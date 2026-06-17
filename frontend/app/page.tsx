"use client"

import { useEffect, useMemo, useRef, useState, useCallback } from "react"
import { PhoneCall, Clock, Frown, Flame, CheckCircle2, Loader2 } from "lucide-react"
import {
  formatDuration,
  type CallRecord,
  type Sentiment,
  type Category,
} from "@/lib/rafeeq-data"
import { fetchCalls } from "@/lib/api"
import { Sidebar } from "@/components/rafeeq/sidebar"
import { Topbar } from "@/components/rafeeq/topbar"
import { HeroBanner } from "@/components/rafeeq/hero-banner"
import { StatCard } from "@/components/rafeeq/stat-card"
import { FilterBar, type CallFilters } from "@/components/rafeeq/filter-bar"
import { QatarMap } from "@/components/rafeeq/qatar-map"
import { CallTable } from "@/components/rafeeq/call-table"
import { ToneChart } from "@/components/rafeeq/tone-chart"
import { CategoryBreakdown } from "@/components/rafeeq/category-breakdown"
import { IntentPanel } from "@/components/rafeeq/intent-panel"
import { SentimentTrend } from "@/components/rafeeq/sentiment-trend"
import { TopTopics } from "@/components/rafeeq/top-topics"
import { CallAnalysisLoading } from "@/components/rafeeq/loading-screen"
import { RefreshStatus } from "@/components/rafeeq/refresh-status"
import { useAutoRefresh } from "@/lib/settings-context"

