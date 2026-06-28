"use client"

import { AlertTriangle, Hash, Mail, X } from "lucide-react"
import { useState } from "react"
import { useSettings } from "@/lib/settings-context"
import { useT } from "@/lib/i18n"

/**
 * Banner shown when a configured alert threshold (cancellation rate / sentiment
 * spike) is breached. It surfaces the breaching items and the channels the alert
 * would be delivered to, per the Settings page configuration.
 */
export function ThresholdAlert({
  title,
  items,
}: {
  title: string
  /** Human-readable breach descriptions, e.g. "Al Wakrah — 12.4% (limit 8%)". */
  items: string[]
}) {
  const { settings } = useSettings()
  const t = useT()
  const [dismissed, setDismissed] = useState(false)

  if (dismissed || items.length === 0) return null

  const channels: { icon: typeof Hash; label: string }[] = []
  if (settings.slackAlerts) channels.push({ icon: Hash, label: t("set.slack") })
  if (settings.emailAlerts) channels.push({ icon: Mail, label: t("set.email") })

  return (
    <div className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
      <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-destructive/15 text-destructive">
        <AlertTriangle className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {items.map((it, i) => (
            <li key={i} className="flex items-center gap-1.5">
              <span className="size-1 rounded-full bg-destructive" />
              {it}
            </li>
          ))}
        </ul>
        <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
          {channels.length > 0 ? (
            <>
              <span>{t("ta.wouldNotifyVia")}</span>
              {channels.map((c) => (
                <span
                  key={c.label}
                  className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 font-semibold text-foreground"
                >
                  <c.icon className="size-3" />
                  {c.label}
                </span>
              ))}
            </>
          ) : (
            <span>{t("ta.noChannels")}</span>
          )}
        </div>
      </div>
      <button
        onClick={() => setDismissed(true)}
        className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
        aria-label={t("a11y.dismissAlert")}
      >
        <X className="size-4" />
      </button>
    </div>
  )
}
