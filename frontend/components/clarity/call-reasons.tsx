"use client"

import { useMemo } from "react"
import { type CallRecord } from "@/lib/clarity-data"
import { useT, useTV } from "@/lib/i18n"
import { Panel } from "./panel"

const COLORS = ["#9b4dff", "#3b82f6", "#f5a623", "#22c55e", "#06b6d4", "#ef4444", "#a78bfa", "#f97316"]

/**
 * Why customers called — ranked by volume, with each reason's negative share.
 *
 * Replaces the old category breakdown, which bucketed a third of all calls into
 * a meaningless "General". A reason is the concrete trigger ("Charged twice for
 * one order"), taken from the analysis and never a bucket name.
 */
export function CallReasons({ calls }: { calls: CallRecord[] }) {
  const t = useT()
  const tv = useTV()

  const rows = useMemo(() => {
    const map = new Map<string, { volume: number; negative: number }>()
    for (const c of calls) {
      const key = c.reason || c.intent
      const agg = map.get(key) ?? { volume: 0, negative: 0 }
      agg.volume++
      if (c.sentiment === "Negative") agg.negative++
      map.set(key, agg)
    }
    const total = calls.length || 1
    return [...map.entries()]
      .map(([reason, { volume, negative }]) => ({
        reason,
        volume,
        pct: Math.round((volume / total) * 100),
        negativePct: Math.round((negative / volume) * 100),
      }))
      .sort((a, b) => b.volume - a.volume)
      .slice(0, 8)
  }, [calls])

  const max = rows[0]?.volume ?? 1

  return (
    <Panel title={t("chart.callReasons")}>
      {rows.length === 0 ? (
        <div className="flex h-[230px] items-center justify-center text-xs text-muted-foreground">
          {t("chart.uploadForReasons")}
        </div>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {rows.map((r, i) => (
            <li key={r.reason} className="flex flex-col gap-1">
              <div className="flex items-baseline justify-between gap-3 text-xs">
                <span className="truncate font-medium text-foreground" title={tv(r.reason)}>
                  {tv(r.reason)}
                </span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {r.volume.toLocaleString()} · {r.pct}%
                </span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted/40">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${(r.volume / max) * 100}%`, background: COLORS[i % COLORS.length] }}
                  />
                </div>
                {/* Negative share is paired with a word, not colour alone. */}
                <span className="w-24 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
                  {t("chart.negShare", { pct: r.negativePct })}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}
