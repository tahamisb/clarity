"use client"

import { useEffect, useState } from "react"
import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts"
import { SENTIMENT_COLORS, type CallRecord, type Sentiment } from "@/lib/rafeeq-data"
import { useT, useTV } from "@/lib/i18n"
import { Panel } from "./panel"

const ORDER: Sentiment[] = ["Positive", "Neutral", "Negative"]

export function ToneChart({ calls }: { calls: CallRecord[] }) {
  const t = useT()
  const tv = useTV()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const counts: Record<Sentiment, number> = { Positive: 0, Neutral: 0, Negative: 0 }
  for (const c of calls) counts[c.sentiment]++
  const total = calls.length
  const data = ORDER.map((name) => ({ name, value: counts[name] })).filter((d) => d.value > 0)

  return (
    <Panel title={t("chart.sentimentDistribution")}>
      {total === 0 ? (
        <div className="flex h-36 items-center justify-center text-xs text-muted-foreground">
          {t("chart.uploadForSentiment")}
        </div>
      ) : (
        <div className="flex items-center gap-4">
          <div className="relative h-36 w-36 shrink-0">
            {mounted && (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={data}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={48}
                    outerRadius={68}
                    paddingAngle={2}
                    stroke="none"
                  >
                    {data.map((d) => (
                      <Cell key={d.name} fill={SENTIMENT_COLORS[d.name as Sentiment]} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            )}
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-lg font-bold text-foreground">{total}</span>
              <span className="text-[10px] text-muted-foreground">{t("unit.calls")}</span>
            </div>
          </div>

          <ul className="flex-1 space-y-2">
            {ORDER.map((name) => (
              <li key={name} className="flex items-center gap-2 text-sm">
                <span
                  className="size-2.5 rounded-full"
                  style={{ background: SENTIMENT_COLORS[name] }}
                />
                <span className="flex-1 text-foreground">{tv(name)}</span>
                <span className="tabular-nums font-semibold text-foreground">
                  {((counts[name] / total) * 100).toFixed(0)}%
                </span>
                <span className="w-14 text-right tabular-nums text-xs text-muted-foreground">
                  {counts[name].toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  )
}
