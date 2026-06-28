"use client"

import { ChevronRight, LogOut, Search, ShieldOff, X } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { signOut, useSession } from "next-auth/react"
import { NotificationBell } from "./notification-panel"
import { GlobalTimeRange } from "./time-range-select"
import { useT } from "@/lib/i18n"

// Mirror of auth.config.ts AUTH_BYPASS — see "Temporary auth bypass" in AUTH_SETUP.md.
const AUTH_BYPASS = process.env.NEXT_PUBLIC_AUTH_BYPASS === "true"

function initialsFromName(name?: string | null, email?: string | null) {
  if (name) {
    const parts = name.trim().split(/\s+/)
    const first = parts[0]?.[0] ?? ""
    const last = parts.length > 1 ? parts[parts.length - 1][0] : ""
    return (first + last).toUpperCase() || "?"
  }
  if (email) return email[0]?.toUpperCase() ?? "?"
  return "?"
}

function ProfileMenu() {
  const t = useT()
  const { data: session } = useSession()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onClick)
    return () => document.removeEventListener("mousedown", onClick)
  }, [])

  // Dev bypass: no real session yet (no Google credentials). Show an explicit
  // "auth bypassed" indicator instead of a broken profile / sign-out flow.
  if (AUTH_BYPASS) {
    return (
      <span
        className="flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs font-bold text-amber-600 dark:text-amber-400"
        title={t("top.authBypassedTitle")}
      >
        <ShieldOff className="size-3.5" />
        {t("top.authBypassed")}
      </span>
    )
  }

  const user = session?.user
  const initials = initialsFromName(user?.name, user?.email)

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex size-9 items-center justify-center rounded-full bg-gradient-to-br from-primary to-brand-bright text-sm font-bold text-primary-foreground shadow-sm transition-opacity hover:opacity-90 cursor-pointer"
        aria-label={t("top.accountMenu")}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {initials}
      </button>

      {open && (
        <div className="glass-frosted absolute right-0 top-11 z-50 w-60 overflow-hidden rounded-xl shadow-2xl">
          <div className="flex items-center gap-3 border-b border-border px-4 py-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-brand-bright text-sm font-bold text-primary-foreground">
              {initials}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-foreground">
                {user?.name ?? t("top.signedIn")}
              </p>
              <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
            </div>
          </div>
          <button
            onClick={() => signOut({ redirectTo: "/login" })}
            className="flex w-full items-center gap-2.5 px-4 py-3 text-sm font-medium text-foreground transition-colors hover:bg-secondary"
          >
            <LogOut className="size-4 text-muted-foreground" />
            {t("top.signOut")}
          </button>
        </div>
      )}
    </div>
  )
}

export function Topbar({
  title = "Call Intelligence",
  search,
  onSearch,
}: {
  title?: string
  search: string
  onSearch: (value: string) => void
}) {
  const t = useT()
  return (
    <header className="glass-frosted sticky top-0 z-30 flex items-center justify-between gap-4 rounded-none border-x-0 border-t-0 px-4 py-3 md:px-6">
      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">{t("top.brand")}</span>
        <ChevronRight className="size-4 text-muted-foreground rtl:rotate-180" />
        <span className="font-semibold text-foreground">{title}</span>
      </div>

      <div className="flex items-center gap-2 md:gap-3">
        {/* App-wide time-range filter — governs every dashboard tab. */}
        <GlobalTimeRange className="hidden lg:flex" />

        <div className="flex items-center gap-2 rounded-full border border-border bg-secondary/50 px-3 py-1.5 text-sm transition-colors focus-within:border-accent/50">
          <Search className="size-4 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder={t("top.searchCalls")}
            className="w-28 bg-transparent text-foreground placeholder:text-muted-foreground focus:outline-none md:w-44"
            aria-label={t("top.searchAria")}
          />
          {search && (
            <button
              onClick={() => onSearch("")}
              aria-label={t("top.clearSearch")}
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>

        <NotificationBell />

        <ProfileMenu />
      </div>
    </header>
  )
}
