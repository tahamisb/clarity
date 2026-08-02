"use client"

import { useEffect, useState } from "react"
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Area,
  AreaChart,
  Cell
} from "recharts"
import type { ZoneItem, TimeItem } from "@/lib/api"
import { Panel } from "./panel"
import { useT, useTV } from "@/lib/i18n"

// Real zone names come back as "Zone 18 Muaither" — shorten to "Zone 18" for
// axis labels while the full name remains available in the tooltip.
function shortZoneLabel(zone: string): string {
  const match = zone.match(/^Zone\s+\d+/i)
  if (match) return match[0]
  return zone.length > 14 ? `${zone.slice(0, 13)}…` : zone
}

export function SentimentByZoneTime({
  zoneData,
  timeData,
}: {
  zoneData?: ZoneItem[]
  timeData: TimeItem[]
}) {
  const t = useT()
  const tv = useTV()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const zoneChartHeight = Math.max(240, (zoneData?.length ?? 0) * 28)

  return (
    <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
      {/* Zone Chart */}
      <Panel title={t("szt.byZone")}>
        {zoneData?.length ? (
          <div style={{ height: zoneChartHeight }}>
            {mounted ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={zoneData}
                  layout="vertical"
                  margin={{ left: 16, right: 16, top: 8, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                  <XAxis
                    type="number"
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                    unit="%"
                    domain={[0, 'dataMax + 5']}
                  />
                  <YAxis
                    dataKey="zone"
                    type="category"
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                    tickFormatter={shortZoneLabel}
                    interval={0}
                    width={72}
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
                    formatter={(val: any) => [`${val}%`, t("szt.negativePct")]}
                  />
                  <Bar
                    dataKey="negativePct"
                    radius={[0, 4, 4, 0]}
                  >
                    {
                      zoneData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.negativePct >= 40 ? "var(--negative)" : "var(--neutral)"} />
                      ))
                    }
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full" />
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {t("szt.zoneEmpty")}
          </p>
        )}
      </Panel>

      {/* Time of Day Chart */}
      <Panel title={t("szt.byTime")}>
        <div className="h-[240px]">
          {mounted ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={timeData} margin={{ left: -16, right: 16, top: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis
                  dataKey="time"
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={tv}
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
                <Area type="monotone" dataKey="neutral" stackId="1" stroke="var(--neutral)" fill="var(--neutral)" fillOpacity={0.2} />
                <Area type="monotone" dataKey="negative" stackId="1" stroke="var(--negative)" fill="var(--negative)" fillOpacity={0.35} />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full" />
          )}
        </div>
      </Panel>
    </div>
  )
}
