"use client"

import { useMemo, useState } from "react"
import { cn } from "@/lib/utils"
import { type CallRecord } from "@/lib/rafeeq-data"
import { useT, useTV } from "@/lib/i18n"
import { Panel } from "./panel"

export function TopTopics({ calls }: { calls: CallRecord[] }) {
  const t = useT()
  const tv = useTV()
  const [mode, setMode] = useState<"frequency" | "negative">("frequency")

  const rows = useMemo(() => {
    const total = calls.length || 1
    const map: Record<string, { volume: number; negative: number; confSum: number }> = {}
    for (const c of calls) {
      if (!map[c.intent]) map[c.intent] = { volume: 0, negative: 0, confSum: 0 }
      map[c.intent].volume++
      if (c.sentiment === "Negative") map[c.intent].negative++
      map[c.intent].confSum += c.confidence
    }

    const all = Object.entries(map).map(([topic, { volume, negative, confSum }]) => ({
      topic,
      volume,
      pct: Math.round((volume / total) * 100),
      negativePct: Math.round((negative / volume) * 100),
      confidence: Math.round(confSum / volume),
    }))

    const sorted =
      mode === "frequency"
        ? [...all].sort((a, b) => b.volume - a.volume)
        : [...all].sort((a, b) => b.negativePct - a.negativePct)

    return sorted.slice(0, 10).map((t, i) => ({ ...t, rank: i + 1 }))
  }, [calls, mode])

  const toggle = (
    <div className="flex rounded-lg border border-border p-0.5 text-xs">
      {(
        [
          ["frequency", t("topics.byFrequency")],
          ["negative", t("topics.byNegativity")],
        ] as const
      ).map(([key, label]) => (
        <button
          key={key}
          onClick={() => setMode(key)}
          className={cn(
            "rounded-md px-2.5 py-1 font-medium transition-colors",
            mode === key
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  )

  return (
    <Panel title={t("chart.topTopics")} action={toggle}>
      {calls.length === 0 ? (
        <div className="flex h-24 items-center justify-center text-xs text-muted-foreground">
          {t("chart.uploadForTopics")}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2 font-semibold">#</th>
                <th className="px-3 py-2 font-semibold">{t("col.intent")}</th>
                <th className="px-3 py-2 font-semibold">{t("col.calls")}</th>
                <th className="px-3 py-2 font-semibold">{t("col.pctTotal")}</th>
                <th className="px-3 py-2 font-semibold">{t("col.negativePct")}</th>
                <th className="px-3 py-2 font-semibold">{t("col.avgConf")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr
                  key={t.topic}
                  className={cn(
                    "border-b border-border/60",
                    t.rank <= 3 && "bg-accent/5",
                  )}
                >
                  <td className="px-3 py-2.5 font-bold text-accent">{t.rank}</td>
                  <td className="px-3 py-2.5 text-foreground">{tv(t.topic)}</td>
                  <td className="px-3 py-2.5 tabular-nums text-muted-foreground">
                    {t.volume.toLocaleString()}
                  </td>
                  <td className="px-3 py-2.5 tabular-nums text-muted-foreground">{t.pct}%</td>
                  <td className="px-3 py-2.5">
                    <span
                      className={cn(
                        "tabular-nums font-semibold",
                        t.negativePct >= 60
                          ? "text-negative"
                          : t.negativePct >= 40
                            ? "text-neutral"
                            : "text-positive",
                      )}
                    >
                      {t.negativePct}%
                    </span>
                  </td>
                  <td className="px-3 py-2.5 tabular-nums text-muted-foreground">
                    {t.confidence}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  )
}
