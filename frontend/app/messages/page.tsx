"use client"

import { Suspense, useMemo, useRef, useState, useCallback, useEffect } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { MessageSquare, Frown, Tag, TrendingUp } from "lucide-react"
import { Sidebar } from "@/components/rafeeq/sidebar"
import { Topbar } from "@/components/rafeeq/topbar"
import { StatCard } from "@/components/rafeeq/stat-card"
import { MessageFeedTable } from "@/components/rafeeq/message-feed-table"
import { MessageDetailModal } from "@/components/rafeeq/message-detail-modal"
import { TopNegativeTriggers } from "@/components/rafeeq/top-negative-triggers"
import { CrossChannelComparison } from "@/components/rafeeq/cross-channel-comparison"
import { SentimentByZoneTime } from "@/components/rafeeq/sentiment-by-zone-time"
import { MessageSentimentTrend } from "@/components/rafeeq/message-sentiment-trend"
import { MessagesLoading } from "@/components/rafeeq/loading-screen"
import { RefreshStatus } from "@/components/rafeeq/refresh-status"
import { GlobalTimeRange } from "@/components/rafeeq/time-range-select"
import { ThresholdAlert } from "@/components/rafeeq/threshold-alert"
import { useAutoRefresh, useSettings } from "@/lib/settings-context"
import { useTimeFilter } from "@/lib/time-filter-context"
import { filterByRange, type TimeRange } from "@/lib/time-range"
import { useT, useTV } from "@/lib/i18n"
import { type SupportMessage, type TimeOfDay } from "@/lib/mock-messages"
import type { Sentiment } from "@/lib/rafeeq-data"
import {
  fetchAllMessagesData,
  clearServerCache,
  type TriggerItem,
  type CrossChannelItem,
  type TrendItem,
  type ZoneItem,
  type TimeItem,
} from "@/lib/api"

