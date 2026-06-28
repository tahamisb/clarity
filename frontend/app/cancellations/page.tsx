"use client"

import React, { useState, useMemo, useEffect, useCallback, useRef } from "react"
import { Ban, TrendingDown, TrendingUp, AlertTriangle, Target, Loader2, RefreshCw } from "lucide-react"
import { Sidebar } from "@/components/rafeeq/sidebar"
import { Topbar } from "@/components/rafeeq/topbar"
import { StatCard } from "@/components/rafeeq/stat-card"
import { CancellationLoading } from "@/components/rafeeq/loading-screen"
import { CancellationChat } from "@/components/rafeeq/cancellation-chat"
import { RefreshStatus } from "@/components/rafeeq/refresh-status"
import { GlobalTimeRange } from "@/components/rafeeq/time-range-select"
import { ThresholdAlert } from "@/components/rafeeq/threshold-alert"
import { useAutoRefresh, useSettings } from "@/lib/settings-context"
import { useTimeFilter } from "@/lib/time-filter-context"
import { type TimeRange } from "@/lib/time-range"
import { useT, useTV } from "@/lib/i18n"
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, ResponsiveContainer,
  BarChart, Bar, Cell,
} from "recharts"
import {
  fetchAllCancellationData,
  fetchLiveQueue,
  fetchDriversReport,
  explainOrder,
  clearServerCache,
  type CancelTrend, type CancelByMerchant, type CancelByZone, type TimeCancelRow,
  type DowCancelRow, type ActorRow, type CancelCrosstabs, type DriversReport,
  type FeatureImportance, type ModelInfo, type LiveQueue, type CancelPrediction,
  type PredictionEngine,
} from "@/lib/api"
import { cn } from "@/lib/utils"

const TIME_BUCKETS = ["Morning", "Lunch", "Afternoon", "Dinner", "Late Night"]

function riskPill(level: string) {
  if (level === "high") return "bg-destructive/10 text-destructive border-destructive/20"
  if (level === "medium") return "bg-amber-500/10 text-amber-500 border-amber-500/20"
  return "bg-emerald-500/10 text-emerald-500 border-emerald-500/20"
}