const CATEGORIES = [
  "Billing", "Technical", "Roaming", "Account Access", "Returns", "Complaints", "General",
]
const SENTIMENTS = ["Positive", "Neutral", "Negative"]

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"

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
  console.log(`[Rafeeq] Parsing "${file.name}" (${file.size} bytes)`)

  if (file.name.endsWith(".json")) {
    let parsed: unknown
    try { parsed = JSON.parse(text) } catch (err) {
      console.error("[Rafeeq] JSON parse error:", err)
      return []
    }
    const results = extractStrings(parsed)
    console.log(`[Rafeeq] Extracted ${results.length} transcript(s) from JSON`)
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
    console.log(`[Rafeeq] Extracted ${results.length} transcript(s) from CSV (col ${idx})`)
    return results
  }

  const trimmed = text.trim()
  console.log(`[Rafeeq] Using .txt as single transcript (${trimmed.length} chars)`)
  return trimmed ? [trimmed] : []
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default function Page() {
  const [calls, setCalls] = useState<CallRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [analysing, setAnalysing] = useState(false)
  const [intentFilter, setIntentFilter] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [filters, setFilters] = useState<CallFilters>({ category: null, sentiment: null, agent: null })
  const [toast, setToast] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    window.setTimeout(() => setToast(null), 3200)
  }, [])

  // Load existing calls from BigQuery. `background` skips the full-page skeleton
  // (used by auto-refresh and the manual "Refresh" button).
  const loadData = useCallback(
    (background = false) => {
      if (background) setRefreshing(true)
      else setLoading(true)
      fetchCalls().then((data) => {
        if (data?.length) {
          setCalls(data)
          if (!background) showToast(`Loaded ${data.length} calls`)
        }
        setLastUpdated(new Date())
        if (background) setRefreshing(false)
        else setLoading(false)
      })
    },
    [showToast],
  )

  useEffect(() => {
    loadData(false)
  }, [loadData])

  // Re-fetch on the cadence configured on the Settings page.
  useAutoRefresh(() => loadData(true))

  // ---------------------------------------------------------------------------
  // Unique agent names extracted from actual call data
  // ---------------------------------------------------------------------------
  const agents = useMemo(() => {
    const seen = new Set<string>()
    for (const c of calls) {
      if (c.agent && c.agent !== "—") seen.add(c.agent)
    }
    return Array.from(seen).sort()
  }, [calls])

  // ---------------------------------------------------------------------------
  // Derived stats for the stat cards
  // ---------------------------------------------------------------------------
  const stats = useMemo(() => {
    const total = calls.length
    if (total === 0) return { total: 0, avgDuration: "—", negativeRate: "—", topCategory: "—" }

    const avgSec = calls.reduce((s, c) => s + c.durationSec, 0) / total
    const negCount = calls.filter((c) => c.sentiment === "Negative").length

    const catMap: Record<string, number> = {}
    for (const c of calls) catMap[c.category] = (catMap[c.category] || 0) + 1
    const topCategory = Object.entries(catMap).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "—"

    return {
      total,
      avgDuration: formatDuration(Math.round(avgSec)),
      negativeRate: `${((negCount / total) * 100).toFixed(1)}%`,
      topCategory,
    }
  }, [calls])

  // ---------------------------------------------------------------------------
  // Filtered calls for the table
  // ---------------------------------------------------------------------------
  const filteredCalls = useMemo(() => {
    const q = search.trim().toLowerCase()
    return calls.filter((c) => {
      if (filters.category && c.category !== filters.category) return false
      if (filters.sentiment && c.sentiment !== filters.sentiment) return false
      if (filters.agent && c.agent !== filters.agent) return false
      if (intentFilter && c.intent !== intentFilter) return false
      if (q && !c.id.toLowerCase().includes(q) && !c.agent.toLowerCase().includes(q) && !c.city.toLowerCase().includes(q))
        return false
      return true
    })
  }, [calls, filters, intentFilter, search])

  const resetFilters = useCallback(() => {
    setFilters({ category: null, sentiment: null, agent: null })
    setIntentFilter(null)
    setSearch("")
  }, [])

  const exportCsv = useCallback(() => {
    const header = ["Call ID", "Date & Time", "Duration", "Agent", "City", "Category", "Sentiment", "Intent", "Confidence"]
    const rows = filteredCalls.map((c: CallRecord) => [
      c.id, c.datetime, formatDuration(c.durationSec), c.agent, c.city,
      c.category, c.sentiment, c.intent, `${c.confidence}%`,
    ])
    const csv = [header, ...rows]
      .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
      .join("\n")
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `rafeeq-calls-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
    showToast(`Exported ${filteredCalls.length} calls to CSV`)
  }, [filteredCalls, showToast])

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

      console.log(`[Rafeeq] Total transcripts to analyse: ${transcripts.length}`)

      if (transcripts.length === 0) {
        showToast("No transcripts found — check the browser console (F12) for details")
        return
      }

      setAnalysing(true)
      showToast(`Analysing ${transcripts.length} transcript${transcripts.length !== 1 ? "s" : ""}…`)

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
        showToast(`Added ${newCalls.length} analysed call${newCalls.length !== 1 ? "s" : ""}`)
      } catch (err) {
        console.error(err)
        showToast("Analysis failed — is the backend running on port 8000?")
      } finally {
        setAnalysing(false)
      }
    },
    [showToast],
  )

  return (
    <div className="flex min-h-screen">
      <Sidebar />

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar search={search} onSearch={setSearch} />

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

          <div className="flex justify-end">
            <RefreshStatus lastUpdated={lastUpdated} refreshing={refreshing} onRefresh={() => loadData(true)} />
          </div>

          {loading ? (
            <CallAnalysisLoading />
          ) : (
          <>
          {/* Stat cards — all derived from real calls */}
          <div id="pipeline" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Total Calls Analyzed"
              value={stats.total > 0 ? stats.total.toLocaleString() : "0"}
              trend="neutral"
              icon={PhoneCall}
            />
            <StatCard
              label="Average Call Duration"
              value={stats.avgDuration}
              trend="neutral"
              icon={Clock}
            />
            <StatCard
              label="Negative Sentiment Rate"
              value={stats.negativeRate}
              trend="neutral"
              icon={Frown}
            />
            <StatCard
              label="Top Issue Category"
              value={stats.topCategory}
              trend="neutral"
              icon={Flame}
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
            <QatarMap calls={calls} />
          </div>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-[2fr_1fr]">
            <div className="flex min-w-0 flex-col gap-6">
              <CallTable calls={filteredCalls} activeLabel={intentFilter} />
              <SentimentTrend calls={calls} />
            </div>
            <div id="intents" className="flex min-w-0 flex-col gap-6">
              <ToneChart calls={calls} />
              <IntentPanel calls={calls} selected={intentFilter} onSelect={setIntentFilter} />
              <CategoryBreakdown calls={calls} />
            </div>
          </div>

          <div id="reports" className="min-w-0">
            <TopTopics calls={calls} />
          </div>
          </>
          )}

          <footer className="pb-4 pt-2 text-center text-xs text-muted-foreground">
            Rafeeq Call Intelligence · All Daily Needs. One Rafeeq.
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
