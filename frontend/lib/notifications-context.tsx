"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { fetchCalls, fetchLiveQueue, fetchMessages } from "./api"
import { useSettings, useAutoRefresh } from "./settings-context"
import { useRole } from "./use-role"
import { useMessageStatus } from "./message-status-context"
import type { UserRole } from "./roles"

// ---------------------------------------------------------------------------
// Role-aware, in-app notifications.
//
// The bell in the top bar opens a panel fed by this provider. Notifications are
// DERIVED from live dashboard data on the same cadence as the dashboards:
//
//   • SLA breach            → unresolved support messages older than the SLA
//                             target (Settings → SLA & Alert Configurations).
//                             Shown to employees AND managers.
//   • High-risk cancellation→ live-queue orders Gemini/the model flags as
//                             "high" risk. Shown to employees AND managers.
//   • Agent helpfulness      → calls where the agent's helpfulness is rated
//                             "Unhelpful". MANAGER ONLY, and names the agent.
//
// Each notification has a stable id so read / dismissed state survives refresh.
// ---------------------------------------------------------------------------

export type NotificationType = "sla" | "cancellation" | "helpfulness"

export type AppNotification = {
  id: string
  type: NotificationType
  title: string
  description: string
  severity: "high" | "medium"
  href: string
  /** epoch ms — used for ordering and the relative timestamp */
  timestamp: number
}

type NotificationsContextValue = {
  notifications: AppNotification[]
  unreadCount: number
  loading: boolean
  role: UserRole
  markAllRead: () => void
  markRead: (id: string) => void
  dismiss: (id: string) => void
  isRead: (id: string) => boolean
  refresh: () => void
}

const NotificationsContext = createContext<NotificationsContextValue | null>(null)

const STORAGE_KEY = "rafeeq.notifications.v1"
/**
 * Safety backstop on items per category — high enough to surface every real
 * breach (there can be hundreds of SLA violations), low enough to keep the DOM
 * sane. The filters in the panel are the intended way to narrow them down.
 */
const PER_TYPE_CAP = 1000

type PersistedState = { read: string[]; dismissed: string[] }

function loadPersisted(): PersistedState {
  if (typeof window === "undefined") return { read: [], dismissed: [] }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return { read: [], dismissed: [] }
    const parsed = JSON.parse(raw) as Partial<PersistedState>
    return { read: parsed.read ?? [], dismissed: parsed.dismissed ?? [] }
  } catch {
    return { read: [], dismissed: [] }
  }
}

function parseDate(value: string | null | undefined): number {
  if (!value) return Date.now()
  const ts = new Date(value.replace(" ", "T")).getTime()
  return Number.isNaN(ts) ? Date.now() : ts
}

