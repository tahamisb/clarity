"use client"

import { useEffect, useMemo, useState } from "react"
import { Bar, BarChart, Cell, ResponsiveContainer, XAxis, YAxis } from "recharts"
import { type CallRecord } from "@/lib/rafeeq-data"
import { Panel } from "./panel"

const COLORS = ["#9b4dff", "#3b82f6", "#f5a623", "#22c55e", "#06b6d4", "#ef4444", "#a78bfa"]

export function CategoryBreakdown({ calls }: { calls: CallRecord[] }) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const data = useMemo(() => {
    const map: Record<string, number> = {}
    for (const c of calls) map[c.category] = (map[c.category] || 0) + 1
    const total = calls.length || 1
    return Object.entries(map)
      .map(([name, value]) => ({ name, value, pct: Math.round((value / total) * 100) }))
      .sort((a, b) => b.value - a.value)
  }, [calls])

  return (
    <Panel title="Call Categories">
      {calls.length === 0 ? (
        <div className="flex h-[230px] items-center justify-center text-xs text-muted-foreground">
          Upload transcripts to see category breakdown
        </div>
      ) : (
        <>
          {mounted ? (
            <ResponsiveContainer width="100%" height={Math.max(120, data.length * 36)}>
              <BarChart
                data={data}
                layout="vertical"
                margin={{ left: 0, right: 16, top: 0, bottom: 0 }}
              >
                <XAxis type="number" hide />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={120}
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                />
                <Bar dataKey="value" radius={[0, 6, 6, 0]} barSize={16}>
                  {data.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div style={{ height: Math.max(120, data.length * 36) }} />
          )}
          <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            {data.map((c, i) => (
              <li key={c.name} className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 truncate text-muted-foreground">
                  <span
                    className="size-2 rounded-full"
                    style={{ background: COLORS[i % COLORS.length] }}
                  />
                  {c.name}
                </span>
                <span className="tabular-nums font-semibold text-foreground">{c.pct}%</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  )
}
