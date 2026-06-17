"use client"

import { useMemo } from "react"
import { cn } from "@/lib/utils"
import { type CallRecord } from "@/lib/rafeeq-data"
import { Panel } from "./panel"

export function IntentPanel({
  calls,
  selected,
  onSelect,
}: {
  calls: CallRecord[]
  selected: string | null
  onSelect: (intent: string | null) => void
}) {
  const intents = useMemo(() => {
    const map: Record<string, { count: number; sentimentSum: number }> = {}
    for (const c of calls) {
      if (!map[c.intent]) map[c.intent] = { count: 0, sentimentSum: 0 }
      map[c.intent].count++
      map[c.intent].sentimentSum +=
        c.sentiment === "Positive" ? 1 : c.sentiment === "Negative" ? -1 : 0
    }
    const total = calls.length || 1
    return Object.entries(map)
      .map(([name, { count, sentimentSum }]) => ({
        name,
        value: count,
        pct: Math.round((count / total) * 100),
        avgSentiment: count > 0 ? sentimentSum / count : 0,
      }))
      .sort((a, b) => b.value - a.value)
  }, [calls])

  const max = Math.max(1, ...intents.map((i) => i.value))

  const actionSlot = selected ? (
    <button
      onClick={() => onSelect(null)}
      className="text-xs font-semibold text-accent hover:underline"
    >
      Clear filter
    </button>
  ) : (
    <span className="text-xs text-muted-foreground">Click to filter calls</span>
  )

  return (
    <Panel title="Intent Classification" action={actionSlot}>
      {calls.length === 0 ? (
        <div className="flex h-24 items-center justify-center text-xs text-muted-foreground">
          Upload transcripts to see intent breakdown
        </div>
      ) : (
        <ul className="space-y-2.5">
          {intents.map((intent) => {
            const active = selected === intent.name
            const sentColor =
              intent.avgSentiment > 0.2
                ? "text-positive"
                : intent.avgSentiment < -0.2
                  ? "text-negative"
                  : "text-neutral"
            return (
              <li key={intent.name}>
                <button
                  onClick={() => onSelect(active ? null : intent.name)}
                  className={cn(
                    "group w-full rounded-lg border px-3 py-2 text-left transition-colors",
                    active
                      ? "border-accent bg-accent/10"
                      : "border-transparent hover:bg-secondary",
                  )}
                >
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium text-foreground">{intent.name}</span>
                    <span className="tabular-nums text-muted-foreground">{intent.pct}%</span>
                  </div>
                  <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                    <div
                      className="h-full rounded-full bg-accent"
                      style={{ width: `${(intent.value / max) * 100}%` }}
                    />
                  </div>
                  <div className="mt-1 flex items-center justify-between text-[11px]">
                    <span className="tabular-nums text-muted-foreground">
                      {intent.value.toLocaleString()} calls
                    </span>
                    <span className={cn("font-semibold tabular-nums", sentColor)}>
                      {intent.avgSentiment > 0 ? "+" : ""}
                      {intent.avgSentiment.toFixed(2)} tone
                    </span>
                  </div>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </Panel>
  )
}
