"use client"

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  Activity, Ban, MessageCircle, Lightbulb,
  TrendingUp, TrendingDown, AlertTriangle, ArrowRight, HeartPulse, ShieldAlert
} from "lucide-react"
import { Sidebar } from "@/components/clarity/sidebar"
import { Topbar } from "@/components/clarity/topbar"
import { StatCard } from "@/components/clarity/stat-card"
import { CxDashboardLoading } from "@/components/clarity/loading-screen"
import { RefreshStatus } from "@/components/clarity/refresh-status"
import { useAutoRefresh } from "@/lib/settings-context"
import { useTimeFilter } from "@/lib/time-filter-context"
import { filterByRange, type TimeRange } from "@/lib/time-range"
import { useT, useTV } from "@/lib/i18n"
import {
  LineChart, Line, AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer
} from "recharts"
import Link from "next/link"
import { cn } from "@/lib/utils"

import {
  fetchCalls, fetchAllMessagesData, fetchCancelTrend, fetchCancelByZone,
  fetchFeatureImportance, fetchCancelByActor, fetchContactRate, clearServerCache, fetchZones,
  type TriggerItem, type TrendItem, type CancelTrend, type CancelByZone,
  type FeatureImportance, type ActorRow, type ContactRate,
  type CrossChannelItem, type HandledBy,
} from "@/lib/api"
import { CrossChannelComparison } from "@/components/clarity/cross-channel-comparison"
import { HandledByPanel } from "@/components/clarity/handled-by"
import type { CallRecord } from "@/lib/clarity-data"
import type { SupportMessage } from "@/lib/mock-messages"
import { GlobalVerticalSelect } from "@/components/clarity/vertical-select"
import { HoverBreakdown } from "@/components/clarity/hover-breakdown"

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

function cleanFeature(name: string) {
  return name.replace(/^num__|^cat__/, "").replace(/_/g, " ")
}