export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const { settings, hydrated } = useSettings()
  const role = useRole()
  const { resolvedIds } = useMessageStatus()

  const [notifications, setNotifications] = useState<AppNotification[]>([])
  const [loading, setLoading] = useState(false)
  const [read, setRead] = useState<Set<string>>(new Set())
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())

  // Hydrate read/dismissed state from localStorage.
  useEffect(() => {
    const p = loadPersisted()
    setRead(new Set(p.read))
    setDismissed(new Set(p.dismissed))
  }, [])

  const persist = useCallback((nextRead: Set<string>, nextDismissed: Set<string>) => {
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ read: [...nextRead], dismissed: [...nextDismissed] }),
      )
    } catch {
      /* storage may be unavailable — non-fatal */
    }
  }, [])

  // Keep the latest config in a ref so refresh() is stable across renders.
  const cfg = useRef({ settings, role, dismissed, resolvedIds })
  cfg.current = { settings, role, dismissed, resolvedIds }

  const refresh = useCallback(async () => {
    const { settings: s, role: r, dismissed: dis, resolvedIds: locallyResolved } = cfg.current
    const wantSla = s.notifySlaBreaches
    const wantCancel = s.notifyHighRiskCancellations
    const wantHelp = r === "manager" && s.notifyAgentHelpfulness

    if (!wantSla && !wantCancel && !wantHelp) {
      setNotifications([])
      return
    }

    // Live queue: prefer the app-wide "auto" engine, but if it yields nothing
    // (e.g. no trained model — auto deliberately returns empty), fall back to the
    // Gemini engine, which is what the cancellations page surfaces in that case.
    // Otherwise high-risk orders shown on the page would never raise a notification.
    const fetchQueue = async () => {
      const q = await fetchLiveQueue(50)
      if (q && q.engine !== "none" && q.orders?.length) return q
      return fetchLiveQueue(50, "gemini")
    }

    setLoading(true)
    const [messages, liveQueue, calls] = await Promise.all([
      wantSla ? fetchMessages() : Promise.resolve(null),
      wantCancel ? fetchQueue() : Promise.resolve(null),
      wantHelp ? fetchCalls() : Promise.resolve(null),
    ])

    const next: AppNotification[] = []

    // SLA breaches — conversations whose HANDLING TIME (closed_at − created_at)
    // exceeded the channel's SLA target. Still-open chats fall back to current age.
    if (wantSla && messages) {
      const now = Date.now()
      const breaches = messages
        .filter((m) => !locallyResolved.has(m.id))
        .map((m) => {
          const ts = parseDate(m.date)
          const durationHours =
            m.handlingMinutes != null ? m.handlingMinutes / 60 : (now - ts) / 3_600_000
          const sla = m.channel === "Ticket" ? s.generalSlaHours : s.chatSlaHours
          return { m, ts, durationHours, sla }
        })
        .filter((b) => b.durationHours > b.sla)
        .sort((a, b) => b.durationHours - a.durationHours)
        .slice(0, PER_TYPE_CAP)

      for (const b of breaches) {
        const took = Math.round(b.durationHours)
        next.push({
          id: `sla:${b.m.id}`,
          type: "sla",
          title: `SLA exceeded · ${b.m.channel}`,
          description: b.m.resolved
            ? `${b.m.id} took ${took}h to resolve — past the ${b.sla}h target.`
            : `${b.m.id} open for ${took}h — past the ${b.sla}h target.`,
          severity: "high",
          href: `/messages?msg=${encodeURIComponent(b.m.id)}`,
          timestamp: b.ts,
        })
      }
    }

    // High-risk cancellations — orders the engine flags as "high".
    if (wantCancel && liveQueue?.orders?.length) {
      const generated = parseDate(liveQueue.generated_at)
      const highRisk = liveQueue.orders
        .filter((o) => o.risk_level === "high")
        .sort((a, b) => b.probability - a.probability)
        .slice(0, PER_TYPE_CAP)

      for (const o of highRisk) {
        const id = o.order_id ?? "—"
        const where = [o.restaurant_name, o.zone_name].filter(Boolean).join(" · ")
        next.push({
          id: `cancel:${id}`,
          type: "cancellation",
          title: `High cancellation risk · ${Math.round(o.probability * 100)}%`,
          description: `Order ${id}${where ? ` (${where})` : ""} is at high risk of cancellation.`,
          severity: "high",
          href: "/cancellations",
          timestamp: generated,
        })
      }
    }

    // Poor agent helpfulness — manager only, names the agent.
    if (wantHelp && calls) {
      const poor = calls
        .filter((c) => c.agentHelpfulness === "Unhelpful")
        .sort((a, b) => parseDate(b.datetime) - parseDate(a.datetime))
        .slice(0, PER_TYPE_CAP)

      for (const c of poor) {
        const agent = c.agent && c.agent !== "—" ? c.agent : "Unknown agent"
        next.push({
          id: `help:${c.id}`,
          type: "helpfulness",
          title: `Poor helpfulness · ${agent}`,
          description: `Call ${c.id} was rated "Unhelpful" — review ${agent}'s handling.`,
          severity: "medium",
          href: "/",
          timestamp: parseDate(c.datetime),
        })
      }
    }

    const filtered = next
      .filter((n) => !dis.has(n.id))
      .sort((a, b) => b.timestamp - a.timestamp)

    setNotifications(filtered)
    setLoading(false)
  }, [])

  // Initial load + re-derive when role or the relevant toggles change.
  useEffect(() => {
    if (!hydrated) return
    refresh()
  }, [
    hydrated,
    refresh,
    role,
    resolvedIds,
    settings.notifySlaBreaches,
    settings.notifyHighRiskCancellations,
    settings.notifyAgentHelpfulness,
    settings.chatSlaHours,
    settings.generalSlaHours,
  ])

  // Re-derive on the dashboards' auto-refresh cadence.
  useAutoRefresh(() => refresh())

  const markAllRead = useCallback(() => {
    setRead((prev) => {
      const nextRead = new Set(prev)
      for (const n of notifications) nextRead.add(n.id)
      persist(nextRead, dismissed)
      return nextRead
    })
  }, [notifications, dismissed, persist])

  const markRead = useCallback(
    (id: string) => {
      setRead((prev) => {
        if (prev.has(id)) return prev
        const nextRead = new Set(prev).add(id)
        persist(nextRead, dismissed)
        return nextRead
      })
    },
    [dismissed, persist],
  )

  const dismiss = useCallback(
    (id: string) => {
      setNotifications((prev) => prev.filter((n) => n.id !== id))
      setDismissed((prev) => {
        const nextDismissed = new Set(prev).add(id)
        persist(read, nextDismissed)
        return nextDismissed
      })
    },
    [read, persist],
  )

  const isRead = useCallback((id: string) => read.has(id), [read])

  const unreadCount = useMemo(
    () => notifications.reduce((n, x) => (read.has(x.id) ? n : n + 1), 0),
    [notifications, read],
  )

  const value: NotificationsContextValue = {
    notifications,
    unreadCount,
    loading,
    role,
    markAllRead,
    markRead,
    dismiss,
    isRead,
    refresh,
  }

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>
}

export function useNotifications(): NotificationsContextValue {
  const ctx = useContext(NotificationsContext)
  if (!ctx) throw new Error("useNotifications must be used within a NotificationsProvider")
  return ctx
}

/** "3h ago" style formatter for the panel. */
export function formatRelative(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return "just now"
  const mins = Math.floor(diff / 60_000)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}