function MessagesPageInner() {
  const t = useT()
  const tv = useTV()
  const router = useRouter()
  const searchParams = useSearchParams()
  // Deep-link target: a notification (e.g. an SLA breach) links to
  // /messages?msg=MSG-XXXX and we pop the matching message's detail modal.
  const focusMsgId = searchParams.get("msg")
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
  const { range, queryKey } = useTimeFilter()

  // Fetch real data from the backend for the given window. `background` skips
  // the full-page skeleton (used by auto-refresh, the manual "Refresh" button,
  // and time-range toggles). The pre-aggregated panels are re-queried per window;
  // the raw feed is filtered client-side below.
  const loadData = useCallback((r: TimeRange, background = false) => {
    if (background) setRefreshing(true)
    else setLoading(true)
    // A refresh re-reads from BigQuery; bust the server cache first so it does.
    const ready = background ? clearServerCache() : Promise.resolve()
    ready
      .then(() => fetchAllMessagesData(r))
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

  // Initial load (full skeleton) once.
  useEffect(() => {
    loadData(range, false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Re-query the aggregated panels in the background when the window changes.
  const firstRange = useRef(true)
  useEffect(() => {
    if (firstRange.current) { firstRange.current = false; return }
    loadData(range, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryKey])

  // Re-fetch on the cadence configured on the Settings page.
  useAutoRefresh(() => loadData(range, true))

  // Messages carry a per-record `date`, so the feed, stat cards, time-of-day
  // breakdown and SLA counts derive from this client-filtered set.
  const scopedMessages = useMemo(
    () => filterByRange(messages, range, (m) => m.date),
    [messages, range],
  )

  // Sentiment-spike alert: negative sentiment jumping week-over-week past the
  // configured threshold (Settings → SLA & Alert Configurations).
  const sentimentBreach = useMemo(() => {
    if (!trend || trend.length < 2) return [] as string[]
    const latest = trend[trend.length - 1]
    const prev = trend[trend.length - 2]
    const delta = latest.negative - prev.negative
    if (delta >= settings.sentimentSpikePct) {
      return [
        t("msg.sentimentBreachItem", {
          delta: delta.toFixed(0),
          prev: prev.negative,
          latest: latest.negative,
          limit: settings.sentimentSpikePct,
        }),
      ]
    }
    return [] as string[]
  }, [trend, settings.sentimentSpikePct, t])

  // SLA breach indicator: conversations whose HANDLING TIME (closed_at − created_at)
  // exceeds the configured SLA target — not "now − created_at", which would flag
  // every historical chat. Still-open chats (no closed_at) fall back to current age.
  // Chat SLA applies to App/WhatsApp, General SLA to Tickets.
  const slaBreach = useMemo(() => {
    const now = Date.now()
    const counts: Record<string, number> = {}
    for (const m of scopedMessages) {
      const startTs = new Date(m.date.replace(" ", "T")).getTime()
      const durationHours =
        m.handlingMinutes != null
          ? m.handlingMinutes / 60
          : Number.isNaN(startTs)
            ? null
            : (now - startTs) / 3_600_000
      if (durationHours === null) continue
      const sla = m.channel === "Ticket" ? settings.generalSlaHours : settings.chatSlaHours
      if (durationHours > sla) counts[m.channel] = (counts[m.channel] ?? 0) + 1
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([ch, n]) => {
        const sla = ch === "Ticket" ? settings.generalSlaHours : settings.chatSlaHours
        return t("msg.slaBreachItem", { n, channel: tv(ch), sla })
      })
  }, [scopedMessages, settings.chatSlaHours, settings.generalSlaHours, t, tv])

  // ---------------------------------------------------------------------------
  // Derived stats for the stat cards
  // ---------------------------------------------------------------------------
  const stats = useMemo(() => {
    const total = scopedMessages.length
    if (total === 0) return { total: 0, negativeRate: "—", topIntent: "—", topChannel: "—" }

    const negCount = scopedMessages.filter((m) => m.sentiment === "Negative").length

    const intentMap: Record<string, number> = {}
    const channelMap: Record<string, number> = {}

    for (const m of scopedMessages) {
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
  }, [scopedMessages])

  // ---------------------------------------------------------------------------
  // Sentiment by time-of-day breakdown (drives the "Sentiment by Time of Day" chart)
  // ---------------------------------------------------------------------------
  const timeOfDayData = useMemo<TimeItem[]>(() => {
    const order: TimeOfDay[] = ["Morning", "Afternoon", "Evening", "Night"]
    return order.map((time) => {
      const subset = scopedMessages.filter((m) => m.timeOfDay === time)
      if (subset.length === 0) return { time, positive: 0, neutral: 0, negative: 0 }
      const pct = (s: Sentiment) =>
        Math.round((subset.filter((m) => m.sentiment === s).length / subset.length) * 100)
      return { time, positive: pct("Positive"), neutral: pct("Neutral"), negative: pct("Negative") }
    })
  }, [scopedMessages])

  // ---------------------------------------------------------------------------
  // Week-over-week message volume change (null when fewer than 2 weeks of data)
  // ---------------------------------------------------------------------------
  const weekOverWeek = useMemo(() => {
    if (scopedMessages.length === 0) return null
    const WEEK_MS = 7 * 24 * 60 * 60 * 1000
    const counts = new Map<number, number>()
    for (const m of scopedMessages) {
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
  }, [scopedMessages])

  // ---------------------------------------------------------------------------
  // Messages for the table. Categorical filtering lives in the table's own
  // Excel-style column headers; here we only apply the topbar search query.
  // ---------------------------------------------------------------------------
  const filteredMessages = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return scopedMessages
    return scopedMessages.filter(
      (m) =>
        m.id.toLowerCase().includes(q) ||
        m.customerId.toLowerCase().includes(q) ||
        m.text.toLowerCase().includes(q),
    )
  }, [scopedMessages, search])

  // Resolve the deep-linked message from the full (unfiltered) set so the modal
  // opens even when the table's filters would otherwise hide it.
  const focusMessage = useMemo(
    () => (focusMsgId ? messages.find((m) => m.id === focusMsgId) ?? null : null),
    [focusMsgId, messages],
  )
  const closeFocus = useCallback(() => router.replace("/messages", { scroll: false }), [router])

  return (
    <div className="flex min-h-screen">
      <Sidebar />

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar title={t("nav.supportMessages")} search={search} onSearch={setSearch} />

        <main className="flex flex-1 flex-col gap-6 p-4 md:p-6">
          
          {/* Header */}
          <div className="flex flex-col items-start gap-3 border-b border-border pb-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
                {t("msg.title")}
              </h1>
              <p className="text-sm text-muted-foreground">
                {t("msg.subtitle")}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3 sm:justify-end">
              <GlobalTimeRange className="lg:hidden" />
              <RefreshStatus lastUpdated={lastUpdated} refreshing={refreshing} onRefresh={() => loadData(range, true)} />
            </div>
          </div>

          {loading ? (
            <MessagesLoading />
          ) : (
          <>
          <ThresholdAlert title={t("msg.alertSentimentSpike")} items={sentimentBreach} />
          <ThresholdAlert title={t("msg.alertSlaExceeded")} items={slaBreach} />

          {/* Stat cards */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <StatCard
              label={t("msg.statTotal")}
              value={stats.total > 0 ? stats.total.toLocaleString() : "0"}
              trend="neutral"
              icon={MessageSquare}
            />
            <StatCard
              label={t("msg.statNegative")}
              value={stats.negativeRate}
              trend="up"
              icon={Frown}
            />
            <StatCard
              label={t("msg.statTopIntent")}
              value={tv(stats.topIntent)}
              trend="neutral"
              icon={Tag}
            />
            <StatCard
              label={t("msg.statTopChannel")}
              value={tv(stats.topChannel)}
              trend="neutral"
              icon={MessageSquare}
            />
            <StatCard
              label={t("msg.statWow")}
              value={weekOverWeek === null ? tv("N/A") : `${weekOverWeek >= 0 ? "+" : ""}${weekOverWeek.toFixed(0)}%`}
              trend={weekOverWeek === null ? "neutral" : weekOverWeek >= 0 ? "up" : "down"}
              icon={TrendingUp}
            />
          </div>

          <TopNegativeTriggers data={triggers} />

          <MessageFeedTable messages={filteredMessages} />

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-[2fr_3fr]">
            <CrossChannelComparison data={crossChannel} />
            <MessageSentimentTrend data={trend} />
          </div>

          <SentimentByZoneTime zoneData={zones} timeData={timeOfDayData} />
          </>
          )}

          <footer className="pb-4 pt-2 text-center text-xs text-muted-foreground">
            {t("msg.footer")}
          </footer>
        </main>
      </div>

      {focusMessage && <MessageDetailModal message={focusMessage} onClose={closeFocus} />}
    </div>
  )
}

export default function MessagesPage() {
  return (
    <Suspense fallback={null}>
      <MessagesPageInner />
    </Suspense>
  )
}
