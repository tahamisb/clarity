"use client"

import { useEffect, useState } from "react"
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { type CallRecord } from "@/lib/clarity-data"
import { useT, useTV } from "@/lib/i18n"
import { Panel } from "./panel"

function getWeekLabel(dateStr: string): string {
  // dateStr format: "2026-06-14 15:38"
  const d = new Date(dateStr.replace(" ", "T"))
  const startOfYear = new Date(d.getFullYear(), 0, 1)
  const week = Math.ceil(((d.getTime() - startOfYear.getTime()) / 86400000 + startOfYear.getDay() + 1) / 7)
  return `W${week}`
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1 text-muted-foreground">
      <span className="size-2 rounded-full" style={{ background: color }} />
      {label}
    </span>
  )
}

export function SentimentTrend({ calls }: { calls: CallRecord[] }) {
  const t = useT()
  const tv = useTV()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const legends = (
    <div className="flex items-center gap-3 text-[11px]">
      <Legend color="var(--positive)" label={tv("Positive")} />
      <Legend color="var(--neutral)" label={tv("Neutral")} />
      <Legend color="var(--negative)" label={tv("Negative")} />
    </div>
  )

  if (calls.length === 0) {
    return (
      <Panel title={t("chart.sentimentTrendWeek")} action={legends}>
        <div className="flex h-[240px] items-center justify-center text-xs text-muted-foreground">
          {t("chart.uploadForTrend")}
        </div>
      </Panel>
    )
  }

  // Group calls by week
  const weekMap: Record<string, { pos: number; neu: number; neg: number }> = {}
  for (const c of calls) {
    const wk = getWeekLabel(c.datetime)
    if (!weekMap[wk]) weekMap[wk] = { pos: 0, neu: 0, neg: 0 }
    if (c.sentiment === "Positive") weekMap[wk].pos++
    else if (c.sentiment === "Neutral") weekMap[wk].neu++
    else weekMap[wk].neg++
  }

  const data = Object.entries(weekMap)
    .sort(([a], [b]) => {
      // Sort by numeric week number
      const n = (s: string) => parseInt(s.replace("W", ""), 10)
      return n(a) - n(b)
    })
    .map(([week, { pos, neu, neg }]) => {
      const total = pos + neu + neg
      return {
        week,
        positive: Math.round((pos / total) * 100),
        neutral: Math.round((neu / total) * 100),
        negative: Math.round((neg / total) * 100),
      }
    })

  return (
    <Panel title={t("chart.sentimentTrendWeek")} action={legends}>
      {mounted ? (
        <div className="overflow-hidden">
        <ResponsiveContainer width="100%" height={240}>
          <AreaChart data={data} margin={{ left: -16, right: 8, top: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis
              dataKey="week"
              tickLine={false}
              axisLine={false}
              tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
              unit="%"
            />
            <Tooltip
              contentStyle={{
                background: "var(--popover)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                fontSize: 12,
                color: "var(--popover-foreground)",
              }}
            />
            <Area type="monotone" dataKey="positive" stackId="1" stroke="var(--positive)" fill="var(--positive)" fillOpacity={0.25} />
            <Area type="monotone" dataKey="neutral"  stackId="1" stroke="var(--neutral)" fill="var(--neutral)" fillOpacity={0.2}  />
            <Area type="monotone" dataKey="negative" stackId="1" stroke="var(--negative)" fill="var(--negative)" fillOpacity={0.25} />
          </AreaChart>
        </ResponsiveContainer>
        </div>
      ) : (
        <div style={{ height: 240 }} />
      )}
    </Panel>
  )
}
