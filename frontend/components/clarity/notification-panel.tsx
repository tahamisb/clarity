"use client"

import Link from "next/link"
import { useEffect, useMemo, useRef, useState } from "react"
import { Ban, Bell, BellOff, CheckCheck, Clock, Frown, Loader2, X } from "lucide-react"
import {
  formatRelative,
  useNotifications,
  type AppNotification,
  type NotificationType,
} from "@/lib/notifications-context"
import { useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"

// Per-type icon + accent. Reuses the app's semantic color tokens.
const TYPE_META: Record<
  NotificationType,
  { icon: typeof Clock; tint: string; ring: string }
> = {
  sla: { icon: Clock, tint: "bg-destructive/12 text-destructive", ring: "ring-destructive/20" },
  cancellation: { icon: Ban, tint: "bg-destructive/12 text-destructive", ring: "ring-destructive/20" },
  helpfulness: { icon: Frown, tint: "bg-amber-500/12 text-amber-500", ring: "ring-amber-500/20" },
}

function NotificationItem({
  n,
  read,
  onOpen,
  onDismiss,
}: {
  n: AppNotification
  read: boolean
  onOpen: () => void
  onDismiss: () => void
}) {
  const meta = TYPE_META[n.type]
  const Icon = meta.icon
  return (
    <li className="group relative">
      <Link
        href={n.href}
        onClick={onOpen}
        className={cn(
          "flex items-start gap-3 px-4 py-3 transition-colors hover:bg-secondary/60",
          !read && "bg-accent/[0.04]",
        )}
      >
        <span
          className={cn(
            "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg ring-1",
            meta.tint,
            meta.ring,
          )}
        >
          <Icon className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            {!read && <span className="size-1.5 shrink-0 rounded-full bg-accent" aria-hidden />}
            <span className="truncate text-sm font-semibold text-foreground">{n.title}</span>
          </span>
          <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
            {n.description}
          </span>
          <span className="mt-1 block text-[11px] text-muted-foreground/80">
            {formatRelative(n.timestamp)}
          </span>
        </span>
      </Link>
      <button
        onClick={onDismiss}
        aria-label="Dismiss notification"
        className="absolute right-2 top-2 flex size-6 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-secondary hover:text-foreground group-hover:opacity-100"
      >
        <X className="size-3.5" />
      </button>
    </li>
  )
}

type FilterKey = "all" | NotificationType
const UNREAD_KEY = "unread"

export function NotificationBell() {
  const t = useT()
  const { notifications, unreadCount, loading, role, markAllRead, markRead, dismiss, isRead } =
    useNotifications()
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState<FilterKey>("all")
  const [unreadOnly, setUnreadOnly] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onClick)
    return () => document.removeEventListener("mousedown", onClick)
  }, [])

  // Per-type counts for the filter chips.
  const counts = useMemo(() => {
    const c = { all: notifications.length, sla: 0, cancellation: 0, helpfulness: 0 }
    for (const n of notifications) c[n.type] += 1
    return c
  }, [notifications])

  const visible = useMemo(
    () =>
      notifications.filter(
        (n) => (filter === "all" || n.type === filter) && (!unreadOnly || !isRead(n.id)),
      ),
    [notifications, filter, unreadOnly, isRead],
  )

  // Chips shown — helpfulness only exists for managers, so hide its chip otherwise.
  const chips: { key: FilterKey; label: string }[] = [
    { key: "all", label: t("notif.chipAll") },
    { key: "sla", label: t("notif.chipSla") },
    { key: "cancellation", label: t("notif.chipRisk") },
    ...(role === "manager" ? [{ key: "helpfulness" as FilterKey, label: t("notif.chipAgents") }] : []),
  ]

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative flex size-9 items-center justify-center rounded-lg border border-border bg-secondary/50 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        aria-label={t("notif.aria")}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <Bell className="size-4" />
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 flex min-w-4 items-center justify-center rounded-full bg-negative px-1 text-[10px] font-bold leading-4 text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="glass-frosted absolute right-0 top-11 z-50 flex max-h-[32rem] w-[23rem] flex-col overflow-hidden rounded-xl shadow-2xl">
          {/* Header */}
          <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-foreground">{t("set.notifications")}</span>
              <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-accent">
                {t(`role.${role}`)}
              </span>
              {notifications.length > 0 && (
                <span className="text-xs font-medium text-muted-foreground">
                  {t("notif.unreadTotal", { unread: unreadCount, total: notifications.length })}
                </span>
              )}
            </div>
            {notifications.length > 0 && unreadCount > 0 && (
              <button
                onClick={markAllRead}
                className="flex items-center gap-1 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground"
              >
                <CheckCheck className="size-3.5" />
                {t("notif.markAllRead")}
              </button>
            )}
          </div>

          {/* Filters */}
          {notifications.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-3 py-2">
              {chips.map((c) => (
                <button
                  key={c.key}
                  onClick={() => setFilter(c.key)}
                  className={cn(
                    "rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors",
                    filter === c.key
                      ? "bg-primary text-primary-foreground"
                      : "bg-secondary/70 text-muted-foreground hover:text-foreground",
                  )}
                >
                  {c.label} {counts[c.key]}
                </button>
              ))}
              <button
                onClick={() => setUnreadOnly((v) => !v)}
                className={cn(
                  "ml-auto rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors",
                  unreadOnly
                    ? "bg-accent/20 text-accent"
                    : "bg-secondary/70 text-muted-foreground hover:text-foreground",
                )}
                aria-pressed={unreadOnly}
              >
                {t("notif.unreadOnly")}
              </button>
            </div>
          )}

          {/* Body */}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {loading && notifications.length === 0 ? (
              <div className="flex items-center justify-center gap-2 px-4 py-10 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin text-accent" />
                {t("notif.checking")}
              </div>
            ) : notifications.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
                <span className="flex size-10 items-center justify-center rounded-full bg-secondary text-muted-foreground">
                  <BellOff className="size-5" />
                </span>
                <p className="text-sm font-semibold text-foreground">{t("notif.allCaughtUp")}</p>
                <p className="max-w-[16rem] text-xs leading-relaxed text-muted-foreground">
                  {role === "manager" ? t("notif.noAlertsManager") : t("notif.noAlertsEmployee")}
                </p>
              </div>
            ) : visible.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                {t("notif.noMatch")}
              </div>
            ) : (
              <ul className="divide-y divide-border/60">
                {visible.map((n) => (
                  <NotificationItem
                    key={n.id}
                    n={n}
                    read={isRead(n.id)}
                    onOpen={() => {
                      markRead(n.id)
                      setOpen(false)
                    }}
                    onDismiss={() => dismiss(n.id)}
                  />
                ))}
              </ul>
            )}
          </div>

          {/* Footer */}
          <div className="border-t border-border px-4 py-2.5 text-center">
            <Link
              href="/settings"
              onClick={() => setOpen(false)}
              className="text-xs font-semibold text-accent transition-colors hover:underline"
            >
              {t("notif.manageSettings")}
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