// Zone names come back long ("Zone 14 Al Souq and Old Doha"); collapse them to
// the "Zone N" prefix (or a truncated form) so the vertical bar-chart axis labels
// stay on one line. The full name remains visible in the tooltip.
function shortZoneLabel(zone: string): string {
  const match = zone.match(/^Zone\s+\d+/i)
  if (match) return match[0]
  return zone.length > 12 ? `${zone.slice(0, 11)}…` : zone
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
  const t = useT()
  const tv = useTV()
  const [search, setSearch] = useState("")
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  // Raw data pulled from the same endpoints that power the dedicated dashboards.
  const [calls, setCalls] = useState<CallRecord[]>([])
  const [messages, setMessages] = useState<SupportMessage[]>([])
  // True message volume for the selected window+vertical (server aggregate).
  // The `messages` feed is capped at 1000 for the client-side sample, so it
  // must never be used to count total interactions.
  const [msgTotal, setMsgTotal] = useState(0)
  // % of support chats escalated from the bot to a human agent (server aggregate).
  const [escalationPct, setEscalationPct] = useState<number | null>(null)
  const [triggers, setTriggers] = useState<TriggerItem[]>([])
  const [msgTrend, setMsgTrend] = useState<TrendItem[]>([])
  const [cancelTrend, setCancelTrend] = useState<CancelTrend | null>(null)
  const [cancelZones, setCancelZones] = useState<CancelByZone | null>(null)
  const [featImp, setFeatImp] = useState<FeatureImportance | null>(null)
  const [cancelActors, setCancelActors] = useState<ActorRow[] | null>(null)
  const [contactRate, setContactRate] = useState<ContactRate | null>(null)
  // Cross-channel comparison lives here (moved off the Messages page) — it is a
  // channel-level read, which is a CX-leadership question, not a message-feed one.
  const [crossChannel, setCrossChannel] = useState<CrossChannelItem[] | undefined>(undefined)
  const [handledBy, setHandledBy] = useState<HandledBy | null>(null)

  // App-wide time-range + vertical filters. Calls/messages carry per-record
  // dates/verticals (filtered client-side); the cancellation aggregates are
  // re-queried server-side.
  const { range, vertical, setVertical, queryKey } = useTimeFilter()

  // Zone scope. Orders, messages and calls all use the same zone vocabulary,
  // so one selection is applied server-side to the aggregates and client-side
  // to the record-level sources below. "all" ⇒ no zone predicate.
  const [zone, setZone] = useState<string>("all")
  const [zoneOptions, setZoneOptions] = useState<string[]>([])

  useEffect(() => {
    fetchZones().then(setZoneOptions)
  }, [])

  const resetFilters = () => {
    setVertical("all")
    setZone("all")
  }

  const loadData = useCallback((r: TimeRange, background = false, bust = false) => {
    if (background) setRefreshing(true)
    else setLoading(true)
    // Only the manual Refresh button busts the server cache — auto-refresh and
    // window toggles ride the backend's TTL cache so they stay fast.
    const ready = bust ? clearServerCache() : Promise.resolve()
    ready.then(() => Promise.all([
      fetchCalls(),
      fetchAllMessagesData(r, 4, 24, vertical, zone),
      fetchCancelTrend(r, vertical, zone),
      // Unscoped on purpose: this chart IS the zone comparison, so it keeps
      // every zone and highlights the selected one instead of collapsing to it.
      fetchCancelByZone(r, vertical),
      fetchFeatureImportance(),
      fetchCancelByActor(r, vertical, zone),
      fetchContactRate(r),
    ])).then(([callsData, msgs, cTrend, cZones, fImp, actors, cRate]) => {
      setCalls(callsData ?? [])
      setMessages(msgs.messages ?? [])
      setMsgTotal(msgs.overview?.total ?? 0)
      setEscalationPct(msgs.overview?.escalationPct ?? null)
      setTriggers(msgs.triggers ?? [])
      setCrossChannel(msgs.crossChannel ?? undefined)
      setHandledBy(msgs.handledBy ?? null)
      setMsgTrend(msgs.trend ?? [])
      setCancelTrend(cTrend)
      setCancelZones(cZones)
      setFeatImp(fImp)
      setCancelActors(actors)
      setContactRate(cRate)
      setLastUpdated(new Date())
      if (background) setRefreshing(false)
      else setLoading(false)
    })
  }, [vertical, zone])

  // Initial load (full skeleton) once.
  useEffect(() => {
    loadData(range, false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Re-query server-aggregated panels in the background when the window changes.
  const firstRange = useRef(true)
  useEffect(() => {
    if (firstRange.current) { firstRange.current = false; return }
    loadData(range, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryKey, zone])

  useAutoRefresh(() => loadData(range, true))

  // Client-side date + vertical scoping for the record-level sources.
  const byVertical = useCallback(
    <T extends { vertical?: string }>(rows: T[]) =>
      vertical === "all" ? rows : rows.filter((r) => r.vertical === vertical),
    [vertical],
  )
  // Calls and the raw message feed are filtered here rather than server-side;
  // a call's zone is the first area named in its transcript.
  const scopedCalls = useMemo(() => {
    const rows = byVertical(filterByRange(calls, range, (c) => c.datetime))
    return zone === "all" ? rows : rows.filter((c) => c.city === zone)
  }, [calls, range, byVertical, zone])
  const scopedMessages = useMemo(() => {
    const rows = byVertical(filterByRange(messages, range, (m) => m.date))
    return zone === "all" ? rows : rows.filter((m) => m.zone === zone)
  }, [messages, range, byVertical, zone])

  // -------------------------------------------------------------------------
  // Derived sentiment counts (calls + messages)
  // -------------------------------------------------------------------------
  const sentimentCounts = useMemo(() => {
    let pos = 0, neu = 0, neg = 0
    for (const c of scopedCalls) {
      if (c.sentiment === "Positive") pos++
      else if (c.sentiment === "Neutral") neu++
      else neg++
    }
    for (const m of scopedMessages) {
      if (m.sentiment === "Positive") pos++
      else if (m.sentiment === "Neutral") neu++
      else neg++
    }
    return { pos, neu, neg, total: pos + neu + neg }
  }, [scopedCalls, scopedMessages])

  const msgSentimentCounts = useMemo(() => {
    let pos = 0, neu = 0, neg = 0
    for (const m of scopedMessages) {
      if (m.sentiment === "Positive") pos++
      else if (m.sentiment === "Neutral") neu++
      else neg++
    }
    return { pos, neu, neg }
  }, [scopedMessages])

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

  // -------------------------------------------------------------------------
  // Calls panel
  // -------------------------------------------------------------------------
  const callWeeks = useMemo(() => weeklyFromCalls(scopedCalls), [scopedCalls])
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
    for (const c of scopedCalls) {
      if (c.sentiment !== "Negative") continue
      counts[c.intent] = (counts[c.intent] ?? 0) + 1
    }
    let entries = Object.entries(counts)
    if (!entries.length) {
      // Fall back to overall intent volume if there are no negatives.
      const all: Record<string, number> = {}
      for (const c of scopedCalls) all[c.intent] = (all[c.intent] ?? 0) + 1
      entries = Object.entries(all)
    }
    return entries
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([name, count], i) => ({ rank: i + 1, name, count, trend: i < 2 ? "up" : "down" }))
  }, [scopedCalls])

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
    if (!msgTrend.length) return t("cx.sentimentInsightEmpty")
    const worst = msgTrend.reduce((a, b, i) => (b.negative > msgTrend[a].negative ? i : a), 0)
    const topTrigger = triggers[0]?.trigger
    const base = t("cx.sentimentInsight", { week: worst + 1, pct: msgTrend[worst].negative })
    return topTrigger ? base + t("cx.sentimentInsightDriver", { trigger: topTrigger }) : base
  }, [msgTrend, triggers, t])

  // -------------------------------------------------------------------------
  // Cancellations panel
  // -------------------------------------------------------------------------
  // Every ISO week in the selected window (period is "YYYY-Www"; drop the year
  // for the compact axis). No slice — YTD has 27 weeks, not 12.
  const weeklyCancellations = useMemo(
    () => (cancelTrend?.weekly ?? []).map((w) => ({ week: w.period.split("-").pop() ?? w.period, rate: w.cancel_rate_pct })),
    [cancelTrend],
  )
  // Who initiated the cancellation (customer via support, Clarity's driver, or the
  // vendor). Percentages are a true share of ALL cancellations. Falls back to the
  // model's feature-importance only when the model is trained (top_features present).
  const cancelDrivers = useMemo(() => {
    if (featImp?.top_features?.length) {
      const top = featImp.top_features.slice(0, 3)
      const sum = top.reduce((s, f) => s + f.importance, 0) || 1
      return { byActor: false, rows: top.map((f) => ({ name: cleanFeature(f.feature), percentage: Math.round((f.importance / sum) * 100) })) }
    }
    const actors = cancelActors ?? []
    const total = actors.reduce((s, a) => s + a.cancellations, 0) || 1
    return { byActor: true, rows: actors.slice(0, 3).map((a) => ({ name: a.cancelled_by, percentage: Math.round((a.cancellations / total) * 100) })) }
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
    if (!cancellationZones.length) return t("cx.cancelInsightEmpty")
    const top = cancellationZones[0]
    return t("cx.cancelInsight", { zone: top.zone, rate: top.rate })
  }, [cancellationZones, t])

  // -------------------------------------------------------------------------
  // Weekly CX health score (derived from real sentiment + cancellation signals)
  // -------------------------------------------------------------------------
  const health = useMemo(() => {
    const sentimentPts = Math.round((sentimentScore / 10) * 50)
    const cancelPts = Math.round((1 - Math.min(cancellationRate / 20, 1)) * 50)
    const score = sentimentPts + cancelPts
    const label = score >= 75 ? t("cx.healthGood") : score >= 50 ? t("cx.healthFair") : t("cx.healthPoor")
    const tone = score >= 75 ? "positive" : score >= 50 ? "neutral" : "destructive"
    // Raw inputs, not derived points — sentiment fills toward 10/10 (more = good),
    // cancellations fill toward the 20% penalty cap (more = bad).
    const components = [
      { name: t("cx.compSentiment"), value: t("cx.compSentimentDetail", { score: sentimentScore.toFixed(1) }), pct: (sentimentScore / 10) * 100 },
      { name: t("cx.compCancellations"), value: t("cx.compCancelDetail", { rate: cancellationRate.toFixed(1) }), pct: Math.min(cancellationRate / 20, 1) * 100 },
    ]
    // Weekly health = that week's sentiment points + that week's cancellation
    // points, same formula as the headline. Sentiment blends both channels like
    // the headline does: message percentages back to counts (the trend carries
    // each week's total) plus call sentiment counts.
    // ponytail: series are index-aligned from the most recent week, not
    // calendar-joined — fine while all are contiguous weekly buckets.
    const msgs = msgTrend.slice(-8)
    const calls = callWeeks.slice(-msgs.length)
    const cWeeks = weeklyCancellations.slice(-msgs.length)
    const trend = msgs.map((m, i) => {
      const c = calls[i - (msgs.length - calls.length)]
      const pos = (m.positive / 100) * m.total + (c?.pos ?? 0)
      const neu = (m.neutral / 100) * m.total + (c?.neu ?? 0)
      const total = m.total + (c ? c.pos + c.neu + c.neg : 0)
      const sPts = total ? ((pos * 10 + neu * 5) / total / 10) * 50 : 0
      const cw = cWeeks[i - (msgs.length - cWeeks.length)]
      const cPts = cw ? (1 - Math.min(cw.rate / 20, 1)) * 50 : cancelPts
      // Keep the source week label (e.g. W21–W28) so it matches the sentiment
      // chart's numbering instead of restarting at W1.
      return { week: m.week, score: Math.round(sPts + cPts) }
    })
    return { score, label, tone, components, trend }
  }, [sentimentScore, cancellationRate, msgTrend, callWeeks, weeklyCancellations, t])

  const totalInteractions = scopedCalls.length + msgTotal

  // ---------------------------------------------------------------------------
  // Per-chart insights — one plain-language read for every graph on this page,
  // derived from the same series the chart draws (no second source of truth).
  // Each returns null when its series is too thin to say anything honest.
  // ---------------------------------------------------------------------------
  const callVolumeInsight = useMemo(() => {
    if (weeklyCallsVolume.length < 2) return null
    const last = weeklyCallsVolume[weeklyCallsVolume.length - 1]
    const prev = weeklyCallsVolume[weeklyCallsVolume.length - 2]
    const sum = (w: typeof last) => w.billing + w.technical + w.complaints
    const prevTotal = sum(prev)
    const delta = prevTotal === 0 ? null : ((sum(last) - prevTotal) / prevTotal) * 100
    const mix = ([
      ["cx.catBilling", last.billing],
      ["cx.catTechnical", last.technical],
      ["cx.catComplaints", last.complaints],
    ] as const).slice().sort((a, b) => b[1] - a[1])[0]
    return t("cx.insightCallVolume", {
      total: sum(last),
      dir: delta === null ? "—" : t(delta >= 0 ? "cx.up" : "cx.down"),
      delta: delta === null ? "0" : Math.abs(delta).toFixed(0),
      top: t(mix[0]),
      topN: mix[1],
    })
  }, [weeklyCallsVolume, t])

  const callSentimentInsight = useMemo(() => {
    if (!weeklyCallSentiment.length) return null
    const last = weeklyCallSentiment[weeklyCallSentiment.length - 1]
    const total = last.positive + last.neutral + last.negative
    if (!total) return null
    const negPct = (last.negative / total) * 100
    const prev = weeklyCallSentiment[weeklyCallSentiment.length - 2]
    const prevTotal = prev ? prev.positive + prev.neutral + prev.negative : 0
    const prevNeg = prevTotal ? (prev.negative / prevTotal) * 100 : null
    return t("cx.insightCallSentiment", {
      neg: negPct.toFixed(1),
      trend: prevNeg === null
        ? t("cx.noPriorWeek")
        : t(negPct >= prevNeg ? "cx.worseThanPrior" : "cx.betterThanPrior", { pts: Math.abs(negPct - prevNeg).toFixed(1) }),
    })
  }, [weeklyCallSentiment, t])

  const complaintsInsight = useMemo(() => {
    if (!topComplaints.length) return null
    const first = topComplaints[0]
    const share = scopedCalls.length ? (first.count / scopedCalls.length) * 100 : 0
    return t("cx.insightComplaints", { name: tv(first.name), count: first.count, share: share.toFixed(0) })
  }, [topComplaints, scopedCalls.length, t, tv])

  const sentimentScoreInsight = useMemo(() => {
    if (weeklySentimentScore.length < 2) return null
    const last = weeklySentimentScore[weeklySentimentScore.length - 1]
    const first = weeklySentimentScore[0]
    const diff = last.score - first.score
    return t("cx.insightSentimentScore", {
      score: last.score.toFixed(1),
      dir: t(diff >= 0 ? "cx.improved" : "cx.declined"),
      diff: Math.abs(diff).toFixed(1),
      weeks: weeklySentimentScore.length,
    })
  }, [weeklySentimentScore, t])

  const negativeTopicsInsight = useMemo(() => {
    if (!topNegativeTopics.length) return null
    const total = topNegativeTopics.reduce((sum, x) => sum + x.count, 0) || 1
    const first = topNegativeTopics[0]
    return t("cx.insightNegTopics", {
      topic: first.topic,
      count: first.count.toLocaleString(),
      share: ((first.count / total) * 100).toFixed(0),
    })
  }, [topNegativeTopics, t])

  const cancelTrendInsight = useMemo(() => {
    if (weeklyCancellations.length < 2) return null
    const last = weeklyCancellations[weeklyCancellations.length - 1]
    const prev = weeklyCancellations[weeklyCancellations.length - 2]
    const peak = weeklyCancellations.reduce((a, b) => (b.rate > a.rate ? b : a))
    return t("cx.insightCancelTrend", {
      rate: last.rate.toFixed(1),
      dir: t(last.rate >= prev.rate ? "cx.up" : "cx.down"),
      pts: Math.abs(last.rate - prev.rate).toFixed(1),
      peakWeek: peak.week,
      peakRate: peak.rate.toFixed(1),
    })
  }, [weeklyCancellations, t])

  const driversInsight = useMemo(() => {
    if (!cancelDrivers.rows.length) return null
    const first = cancelDrivers.rows[0]
    return t(cancelDrivers.byActor ? "cx.insightCancelActor" : "cx.insightCancelDriver", {
      name: tv(first.name), pct: first.percentage,
    })
  }, [cancelDrivers, t, tv])

  const healthInsight = useMemo(() => {
    if (health.trend.length < 2) return null
    const last = health.trend[health.trend.length - 1]
    const prev = health.trend[health.trend.length - 2]
    return t("cx.insightHealth", {
      score: health.score,
      label: health.label,
      dir: t(last.score >= prev.score ? "cx.up" : "cx.down"),
      pts: Math.abs(last.score - prev.score),
    })
  }, [health, t])

  // ---------------------------------------------------------------------------
  // Executive summary — one read across Calls, Messages and Cancellations.
  // Deterministic prose over the same numbers the panels below show, so it can
  // never drift from them (and costs nothing to produce).
  // ---------------------------------------------------------------------------
  const execSummary = useMemo(() => {
    const verdict = t("cx.execVerdict", {
      label: health.label.toLowerCase(),
      score: health.score,
      interactions: totalInteractions.toLocaleString(),
      sentiment: sentimentScore.toFixed(1),
    })

    const points: { key: string; text: string; tone: "positive" | "neutral" | "negative" }[] = []

    // Volume mix across the two contact channels.
    points.push({
      key: "volume",
      tone: "neutral",
      text: t("cx.execVolume", {
        calls: scopedCalls.length.toLocaleString(),
        messages: msgTotal.toLocaleString(),
        contact: contactRate ? contactRate.contact_rate_pct.toFixed(1) + "%" : "—",
      }),
    })

    // What customers are actually calling about.
    if (topComplaints.length) {
      points.push({
        key: "calls",
        tone: "negative",
        text: t("cx.execCalls", { name: tv(topComplaints[0].name), count: topComplaints[0].count }),
      })
    }

    // Who is doing the handling, and how each one's conversations land.
    const bot = handledBy?.handlers.find((h) => h.handler === "Bot")
    const agent = handledBy?.handlers.find((h) => h.handler === "Agent")
    if (bot && agent && handledBy && handledBy.total > 0) {
      points.push({
        key: "handled",
        tone: bot.negative_pct > agent.negative_pct ? "negative" : "positive",
        text: t("cx.execHandled", {
          botPct: bot.share_pct, agentPct: agent.share_pct,
          botNeg: bot.negative_pct, agentNeg: agent.negative_pct,
        }),
      })
    }

    // Loudest negative driver in the text channels.
    if (triggers.length) {
      points.push({
        key: "sentiment",
        tone: "negative",
        text: t("cx.execSentiment", { trigger: triggers[0].trigger, volume: triggers[0].volume.toLocaleString() }),
      })
    }

    // Cancellation pressure and where it is worst.
    points.push({
      key: "cancel",
      tone: cancellationRate >= 8 ? "negative" : cancellationRate >= 4 ? "neutral" : "positive",
      text: cancellationZones.length
        ? t("cx.execCancel", {
            rate: cancellationRate.toFixed(1),
            zone: cancellationZones[0].zone,
            zoneRate: cancellationZones[0].rate.toFixed(1),
          })
        : t("cx.execCancelNoZone", { rate: cancellationRate.toFixed(1) }),
    })

    // The single thing to act on, chosen by the loudest negative signal.
    const action = cancellationRate >= 8 && cancellationZones.length
      ? t("cx.execActionCancel", { zone: cancellationZones[0].zone })
      : escalationPct !== null && escalationPct >= 40
        ? t("cx.execActionEscalation", { pct: escalationPct.toFixed(0) })
        : topComplaints.length
          ? t("cx.execActionComplaint", { name: tv(topComplaints[0].name) })
          : t("cx.execActionNone")

    return { verdict, points, action }
  }, [
    health, totalInteractions, sentimentScore, scopedCalls.length, msgTotal, contactRate,
    topComplaints, handledBy, triggers, cancellationRate, cancellationZones, escalationPct, t, tv,
  ])


  // Hover breakdown behind the cancellation-rate stat: top zones by cancelled
  // volume (falls back to cancelling actors if zone data is empty).
  const cancelContributors = useMemo(() => {
    const zones = [...(cancelZones?.by_zone_name ?? [])]
      .sort((a, b) => b.cancelled - a.cancelled)
      .slice(0, 5)
      .map((z) => ({ label: z.zone, value: z.cancelled, pct: z.cancel_rate_pct }))
    if (zones.length) return zones
    return (cancelActors ?? []).slice(0, 5).map((a) => ({ label: a.cancelled_by, value: a.cancellations }))
  }, [cancelZones, cancelActors])

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
        <Topbar title={t("cx.title")} search={search} onSearch={setSearch} />

        <main className="flex flex-1 flex-col gap-6 p-4 md:p-6">

          {/* Header */}
          <div className="flex flex-col items-start gap-3 border-b border-border pb-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
                {t("cx.title")}
              </h1>
              <p className="text-sm text-muted-foreground">
                {t("cx.subtitle")}
              </p>
            </div>
            <RefreshStatus lastUpdated={lastUpdated} refreshing={refreshing} onRefresh={() => loadData(range, true, true)} />
          </div>

          {loading ? (
            <CxDashboardLoading />
          ) : (
          <>
          {/* Filter Bar — zone and category scope selectors. */}
          <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-3">
              <select
                aria-label={t("cx.zoneFilter")}
                className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground outline-none focus:ring-2 focus:ring-primary/50"
                value={zone} onChange={(e) => setZone(e.target.value)}
              >
                <option value="all">{tv("All Zones")}</option>
                {zoneOptions.map((z) => (
                  <option key={z} value={z}>{tv(z)}</option>
                ))}
              </select>
              {/* Mobile-only: topbar shows the vertical filter on lg+ (avoids a duplicate). */}
              <GlobalVerticalSelect className="lg:hidden" />
              {zone !== "all" && (
                <span className="rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
                  {t("cx.scopedToZone", { zone: tv(zone) })}
                </span>
              )}
            </div>
            <button
              onClick={resetFilters}
              className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              {t("cx.resetFilters")}
            </button>
          </div>

          {/* EXECUTIVE SUMMARY — the whole product in one read, assembled from the
              Calls, Messages and Cancellations panels below. */}
          <section className="flex flex-col gap-5 rounded-xl border border-primary/25 bg-gradient-to-br from-primary/[0.07] to-transparent p-6 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold tracking-tight text-foreground">{t("cx.execTitle")}</h2>
                <p className="text-xs text-muted-foreground">{t("cx.execSubtitle")}</p>
              </div>
              <span className={cn(
                "rounded-full border px-3 py-1 text-xs font-bold uppercase tracking-wide",
                health.tone === "positive" ? "border-positive/30 bg-positive/10 text-positive" :
                health.tone === "neutral" ? "border-neutral/30 bg-neutral/10 text-neutral" :
                "border-destructive/30 bg-destructive/10 text-destructive",
              )}>
                {t("cx.healthIs", { label: health.label })}
              </span>
            </div>

            <p className="max-w-4xl text-base leading-relaxed text-foreground">{execSummary.verdict}</p>

            <ul className="grid grid-cols-1 gap-x-6 gap-y-3 lg:grid-cols-2">
              {execSummary.points.map((pt) => (
                <li key={pt.key} className="flex items-start gap-2.5 text-sm leading-relaxed text-muted-foreground">
                  {/* Tone is carried by the icon, not colour alone. */}
                  {pt.tone === "negative" ? (
                    <TrendingDown className="mt-0.5 size-4 shrink-0 text-destructive" aria-label={t("cx.toneNegative")} />
                  ) : pt.tone === "positive" ? (
                    <TrendingUp className="mt-0.5 size-4 shrink-0 text-positive" aria-label={t("cx.tonePositive")} />
                  ) : (
                    <Activity className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-label={t("cx.toneNeutral")} />
                  )}
                  <span>{pt.text}</span>
                </li>
              ))}
            </ul>

            <div className="flex items-start gap-3 rounded-lg border border-accent/25 bg-accent/5 p-4">
              <div className="mt-0.5 rounded-full bg-accent/20 p-1.5 text-accent">
                <Lightbulb className="size-4" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground">{t("cx.execActTitle")}</h3>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{execSummary.action}</p>
              </div>
            </div>
          </section>

          {/* Summary KPI Strip */}
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-5">
            <StatCard label={t("cx.totalInteractions")} value={totalInteractions.toLocaleString()} trend="neutral" icon={Activity} />
            <StatCard label={t("cx.contactRate")} value={contactRate ? `${contactRate.contact_rate_pct.toFixed(1)}%` : "—"} trend="neutral" icon={MessageCircle} />
            <StatCard label={t("cx.overallSentiment")} value={`${sentimentScore.toFixed(1)}/10`} trend="neutral" icon={HeartPulse} />
            <HoverBreakdown title={t("hover.topZones")} rows={cancelContributors}>
              <StatCard label={t("cx.cancellationRate")} value={`${cancellationRate.toFixed(1)}%`} trend="neutral" icon={Ban} />
            </HoverBreakdown>
            <StatCard label={t("cx.escalationRate")} value={escalationPct === null ? "—" : `${escalationPct.toFixed(1)}%`} trend="neutral" icon={AlertTriangle} />
          </div>

          {/* Grid Layout for Panels */}
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">

            {/* CALLS PANEL */}
            <div className="flex flex-col rounded-xl border border-border bg-card p-5 shadow-sm">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-bold text-foreground">{t("nav.callIntelligence")}</h2>
                <Link href="/" className="group flex items-center gap-1 text-xs font-semibold text-primary transition-colors hover:text-primary/80">
                  {t("cx.viewFullCall")} <ArrowRight className="size-3 transition-transform group-hover:translate-x-1 rtl:-scale-x-100" />
                </Link>
              </div>

              <div className="grid flex-1 grid-cols-1 gap-6 lg:grid-cols-[1.5fr_1fr]">
                <div className="flex flex-col gap-4">
                  <div className="h-[160px] w-full">
                    {weeklyCallsVolume.length === 0 ? <EmptyChart label={t("empty.noCallData")} /> : (
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
                  <ChartInsight text={callVolumeInsight} />
                  <div className="h-[120px] w-full">
                    {weeklyCallSentiment.length === 0 ? <EmptyChart label={t("empty.noCallData")} /> : (
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
                  <ChartInsight text={callSentimentInsight} />
                </div>

                <div className="flex flex-col gap-3">
                  <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">{t("cx.topComplaints")}</h3>
                  {topComplaints.length === 0 ? (
                    <p className="text-xs text-muted-foreground">{t("cx.noCallData")}</p>
                  ) : topComplaints.map(comp => (
                    <div key={comp.rank} className="flex items-center gap-3 rounded-lg border border-border bg-sidebar p-3">
                      <div className="flex size-6 items-center justify-center rounded-full bg-primary/20 text-xs font-bold text-primary">
                        {comp.rank}
                      </div>
                      <div className="flex-1">
                        <div className="text-sm font-semibold text-foreground">{tv(comp.name)}</div>
                        <div className="text-xs text-muted-foreground">{comp.count} {t("unit.calls")}</div>
                      </div>
                      {comp.trend === "up" ? <TrendingUp className="size-4 text-destructive" /> : <TrendingDown className="size-4 text-positive" />}
                    </div>
                  ))}
                  <ChartInsight text={complaintsInsight} />
                </div>
              </div>
            </div>

            {/* SENTIMENT PANEL */}
            <div className="flex flex-col rounded-xl border border-border bg-card p-5 shadow-sm">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-bold text-foreground">{t("cx.textSentiment")}</h2>
                <Link href="/messages" className="group flex items-center gap-1 text-xs font-semibold text-primary transition-colors hover:text-primary/80">
                  {t("cx.viewFullSentiment")} <ArrowRight className="size-3 transition-transform group-hover:translate-x-1 rtl:-scale-x-100" />
                </Link>
              </div>

              <div className="grid flex-1 grid-cols-1 gap-6 lg:grid-cols-2">
                <div className="flex flex-col gap-4">
                  <div className="h-[120px] w-full">
                    {weeklySentimentScore.length === 0 ? <EmptyChart label={t("empty.noSentimentTrend")} /> : (
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={weeklySentimentScore} margin={{ top: 5, right: 0, bottom: 0, left: -30 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                        <XAxis dataKey="week" stroke="var(--muted-foreground)" fontSize={11} tickLine={false} axisLine={false} />
                        <YAxis domain={[0, 10]} stroke="var(--muted-foreground)" fontSize={11} tickLine={false} axisLine={false} />
                        <RechartsTooltip content={<CustomTooltip />} />
                        <Line type="monotone" dataKey="score" name={t("cx.overallSentiment")} stroke="var(--primary)" strokeWidth={3} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                      </LineChart>
                    </ResponsiveContainer>
                    )}
                  </div>
                  <ChartInsight text={sentimentScoreInsight} />
                  <div className="h-[160px] w-full">
                    {topNegativeTopics.length === 0 ? <EmptyChart label={t("empty.noNegativeTopics")} /> : (
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
                  <ChartInsight text={negativeTopicsInsight} />
                </div>

                <div className="flex flex-col gap-4">
                  <div className="flex h-[150px] w-full items-center justify-center relative">
                    {sentimentSplit.length === 0 ? <EmptyChart label={t("empty.noMessages")} /> : (
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
                    <span className="font-semibold text-primary block mb-1">{t("common.aiInsight")}</span>
                    {sentimentInsight}
                  </div>
                </div>
              </div>
            </div>

            {/* CANCELLATIONS PANEL */}
            <div className="flex flex-col rounded-xl border border-border bg-card p-5 shadow-sm xl:col-span-2">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-bold text-foreground">{t("cancel.title")}</h2>
                <Link href="/cancellations" className="group flex items-center gap-1 text-xs font-semibold text-primary transition-colors hover:text-primary/80">
                  {t("cx.viewFullCancellation")} <ArrowRight className="size-3 transition-transform group-hover:translate-x-1 rtl:-scale-x-100" />
                </Link>
              </div>

              <div className="grid flex-1 grid-cols-1 gap-6 lg:grid-cols-[1fr_1fr]">
                <div className="flex flex-col gap-4">
                  <div className="h-[120px] w-full">
                    {weeklyCancellations.length === 0 ? <EmptyChart label={t("empty.noCancellationTrend")} /> : (
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={weeklyCancellations} margin={{ top: 5, right: 0, bottom: 0, left: -20 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                        <XAxis dataKey="week" stroke="var(--muted-foreground)" fontSize={11} tickLine={false} axisLine={false} />
                        <YAxis stroke="var(--muted-foreground)" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}%`} />
                        <RechartsTooltip content={<CustomTooltip />} />
                        <Line type="monotone" dataKey="rate" name={t("cx.cancellationRate")} stroke="var(--chart-4)" strokeWidth={3} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                      </LineChart>
                    </ResponsiveContainer>
                    )}
                  </div>
                  <ChartInsight text={cancelTrendInsight} />
                  <div className="flex flex-col gap-2">
                    <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                      {cancelDrivers.byActor ? t("cx.cancelledBy") : t("cx.topDrivers")}
                    </h3>
                    {cancelDrivers.rows.length === 0 ? (
                      <p className="text-xs text-muted-foreground">{t("cx.trainModelDrivers")}</p>
                    ) : cancelDrivers.rows.map((driver, i) => (
                      <div key={i} className="flex items-center justify-between rounded bg-muted/30 px-3 py-2 text-sm">
                        <span className="font-medium text-foreground">{tv(driver.name)}</span>
                        <span className="text-xs font-semibold text-muted-foreground">{driver.percentage}%</span>
                      </div>
                    ))}
                    <ChartInsight text={driversInsight} />
                  </div>
                </div>

                <div className="flex flex-col gap-4">
                  <div className="h-[190px] w-full">
                    {cancellationZones.length === 0 ? <EmptyChart label={t("empty.noZoneData")} /> : (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={cancellationZones} layout="vertical" margin={{ top: 0, right: 10, left: 8, bottom: 0 }} barCategoryGap="25%">
                        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--border)" />
                        <XAxis type="number" hide />
                        <YAxis dataKey="zone" type="category" stroke="var(--muted-foreground)" fontSize={11} tickLine={false} axisLine={false} width={64} interval={0} tickFormatter={shortZoneLabel} />
                        <RechartsTooltip cursor={{ fill: 'var(--muted)', opacity: 0.5 }} content={<CustomTooltip />} />
                        <Bar dataKey="rate" radius={[0, 4, 4, 0]} barSize={12}>
                          {cancellationZones.map((entry, index) => (
                            <Cell
                              key={`cell-${index}`}
                              fill={entry.level === 'high' ? 'var(--destructive)' : entry.level === 'medium' ? 'var(--neutral)' : 'var(--primary)'}
                              // The rest dim so the scoped zone stands out among its peers.
                              fillOpacity={zone === "all" || entry.zone === zone ? 1 : 0.25}
                            />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                    )}
                  </div>
                  <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs leading-relaxed text-foreground">
                    <span className="font-semibold text-primary block mb-1">{t("common.aiInsight")}</span>
                    {cancellationInsight}
                  </div>
                </div>
              </div>
            </div>

          </div>

          {/* CHANNEL BEHAVIOUR — where each intent lands, and who handles it. */}
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <CrossChannelComparison data={crossChannel} />
            <HandledByPanel data={handledBy} />
          </div>

          {/* WEEKLY CX HEALTH SCORE */}
          <div className="mt-2 flex flex-col rounded-xl border border-border bg-sidebar p-6 shadow-sm">
            <h2 className="mb-6 text-xl font-bold text-foreground">{t("cx.weeklyHealth")}</h2>

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
                    {t("cx.healthIs", { label: health.label })}
                  </span>
                </div>
              </div>

              <div className="flex flex-col justify-center gap-6">
                <div>
                  <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">{t("cx.recentTrend")}</h3>
                  <div className="h-[60px] w-full [&_.recharts-wrapper]:outline-none [&_svg]:outline-none">
                    {/* A single week renders as one floating dot — show the empty state instead. */}
                    {health.trend.length < 2 ? <EmptyChart label={t("empty.noTrendData")} /> : (
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={health.trend} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
                        <XAxis dataKey="week" hide />
                        {/* Fixed 0–100 scale so 60 sits at 60% height instead of auto-zooming flat. */}
                        <YAxis domain={[0, 100]} hide />
                        <Line
                          type="monotone" dataKey="score"
                          stroke={health.tone === "positive" ? "var(--positive)" : health.tone === "neutral" ? "var(--neutral)" : "var(--destructive)"}
                          strokeWidth={3} dot={{ r: 4, fill: "var(--background)" }} activeDot={{ r: 6 }}
                        />
                        <RechartsTooltip content={<CustomTooltip />} cursor={{ stroke: 'var(--muted)' }} />
                      </LineChart>
                    </ResponsiveContainer>
                    )}
                  </div>
                  <ChartInsight text={healthInsight} />
                </div>

                <div>
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">{t("cx.scoreComposition")}</h3>
                    <span className="text-sm font-bold text-foreground">{health.score} / 100</span>
                  </div>
                  {/* The two raw metrics behind the score — no derived points. */}
                  <div className="flex flex-col gap-3">
                    {health.components.map((comp, idx) => {
                      const colors = ["bg-primary", "bg-chart-4"];
                      return (
                        <div key={comp.name}>
                          <div className="mb-1 flex items-center justify-between text-xs">
                            <span className="flex items-center gap-1.5 text-muted-foreground">
                              <span className={cn("size-2 rounded-full", colors[idx % colors.length])} />
                              <span className="font-medium text-foreground">{comp.name}</span>
                            </span>
                            <span className="font-semibold text-foreground">{comp.value}</span>
                          </div>
                          <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted/40">
                            <div
                              className={cn("h-full rounded-full transition-all", colors[idx % colors.length])}
                              style={{ width: `${comp.pct}%` }}
                            />
                          </div>
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
            {t("cx.footer")}
          </footer>
        </main>
      </div>
    </div>
  )
}

/**
 * One-line read for the chart directly above it. Renders nothing when the
 * series is too thin to say anything true — an absent insight beats a hedged one.
 */
function ChartInsight({ text }: { text: string | null }) {
  if (!text) return null
  return (
    <p className="flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground">
      <Lightbulb className="mt-0.5 size-3 shrink-0 text-accent" aria-hidden />
      <span>{text}</span>
    </p>
  )
}

function EmptyChart({ label }: { label: string }) {
  return <div className="flex h-full min-h-[100px] items-center justify-center text-xs text-muted-foreground">{label}</div>
}
