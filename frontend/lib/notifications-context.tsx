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
import { fetchCalls, fetchLiveQueue, fetchSlaBreaches } from "./api"
import { useSettings, useAutoRefresh } from "./settings-context"
import { useRole } from "./use-role"
import { useTimeFilter } from "./time-filter-context"
import type { UserRole } from "./roles"
import { now } from "./frozen-clock"

// ---------------------------------------------------------------------------
// Role-aware, in-app notifications.
//
// The bell in the top bar opens a panel fed by this provider. Notifications are
// DERIVED from the same data the dashboards show, so counts match what's on
// screen. Each breach is ONE notification (individually clickable; filter by the
// panel's type chips), not a summary:
//
//   • SLA breach            → each breaching conversation, server-computed over
//                             the full window (matches the Messages SLA banner —
//                             the capped feed missed most). Links to the message.
//                             Shown to employees AND managers.
//   • High cancellation risk→ each order the live prediction queue flags "high"
//                             (same queue/engine the Cancellations page shows).
//                             Shown to employees AND managers.
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

const STORAGE_KEY = "clarity.notifications.v1"
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
  if (!value) return now().getTime()
  const ts = new Date(value.replace(" ", "T")).getTime()
  return Number.isNaN(ts) ? now().getTime() : ts
}

export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const { settings, hydrated } = useSettings()
  const role = useRole()
  const { range, vertical, queryKey } = useTimeFilter()

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
  const cfg = useRef({ settings, role, dismissed, range, vertical })
  cfg.current = { settings, role, dismissed, range, vertical }

  const refresh = useCallback(async () => {
    const { settings: s, role: r, dismissed: dis, range: win, vertical: vert } = cfg.current
    const wantSla = s.notifySlaBreaches
    const wantCancel = s.notifyHighRiskCancellations
    const wantHelp = r === "manager" && s.notifyAgentHelpfulness

    if (!wantSla && !wantCancel && !wantHelp) {
      setNotifications([])
      return
    }

    setLoading(true)
    // SLA: server-computed breaches over the global window/vertical (matches the
    // Messages banner). Cancellation: the same live prediction queue the
    // Cancellations page renders (limit 500, Gemini engine) — not window-scoped,
    // it's a "pending orders at risk now" view.
    const [slaBreaches, liveQueue, calls] = await Promise.all([
      wantSla ? fetchSlaBreaches(win, s.chatSlaHours, s.generalSlaHours, vert) : Promise.resolve(null),
      wantCancel ? fetchLiveQueue(500) : Promise.resolve(null),
      wantHelp ? fetchCalls() : Promise.resolve(null),
    ])

    const next: AppNotification[] = []

    // SLA breaches — one per breaching conversation, most-overdue first, each
    // deep-linking to its message on the Messages page.
    if (wantSla && slaBreaches) {
      const ts = now().getTime()
      const channelLabel: Record<string, string> = { app: "App", whatsapp: "WhatsApp", ticket: "Ticket" }
      for (const b of slaBreaches.slice(0, PER_TYPE_CAP)) {
        const chan = channelLabel[b.channel] ?? b.channel
        const sla = b.channel === "ticket" ? s.generalSlaHours : s.chatSlaHours
        const took = Math.round(b.hours)
        const msgId = `MSG-${b.message_id.slice(0, 8).toUpperCase()}`
        next.push({
          id: `sla:${b.message_id}`,
          type: "sla",
          title: `SLA exceeded · ${chan}`,
          description: b.resolved
            ? `${msgId} took ${took}h to resolve — past the ${sla}h target.`
            : `${msgId} open for ${took}h — past the ${sla}h target.`,
          severity: "high",
          href: `/messages?msg=${encodeURIComponent(msgId)}`,
          timestamp: ts,
        })
      }
    }

    // High-risk cancellations — one per order the live queue flags "high".
    if (wantCancel && liveQueue?.orders?.length) {
      const ts = now().getTime()
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
          href: o.order_id ? `/cancellations?order=${encodeURIComponent(o.order_id)}` : "/cancellations",
          timestamp: ts,
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

    // Backend feeds can repeat a source row (e.g. one message breaching twice);
    // ids must be unique — keep the first occurrence of each.
    const filtered = [...new Map(next.map((n) => [n.id, n])).values()]
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
    queryKey,
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

/** "3h ago" style formatter for the panel — measured against the frozen clock. */
export function formatRelative(ts: number): string {
  const diff = now().getTime() - ts
  if (diff < 60_000) return "just now"
  const mins = Math.floor(diff / 60_000)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}
