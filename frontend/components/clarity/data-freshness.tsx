"use client"

import { useEffect, useState } from "react"
import { fetchLiveStatus, type LiveStatus } from "@/lib/api"
import { useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"

/**
 * How current the *warehouse* is — not when this browser last fetched.
 *
 * Those two come apart in the one way that matters on a live dashboard: if the
 * pipeline behind the warehouse stops, every request still succeeds, the
 * refresh timer keeps ticking, and the charts quietly freeze on whatever they
 * last showed. Nothing on screen is wrong, and nothing on screen is current.
 *
 * So this reads the age of the newest row and says so. When it grows the badge
 * degrades — live → lagging → stale — rather than continuing to imply the
 * numbers are fresh. A dashboard that admits it is stale is useful; one that
 * presents old numbers as current is worse than one that is visibly down.
 */

const POLL_MS = 15_000

// amber-500 rather than a token: there is no --warning in the palette, and the
// rest of the app already reaches for amber-500 for exactly this "attention,
// not failure" step (cancellations, settings, login).
const TONE: Record<LiveStatus["state"], string> = {
  live: "bg-positive",
  lagging: "bg-amber-500",
  stale: "bg-negative",
  frozen: "bg-muted-foreground/60",
  unknown: "bg-muted-foreground/40",
}

function ago(seconds: number | null): string {
  if (seconds === null) return "—"
  if (seconds < 60) return `${Math.round(seconds)}s ago`
  const mins = Math.floor(seconds / 60)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  return hrs < 24 ? `${hrs}h ago` : `${Math.floor(hrs / 24)}d ago`
}

export function DataFreshness({ className }: { className?: string }) {
  const t = useT()
  const [status, setStatus] = useState<LiveStatus | null>(null)

  useEffect(() => {
    let cancelled = false
    const poll = async () => {
      const next = await fetchLiveStatus()
      if (!cancelled) setStatus(next)
    }
    poll()
    const id = window.setInterval(poll, POLL_MS)
    // Stop polling while the tab is hidden — a dashboard left open on a wall
    // screen overnight should not keep a connection busy for nobody.
    const onVisible = () => {
      if (document.visibilityState === "visible") poll()
    }
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      cancelled = true
      window.clearInterval(id)
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [])

  const state = status?.state ?? "unknown"
  const detail =
    state === "frozen"
      ? null
      : t("live.dataAge", { ago: ago(status?.orders.age_seconds ?? null) })

  return (
    <span
      className={cn("hidden items-center gap-1.5 lg:flex", className)}
      title={
        status
          ? `${status.warehouse} · clock ${status.clock} · ` +
            `${status.orders.today} orders today · ${status.orders.in_flight} in flight`
          : undefined
      }
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          TONE[state],
          // Only a genuinely live feed pulses. A stalled one holding a steady
          // dot is the point — motion would read as "still arriving".
          state === "live" && "animate-pulse",
        )}
      />
      <span className={cn(state === "stale" && "text-negative font-semibold")}>
        {t(`live.${state}`)}
      </span>
      {detail && <span className="hidden xl:inline text-muted-foreground/80">· {detail}</span>}
    </span>
  )
}
