"use client"

import { useMemo, useState, useCallback, useEffect } from "react"
import { MessageSquare, Frown, Tag, TrendingUp } from "lucide-react"
import { Sidebar } from "@/components/rafeeq/sidebar"
import { Topbar } from "@/components/rafeeq/topbar"
import { StatCard } from "@/components/rafeeq/stat-card"
import { MessageFilterBar, type MessageFilters } from "@/components/rafeeq/message-filter-bar"
import { MessageFeedTable } from "@/components/rafeeq/message-feed-table"
import { TopNegativeTriggers } from "@/components/rafeeq/top-negative-triggers"
import { CrossChannelComparison } from "@/components/rafeeq/cross-channel-comparison"
import { SentimentByZoneTime } from "@/components/rafeeq/sentiment-by-zone-time"
import { MessageSentimentTrend } from "@/components/rafeeq/message-sentiment-trend"
import { MessagesLoading } from "@/components/rafeeq/loading-screen"
import { RefreshStatus } from "@/components/rafeeq/refresh-status"
import { ThresholdAlert } from "@/components/rafeeq/threshold-alert"
import { useAutoRefresh, useSettings } from "@/lib/settings-context"
import { type SupportMessage, type TimeOfDay } from "@/lib/mock-messages"
import type { Sentiment } from "@/lib/rafeeq-data"
import {
  fetchAllMessagesData,
  type TriggerItem,
  type CrossChannelItem,
  type TrendItem,
  type ZoneItem,
  type TimeItem,
} from "@/lib/api"

const CHANNELS = ["App", "WhatsApp", "Ticket"]
const INTENTS = ["Complaint", "Refund", "Order Query", "Cancellation", "Praise"]
const SENTIMENTS = ["Positive", "Neutral", "Negative"]
const TIMES = ["Morning", "Afternoon", "Evening", "Night"]

