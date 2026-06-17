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
import type { TrendItem } from "@/lib/api"
import { Panel } from "./panel"

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1 text-muted-foreground">
      <span className="size-2 rounded-full" style={{ background: color }} />
      {label}
    </span>
  )
}

export function MessageSentimentTrend({ data }: { data?: TrendItem[] }) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const legends = (
    <div className="flex items-center gap-3 text-[11px]">
      <Legend color="var(--positive)" label="Positive" />
      <Legend color="var(--neutral)" label="Neutral" />
      <Legend color="var(--negative)" label="Negative" />
    </div>
  )

  if (!data?.length) {
    return (
      <Panel title="Message Sentiment Trend by Week" action={legends}>
        <p className="text-sm text-muted-foreground">
          No sentiment trend data yet — run sentiment classification to populate this chart.
        </p>
      </Panel>
    )
  }

  return (
    <Panel title="Message Sentiment Trend by Week" action={legends}>
      {mounted ? (
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
      ) : (
        <div style={{ height: 240 }} />
      )}
    </Panel>
  )
}
