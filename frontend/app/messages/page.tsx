"use client"

import { Suspense, useMemo, useRef, useState, useCallback, useEffect } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { MessageSquare, Frown, Tag, TrendingUp } from "lucide-react"
import { Sidebar } from "@/components/clarity/sidebar"
import { Topbar, type SearchResult } from "@/components/clarity/topbar"
import { useDebouncedValue } from "@/lib/use-debounced-value"
import { StatCard } from "@/components/clarity/stat-card"
import { MessageFeedTable } from "@/components/clarity/message-feed-table"
import { MessageDetailModal } from "@/components/clarity/message-detail-modal"
import { TopNegativeTriggers } from "@/components/clarity/top-negative-triggers"
import { HandledByPanel } from "@/components/clarity/handled-by"
import { SentimentByZoneTime } from "@/components/clarity/sentiment-by-zone-time"
import { MessageSentimentTrend } from "@/components/clarity/message-sentiment-trend"
import { MessagesLoading } from "@/components/clarity/loading-screen"
import { RefreshStatus } from "@/components/clarity/refresh-status"
import { GlobalTimeRange } from "@/components/clarity/time-range-select"
import { GlobalVerticalSelect, VerticalBadge } from "@/components/clarity/vertical-select"
import { ThresholdAlert } from "@/components/clarity/threshold-alert"
import { useAutoRefresh, useSettings } from "@/lib/settings-context"
import { useTimeFilter } from "@/lib/time-filter-context"
import { filterByRange, type TimeRange } from "@/lib/time-range"
import { useT, useTV } from "@/lib/i18n"
import { type SupportMessage, type TimeOfDay } from "@/lib/mock-messages"
import type { Sentiment } from "@/lib/clarity-data"
import { now } from "@/lib/clock"
import {
  fetchAllMessagesData,
  clearServerCache,
  type TriggerItem,
  type HandledBy,
  type TrendItem,
  type ZoneItem,
  type TimeItem,
  type MessageOverview,
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
  // Full-corpus stats (stat cards, time-of-day, SLA) aggregated in SQL — the
  // feed above is capped at 1000 rows, so anything derived from it is only a sample.
  const [overview, setOverview] = useState<MessageOverview | null>(null)
  const [triggers, setTriggers] = useState<TriggerItem[] | undefined>(undefined)
  const [handledBy, setHandledBy] = useState<HandledBy | null>(null)
  const [trend, setTrend] = useState<TrendItem[] | undefined>(undefined)
  const [zones, setZones] = useState<ZoneItem[] | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [search, setSearch] = useState("")
  const { settings } = useSettings()
  const { range, vertical, queryKey } = useTimeFilter()

  // Fetch real data from the backend for the given window. `background` skips
  // the full-page skeleton (used by auto-refresh, the manual "Refresh" button,
  // and time-range toggles). The pre-aggregated panels are re-queried per window;
  // the raw feed is filtered client-side below.
  const loadData = useCallback((r: TimeRange, background = false, bust = false) => {
    if (background) setRefreshing(true)
    else setLoading(true)
    // Only the manual Refresh button busts the server cache — auto-refresh and
    // window toggles ride the backend's TTL cache so they stay fast.
    const ready = bust ? clearServerCache() : Promise.resolve()
    ready
      .then(() => fetchAllMessagesData(r, settings.chatSlaHours, settings.generalSlaHours, vertical))
      .then((result) => {
        setMessages(result.messages ?? [])
        if (result.overview) setOverview(result.overview)
        if (result.triggers) setTriggers(result.triggers)
        if (result.handledBy) setHandledBy(result.handledBy)
        if (result.trend) setTrend(result.trend)
        if (result.zones) setZones(result.zones)
        setLastUpdated(new Date())
      })
      .finally(() => {
        if (background) setRefreshing(false)
        else setLoading(false)
      })
  }, [settings.chatSlaHours, settings.generalSlaHours, vertical])

  // Initial load (full skeleton) once.
  useEffect(() => {
    loadData(range, false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Re-query the aggregated panels in the background when the window changes, or
  // when the SLA thresholds change (they're now applied server-side in the overview).
  const firstRange = useRef(true)
  useEffect(() => {
    if (firstRange.current) { firstRange.current = false; return }
    loadData(range, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryKey, settings.chatSlaHours, settings.generalSlaHours])

  // Re-fetch on the cadence configured on the Settings page.
  useAutoRefresh(() => loadData(range, true))

  // Messages carry a per-record `date` and `vertical`, so the feed, stat cards,
  // time-of-day breakdown and SLA counts derive from this client-filtered set.
  const scopedMessages = useMemo(() => {
    const timeScoped = filterByRange(messages, range, (m) => m.date)
    if (vertical === "all") return timeScoped
    return timeScoped.filter((m) => m.vertical === vertical)
  }, [messages, range, vertical])

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
    const fmt = (ch: string, n: number) => {
      const sla = ch === "Ticket" ? settings.generalSlaHours : settings.chatSlaHours
      return t("msg.slaBreachItem", { n, channel: tv(ch), sla })
    }
    // Prefer the full-corpus counts from the overview; the client sample is only
    // a fallback when the backend is unreachable.
    if (overview) {
      return overview.slaBreaches
        .slice()
        .sort((a, b) => b.count - a.count)
        .map((b) => fmt(b.channel, b.count))
    }
    const nowTs = now().getTime()
    const counts: Record<string, number> = {}
    for (const m of scopedMessages) {
      const startTs = new Date(m.date.replace(" ", "T")).getTime()
      const durationHours =
        m.handlingMinutes != null
          ? m.handlingMinutes / 60
          : Number.isNaN(startTs)
            ? null
            : (nowTs - startTs) / 3_600_000
      if (durationHours === null) continue
      const sla = m.channel === "Ticket" ? settings.generalSlaHours : settings.chatSlaHours
      if (durationHours > sla) counts[m.channel] = (counts[m.channel] ?? 0) + 1
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([ch, n]) => fmt(ch, n))
  }, [overview, scopedMessages, settings.chatSlaHours, settings.generalSlaHours, t, tv])

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
    if (overview) return overview.timeOfDay
    const order: TimeOfDay[] = ["Morning", "Afternoon", "Evening", "Night"]
    return order.map((time) => {
      const subset = scopedMessages.filter((m) => m.timeOfDay === time)
      if (subset.length === 0) return { time, positive: 0, neutral: 0, negative: 0 }
      const pct = (s: Sentiment) =>
        Math.round((subset.filter((m) => m.sentiment === s).length / subset.length) * 100)
      return { time, positive: pct("Positive"), neutral: pct("Neutral"), negative: pct("Negative") }
    })
  }, [overview, scopedMessages])

  // ---------------------------------------------------------------------------
  // Week-over-week message volume change (null when fewer than 2 weeks of data)
  // ---------------------------------------------------------------------------
  const weekOverWeek = useMemo(() => {
    // Prefer the corpus-wide weekly totals from the sentiment trend; the client
    // sample (capped feed) is only a fallback when the trend isn't loaded.
    if (trend && trend.length >= 2) {
      const current = trend[trend.length - 1].total
      const previous = trend[trend.length - 2].total
      if (previous === 0) return null
      return ((current - previous) / previous) * 100
    }
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
  }, [trend, scopedMessages])

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

  // Topbar search dropdown — matches within the scoped set; clicking opens the
  // message's detail modal via the ?msg= focus mechanism above.
  const { value: debouncedSearch, pending: searchPending } = useDebouncedValue(search)
  const searchResults = useMemo<SearchResult[]>(() => {
    const q = debouncedSearch.trim().toLowerCase()
    if (!q) return []
    return scopedMessages
      .filter((m) =>
        m.id.toLowerCase().includes(q) ||
        m.customerId.toLowerCase().includes(q) ||
        m.text.toLowerCase().includes(q) ||
        m.intent.toLowerCase().includes(q),
      )
      .slice(0, 50)
      .map((m) => ({
        id: m.id,
        title: `${m.id} · ${tv(m.intent)}`,
        subtitle: m.text,
        badge: tv(m.sentiment),
        onSelect: () => router.replace(`/messages?msg=${encodeURIComponent(m.id)}`, { scroll: false }),
      }))
  }, [debouncedSearch, scopedMessages, router, tv])

  return (
    <div className="flex min-h-screen">
      <Sidebar />

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          title={t("nav.supportMessages")}
          search={search}
          onSearch={setSearch}
          searchResults={searchResults}
          searchLoading={searchPending}
          searchPlaceholder={t("top.searchMessages")}
        />

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
              {/* Mobile-only: topbar shows the vertical filter on lg+ (avoids a duplicate). */}
              <GlobalVerticalSelect className="lg:hidden" />
              <RefreshStatus lastUpdated={lastUpdated} refreshing={refreshing} onRefresh={() => loadData(range, true, true)} />
            </div>
          </div>

          {loading ? (
            <MessagesLoading />
          ) : (
          <>
          <ThresholdAlert title={t("msg.alertSentimentSpike")} items={sentimentBreach} />
          <ThresholdAlert title={t("msg.alertSlaExceeded")} items={slaBreach} />

          {/* Stat cards — badge names the vertical the numbers came from:
              the selected filter, or the dominant vertical when on "all". */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <StatCard
              label={t("msg.statTotal")}
              // Full-corpus values come from the server overview; the client
              // sample (capped 1000-row feed) is only a fallback when it's null.
              value={(overview?.total ?? stats.total).toLocaleString()}
              trend="neutral"
              icon={MessageSquare}
              badge={<VerticalBadge vertical={vertical} />}
            />
            <StatCard
              label={t("msg.statNegative")}
              value={overview ? `${overview.negativePct.toFixed(1)}%` : stats.negativeRate}
              trend="up"
              icon={Frown}
              badge={<VerticalBadge vertical={vertical} />}
            />
            <StatCard
              label={t("msg.statTopIntent")}
              value={tv(overview?.topIntent ?? stats.topIntent)}
              trend="neutral"
              icon={Tag}
              badge={<VerticalBadge vertical={vertical} />}
            />
            <StatCard
              label={t("msg.statTopChannel")}
              value={tv(overview?.topChannel ?? stats.topChannel)}
              trend="neutral"
              icon={MessageSquare}
              badge={<VerticalBadge vertical={vertical} />}
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

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-[3fr_2fr]">
            <HandledByPanel data={handledBy} />
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
