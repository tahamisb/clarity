"use client"

import React, { useCallback, useEffect, useMemo, useState } from "react"
import {
  Activity, Ban, Clock, Bot,
  TrendingUp, TrendingDown, AlertTriangle, ArrowRight, HeartPulse, ShieldAlert
} from "lucide-react"
import { Sidebar } from "@/components/rafeeq/sidebar"
import { Topbar } from "@/components/rafeeq/topbar"
import { StatCard } from "@/components/rafeeq/stat-card"
import { CxDashboardLoading } from "@/components/rafeeq/loading-screen"
import { RefreshStatus } from "@/components/rafeeq/refresh-status"
import { WorkInProgress, WipBadge } from "@/components/rafeeq/work-in-progress"
import { useAutoRefresh } from "@/lib/settings-context"
import {
  LineChart, Line, AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, ReferenceLine
} from "recharts"
import Link from "next/link"
import { cn } from "@/lib/utils"

import {
  fetchCalls, fetchAllMessagesData, fetchCancelTrend, fetchCancelByZone,
  fetchFeatureImportance, fetchCancelByActor,
  type TriggerItem, type TrendItem, type CancelTrend, type CancelByZone,
  type FeatureImportance, type ActorRow,
} from "@/lib/api"
import type { CallRecord } from "@/lib/rafeeq-data"
import type { SupportMessage } from "@/lib/mock-messages"

// Resolution-time and chatbot telemetry have no backing data source yet, so those
// two panels stay behind the "Work in progress" overlay using mock previews.
import {
  weeklyResolutionTime,
  resolutionByIssueType,
  chatbotStats,
  topUnansweredQuestions,
  chatbotResolutionSplit,
} from "@/lib/mock-cx-dashboard"

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

function cleanFeature(name: string) {
  return name.replace(/^num__|^cat__/, "").replace(/_/g, " ")
}

// Bucket calls into weekly groups (last 12), counting category volume + sentiment.
function weeklyFromCalls(calls: CallRecord[]) {
  type Bucket = { billing: number; technical: number; complaints: number; pos: number; neu: number; neg: number }
  const buckets = new Map<number, Bucket>()
  for (const c of calls) {
    const ts = new Date(c.datetime.replace(" ", "T")).getTime()
    if (Number.isNaN(ts)) continue
    const wk = Math.floor(ts / WEEK_MS)
    const b = buckets.get(wk) ?? { billing: 0, technical: 0, complaints: 0, pos: 0, neu: 0, neg: 0 }
    if (c.category === "Billing") b.billing++
    else if (c.category === "Technical") b.technical++
    else if (c.category === "Complaints") b.complaints++
    if (c.sentiment === "Positive") b.pos++
    else if (c.sentiment === "Neutral") b.neu++
    else b.neg++
    buckets.set(wk, b)
  }
  const keys = [...buckets.keys()].sort((a, b) => a - b).slice(-12)
  return keys.map((k, i) => ({ week: `W${i + 1}`, ...buckets.get(k)! }))
}

