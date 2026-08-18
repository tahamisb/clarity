"use client"

import { useEffect, useMemo, useRef, useState, useCallback } from "react"
import { PhoneCall, Clock, Frown, Flame, CheckCircle2, Loader2 } from "lucide-react"
import {
  formatDuration,
  type CallRecord,
  type Sentiment,
  type Category,
} from "@/lib/clarity-data"
import { fetchCalls, clearServerCache } from "@/lib/api"
import { Sidebar } from "@/components/clarity/sidebar"
import { Topbar, type SearchResult } from "@/components/clarity/topbar"
import { CallDetailModal } from "@/components/clarity/call-detail-modal"
import { useDebouncedValue } from "@/lib/use-debounced-value"
import { HeroBanner } from "@/components/clarity/hero-banner"
import { StatCard } from "@/components/clarity/stat-card"
import { FilterBar, type CallFilters } from "@/components/clarity/filter-bar"
import { QatarMap } from "@/components/clarity/qatar-map"
import { CallTable, CALL_FILTER_COLUMNS } from "@/components/clarity/call-table"
import { applyColumnFilters, type ColumnFilterState } from "@/components/clarity/column-filter"
import { ToneChart } from "@/components/clarity/tone-chart"
import { CallReasons } from "@/components/clarity/call-reasons"
import { IntentPanel } from "@/components/clarity/intent-panel"
import { SentimentTrend } from "@/components/clarity/sentiment-trend"
import { TopTopics } from "@/components/clarity/top-topics"
import { CallAnalysisLoading } from "@/components/clarity/loading-screen"
import { RefreshStatus } from "@/components/clarity/refresh-status"
import { GlobalTimeRange } from "@/components/clarity/time-range-select"
import { GlobalVerticalSelect, VerticalBadge } from "@/components/clarity/vertical-select"
import { useAutoRefresh } from "@/lib/settings-context"
import { useTimeFilter } from "@/lib/time-filter-context"
import { filterByRange } from "@/lib/time-range"
import { useT, useTV } from "@/lib/i18n"
import { todayStr } from "@/lib/clock"

const CATEGORIES = [
  "Billing", "Technical", "Roaming", "Account Access", "Returns", "Complaints", "General",
]
const SENTIMENTS = ["Positive", "Neutral", "Negative"]

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8001"

// ---------------------------------------------------------------------------
// API response type
// ---------------------------------------------------------------------------
type ApiResult = {
  call_id: string
  transcript: string
  intents: string[]
  sentiment: string
  sentiment_confidence: number
  entities: {
    order_ids: string[]
    restaurant_names: string[]
    areas: string[]
    product_names: string[]
    qar_amounts: string[]
  }
  summary: string
  reason?: string
  analysed_at: string
  error?: string
}

// ---------------------------------------------------------------------------
// Intent → Category mapping
// ---------------------------------------------------------------------------
const INTENT_TO_CATEGORY: Record<string, Category> = {
  order_status:    "General",
  refund_request:  "Billing",
  complaint:       "Complaints",
  cancellation:    "Returns",
  escalation:      "Complaints",
  praise:          "General",
  delivery_issue:  "Technical",
  wrong_item:      "Returns",
  payment_issue:   "Billing",
  account_issue:   "Account Access",
  general_inquiry: "General",
}

function extractAgentName(transcript: string): string {
  // English: Agent (Name):
  let m = transcript.match(/Agent\s*\(([^)]+)\)/i)
  if (m) return m[1].trim()
  // Arabic labelled: الموظف (Name):
  m = transcript.match(/الموظف\s*\(([^)]+)\)/)
  if (m) return m[1].trim()
  // Arabic intro: معك Name.
  m = transcript.match(/معك\s+([^.\n،،]+)/)
  if (m) return m[1].trim()
  return "—"
}