export default function CancellationsPage() {
  const t = useT()
  const tv = useTV()
  const [search, setSearch] = useState("")
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const { settings } = useSettings()
  const { range, queryKey } = useTimeFilter()

  const [trend, setTrend] = useState<CancelTrend | null>(null)
  const [byMerchant, setByMerchant] = useState<CancelByMerchant | null>(null)
  const [byZone, setByZone] = useState<CancelByZone | null>(null)
  const [byTime, setByTime] = useState<TimeCancelRow[] | null>(null)
  const [byDay, setByDay] = useState<DowCancelRow[] | null>(null)
  const [byActor, setByActor] = useState<ActorRow[] | null>(null)
  const [crosstabs, setCrosstabs] = useState<CancelCrosstabs | null>(null)
  const [driversReport, setDriversReport] = useState<DriversReport | null>(null)
  const [reportLoading, setReportLoading] = useState(true)
  const [featureImportance, setFeatureImportance] = useState<FeatureImportance | null>(null)
  const [modelInfo, setModelInfo] = useState<ModelInfo | null>(null)
  const [liveQueue, setLiveQueue] = useState<LiveQueue | null>(null)

  const [riskFilter, setRiskFilter] = useState("All Risks")
  const [zoneFilter, setZoneFilter] = useState("All Zones")
  const [expanded, setExpanded] = useState<string | null>(null)
  const [explanations, setExplanations] = useState<Record<string, CancelPrediction>>({})
  const [explaining, setExplaining] = useState<string | null>(null)
  const [engine, setEngine] = useState<PredictionEngine>("auto")
  const [queueLoading, setQueueLoading] = useState(false)

  // Load dashboard data. `background` skips the full-page skeleton (auto-refresh
  // and manual refresh) and intentionally does NOT regenerate the Gemini drivers
  // report, which is a slow/billed call we don't want to re-run every tick.
  const loadData = useCallback((r: TimeRange, background = false) => {
    if (background) setRefreshing(true)
    else setLoading(true)
    // A refresh re-reads from BigQuery; bust the server cache first so it does.
    const ready = background ? clearServerCache() : Promise.resolve()
    ready.then(() => fetchAllCancellationData(r)).then((d) => {
      setTrend(d.trend)
      setByMerchant(d.byMerchant)
      setByZone(d.byZone)
      setByTime(d.byTime)
      setByDay(d.byDay)
      setByActor(d.byActor)
      setCrosstabs(d.crosstabs)
      setFeatureImportance(d.featureImportance)
      setModelInfo(d.modelInfo)
      // Respect the currently-selected prediction engine for the live queue.
      if (engine === "auto") setLiveQueue(d.liveQueue)
      else fetchLiveQueue(50, engine).then(setLiveQueue)
      setLastUpdated(new Date())
      if (background) setRefreshing(false)
      else setLoading(false)
    })
    if (!background) {
      // Drivers report is slow (Gemini) — load it separately so charts paint first.
      setReportLoading(true)
      fetchDriversReport().then((r) => {
        setDriversReport(r)
        setReportLoading(false)
      })
    }
  }, [engine])

  useEffect(() => {
    loadData(range, false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Re-aggregate every chart/table for the new window when the range changes.
  const firstRange = useRef(true)
  useEffect(() => {
    if (firstRange.current) { firstRange.current = false; return }
    loadData(range, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryKey])

  // Re-fetch on the cadence configured on the Settings page.
  useAutoRefresh(() => loadData(range, true))

  // Cancellation-rate alert: zones (with meaningful volume) whose cancel rate
  // exceeds the configured threshold (Settings → SLA & Alert Configurations).
  const cancelBreach = useMemo(() => {
    const zones = byZone?.by_zone_name ?? []
    return zones
      .filter((z) => z.total_orders >= 50 && z.cancel_rate_pct > settings.cancelThresholdPct)
      .sort((a, b) => b.cancel_rate_pct - a.cancel_rate_pct)
      .slice(0, 6)
      .map((z) => t("cancel.breachItem", { zone: z.zone, rate: z.cancel_rate_pct.toFixed(1), limit: settings.cancelThresholdPct }))
  }, [byZone, settings.cancelThresholdPct, t])

  // -------------------------------------------------------------------------
  // Derived stats
  // -------------------------------------------------------------------------
  const stats = useMemo(() => {
    const monthly = trend?.monthly ?? []
    const totalCancelled = monthly.reduce((s, m) => s + (m.cancelled ?? 0), 0)
    const totalOrders = monthly.reduce((s, m) => s + (m.total_orders ?? 0), 0)
    const overallRate = totalOrders ? (totalCancelled / totalOrders) * 100 : 0

    const weekly = trend?.weekly ?? []
    let wow: number | null = null
    if (weekly.length >= 2) {
      wow = weekly[weekly.length - 1].cancel_rate_pct - weekly[weekly.length - 2].cancel_rate_pct
    }

    const topDriver =
      driversReport?.top_drivers?.[0]?.name ??
      featureImportance?.top_features?.[0]?.feature ??
      byActor?.[0]?.cancelled_by ??
      "—"

    const riskZone = [...(byZone?.by_zone_name ?? [])]
      .filter((z) => z.total_orders >= 50)
      .sort((a, b) => b.cancel_rate_pct - a.cancel_rate_pct)[0]?.zone ?? "—"

    return { totalCancelled, overallRate, wow, topDriver, riskZone }
  }, [trend, driversReport, featureImportance, byActor, byZone])

  // Trend chart data (weekly cancellation rate). The backend already scopes the
  // trend to the selected window, so we map the weekly series straight through.
  const trendData = useMemo(
    () => (trend?.weekly ?? []).map((w) => ({ week: w.period, rate: w.cancel_rate_pct })),
    [trend],
  )

  // Top drivers (prefer ML feature importance, fall back to cancellation actors)
  const driverData = useMemo(() => {
    if (featureImportance?.top_features?.length) {
      return featureImportance.top_features.slice(0, 8).map((f) => ({
        driver: f.feature.replace(/^num__|^cat__/, "").replace(/_/g, " "),
        value: Math.round(f.importance * 1000) / 1000,
      }))
    }
    return (byActor ?? []).slice(0, 8).map((a) => ({ driver: a.cancelled_by, value: a.cancellations }))
  }, [featureImportance, byActor])

  // Zone × time heatmap
  const heatmap = useMemo(() => {
    const rows = crosstabs?.zone_x_time ?? []
    const zones = Array.from(new Set(rows.map((r) => r.zone_name).filter(Boolean))) as string[]
    const lookup = new Map<string, number>()
    for (const r of rows) lookup.set(`${r.zone_name}__${r.time_bucket}`, r.cancel_rate_pct)
    const maxRate = rows.reduce((m, r) => Math.max(m, r.cancel_rate_pct), 0) || 1
    return { zones: zones.slice(0, 6), lookup, maxRate }
  }, [crosstabs])

  const zoneData = useMemo(
    () => [...(byZone?.by_zone_name ?? [])]
      .sort((a, b) => b.cancel_rate_pct - a.cancel_rate_pct)
      .slice(0, 8)
      .map((z) => ({ zone: z.zone, rate: z.cancel_rate_pct })),
    [byZone],
  )

  const dayData = useMemo(
    () => [...(byDay ?? [])]
      .sort((a, b) => a.dow_index - b.dow_index)
      .map((d) => ({ day: d.day_of_week.slice(0, 3), rate: d.cancel_rate_pct })),
    [byDay],
  )

  // Live queue filtering
  const queueOrders = useMemo(() => {
    const orders = liveQueue?.orders ?? []
    return orders.filter((o) => {
      if (riskFilter !== "All Risks" && o.risk_level !== riskFilter.toLowerCase()) return false
      if (zoneFilter !== "All Zones" && (o.zone_name ?? "") !== zoneFilter) return false
      if (search.trim() && !(o.order_id ?? "").toLowerCase().includes(search.trim().toLowerCase())) return false
      return true
    })
  }, [liveQueue, riskFilter, zoneFilter, search])

  const queueZones = useMemo(
    () => Array.from(new Set((liveQueue?.orders ?? []).map((o) => o.zone_name).filter(Boolean))) as string[],
    [liveQueue],
  )

  const toggleExpand = useCallback(async (orderId: string | null) => {
    if (!orderId) return
    if (expanded === orderId) { setExpanded(null); return }
    setExpanded(orderId)
    if (!explanations[orderId]) {
      setExplaining(orderId)
      const detail = await explainOrder(orderId, engine)
      if (detail) setExplanations((prev) => ({ ...prev, [orderId]: detail }))
      setExplaining(null)
    }
  }, [expanded, explanations, engine])

  // Re-score the live queue when the prediction engine changes
  const changeEngine = useCallback((next: PredictionEngine) => {
    setEngine(next)
    setExpanded(null)
    setExplanations({})
    setQueueLoading(true)
    fetchLiveQueue(50, next).then((q) => {
      setLiveQueue(q)
      setQueueLoading(false)
    })
  }, [])

  const CustomTooltip = ({ active, payload, label, unit = "%" }: any) => {
    if (active && payload?.length) {
      return (
        <div className="rounded-lg border border-border bg-card/95 p-3 text-sm shadow-xl backdrop-blur-sm">
          <p className="mb-1 font-semibold text-foreground">{label}</p>
          {payload.map((e: any, i: number) => (
            <div key={i} className="flex items-center justify-between gap-4">
              <span style={{ color: e.color }}>{e.name}</span>
              <span className="font-medium text-foreground">{e.value}{unit}</span>
            </div>
          ))}
        </div>
      )
    }
    return null
  }

  const modelReady = modelInfo?.available
  const queueEmpty = !liveQueue || liveQueue.count === 0

  return (
    <div className="flex min-h-screen">
      <Sidebar />

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar title={t("cancel.title")} search={search} onSearch={setSearch} />

        <main className="flex flex-1 flex-col gap-6 p-4 md:p-6">

          <div className="flex flex-col items-start gap-3 border-b border-border pb-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
                {t("cancel.title")}
              </h1>
              <p className="text-sm text-muted-foreground">
                {t("cancel.subtitle")}
              </p>
            </div>
            <div className="flex flex-col items-start gap-3 sm:items-end">
              <GlobalTimeRange className="lg:hidden" />
              <RefreshStatus lastUpdated={lastUpdated} refreshing={refreshing} onRefresh={() => loadData(range, true)} />
            </div>
          </div>

          {loading ? (
            <CancellationLoading />
          ) : (
          <>
          <ThresholdAlert title={t("cancel.alertBreach")} items={cancelBreach} />

          {/* Stat Cards */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <StatCard label={t("cancel.statTotal")} value={stats.totalCancelled.toLocaleString()} trend="neutral" icon={Ban} />
            <StatCard label={t("cx.cancellationRate")} value={`${stats.overallRate.toFixed(1)}%`} trend="neutral" icon={Target} />
            <StatCard
              label={t("cancel.statWow")}
              value={stats.wow === null ? tv("N/A") : `${stats.wow >= 0 ? "+" : ""}${stats.wow.toFixed(1)} ${t("set.ptsSuffix")}`}
              trend={stats.wow === null ? "neutral" : stats.wow > 0 ? "up" : "down"}
              icon={stats.wow !== null && stats.wow > 0 ? TrendingUp : TrendingDown}
            />
            <StatCard label={t("cancel.statTopDriver")} value={tv(stats.topDriver)} trend="neutral" icon={AlertTriangle} />
            <StatCard label={t("cancel.statRiskZone")} value={tv(stats.riskZone)} trend="neutral" icon={AlertTriangle} />
          </div>

          {/* Trend + Top Drivers */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[2fr_1.5fr]">
            <div className="flex flex-col rounded-xl border border-border bg-card p-5 shadow-sm">
              <h2 className="mb-4 text-base font-semibold text-foreground">{t("cancel.rateByWeek")}</h2>
              <div className="h-[300px] w-full">
                {trendData.length === 0 ? (
                  <EmptyChart label={t("cancel.noTrend")} />
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={trendData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                      <XAxis dataKey="week" stroke="var(--muted-foreground)" fontSize={11} tickLine={false} axisLine={false} />
                      <YAxis stroke="var(--muted-foreground)" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}%`} />
                      <RechartsTooltip content={<CustomTooltip />} />
                      <Legend iconType="circle" wrapperStyle={{ fontSize: "12px" }} />
                      <Line type="monotone" dataKey="rate" name={t("cancel.rateLegend")} stroke="var(--primary)" strokeWidth={3} dot={{ r: 3 }} activeDot={{ r: 6 }} />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            <div className="flex flex-col rounded-xl border border-border bg-card p-5 shadow-sm">
              <h2 className="mb-4 text-base font-semibold text-foreground">
                {featureImportance?.top_features?.length ? t("cancel.topDriversModel") : t("cancel.byActor")}
              </h2>
              <div className="h-[240px] w-full">
                {driverData.length === 0 ? (
                  <EmptyChart label={t("cancel.trainToSeeDrivers")} />
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={driverData} layout="vertical" margin={{ top: 0, right: 20, left: 30, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--border)" />
                      <XAxis type="number" hide />
                      <YAxis dataKey="driver" type="category" stroke="var(--muted-foreground)" fontSize={11} tickLine={false} axisLine={false} width={130} />
                      <RechartsTooltip cursor={{ fill: "var(--muted)", opacity: 0.5 }} content={<CustomTooltip unit="" />} />
                      <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={16}>
                        {driverData.map((_, i) => (
                          <Cell key={i} fill="var(--primary)" style={{ opacity: 1 - i * 0.08 }} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
          </div>

          {/* Heatmap + Zone + Day */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <div className="flex flex-col rounded-xl border border-border bg-card p-5 shadow-sm">
              <h2 className="mb-4 text-base font-semibold text-foreground">{t("cancel.riskByZoneTime")}</h2>
              {heatmap.zones.length === 0 ? (
                <EmptyChart label={t("cancel.noCrosstab")} />
              ) : (
                <div className="flex-1 overflow-x-auto rounded-lg border border-border">
                  <div className="grid min-w-[420px]" style={{ gridTemplateColumns: `110px repeat(${TIME_BUCKETS.length}, 1fr)` }}>
                    <div className="border-b border-r border-border p-2" />
                    {TIME_BUCKETS.map((bucket) => (
                      <div key={bucket} className="border-b border-r border-border p-2 text-center text-[11px] font-semibold text-muted-foreground">{tv(bucket)}</div>
                    ))}
                    {heatmap.zones.map((zone) => (
                      <React.Fragment key={zone}>
                        <div className="flex items-center border-b border-r border-border p-2 text-xs font-medium text-muted-foreground">{tv(zone)}</div>
                        {TIME_BUCKETS.map((bucket) => {
                          const rate = heatmap.lookup.get(`${zone}__${bucket}`)
                          const has = rate !== undefined
                          const opacity = has ? Math.min(Math.max(rate / heatmap.maxRate, 0.08), 1) : 0
                          return (
                            <div
                              key={`${zone}-${bucket}`}
                              className="flex items-center justify-center border-b border-r border-border p-3 text-xs font-semibold"
                              style={{ backgroundColor: has ? `color-mix(in srgb, var(--destructive) ${opacity * 100}%, transparent)` : "transparent" }}
                            >
                              <span className={opacity > 0.5 ? "text-white" : "text-foreground"}>{has ? `${rate.toFixed(1)}%` : "—"}</span>
                            </div>
                          )
                        })}
                      </React.Fragment>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="flex flex-col rounded-xl border border-border bg-card p-5 shadow-sm">
              <h2 className="mb-4 text-base font-semibold text-foreground">{t("cancel.rateByZone")}</h2>
              <div className="min-h-[250px] w-full flex-1">
                {zoneData.length === 0 ? <EmptyChart label={t("cancel.noZone")} /> : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={zoneData} layout="vertical" margin={{ top: 0, right: 20, left: 30, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--border)" />
                      <XAxis type="number" hide />
                      <YAxis dataKey="zone" type="category" stroke="var(--muted-foreground)" fontSize={11} tickLine={false} axisLine={false} width={90} tickFormatter={tv} />
                      <RechartsTooltip cursor={{ fill: "var(--muted)", opacity: 0.5 }} content={<CustomTooltip />} />
                      <Bar dataKey="rate" radius={[0, 4, 4, 0]} barSize={16}>
                        {zoneData.map((_, i) => (
                          <Cell key={i} fill={i === 0 ? "var(--destructive)" : "var(--primary)"} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            <div className="flex flex-col rounded-xl border border-border bg-card p-5 shadow-sm">
              <h2 className="mb-4 text-base font-semibold text-foreground">{t("cancel.rateByDay")}</h2>
              <div className="min-h-[250px] w-full flex-1">
                {dayData.length === 0 ? <EmptyChart label={t("cancel.noDow")} /> : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={dayData} margin={{ top: 10, right: 0, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                      <XAxis dataKey="day" stroke="var(--muted-foreground)" fontSize={12} tickLine={false} axisLine={false} tickFormatter={tv} />
                      <YAxis stroke="var(--muted-foreground)" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}%`} />
                      <RechartsTooltip cursor={{ fill: "var(--muted)", opacity: 0.5 }} content={<CustomTooltip />} />
                      <Bar dataKey="rate" radius={[4, 4, 0, 0]} barSize={24}>
                        {dayData.map((d, i) => (
                          <Cell key={i} fill={d.day === "Fri" ? "var(--destructive)" : "var(--primary)"} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
          </div>

          {/* Live high-risk queue */}
          <div className="flex flex-col rounded-xl border border-border bg-card shadow-sm">
            <div className="flex flex-col gap-4 border-b border-border p-5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-base font-semibold text-foreground">{t("cancel.liveQueue")}</h2>
                <p className="text-sm text-muted-foreground">
                  {t("cancel.liveQueueDesc", { engine: liveQueue?.engine === "gemini" ? "Gemini" : t("engine.mlModel") })}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {/* Prediction engine toggle */}
                <div className="flex items-center rounded-lg border border-border bg-background p-0.5 text-xs">
                  {(["auto", "model", "gemini"] as PredictionEngine[]).map((e) => (
                    <button
                      key={e}
                      onClick={() => changeEngine(e)}
                      className={cn(
                        "rounded-md px-2.5 py-1 font-medium capitalize transition-colors",
                        engine === e ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {tv(e)}
                    </button>
                  ))}
                </div>
                <select className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary/50"
                  value={zoneFilter} onChange={(e) => setZoneFilter(e.target.value)}>
                  <option value="All Zones">{tv("All Zones")}</option>
                  {queueZones.map((z) => <option key={z} value={z}>{tv(z)}</option>)}
                </select>
                <select className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary/50"
                  value={riskFilter} onChange={(e) => setRiskFilter(e.target.value)}>
                  {["All Risks", "High", "Medium", "Low"].map((r) => <option key={r} value={r}>{tv(r)}</option>)}
                </select>
              </div>
            </div>

            {queueLoading ? (
              <div className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground">
                <Loader2 className="size-5 animate-spin text-accent" />
                {t("cancel.scoringWith", { engine: engine === "gemini" ? "Gemini" : t("engine.mlModel") })}
              </div>
            ) : queueEmpty ? (
              <div className="flex flex-col items-center gap-2 p-10 text-center text-sm text-muted-foreground">
                <AlertTriangle className="size-6 text-muted-foreground" />
                <p>
                  {engine !== "gemini" && !modelReady
                    ? t("cancel.modelNotTrained")
                    : t("cancel.noActiveOrders")}
                </p>
                {engine !== "gemini" && !modelReady && (
                  <code className="rounded bg-secondary px-2 py-1 text-xs text-accent">python scripts/train_cancellation_model.py</code>
                )}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm text-foreground">
                  <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-5 py-3 font-semibold">{t("col.orderId")}</th>
                      <th className="px-5 py-3 font-semibold">{t("col.merchantZone")}</th>
                      <th className="px-5 py-3 font-semibold">{t("col.topRiskFactor")}</th>
                      <th className="px-5 py-3 text-center font-semibold">{t("col.risk")}</th>
                      <th className="px-5 py-3 text-center font-semibold">{t("col.score")}</th>
                      <th className="px-5 py-3 text-right font-semibold">{t("col.action")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {queueOrders.length === 0 ? (
                      <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">{t("cancel.noOrdersMatch")}</td></tr>
                    ) : queueOrders.map((o) => {
                      const id = o.order_id ?? "—"
                      const factor = o.top_risk_factors?.[0]?.feature?.replace(/^num__|^cat__/, "").replace(/_/g, " ") ?? "—"
                      const isOpen = expanded === o.order_id
                      return (
                        <React.Fragment key={id}>
                          <tr className="cursor-pointer transition-colors hover:bg-muted/50" onClick={() => toggleExpand(o.order_id)}>
                            <td className="px-5 py-3 font-medium">{id}</td>
                            <td className="px-5 py-3">
                              <div className="font-medium text-foreground">{o.restaurant_name ?? "—"}</div>
                              <div className="text-xs text-muted-foreground">{o.zone_name ?? "—"}</div>
                            </td>
                            <td className="px-5 py-3"><div className="max-w-[200px] truncate" title={factor}>{factor}</div></td>
                            <td className="px-5 py-3 text-center">
                              <span className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold capitalize", riskPill(o.risk_level))}>
                                {tv(o.risk_level)}
                              </span>
                            </td>
                            <td className="px-5 py-3 text-center font-semibold tabular-nums">{Math.round(o.probability * 100)}%</td>
                            <td className="px-5 py-3 text-right">
                              <button className="rounded-lg bg-secondary px-3 py-1.5 text-xs font-semibold text-secondary-foreground transition-colors hover:bg-secondary/80">
                                {isOpen ? t("cancel.hide") : t("cancel.explain")}
                              </button>
                            </td>
                          </tr>
                          {isOpen && (
                            <tr className="bg-muted/30">
                              <td colSpan={6} className="px-5 py-4">
                                {explaining === o.order_id ? (
                                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                    <Loader2 className="size-4 animate-spin text-accent" /> {t("cancel.generatingExplanation")}
                                  </div>
                                ) : explanations[id] ? (
                                  <div className="space-y-2 text-sm">
                                    <p className="text-foreground/90">{explanations[id].gemini_explanation ?? t("cancel.noExplanation")}</p>
                                    {explanations[id].recommended_action && (
                                      <p className="rounded-md bg-primary/5 p-2 text-foreground">
                                        <span className="font-semibold text-primary">{t("cancel.recommendedAction")}</span>
                                        {explanations[id].recommended_action}
                                      </p>
                                    )}
                                    <div className="flex flex-wrap gap-1.5 pt-1">
                                      {explanations[id].top_risk_factors.slice(0, 5).map((f, i) => (
                                        <span key={i} className={cn("rounded-full border px-2 py-0.5 text-[11px]",
                                          f.direction === "increases_risk" ? "border-destructive/30 text-destructive" : "border-emerald-500/30 text-emerald-500")}>
                                          {f.feature.replace(/^num__|^cat__/, "").replace(/_/g, " ")}
                                        </span>
                                      ))}
                                    </div>
                                  </div>
                                ) : (
                                  <p className="text-sm text-muted-foreground">{t("cancel.couldNotLoad")}</p>
                                )}
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Model card + Drivers report */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_2fr]">
            <div className="flex flex-col justify-between rounded-xl border border-border bg-sidebar p-5 shadow-sm">
              <div>
                <div className="mb-1 flex items-center gap-2 text-primary">
                  <Target className="size-5" />
                  <h2 className="text-sm font-semibold uppercase tracking-wide">{t("cancel.modelPerformance")}</h2>
                </div>
                <h3 className="mb-4 text-xs text-muted-foreground">{modelInfo?.algorithm ?? t("cancel.notTrained")}</h3>

                {modelReady ? (
                  <div className="space-y-3">
                    <Metric label="ROC-AUC" value={modelInfo?.roc_auc != null ? modelInfo.roc_auc.toFixed(3) : "—"} />
                    <Metric label={t("cancel.decisionThreshold")} value={modelInfo?.threshold != null ? modelInfo.threshold.toFixed(2) : "—"} />
                    <Metric label={t("cancel.features")} value={modelInfo?.n_features?.toLocaleString() ?? "—"} />
                    <Metric label={t("cancel.trainingRows")} value={modelInfo?.n_training_rows?.toLocaleString() ?? "—"} last />
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {t("cancel.runTraining")}
                  </p>
                )}
              </div>
              <div className="mt-4 rounded-md bg-muted/50 p-3 text-xs leading-relaxed text-muted-foreground">
                <strong>{t("cancel.highRecall")}</strong>{t("cancel.highRecallDesc")}
                {modelInfo?.trained_at && <div className="mt-1">{t("cancel.lastTrained", { date: modelInfo.trained_at.slice(0, 16).replace("T", " ") })}</div>}
              </div>
            </div>

            <div className="flex flex-col rounded-xl border border-border bg-card p-6 shadow-sm">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-xl font-bold text-foreground">{t("cancel.driversReport")}</h2>
                {driversReport?.generated_at && (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <RefreshCw className="size-3" /> {driversReport.generated_at.slice(0, 10)}
                  </span>
                )}
              </div>

              {reportLoading ? (
                <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin text-accent" />
                  {t("cancel.generatingReport")}
                </div>
              ) : !driversReport ? (
                <p className="text-sm text-muted-foreground">
                  {t("cancel.reportFirstRequest")}
                </p>
              ) : (
                <div className="space-y-6 text-sm text-muted-foreground">
                  <section>
                    <h3 className="mb-2 text-sm font-semibold uppercase tracking-wider text-foreground">{t("cancel.executiveSummary")}</h3>
                    <p className="leading-relaxed">{driversReport.executive_summary}</p>
                  </section>

                  {driversReport.top_drivers?.length > 0 && (
                    <section>
                      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-foreground">{t("cancel.topDrivers")}</h3>
                      <ul className="space-y-3">
                        {driversReport.top_drivers.slice(0, 6).map((d, i) => (
                          <li key={i} className="flex gap-3">
                            <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/20 text-xs font-bold text-primary">{i + 1}</span>
                            <div>
                              <p className="font-medium text-foreground">{d.name}</p>
                              <p>{d.explanation}</p>
                              <p className="mt-0.5 text-foreground/80"><span className="font-semibold text-primary">{t("cancel.actionLabel")}</span>{d.recommendation}</p>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}

                  {driversReport.high_risk_segments?.length > 0 && (
                    <section>
                      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-foreground">{t("cancel.highRiskSegments")}</h3>
                      <ul className="grid gap-2 sm:grid-cols-2">
                        {driversReport.high_risk_segments.map((s, i) => (
                          <li key={i} className="rounded-lg border border-border bg-muted/30 p-3">
                            <div className="flex items-center justify-between">
                              <span className="font-medium text-foreground">{s.segment}</span>
                              {s.cancel_rate != null && <span className="text-xs font-semibold text-destructive">{s.cancel_rate}%</span>}
                            </div>
                            <p className="mt-1 text-xs">{s.recommendation}</p>
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}

                  {driversReport.trend_insight && (
                    <div className="rounded-r-lg border-l-2 border-accent bg-accent/5 py-2 pl-4 text-foreground/85">
                      {driversReport.trend_insight}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Gemini chat */}
          <CancellationChat />
          </>
          )}

          <footer className="pb-4 pt-2 text-center text-xs text-muted-foreground">
            {t("cancel.footer")}
          </footer>
        </main>
      </div>
    </div>
  )
}

function Metric({ label, value, last = false }: { label: string; value: string; last?: boolean }) {
  return (
    <div className={cn("flex items-center justify-between", !last && "border-b border-border pb-2")}>
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="font-semibold text-foreground">{value}</span>
    </div>
  )
}

function EmptyChart({ label }: { label: string }) {
  return <div className="flex h-full min-h-[200px] items-center justify-center text-xs text-muted-foreground">{label}</div>
}