export default function CxDashboardPage() {
  const [search, setSearch] = useState("")
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  // Raw data pulled from the same endpoints that power the dedicated dashboards.
  const [calls, setCalls] = useState<CallRecord[]>([])
  const [messages, setMessages] = useState<SupportMessage[]>([])
  const [triggers, setTriggers] = useState<TriggerItem[]>([])
  const [msgTrend, setMsgTrend] = useState<TrendItem[]>([])
  const [cancelTrend, setCancelTrend] = useState<CancelTrend | null>(null)
  const [cancelZones, setCancelZones] = useState<CancelByZone | null>(null)
  const [featImp, setFeatImp] = useState<FeatureImportance | null>(null)
  const [cancelActors, setCancelActors] = useState<ActorRow[] | null>(null)

  // Global filters (visual scope selectors)
  const [dateFilter, setDateFilter] = useState("Last 4 weeks")
  const [zoneFilter, setZoneFilter] = useState("All Zones")
  const [categoryFilter, setCategoryFilter] = useState("All Categories")

  const resetFilters = () => {
    setDateFilter("Last 4 weeks")
    setZoneFilter("All Zones")
    setCategoryFilter("All Categories")
  }

  const loadData = useCallback((background = false) => {
    if (background) setRefreshing(true)
    else setLoading(true)
    Promise.all([
      fetchCalls(),
      fetchAllMessagesData(),
      fetchCancelTrend(),
      fetchCancelByZone(),
      fetchFeatureImportance(),
      fetchCancelByActor(),
    ]).then(([callsData, msgs, cTrend, cZones, fImp, actors]) => {
      setCalls(callsData ?? [])
      setMessages(msgs.messages ?? [])
      setTriggers(msgs.triggers ?? [])
      setMsgTrend(msgs.trend ?? [])
      setCancelTrend(cTrend)
      setCancelZones(cZones)
      setFeatImp(fImp)
      setCancelActors(actors)
      setLastUpdated(new Date())
      if (background) setRefreshing(false)
      else setLoading(false)
    })
  }, [])

  useEffect(() => {
    loadData(false)
  }, [loadData])

  useAutoRefresh(() => loadData(true))

  // -------------------------------------------------------------------------
  // Derived sentiment counts (calls + messages)
  // -------------------------------------------------------------------------
  const sentimentCounts = useMemo(() => {
    let pos = 0, neu = 0, neg = 0
    for (const c of calls) {
      if (c.sentiment === "Positive") pos++
      else if (c.sentiment === "Neutral") neu++
      else neg++
    }
    for (const m of messages) {
      if (m.sentiment === "Positive") pos++
      else if (m.sentiment === "Neutral") neu++
      else neg++
    }
    return { pos, neu, neg, total: pos + neu + neg }
  }, [calls, messages])

  const msgSentimentCounts = useMemo(() => {
    let pos = 0, neu = 0, neg = 0
    for (const m of messages) {
      if (m.sentiment === "Positive") pos++
      else if (m.sentiment === "Neutral") neu++
      else neg++
    }
    return { pos, neu, neg }
  }, [messages])

  // Overall sentiment score out of 10 (positive=10, neutral=5, negative=0)
  const sentimentScore = useMemo(() => {
    const { pos, neu, total } = sentimentCounts
    if (!total) return 0
    return (pos * 10 + neu * 5) / total
  }, [sentimentCounts])

  // Overall cancellation rate from the trend totals
  const cancellationRate = useMemo(() => {
    const months = cancelTrend?.monthly ?? []
    const cancelled = months.reduce((s, m) => s + (m.cancelled ?? 0), 0)
    const orders = months.reduce((s, m) => s + (m.total_orders ?? 0), 0)
    return orders ? (cancelled / orders) * 100 : 0
  }, [cancelTrend])

  // Escalation proxy: share of calls categorised as Complaints
  const escalationRate = useMemo(() => {
    if (!calls.length) return null
    const complaints = calls.filter((c) => c.category === "Complaints").length
    return (complaints / calls.length) * 100
  }, [calls])

  // -------------------------------------------------------------------------
  // Calls panel
  // -------------------------------------------------------------------------
  const callWeeks = useMemo(() => weeklyFromCalls(calls), [calls])
  const weeklyCallsVolume = useMemo(
    () => callWeeks.map((w) => ({ week: w.week, billing: w.billing, technical: w.technical, complaints: w.complaints })),
    [callWeeks],
  )
  const weeklyCallSentiment = useMemo(
    () => callWeeks.map((w) => ({ week: w.week, positive: w.pos, neutral: w.neu, negative: w.neg })),
    [callWeeks],
  )
  const topComplaints = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const c of calls) {
      if (c.sentiment !== "Negative") continue
      counts[c.intent] = (counts[c.intent] ?? 0) + 1
    }
    let entries = Object.entries(counts)
    if (!entries.length) {
      // Fall back to overall intent volume if there are no negatives.
      const all: Record<string, number> = {}
      for (const c of calls) all[c.intent] = (all[c.intent] ?? 0) + 1
      entries = Object.entries(all)
    }
    return entries
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([name, count], i) => ({ rank: i + 1, name, count, trend: i < 2 ? "up" : "down" }))
  }, [calls])

  // -------------------------------------------------------------------------
  // Text sentiment panel
  // -------------------------------------------------------------------------
  const weeklySentimentScore = useMemo(
    () => msgTrend.map((t, i) => ({
      week: `W${i + 1}`,
      score: Math.round(((t.positive * 10 + t.neutral * 5) / 100) * 10) / 10,
    })),
    [msgTrend],
  )
  const topNegativeTopics = useMemo(
    () => triggers.slice(0, 5).map((t) => ({ topic: t.trigger, count: t.volume })),
    [triggers],
  )
  const sentimentSplit = useMemo(() => {
    const { pos, neu, neg } = msgSentimentCounts
    return [
      { name: "Positive", value: pos, fill: "var(--positive)" },
      { name: "Neutral", value: neu, fill: "var(--neutral)" },
      { name: "Negative", value: neg, fill: "var(--negative)" },
    ].filter((s) => s.value > 0)
  }, [msgSentimentCounts])

  const sentimentInsight = useMemo(() => {
    if (!msgTrend.length) return "Not enough message data yet to surface a sentiment insight."
    const worst = msgTrend.reduce((a, b, i) => (b.negative > msgTrend[a].negative ? i : a), 0)
    const topTrigger = triggers[0]?.trigger
    const base = `Negative sentiment peaks in W${worst + 1} at ${msgTrend[worst].negative}%.`
    return topTrigger ? `${base} Leading driver: ${topTrigger}.` : base
  }, [msgTrend, triggers])

  // -------------------------------------------------------------------------
  // Cancellations panel
  // -------------------------------------------------------------------------
  const weeklyCancellations = useMemo(
    () => (cancelTrend?.weekly ?? []).slice(-12).map((w, i) => ({ week: `W${i + 1}`, rate: w.cancel_rate_pct })),
    [cancelTrend],
  )
  const topCancellationDrivers = useMemo(() => {
    if (featImp?.top_features?.length) {
      const top = featImp.top_features.slice(0, 3)
      const sum = top.reduce((s, f) => s + f.importance, 0) || 1
      return top.map((f) => ({ name: cleanFeature(f.feature), percentage: Math.round((f.importance / sum) * 100) }))
    }
    const actors = cancelActors ?? []
    const sum = actors.slice(0, 3).reduce((s, a) => s + a.cancellations, 0) || 1
    return actors.slice(0, 3).map((a) => ({ name: a.cancelled_by, percentage: Math.round((a.cancellations / sum) * 100) }))
  }, [featImp, cancelActors])
  const cancellationZones = useMemo(() => {
    const zones = cancelZones?.by_zone_name ?? []
    return [...zones]
      .filter((z) => z.total_orders >= 50)
      .sort((a, b) => b.cancel_rate_pct - a.cancel_rate_pct)
      .slice(0, 6)
      .map((z) => ({
        zone: z.zone,
        rate: Math.round(z.cancel_rate_pct * 10) / 10,
        level: z.cancel_rate_pct >= 6 ? "high" : z.cancel_rate_pct >= 4 ? "medium" : "low",
      }))
  }, [cancelZones])

  const cancellationInsight = useMemo(() => {
    if (!cancellationZones.length) return "Not enough cancellation data yet to surface a zone insight."
    const top = cancellationZones[0]
    return `${top.zone} has the highest cancellation rate at ${top.rate}%.`
  }, [cancellationZones])

  // -------------------------------------------------------------------------
  // Weekly CX health score (derived from real sentiment + cancellation signals)
  // -------------------------------------------------------------------------
  const health = useMemo(() => {
    const sentimentPts = Math.round((sentimentScore / 10) * 50)
    const cancelPts = Math.round((1 - Math.min(cancellationRate / 20, 1)) * 50)
    const score = sentimentPts + cancelPts
    const label = score >= 75 ? "GOOD" : score >= 50 ? "FAIR" : "POOR"
    const tone = score >= 75 ? "positive" : score >= 50 ? "neutral" : "destructive"
    const components = [
      { name: "Sentiment (50%)", score: sentimentPts },
      { name: "Cancellations (50%)", score: cancelPts },
    ]
    const trend = weeklySentimentScore.slice(-8).map((w) => ({ week: w.week, score: Math.round(w.score * 10) }))
    return { score, label, tone, components, trend }
  }, [sentimentScore, cancellationRate, weeklySentimentScore])

  const totalInteractions = calls.length + messages.length

  // Custom tooltip
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="rounded-lg border border-border bg-card/95 p-3 text-sm shadow-xl backdrop-blur-sm">
          <p className="mb-2 font-semibold text-foreground">{label}</p>
          {payload.map((entry: any, index: number) => (
            <div key={index} className="flex items-center justify-between gap-4">
              <span style={{ color: entry.color }}>{entry.name}</span>
              <span className="font-medium text-foreground">{entry.value}</span>
            </div>
          ))}
        </div>
      )
    }
    return null
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar />

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar title="CX Analytics Dashboard" search={search} onSearch={setSearch} />

        <main className="flex flex-1 flex-col gap-6 p-4 md:p-6">

          {/* Header */}
          <div className="flex flex-col items-start gap-3 border-b border-border pb-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
                CX Analytics Dashboard
              </h1>
              <p className="text-sm text-muted-foreground">
                Single source of truth for overall Customer Experience health across calls, text, and bot channels.
              </p>
            </div>
            <RefreshStatus lastUpdated={lastUpdated} refreshing={refreshing} onRefresh={() => loadData(true)} />
          </div>

          {loading ? (
            <CxDashboardLoading />
          ) : (
          <>
          {/* Global Filter Bar */}
          <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap gap-3">
              <select
                className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground outline-none focus:ring-2 focus:ring-primary/50"
                value={dateFilter} onChange={(e) => setDateFilter(e.target.value)}
              >
                <option>Last 7 days</option>
                <option>Last 4 weeks</option>
                <option>Last 3 months</option>
                <option>Custom</option>
              </select>
              <select
                className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground outline-none focus:ring-2 focus:ring-primary/50"
                value={zoneFilter} onChange={(e) => setZoneFilter(e.target.value)}
              >
                <option>All Zones</option>
                <option>Al Rayyan</option>
                <option>West Bay</option>
                <option>Al Wakra</option>
                <option>Lusail</option>
                <option>Al Khor</option>
                <option>Al Daayen</option>
              </select>
              <select
                className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground outline-none focus:ring-2 focus:ring-primary/50"
                value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}
              >
                <option>All Categories</option>
                <option>Restaurant</option>
                <option>Grocery</option>
                <option>Pharmacy</option>
                <option>Dark Kitchen</option>
              </select>
            </div>
            <button
              onClick={resetFilters}
              className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              Reset Filters
            </button>
          </div>

          {/* Summary KPI Strip */}
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-6">
            <StatCard label="Total Interactions" value={totalInteractions.toLocaleString()} trend="neutral" icon={Activity} />
            <StatCard label="Overall Sentiment" value={`${sentimentScore.toFixed(1)}/10`} trend="neutral" icon={HeartPulse} />
            <StatCard label="Cancellation Rate" value={`${cancellationRate.toFixed(1)}%`} trend="neutral" icon={Ban} />
            <StatCard label="Avg Resolution Time" value="—" trend="neutral" icon={Clock} />
            <StatCard label="Bot Containment" value="—" trend="neutral" icon={Bot} />
            <StatCard label="Escalation Rate" value={escalationRate === null ? "—" : `${escalationRate.toFixed(1)}%`} trend="neutral" icon={AlertTriangle} />
          </div>

          {/* Grid Layout for Panels */}
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">

            {/* CALLS PANEL */}
            <div className="flex flex-col rounded-xl border border-border bg-card p-5 shadow-sm">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-bold text-foreground">Call Intelligence</h2>
                <Link href="/" className="group flex items-center gap-1 text-xs font-semibold text-primary transition-colors hover:text-primary/80">
                  View Full Call Report <ArrowRight className="size-3 transition-transform group-hover:translate-x-1" />
                </Link>
              </div>

              <div className="grid flex-1 grid-cols-1 gap-6 lg:grid-cols-[1.5fr_1fr]">
                <div className="flex flex-col gap-4">
                  <div className="h-[160px] w-full">
                    {weeklyCallsVolume.length === 0 ? <EmptyChart label="No call data" /> : (
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={weeklyCallsVolume} margin={{ top: 0, right: 0, bottom: 0, left: -20 }}>
                        <defs>
                          <linearGradient id="colorBilling" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="var(--chart-1)" stopOpacity={0.8}/>
                            <stop offset="95%" stopColor="var(--chart-1)" stopOpacity={0}/>
                          </linearGradient>
                          <linearGradient id="colorTechnical" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="var(--chart-2)" stopOpacity={0.8}/>
                            <stop offset="95%" stopColor="var(--chart-2)" stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                        <XAxis dataKey="week" stroke="var(--muted-foreground)" fontSize={11} tickLine={false} axisLine={false} />
                        <YAxis stroke="var(--muted-foreground)" fontSize={11} tickLine={false} axisLine={false} />
                        <RechartsTooltip content={<CustomTooltip />} />
                        <Area type="monotone" dataKey="billing" stackId="1" stroke="var(--chart-1)" fillOpacity={1} fill="url(#colorBilling)" />
                        <Area type="monotone" dataKey="technical" stackId="1" stroke="var(--chart-2)" fillOpacity={1} fill="url(#colorTechnical)" />
                        <Area type="monotone" dataKey="complaints" stackId="1" stroke="var(--chart-4)" fillOpacity={1} fill="var(--chart-4)" />
                      </AreaChart>
                    </ResponsiveContainer>
                    )}
                  </div>
                  <div className="h-[120px] w-full">
                    {weeklyCallSentiment.length === 0 ? <EmptyChart label="No call data" /> : (
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={weeklyCallSentiment} margin={{ top: 0, right: 0, bottom: 0, left: -20 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                        <XAxis dataKey="week" stroke="var(--muted-foreground)" fontSize={11} tickLine={false} axisLine={false} />
                        <YAxis stroke="var(--muted-foreground)" fontSize={11} tickLine={false} axisLine={false} />
                        <RechartsTooltip content={<CustomTooltip />} />
                        <Line type="monotone" dataKey="positive" stroke="var(--positive)" strokeWidth={2} dot={false} />
                        <Line type="monotone" dataKey="neutral" stroke="var(--neutral)" strokeWidth={2} dot={false} />
                        <Line type="monotone" dataKey="negative" stroke="var(--negative)" strokeWidth={2} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                    )}
                  </div>
                </div>

                <div className="flex flex-col gap-3">
                  <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Top Complaints</h3>
                  {topComplaints.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No call data yet.</p>
                  ) : topComplaints.map(comp => (
                    <div key={comp.rank} className="flex items-center gap-3 rounded-lg border border-border bg-sidebar p-3">
                      <div className="flex size-6 items-center justify-center rounded-full bg-primary/20 text-xs font-bold text-primary">
                        {comp.rank}
                      </div>
                      <div className="flex-1">
                        <div className="text-sm font-semibold text-foreground">{comp.name}</div>
                        <div className="text-xs text-muted-foreground">{comp.count} calls</div>
                      </div>
                      {comp.trend === "up" ? <TrendingUp className="size-4 text-destructive" /> : <TrendingDown className="size-4 text-positive" />}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* SENTIMENT PANEL */}
            <div className="flex flex-col rounded-xl border border-border bg-card p-5 shadow-sm">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-bold text-foreground">Text Sentiment</h2>
                <Link href="/messages" className="group flex items-center gap-1 text-xs font-semibold text-primary transition-colors hover:text-primary/80">
                  View Full Sentiment Report <ArrowRight className="size-3 transition-transform group-hover:translate-x-1" />
                </Link>
              </div>

              <div className="grid flex-1 grid-cols-1 gap-6 lg:grid-cols-2">
                <div className="flex flex-col gap-4">
                  <div className="h-[120px] w-full">
                    {weeklySentimentScore.length === 0 ? <EmptyChart label="No sentiment trend" /> : (
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={weeklySentimentScore} margin={{ top: 5, right: 0, bottom: 0, left: -30 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                        <XAxis dataKey="week" stroke="var(--muted-foreground)" fontSize={11} tickLine={false} axisLine={false} />
                        <YAxis domain={[0, 10]} stroke="var(--muted-foreground)" fontSize={11} tickLine={false} axisLine={false} />
                        <RechartsTooltip content={<CustomTooltip />} />
                        <Line type="monotone" dataKey="score" name="Weekly Score" stroke="var(--primary)" strokeWidth={3} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                      </LineChart>
                    </ResponsiveContainer>
                    )}
                  </div>
                  <div className="h-[160px] w-full">
                    {topNegativeTopics.length === 0 ? <EmptyChart label="No negative topics" /> : (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={topNegativeTopics} layout="vertical" margin={{ top: 0, right: 10, left: 20, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--border)" />
                        <XAxis type="number" hide />
                        <YAxis dataKey="topic" type="category" stroke="var(--muted-foreground)" fontSize={11} tickLine={false} axisLine={false} width={80} />
                        <RechartsTooltip cursor={{ fill: 'var(--muted)', opacity: 0.5 }} content={<CustomTooltip />} />
                        <Bar dataKey="count" radius={[0, 4, 4, 0]} barSize={12} fill="var(--destructive)" />
                      </BarChart>
                    </ResponsiveContainer>
                    )}
                  </div>
                </div>

                <div className="flex flex-col gap-4">
                  <div className="flex h-[150px] w-full items-center justify-center relative">
                    {sentimentSplit.length === 0 ? <EmptyChart label="No messages" /> : (
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={sentimentSplit}
                          innerRadius={40}
                          outerRadius={65}
                          paddingAngle={2}
                          dataKey="value"
                        >
                          {sentimentSplit.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.fill} />
                          ))}
                        </Pie>
                        <RechartsTooltip content={<CustomTooltip />} />
                      </PieChart>
                    </ResponsiveContainer>
                    )}
                  </div>
                  <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs leading-relaxed text-foreground">
                    <span className="font-semibold text-primary block mb-1">AI Insight</span>
                    {sentimentInsight}
                  </div>
                </div>
              </div>
            </div>

            {/* CANCELLATIONS PANEL */}
            <div className="flex flex-col rounded-xl border border-border bg-card p-5 shadow-sm">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-bold text-foreground">Cancellation Intelligence</h2>
                <Link href="/cancellations" className="group flex items-center gap-1 text-xs font-semibold text-primary transition-colors hover:text-primary/80">
                  View Full Cancellation Report <ArrowRight className="size-3 transition-transform group-hover:translate-x-1" />
                </Link>
              </div>

              <div className="grid flex-1 grid-cols-1 gap-6 lg:grid-cols-[1fr_1fr]">
                <div className="flex flex-col gap-4">
                  <div className="h-[120px] w-full">
                    {weeklyCancellations.length === 0 ? <EmptyChart label="No cancellation trend" /> : (
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={weeklyCancellations} margin={{ top: 5, right: 0, bottom: 0, left: -20 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                        <XAxis dataKey="week" stroke="var(--muted-foreground)" fontSize={11} tickLine={false} axisLine={false} />
                        <YAxis stroke="var(--muted-foreground)" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}%`} />
                        <RechartsTooltip content={<CustomTooltip />} />
                        <Line type="monotone" dataKey="rate" name="Cancel Rate" stroke="var(--chart-4)" strokeWidth={3} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                      </LineChart>
                    </ResponsiveContainer>
                    )}
                  </div>
                  <div className="flex flex-col gap-2">
                    {topCancellationDrivers.length === 0 ? (
                      <p className="text-xs text-muted-foreground">Train the model or load cancellation data to see drivers.</p>
                    ) : topCancellationDrivers.map((driver, i) => (
                      <div key={i} className="flex items-center justify-between rounded bg-muted/30 px-3 py-2 text-sm">
                        <span className="font-medium text-foreground">{driver.name}</span>
                        <span className="text-xs font-semibold text-muted-foreground">{driver.percentage}%</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex flex-col gap-4">
                  <div className="h-[150px] w-full">
                    {cancellationZones.length === 0 ? <EmptyChart label="No zone data" /> : (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={cancellationZones} layout="vertical" margin={{ top: 0, right: 10, left: 20, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--border)" />
                        <XAxis type="number" hide />
                        <YAxis dataKey="zone" type="category" stroke="var(--muted-foreground)" fontSize={11} tickLine={false} axisLine={false} width={60} />
                        <RechartsTooltip cursor={{ fill: 'var(--muted)', opacity: 0.5 }} content={<CustomTooltip />} />
                        <Bar dataKey="rate" radius={[0, 4, 4, 0]} barSize={12}>
                          {cancellationZones.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.level === 'high' ? 'var(--destructive)' : entry.level === 'medium' ? 'var(--neutral)' : 'var(--primary)'} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                    )}
                  </div>
                  <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs leading-relaxed text-foreground">
                    <span className="font-semibold text-primary block mb-1">AI Insight</span>
                    {cancellationInsight}
                  </div>
                </div>
              </div>
            </div>

            {/* RESOLUTION TIME PANEL — no resolution-time data source yet */}
            <div className="flex flex-col rounded-xl border border-border bg-card p-5 shadow-sm">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-bold text-foreground">Resolution Time</h2>
                <WipBadge />
              </div>

              <WorkInProgress note="Resolution-time tracking needs per-ticket open/close timestamps, which aren't ingested yet.">
              <div className="grid flex-1 grid-cols-1 gap-6 lg:grid-cols-[1fr_1.5fr]">
                <div className="flex flex-col gap-4">
                  <div className="h-[180px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={weeklyResolutionTime} margin={{ top: 10, right: 0, bottom: 0, left: -20 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                        <XAxis dataKey="week" stroke="var(--muted-foreground)" fontSize={11} tickLine={false} axisLine={false} />
                        <YAxis stroke="var(--muted-foreground)" fontSize={11} tickLine={false} axisLine={false} />
                        <RechartsTooltip cursor={{ fill: 'var(--muted)', opacity: 0.5 }} content={<CustomTooltip />} />
                        <ReferenceLine y={4} stroke="var(--chart-4)" strokeDasharray="3 3" label={{ position: 'top', value: '4h SLA', fill: 'var(--chart-4)', fontSize: 10 }} />
                        <Bar dataKey="hours" radius={[4, 4, 0, 0]} barSize={16}>
                          {weeklyResolutionTime.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.hours > 4 ? "var(--destructive)" : "var(--positive)"} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="flex flex-col overflow-hidden rounded-lg border border-border">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-muted/50 text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 font-semibold">Issue Type</th>
                        <th className="px-3 py-2 font-semibold">Avg Time</th>
                        <th className="px-3 py-2 font-semibold text-center">SLA Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {resolutionByIssueType.map((issue, idx) => (
                        <tr key={idx} className="bg-card">
                          <td className="px-3 py-2 font-medium text-foreground">{issue.type}</td>
                          <td className="px-3 py-2 flex items-center gap-1">
                            {issue.avgTime}h
                            {issue.trend === "up" ? <TrendingUp className="size-3 text-destructive" /> : issue.trend === "down" ? <TrendingDown className="size-3 text-positive" /> : null}
                          </td>
                          <td className="px-3 py-2 text-center">
                            <span className={cn(
                              "inline-flex items-center justify-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
                              issue.status === 'met' ? "border-positive/20 bg-positive/10 text-positive" : "border-destructive/20 bg-destructive/10 text-destructive"
                            )}>
                              {issue.sla}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              </WorkInProgress>
            </div>

            {/* CHATBOT PERFORMANCE PANEL (Spans full width) — no bot telemetry yet */}
            <div className="flex flex-col rounded-xl border border-border bg-card p-5 shadow-sm xl:col-span-2">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-bold text-foreground">Chatbot Summary</h2>
                <WipBadge />
              </div>

              <WorkInProgress note="Chatbot containment, fallback and unanswered-question analytics need the bot conversation logs, which aren't connected yet.">
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_1.5fr_1fr]">
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col justify-center rounded-lg border border-border bg-sidebar p-3 text-center">
                    <span className="text-xs text-muted-foreground mb-1">Containment Rate</span>
                    <span className="text-xl font-bold text-foreground">{chatbotStats.containmentRate}%</span>
                  </div>
                  <div className="flex flex-col justify-center rounded-lg border border-border bg-sidebar p-3 text-center">
                    <span className="text-xs text-muted-foreground mb-1">Fallback Rate</span>
                    <span className="text-xl font-bold text-destructive">{chatbotStats.fallbackRate}%</span>
                  </div>
                  <div className="flex flex-col justify-center rounded-lg border border-border bg-sidebar p-3 text-center">
                    <span className="text-xs text-muted-foreground mb-1">Avg Bot Turns</span>
                    <span className="text-xl font-bold text-foreground">{chatbotStats.avgBotTurns}</span>
                  </div>
                  <div className="flex flex-col justify-center rounded-lg border border-border bg-sidebar p-3 text-center">
                    <span className="text-xs text-muted-foreground mb-1">Top Unanswered</span>
                    <span className="text-sm font-bold text-foreground truncate px-1" title={chatbotStats.topUnanswered}>{chatbotStats.topUnanswered}</span>
                  </div>
                </div>

                <div className="flex flex-col">
                  <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">Top Unanswered Questions</h3>
                  <div className="flex flex-col gap-2">
                    {topUnansweredQuestions.map(q => (
                      <div key={q.rank} className="flex items-center gap-3 rounded bg-muted/30 px-3 py-2 text-sm">
                        <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/20 text-[10px] font-bold text-primary">{q.rank}</span>
                        <span className="flex-1 truncate text-foreground" dir="auto">{q.question}</span>
                        <span className="text-xs font-semibold text-muted-foreground">{q.count}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex flex-col gap-4">
                  <div className="flex h-[130px] w-full items-center justify-center">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={chatbotResolutionSplit} innerRadius={35} outerRadius={55} paddingAngle={2} dataKey="value">
                          {chatbotResolutionSplit.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.fill} />
                          ))}
                        </Pie>
                        <RechartsTooltip content={<CustomTooltip />} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs leading-relaxed text-foreground">
                    <span className="font-semibold text-primary block mb-1">AI Insight</span>
                    41% of escalations happen within the first 2 bot turns — customers are bypassing the menu. An LLM-powered bot layer could contain an estimated 30% more chats.
                  </div>
                </div>
              </div>
              </WorkInProgress>
            </div>

          </div>

          {/* WEEKLY CX HEALTH SCORE */}
          <div className="mt-2 flex flex-col rounded-xl border border-border bg-sidebar p-6 shadow-sm">
            <h2 className="mb-6 text-xl font-bold text-foreground">Weekly CX Health Score</h2>

            <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_2fr]">
              <div className="flex flex-col items-center justify-center border-r-0 border-border lg:border-r lg:pr-8">
                <div className={cn(
                  "flex items-center justify-center size-32 rounded-full border-8",
                  health.tone === "positive" ? "border-positive/20 bg-positive/5" :
                  health.tone === "neutral" ? "border-neutral/20 bg-neutral/5" : "border-destructive/20 bg-destructive/5",
                )}>
                  <span className={cn(
                    "text-5xl font-black tracking-tighter",
                    health.tone === "positive" ? "text-positive" : health.tone === "neutral" ? "text-neutral" : "text-destructive",
                  )}>{health.score}</span>
                </div>
                <div className={cn(
                  "mt-4 flex items-center gap-2 rounded-full px-4 py-1.5 border",
                  health.tone === "positive" ? "bg-positive/10 border-positive/20" :
                  health.tone === "neutral" ? "bg-neutral/10 border-neutral/20" : "bg-destructive/10 border-destructive/20",
                )}>
                  <ShieldAlert className={cn("size-4", health.tone === "positive" ? "text-positive" : health.tone === "neutral" ? "text-neutral" : "text-destructive")} />
                  <span className={cn("text-sm font-bold uppercase tracking-wide", health.tone === "positive" ? "text-positive" : health.tone === "neutral" ? "text-neutral" : "text-destructive")}>
                    CX Health is {health.label} this week
                  </span>
                </div>
              </div>

              <div className="flex flex-col justify-center gap-6">
                <div>
                  <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">Recent Trend</h3>
                  <div className="h-[60px] w-full">
                    {health.trend.length === 0 ? <EmptyChart label="No trend data" /> : (
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={health.trend} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
                        <Line type="monotone" dataKey="score" stroke="var(--positive)" strokeWidth={3} dot={{ r: 4, fill: "var(--background)" }} activeDot={{ r: 6 }} />
                        <RechartsTooltip content={<CustomTooltip />} cursor={{ stroke: 'var(--muted)' }} />
                      </LineChart>
                    </ResponsiveContainer>
                    )}
                  </div>
                </div>

                <div>
                  <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">Score Composition Breakdown (Out of 100)</h3>
                  <div className="flex h-8 w-full overflow-hidden rounded-lg">
                    {health.components.map((comp, idx) => {
                      const colors = ["bg-primary", "bg-chart-4"];
                      return (
                        <div
                          key={comp.name}
                          className={cn("flex items-center justify-center text-[10px] font-bold text-white transition-all hover:opacity-80", colors[idx % colors.length])}
                          style={{ width: `${comp.score}%` }}
                          title={`${comp.name}: ${comp.score} points`}
                        >
                          {comp.score}
                        </div>
                      )
                    })}
                  </div>
                  <div className="mt-2 flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
                    {health.components.map((comp, idx) => {
                      const dot = ["bg-primary", "bg-chart-4"];
                      return (
                        <div key={comp.name} className="flex items-center gap-1">
                          <div className={cn("size-2 rounded-full", dot[idx % dot.length])} />
                          {comp.name}
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            </div>
          </div>
          </>
          )}

          <footer className="pb-4 pt-2 text-center text-xs text-muted-foreground">
            Rafeeq Analytics · CX Operations Dashboard
          </footer>
        </main>
      </div>
    </div>
  )
}

function EmptyChart({ label }: { label: string }) {
  return <div className="flex h-full min-h-[100px] items-center justify-center text-xs text-muted-foreground">{label}</div>
}