function transformResult(r: ApiResult): CallRecord {
  const intentRaw = r.intents[0] ?? "general_inquiry"
  const intent = intentRaw.split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")
  const wordCount = r.transcript.trim().split(/\s+/).length
  return {
    id: `RFQ-${r.call_id.slice(0, 8).toUpperCase()}`,
    datetime: r.analysed_at.replace("T", " ").slice(0, 16),
    durationSec: Math.max(30, Math.round((wordCount / 130) * 60)),
    agent: extractAgentName(r.transcript),
    city: r.entities.areas[0] ?? "Qatar",
    category: INTENT_TO_CATEGORY[intentRaw] ?? "General",
    sentiment: (r.sentiment.charAt(0).toUpperCase() + r.sentiment.slice(1)) as Sentiment,
    intent,
    confidence: Math.round(r.sentiment_confidence * 100),
    transcript: r.transcript,
    summary: r.summary,
    reason: r.reason?.trim() || intent,
    agentHelpfulness: "N/A",
    customerBehavior: "N/A",
  }
}

// ---------------------------------------------------------------------------
// File parser
// ---------------------------------------------------------------------------
function extractStrings(val: unknown, minLen = 20): string[] {
  if (typeof val === "string") return val.trim().length >= minLen ? [val.trim()] : []
  if (Array.isArray(val)) return val.flatMap((v) => extractStrings(v, minLen))
  if (val && typeof val === "object") {
    const obj = val as Record<string, unknown>
    const preferred = ["transcript", "text", "content", "body", "message", "call_text", "transcription"]
    for (const key of preferred) {
      if (key in obj && typeof obj[key] === "string") {
        const s = (obj[key] as string).trim()
        if (s.length >= minLen) return [s]
      }
    }
    return Object.values(obj).flatMap((v) => extractStrings(v, minLen))
  }
  return []
}

