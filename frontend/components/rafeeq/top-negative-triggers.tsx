"use client"

import type { TriggerItem } from "@/lib/api"
import { Panel } from "./panel"
import { TrendingDown, TrendingUp } from "lucide-react"

export function TopNegativeTriggers({ data }: { data?: TriggerItem[] }) {
  if (!data?.length) {
    return (
      <Panel title="Top 5 Negative Triggers">
        <p className="text-sm text-muted-foreground">
          No negative triggers yet — run sentiment classification to populate this panel.
        </p>
      </Panel>
    )
  }

  return (
    <Panel title="Top 5 Negative Triggers">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {data.map((t) => (
          <div
            key={t.rank}
            className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4 transition-colors hover:bg-secondary/20"
          >
            <div className="flex items-center justify-between">
              <span className="flex size-6 items-center justify-center rounded-full bg-accent/20 text-xs font-bold text-accent">
                {t.rank}
              </span>
              {t.trend === "up" ? (
                <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-negative">
                  <TrendingUp className="size-3" /> Up
                </span>
              ) : (
                <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-positive">
                  <TrendingDown className="size-3" /> Down
                </span>
              )}
            </div>

            <div className="mt-1">
              <h4 className="font-semibold text-foreground line-clamp-1" title={t.trigger}>
                {t.trigger}
              </h4>
              <p className="mt-1 text-2xl font-bold tabular-nums text-foreground">
                {t.volume.toLocaleString()}
              </p>
              <p className="text-xs text-muted-foreground">messages</p>
            </div>

            <div className="mt-2 flex flex-col gap-1.5 border-t border-border pt-3 text-[11px] text-muted-foreground">
              <div className="flex items-center justify-between">
                <span>Peak Zone:</span>
                <span className="font-medium text-foreground">{t.zone}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Peak Time:</span>
                <span className="font-medium text-foreground">{t.time}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </Panel>
  )
}