export default function MessagesPage() {
  const [messages, setMessages] = useState<SupportMessage[]>([])
  const [triggers, setTriggers] = useState<TriggerItem[] | undefined>(undefined)
  const [crossChannel, setCrossChannel] = useState<CrossChannelItem[] | undefined>(undefined)
  const [trend, setTrend] = useState<TrendItem[] | undefined>(undefined)
  const [zones, setZones] = useState<ZoneItem[] | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [search, setSearch] = useState("")
  const { settings } = useSettings()
  const [filters, setFilters] = useState<MessageFilters>({
    channel: null,
    intent: null,
    sentiment: null,
    zone: null,
    timeOfDay: null,
  })

  // Fetch real data from the backend. `background` skips the full-page skeleton
  // (used by auto-refresh and the manual "Refresh" button).
  const loadData = useCallback((background = false) => {
    if (background) setRefreshing(true)
    else setLoading(true)
    fetchAllMessagesData()
      .then((result) => {
        setMessages(result.messages ?? [])
        if (result.triggers) setTriggers(result.triggers)
        if (result.crossChannel) setCrossChannel(result.crossChannel)
        if (result.trend) setTrend(result.trend)
        if (result.zones) setZones(result.zones)
        setLastUpdated(new Date())
      })
      .finally(() => {
        if (background) setRefreshing(false)
        else setLoading(false)
      })
  }, [])

  useEffect(() => {
    loadData(false)
  }, [loadData])

  // Re-fetch on the cadence configured on the Settings page.
  useAutoRefresh(() => loadData(true))

  // Sentiment-spike alert: negative sentiment jumping week-over-week past the
  // configured threshold (Settings → SLA & Alert Configurations).
  const sentimentBreach = useMemo(() => {
    if (!trend || trend.length < 2) return [] as string[]
    const latest = trend[trend.length - 1]
    const prev = trend[trend.length - 2]
    const delta = latest.negative - prev.negative
    if (delta >= settings.sentimentSpikePct) {
      return [
        `Negative sentiment up ${delta.toFixed(0)} pts week-over-week (${prev.negative}% → ${latest.negative}%, limit ${settings.sentimentSpikePct} pts)`,
      ]
    }
    return [] as string[]
  }, [trend, settings.sentimentSpikePct])

  // SLA breach indicator: unresolved messages whose age exceeds the configured
  // SLA target. Chat SLA applies to App/WhatsApp, General SLA to Tickets.
  const slaBreach = useMemo(() => {
    const now = Date.now()
    const counts: Record<string, number> = {}
    for (const m of messages) {
      if (m.resolved) continue
      const ts = new Date(m.date.replace(" ", "T")).getTime()
      if (Number.isNaN(ts)) continue
      const ageHours = (now - ts) / 3_600_000
      const sla = m.channel === "Ticket" ? settings.generalSlaHours : settings.chatSlaHours
      if (ageHours > sla) counts[m.channel] = (counts[m.channel] ?? 0) + 1
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([ch, n]) => {
        const sla = ch === "Ticket" ? settings.generalSlaHours : settings.chatSlaHours
        return `${n} unresolved ${ch} message${n !== 1 ? "s" : ""} past the ${sla}h SLA`
      })
  }, [messages, settings.chatSlaHours, settings.generalSlaHours])

  // ---------------------------------------------------------------------------
  // Derived stats for the stat cards
  // ---------------------------------------------------------------------------
  const stats = useMemo(() => {
    const total = messages.length
    if (total === 0) return { total: 0, negativeRate: "—", topIntent: "—", topChannel: "—" }

    const negCount = messages.filter((m) => m.sentiment === "Negative").length

    const intentMap: Record<string, number> = {}
    const channelMap: Record<string, number> = {}

    for (const m of messages) {
      intentMap[m.intent] = (intentMap[m.intent] || 0) + 1
      channelMap[m.channel] = (channelMap[m.channel] || 0) + 1
    }

    const topIntent = Object.entries(intentMap).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "—"
    const topChannel = Object.entries(channelMap).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "—"

    return {
      total,
      negativeRate: `${((negCount / total) * 100).toFixed(1)}%`,
      topIntent,
      topChannel,
    }
  }, [messages])

  // ---------------------------------------------------------------------------
  // Sentiment by time-of-day breakdown (drives the "Sentiment by Time of Day" chart)
  // ---------------------------------------------------------------------------
  const timeOfDayData = useMemo<TimeItem[]>(() => {
    const order: TimeOfDay[] = ["Morning", "Afternoon", "Evening", "Night"]
    return order.map((time) => {
      const subset = messages.filter((m) => m.timeOfDay === time)
      if (subset.length === 0) return { time, positive: 0, neutral: 0, negative: 0 }
      const pct = (s: Sentiment) =>
        Math.round((subset.filter((m) => m.sentiment === s).length / subset.length) * 100)
      return { time, positive: pct("Positive"), neutral: pct("Neutral"), negative: pct("Negative") }
    })
  }, [messages])

  // ---------------------------------------------------------------------------
  // Week-over-week message volume change (null when fewer than 2 weeks of data)
  // ---------------------------------------------------------------------------
  const weekOverWeek = useMemo(() => {
    if (messages.length === 0) return null
    const WEEK_MS = 7 * 24 * 60 * 60 * 1000
    const counts = new Map<number, number>()
    for (const m of messages) {
      const ts = new Date(m.date.replace(" ", "T")).getTime()
      if (Number.isNaN(ts)) continue
      const week = Math.floor(ts / WEEK_MS)
      counts.set(week, (counts.get(week) ?? 0) + 1)
    }
    const weeks = [...counts.keys()].sort((a, b) => b - a)
    if (weeks.length < 2) return null
    const current = counts.get(weeks[0])!
    const previous = counts.get(weeks[1])!
    if (previous === 0) return null
    return ((current - previous) / previous) * 100
  }, [messages])

  // ---------------------------------------------------------------------------
  // Zone filter options derived from real message data
  // ---------------------------------------------------------------------------
  const zoneOptions = useMemo(() => {
    const set = new Set<string>()
    for (const m of messages) set.add(m.zone)
    return [...set].sort()
  }, [messages])

  // ---------------------------------------------------------------------------
  // Filtered messages for the table
  // ---------------------------------------------------------------------------
  const filteredMessages = useMemo(() => {
    const q = search.trim().toLowerCase()
    return messages.filter((m) => {
      if (filters.channel && m.channel !== filters.channel) return false
      if (filters.intent && m.intent !== filters.intent) return false
      if (filters.sentiment && m.sentiment !== filters.sentiment) return false
      if (filters.zone && m.zone !== filters.zone) return false
      if (filters.timeOfDay && m.timeOfDay !== filters.timeOfDay) return false
      if (q && !m.id.toLowerCase().includes(q) && !m.customerId.toLowerCase().includes(q) && !m.text.toLowerCase().includes(q))
        return false
      return true
    })
  }, [messages, filters, search])

  const resetFilters = useCallback(() => {
    setFilters({ channel: null, intent: null, sentiment: null, zone: null, timeOfDay: null })
    setSearch("")
  }, [])

  const exportCsv = useCallback(() => {
    const headers = ["Msg ID", "Channel", "Customer", "Text", "Intent", "Sentiment", "Confidence", "Zone", "Time of Day", "Date"]
    const escape = (v: string) => `"${v.replace(/"/g, '""')}"`
    const rows = filteredMessages.map((m) =>
      [m.id, m.channel, m.customerId, m.text, m.intent, m.sentiment, `${m.confidence}%`, m.zone, m.timeOfDay, m.date]
        .map((v) => escape(String(v)))
        .join(",")
    )
    const csv = [headers.map(escape).join(","), ...rows].join("\n")
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = `support-messages-${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }, [filteredMessages])

  return (
    <div className="flex min-h-screen">
      <Sidebar />

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar title="Support Messages" search={search} onSearch={setSearch} />

        <main className="flex flex-1 flex-col gap-6 p-4 md:p-6">
          
          {/* Header */}
          <div className="flex flex-col items-start gap-3 border-b border-border pb-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
                Customer Support Messages
              </h1>
              <p className="text-sm text-muted-foreground">
                Analyze text-based support across App, WhatsApp, and Tickets.
              </p>
            </div>
            <RefreshStatus lastUpdated={lastUpdated} refreshing={refreshing} onRefresh={() => loadData(true)} />
          </div>

          {loading ? (
            <MessagesLoading />
          ) : (
          <>
          <ThresholdAlert title="Negative sentiment spike detected" items={sentimentBreach} />
          <ThresholdAlert title="SLA targets exceeded" items={slaBreach} />

          {/* Stat cards */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <StatCard
              label="Total Messages Analyzed"
              value={stats.total > 0 ? stats.total.toLocaleString() : "0"}
              trend="neutral"
              icon={MessageSquare}
            />
            <StatCard
              label="Negative Sentiment"
              value={stats.negativeRate}
              trend="up"
              icon={Frown}
            />
            <StatCard
              label="Most Common Intent"
              value={stats.topIntent}
              trend="neutral"
              icon={Tag}
            />
            <StatCard
              label="Most Active Channel"
              value={stats.topChannel}
              trend="neutral"
              icon={MessageSquare}
            />
            <StatCard
              label="Week-over-Week Vol"
              value={weekOverWeek === null ? "N/A" : `${weekOverWeek >= 0 ? "+" : ""}${weekOverWeek.toFixed(0)}%`}
              trend={weekOverWeek === null ? "neutral" : weekOverWeek >= 0 ? "up" : "down"}
              icon={TrendingUp}
            />
          </div>

          <TopNegativeTriggers data={triggers} />

          <div>
            <MessageFilterBar
              filters={filters}
              channels={CHANNELS}
              intents={INTENTS}
              sentiments={SENTIMENTS}
              zones={zoneOptions}
              timesOfDay={TIMES}
              resultCount={filteredMessages.length}
              onChange={setFilters}
              onReset={resetFilters}
              onExport={exportCsv}
            />
          </div>

          <MessageFeedTable messages={filteredMessages} />

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-[2fr_3fr]">
            <CrossChannelComparison data={crossChannel} />
            <MessageSentimentTrend data={trend} />
          </div>

          <SentimentByZoneTime zoneData={zones} timeData={timeOfDayData} />
          </>
          )}

          <footer className="pb-4 pt-2 text-center text-xs text-muted-foreground">
            Rafeeq Call Intelligence · Support Messages
          </footer>
        </main>
      </div>
    </div>
  )
}