async function parseFile(file: File): Promise<string[]> {
  const text = await file.text()
  console.log(`[Clarity] Parsing "${file.name}" (${file.size} bytes)`)

  if (file.name.endsWith(".json")) {
    let parsed: unknown
    try { parsed = JSON.parse(text) } catch (err) {
      console.error("[Clarity] JSON parse error:", err)
      return []
    }
    const results = extractStrings(parsed)
    console.log(`[Clarity] Extracted ${results.length} transcript(s) from JSON`)
    return results
  }

  if (file.name.endsWith(".csv")) {
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean)
    if (lines.length < 2) return []
    const headers = lines[0].toLowerCase().split(",")
    const preferred = ["transcript", "text", "content", "body", "message"]
    let idx = 0
    for (const name of preferred) {
      const found = headers.findIndex((h) => h.replace(/"/g, "").trim() === name)
      if (found >= 0) { idx = found; break }
    }
    const results = lines.slice(1).map((line) => {
      const cols = line.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)
      return (cols[idx] ?? "").replace(/^"|"$/g, "").trim()
    }).filter((s) => s.length >= 20)
    console.log(`[Clarity] Extracted ${results.length} transcript(s) from CSV (col ${idx})`)
    return results
  }

  const trimmed = text.trim()
  console.log(`[Clarity] Using .txt as single transcript (${trimmed.length} chars)`)
  return trimmed ? [trimmed] : []
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default function Page() {
  const t = useT()
  const tv = useTV()
  const [calls, setCalls] = useState<CallRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [analysing, setAnalysing] = useState(false)
  const [intentFilter, setIntentFilter] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [activeSearchCall, setActiveSearchCall] = useState<CallRecord | null>(null)
  const [filters, setFilters] = useState<CallFilters>({ category: null, sentiment: null, agent: null })
  // The call table's per-column header filters live here, not inside the table,
  // so the charts, map and stat cards scope to them too.
  const [columnFilters, setColumnFilters] = useState<ColumnFilterState>({})
  const [toast, setToast] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    window.setTimeout(() => setToast(null), 3200)
  }, [])

  // Load existing analysed calls. `background` skips the full-page skeleton
  // (used by auto-refresh and the manual "Refresh" button).
  const loadData = useCallback(
    (background = false, bust = false) => {
      if (background) setRefreshing(true)
      else setLoading(true)
      // Only the manual Refresh button busts the server cache — auto-refresh
      // rides the backend's TTL cache so it stays fast.
      const ready = bust ? clearServerCache() : Promise.resolve()
      ready.then(fetchCalls).then((data) => {
        if (data?.length) {
          setCalls(data)
          if (!background) showToast(t("ci.loadedCalls", { n: data.length }))
        }
        setLastUpdated(new Date())
        if (background) setRefreshing(false)
        else setLoading(false)
      })
    },
    [showToast, t],
  )

  useEffect(() => {
    loadData(false)
  }, [loadData])

  // Re-fetch on the cadence configured on the Settings page.
  useAutoRefresh(() => loadData(true))

  // Global time-range + vertical filters. Calls carry per-record `datetime` and
  // `vertical`, so the whole page (stats, charts, map, table) derives from this
  // client-filtered set.
  const { range, vertical } = useTimeFilter()
  const scopedCalls = useMemo(() => {
    const timeScoped = filterByRange(calls, range, (c) => c.datetime)
    if (vertical === "all") return timeScoped
    return timeScoped.filter((c) => c.vertical === vertical)
  }, [calls, range, vertical])


  // ---------------------------------------------------------------------------
  // Unique agent names extracted from actual call data
  // ---------------------------------------------------------------------------
  const agents = useMemo(() => {
    const seen = new Set<string>()
    for (const c of scopedCalls) {
      if (c.agent && c.agent !== "—") seen.add(c.agent)
    }
    return Array.from(seen).sort()
  }, [scopedCalls])

  // ---------------------------------------------------------------------------
  // Active filter set — applied to EVERY card on the page (stats, map, charts,
  // table), not just the table, so a filtered view is internally consistent.
  //
  // `skip` lets a control exclude its own dimension: the intent panel still
  // shows all intents while one is selected, otherwise picking an intent would
  // collapse its own list to a single row and strand the user.
  // ---------------------------------------------------------------------------
  const applyFilters = useCallback(
    (rows: CallRecord[], skip?: "intent") => {
      const q = search.trim().toLowerCase()
      const base = rows.filter((c) => {
        if (filters.category && c.category !== filters.category) return false
        if (filters.sentiment && c.sentiment !== filters.sentiment) return false
        if (filters.agent && c.agent !== filters.agent) return false
        if (skip !== "intent" && intentFilter && c.intent !== intentFilter) return false
        if (q && !c.id.toLowerCase().includes(q) && !c.agent.toLowerCase().includes(q) && !c.city.toLowerCase().includes(q))
          return false
        return true
      })
      return applyColumnFilters(base, CALL_FILTER_COLUMNS, columnFilters)
    },
    [filters, intentFilter, search, columnFilters],
  )

  const filteredCalls = useMemo(() => applyFilters(scopedCalls), [scopedCalls, applyFilters])
  const intentPanelCalls = useMemo(
    () => applyFilters(scopedCalls, "intent"),
    [scopedCalls, applyFilters],
  )

  // ---------------------------------------------------------------------------
  // Derived stats for the stat cards
  // ---------------------------------------------------------------------------
  const stats = useMemo(() => {
    const total = filteredCalls.length
    if (total === 0) return { total: 0, avgDuration: "—", negativeRate: "—", topReason: "—" }

    const avgSec = filteredCalls.reduce((s, c) => s + c.durationSec, 0) / total
    const negCount = filteredCalls.filter((c) => c.sentiment === "Negative").length

    // The single most common concrete reason for calling — not a bucket name.
    const reasonMap: Record<string, number> = {}
    for (const c of filteredCalls) {
      const r = c.reason || c.intent
      reasonMap[r] = (reasonMap[r] || 0) + 1
    }
    const topReason = Object.entries(reasonMap).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "—"

    return {
      total,
      avgDuration: formatDuration(Math.round(avgSec)),
      negativeRate: `${((negCount / total) * 100).toFixed(1)}%`,
      topReason,
    }
  }, [filteredCalls])


  // Topbar search dropdown — matches within the scoped calls; clicking opens the
  // call's detail modal (rendered below).
  const { value: debouncedSearch, pending: searchPending } = useDebouncedValue(search)
  const searchResults = useMemo<SearchResult[]>(() => {
    const q = debouncedSearch.trim().toLowerCase()
    if (!q) return []
    return scopedCalls
      .filter((c) =>
        c.id.toLowerCase().includes(q) ||
        c.agent.toLowerCase().includes(q) ||
        c.city.toLowerCase().includes(q) ||
        c.intent.toLowerCase().includes(q),
      )
      .slice(0, 50)
      .map((c) => ({
        id: c.id,
        title: `${c.id} · ${tv(c.intent)}`,
        subtitle: `${c.agent} · ${c.city}`,
        badge: tv(c.sentiment),
        onSelect: () => setActiveSearchCall(c),
      }))
  }, [debouncedSearch, scopedCalls, tv])

  const resetFilters = useCallback(() => {
    setFilters({ category: null, sentiment: null, agent: null })
    setColumnFilters({})
    setIntentFilter(null)
    setSearch("")
  }, [])

  const exportCsv = useCallback(() => {
    const header = ["Call ID", "Date & Time", "Duration", "Agent", "City", "Reason", "Category", "Sentiment", "Intent", "Confidence"]
    const rows = filteredCalls.map((c: CallRecord) => [
      c.id, c.datetime, formatDuration(c.durationSec), c.agent, c.city,
      c.reason, c.category, c.sentiment, c.intent, `${c.confidence}%`,
    ])
    const csv = [header, ...rows]
      .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
      .join("\n")
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `clarity-calls-${todayStr()}.csv`
    a.click()
    URL.revokeObjectURL(url)
    showToast(t("ci.exportedCalls", { n: filteredCalls.length }))
  }, [filteredCalls, showToast, t])

  // ---------------------------------------------------------------------------
  // File upload + analysis
  // ---------------------------------------------------------------------------
  const onFilesSelected = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? [])
      e.target.value = ""
      if (files.length === 0) return

      const transcripts: string[] = []
      for (const file of files) transcripts.push(...(await parseFile(file)))

      console.log(`[Clarity] Total transcripts to analyse: ${transcripts.length}`)

      if (transcripts.length === 0) {
        showToast(t("ci.noTranscripts"))
        return
      }

      setAnalysing(true)
      showToast(t("ci.analysing", { n: transcripts.length }))

      try {
        const newCalls: CallRecord[] = []
        for (let i = 0; i < transcripts.length; i += 100) {
          const chunk = transcripts.slice(i, i + 100)
          const res = await fetch(`${API_BASE}/analyse/batch`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ transcripts: chunk }),
          })
          if (!res.ok) throw new Error(`Backend returned ${res.status}`)
          const data: { results: ApiResult[] } = await res.json()
          for (const result of data.results) {
            if (!result.error) newCalls.push(transformResult(result))
          }
        }
        setCalls((prev) => [...newCalls, ...prev])
        showToast(t("ci.added", { n: newCalls.length }))
      } catch (err) {
        console.error(err)
        showToast(t("ci.analysisFailed"))
      } finally {
        setAnalysing(false)
      }
    },
    [showToast, t],
  )

  return (
    <div className="flex min-h-screen">
      <Sidebar />

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          title={t("nav.callIntelligence")}
          search={search}
          onSearch={setSearch}
          searchResults={searchResults}
          searchLoading={searchPending}
          searchPlaceholder={t("top.searchCalls")}
        />
        {activeSearchCall && (
          <CallDetailModal call={activeSearchCall} onClose={() => setActiveSearchCall(null)} />
        )}

        <main className="flex flex-1 flex-col gap-6 p-4 md:p-6">
          <HeroBanner onUpload={() => fileInputRef.current?.click()} />
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,.csv,.json"
            multiple
            className="hidden"
            onChange={onFilesSelected}
          />

          <div className="flex flex-wrap items-center justify-end gap-3">
            <GlobalTimeRange className="lg:hidden" />
            {/* Mobile-only: topbar shows the vertical filter on lg+ (avoids a duplicate). */}
            <GlobalVerticalSelect className="lg:hidden" />
            <RefreshStatus lastUpdated={lastUpdated} refreshing={refreshing} onRefresh={() => loadData(true, true)} />
          </div>

          {loading ? (
            <CallAnalysisLoading />
          ) : (
          <>
          {/* Stat cards — all derived from real calls */}
          <div id="pipeline" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label={t("ci.statTotal")}
              value={stats.total > 0 ? stats.total.toLocaleString() : "0"}
              trend="neutral"
              icon={PhoneCall}
              badge={<VerticalBadge vertical={vertical} />}
            />
            <StatCard
              label={t("ci.statAvgDuration")}
              value={stats.avgDuration}
              trend="neutral"
              icon={Clock}
              badge={<VerticalBadge vertical={vertical} />}
            />
            <StatCard
              label={t("ci.statNegRate")}
              value={stats.negativeRate}
              trend="neutral"
              icon={Frown}
              badge={<VerticalBadge vertical={vertical} />}
            />
            <StatCard
              label={t("ci.statTopReason")}
              value={tv(stats.topReason)}
              trend="neutral"
              icon={Flame}
              badge={<VerticalBadge vertical={vertical} />}
            />
          </div>

          <div id="calls">
            <FilterBar
              filters={filters}
              categories={CATEGORIES}
              sentiments={SENTIMENTS}
              agents={agents}
              resultCount={filteredCalls.length}
              onChange={setFilters}
              onReset={resetFilters}
              onExport={exportCsv}
            />
          </div>

          <div id="coverage">
            <QatarMap calls={filteredCalls} />
          </div>

          {/* Two balanced stacks. The wide side carries the table and the trend
              (~975px), the narrow side the donut and the intent list (~915px) —
              within a row of each other, so neither column ends in a void. The
              reasons panel used to sit here and overhung the left by ~425px; it
              now pairs with Top Topics below, where the heights match. */}
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-[2fr_1fr]">
            <div className="flex min-w-0 flex-col gap-6">
              <CallTable
                calls={filteredCalls}
                activeLabel={intentFilter}
                filters={columnFilters}
                onFiltersChange={setColumnFilters}
                filterSource={scopedCalls}
              />
              <SentimentTrend calls={filteredCalls} />
            </div>
            <div id="intents" className="flex min-w-0 flex-col gap-6">
              <ToneChart calls={filteredCalls} />
              <IntentPanel calls={intentPanelCalls} selected={intentFilter} onSelect={setIntentFilter} />
            </div>
          </div>

          {/* Both are "what were the calls about" reads — the narrow list of
              reasons beside the wide ranked table. */}
          <div id="reports" className="grid min-w-0 grid-cols-1 gap-6 xl:grid-cols-[1fr_2fr]">
            <CallReasons calls={filteredCalls} />
            <div className="min-w-0">
              <TopTopics calls={filteredCalls} />
            </div>
          </div>
          </>
          )}

          <footer className="pb-4 pt-2 text-center text-xs text-muted-foreground">
            {t("ci.footer")}
          </footer>
        </main>
      </div>

      {toast && (
        <div className="fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-xl border border-accent/30 bg-card px-4 py-3 text-sm font-medium text-foreground shadow-2xl">
          {analysing
            ? <Loader2 className="size-4 animate-spin text-accent" />
            : <CheckCircle2 className="size-4 text-positive" />
          }
          {toast}
        </div>
      )}
    </div>
  )
}
