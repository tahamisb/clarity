"use client"

import { useEffect, useState } from "react"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import type { CrossChannelItem } from "@/lib/api"
import { Panel } from "./panel"
import { Lightbulb } from "lucide-react"

// Find the intent with the biggest skew between channels and describe it.
function buildInsight(data: CrossChannelItem[]): string | null {
  let best: { intent: string; ratio: number; primary: "messages" | "calls" } | null = null

  for (const { intent, calls, messages } of data) {
    if (calls === 0 && messages === 0) continue
    let ratio: number
    let primary: "messages" | "calls"
    if (calls === 0) {
      ratio = Infinity
      primary = "messages"
    } else if (messages === 0) {
      ratio = Infinity
      primary = "calls"
    } else if (messages >= calls) {
      ratio = messages / calls
      primary = "messages"
    } else {
      ratio = calls / messages
      primary = "calls"
    }
    if (!best || ratio > best.ratio) best = { intent, ratio, primary }
  }

  if (!best) return null

  const primaryLabel = best.primary === "messages" ? "text messages" : "calls"
  const otherLabel = best.primary === "messages" ? "calls" : "text messages"

  if (!Number.isFinite(best.ratio)) {
    return `${best.intent} cases are reported exclusively via ${primaryLabel} in the current data, with no ${otherLabel} for this category.`
  }
  if (best.ratio < 1.15) {
    return `${best.intent} cases are reported at roughly equal volume across calls and text messages, with no single channel dominating.`
  }
  const channelHint =
    best.primary === "messages"
      ? "asynchronous channels like WhatsApp or the app"
      : "calling support directly"
  return `${best.intent} cases appear ${best.ratio.toFixed(1)}× more often via ${primaryLabel} than ${otherLabel}. Customers seemingly prefer ${channelHint} for ${best.intent.toLowerCase()}-related matters.`
}

export function CrossChannelComparison({ data }: { data?: CrossChannelItem[] }) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  if (!data?.length) {
    return (
      <Panel title="Cross-Channel Comparison: Calls vs Messages">
        <p className="text-sm text-muted-foreground">
          No cross-channel data yet — run sentiment classification to populate this chart.
        </p>
      </Panel>
    )
  }

  const insight = buildInsight(data)

  return (
    <Panel title="Cross-Channel Comparison: Calls vs Messages">
      <div className="flex flex-col gap-4">
        {mounted ? (
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} margin={{ left: -16, right: 8, top: 16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis
                  dataKey="intent"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                  tickFormatter={(val) => `${(val / 1000).toFixed(0)}k`}
                />
                <Tooltip
                  cursor={{ fill: "rgba(255,255,255,0.05)" }}
                  contentStyle={{
                    background: "var(--popover)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    fontSize: 12,
                    color: "var(--popover-foreground)",
                  }}
                />
                <Legend
                  wrapperStyle={{ fontSize: 12, color: "var(--muted-foreground)" }}
                  iconType="circle"
                />
                <Bar dataKey="calls" name="Calls Volume" fill="var(--chart-5)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="messages" name="Messages Volume" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="h-[280px]" />
        )}

        {insight && (
          <div className="flex items-start gap-3 rounded-xl border border-accent/20 bg-accent/5 p-4">
            <div className="mt-0.5 rounded-full bg-accent/20 p-1.5 text-accent">
              <Lightbulb className="size-4" />
            </div>
            <div>
              <h4 className="text-sm font-semibold text-foreground">AI Insight</h4>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{insight}</p>
            </div>
          </div>
        )}
      </div>
    </Panel>
  )
}
