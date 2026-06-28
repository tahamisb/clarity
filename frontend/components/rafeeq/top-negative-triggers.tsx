"use client"

import type { TriggerItem } from "@/lib/api"
import { Panel } from "./panel"
import { TrendingDown, TrendingUp } from "lucide-react"
import { useT, useTV } from "@/lib/i18n"

export function TopNegativeTriggers({ data }: { data?: TriggerItem[] }) {
  const t = useT()
  const tv = useTV()
  if (!data?.length) {
    return (
      <Panel title={t("trig.title")}>
        <p className="text-sm text-muted-foreground">
          {t("trig.empty")}
        </p>
      </Panel>
    )
  }

  return (
    <Panel title={t("trig.title")}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {data.map((item) => (
          <div
            key={item.rank}
            className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4 transition-colors hover:bg-secondary/20"
          >
            <div className="flex items-center justify-between">
              <span className="flex size-6 items-center justify-center rounded-full bg-accent/20 text-xs font-bold text-accent">
                {item.rank}
              </span>
              {item.trend === "up" ? (
                <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-negative">
                  <TrendingUp className="size-3" /> {t("trig.up")}
                </span>
              ) : (
                <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-positive">
                  <TrendingDown className="size-3" /> {t("trig.down")}
                </span>
              )}
            </div>

            <div className="mt-1">
              <h4 className="font-semibold text-foreground line-clamp-1" title={item.trigger}>
                {item.trigger}
              </h4>
              <p className="mt-1 text-2xl font-bold tabular-nums text-foreground">
                {item.volume.toLocaleString()}
              </p>
              <p className="text-xs text-muted-foreground">{t("trig.messages")}</p>
            </div>

            <div className="mt-2 flex flex-col gap-1.5 border-t border-border pt-3 text-[11px] text-muted-foreground">
              <div className="flex items-center justify-between">
                <span>{t("trig.peakZone")}</span>
                <span className="font-medium text-foreground">{tv(item.zone)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>{t("trig.peakTime")}</span>
                <span className="font-medium text-foreground">{tv(item.time)}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </Panel>
  )
}
