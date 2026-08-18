import {
  type SupportMessage,
  type Channel,
  type TimeOfDay,
  type MessageIntent,
} from "./mock-messages"
import type { AgentHelpfulness, CallRecord, Category, CustomerBehavior, Sentiment } from "./clarity-data"
import { rangeParams, type TimeRange } from "./time-range"
import { verticalParam, type VerticalFilter } from "./verticals"

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8001"

/**
 * Build a `?start=…&end=…&vertical=…` suffix for the selected filters. "all"
 * yields "" so the backend returns its full aggregation. Append only to
 * endpoints that have no other query params (the analytics endpoints below).
 */
function rangeSuffix(
  range: TimeRange, vertical: VerticalFilter = "all", zone: ZoneFilter = "all",
): string {
  const { start, end } = rangeParams(range)
  const parts: string[] = []
  if (start) parts.push(`start=${start}`)
  if (end) parts.push(`end=${end}`)
  const v = verticalParam(vertical)
  if (v) parts.push(`vertical=${encodeURIComponent(v)}`)
  const z = zoneParam(zone)
  if (z) parts.push(`zone=${encodeURIComponent(z)}`)
  return parts.length ? `?${parts.join("&")}` : ""
}

/** Delivery-zone filter. "all" means no zone predicate. */
export type ZoneFilter = string
export const zoneParam = (zone: ZoneFilter) => (zone && zone !== "all" ? zone : null)

/** The zone vocabulary, read from the warehouse rather than hardcoded. */
export const fetchZones = () =>
  apiFetch<{ zones: string[] }>("/api/cancellation/analytics/zones").then((d) => d?.zones ?? [])

/**
 * Absolute URL for the negative-customer CSV export, scoped to the active
 * window + vertical. Used as an <a href download> — the backend sets
 * Content-Disposition so the browser saves it.
 */
export function negativeCustomersCsvUrl(range: TimeRange, vertical: VerticalFilter = "all"): string {
  return `${BASE}/api/v1/analytics/negative-customers.csv${rangeSuffix(range, vertical)}`
}

async function apiFetch<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${BASE}${path}`, { cache: "no-store" })
    if (!res.ok) {
      console.warn(`[api] ${res.status} ${BASE}${path}`)
      return null
    }
    return (await res.json()) as T
  } catch (err) {
    // Usually CORS or the backend being down. Callers turn null into an empty
    // panel, so without this the whole dashboard just renders zeros in silence.
    console.warn(`[api] request failed: ${BASE}${path}`, err)
    return null
  }
}

/**
 * Drop the backend's analytics TTL caches so the next fetch re-queries the warehouse.
 * Called by every page's refresh path (manual button + auto-refresh tick) so a
 * refresh reflects the latest rows instead of up-to-5-min-stale aggregates.
 */
export async function clearServerCache(): Promise<void> {
  try {
    await fetch(`${BASE}/api/cache/clear`, { method: "POST", cache: "no-store" })
  } catch {
    /* non-fatal — a failed clear just means the fetch may hit a warm cache */
  }
}

async function apiPost<T>(path: string, body: unknown): Promise<T | null> {
  try {
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

/**
 * Register an email on the "Unlock full version" waitlist so sales can follow
 * up. Returns false if the backend rejected it or is unreachable.
 */
export async function joinWaitlist(input: {
  email: string
  company?: string
  note?: string
  plan?: string
}): Promise<boolean> {
  return (await apiPost<{ status: string }>("/api/v1/waitlist", input)) !== null
}

// ---------------------------------------------------------------------------
// Chart data shapes (populated from backend analytics endpoints)
// ---------------------------------------------------------------------------

export type TriggerItem = {
  rank: number
  trigger: string
  volume: number
  zone: string
  time: string
  trend: "up" | "down"
  vertical?: string | null
}

export type CrossChannelItem = {
  intent: string
  calls: number
  messages: number
}

export type TrendItem = {
  week: string
  positive: number
  neutral: number
  negative: number
  total: number
}

export type ZoneItem = {
  zone: string
  negativePct: number
}

export type TimeItem = {
  time: string
  positive: number
  neutral: number
  negative: number
}

// ---------------------------------------------------------------------------
// Backend response types (Pillar 02)
// ---------------------------------------------------------------------------

type ApiSentimentTrend = {
  weeks: Array<{
    week_start: string
    positive_pct: number
    neutral_pct: number
    negative_pct: number
    positive: number
    neutral: number
    negative: number
    total: number
  }>
}

type ApiTopTriggers = {
  triggers: Array<{
    trigger: string
    count: number
    top_zones: string[]
    top_vertical?: string | null
    time_of_day_distribution: Record<string, number>
  }>
}

type ApiCrossChannel = {
  shared_intents: Array<{ intent: string; text_count: number; call_count: number }>
  text_only_intents: string[]
  call_only_intents: string[]
}

type ApiZoneHeatmap = {
  zones: Array<{ zone: string; total: number; negative: number; negative_pct: number }>
}

type ApiClassificationResult = {
  classification: {
    classification_id: string
    message_id: string
    sentiment: string
    sentiment_confidence: number
    intent: string
    intent_confidence: number
    negative_trigger: string | null
    classified_at: string
  }
  message: {
    message_id: string
    customer_id?: string | null
    content: string
    source_channel: string
    merchant_name: string | null
    zone: string | null
    vertical?: string | null
    created_at: string
    ingested_at: string
    closed_at?: string | null
    agent_name?: string | null
  }
}

type ApiSentimentResults = {
  total: number
  items: ApiClassificationResult[]
}

// ---------------------------------------------------------------------------
// Data fetchers
// ---------------------------------------------------------------------------

export async function fetchSentimentTrend(
  range: TimeRange = "all", vertical: VerticalFilter = "all", zone: ZoneFilter = "all",
): Promise<TrendItem[] | null> {
  const data = await apiFetch<ApiSentimentTrend>(`/api/v1/analytics/sentiment-trend${rangeSuffix(range, vertical, zone)}`)
  if (!data?.weeks?.length) return null

  return data.weeks.map((w, i) => ({
    week: `W${i + 1}`,
    positive: Math.round(w.positive_pct),
    neutral: Math.round(w.neutral_pct),
    negative: Math.round(w.negative_pct),
    total: w.total,
  }))
}

export async function fetchTopNegativeTriggers(
  range: TimeRange = "all", vertical: VerticalFilter = "all", zone: ZoneFilter = "all",
): Promise<TriggerItem[] | null> {
  const data = await apiFetch<ApiTopTriggers>(`/api/v1/analytics/top-negative-triggers${rangeSuffix(range, vertical, zone)}`)
  if (!data?.triggers?.length) return null

  const peakTime = (dist: Record<string, number>) => {
    const timeLabels: Record<string, string> = {
      morning: "Morning",
      afternoon: "Afternoon",
      evening: "Evening",
      night: "Night",
    }
    const peak = Object.entries(dist).sort((a, b) => b[1] - a[1])[0]
    return peak ? (timeLabels[peak[0]] ?? peak[0]) : "Evening"
  }

  return data.triggers.map((t, i) => ({
    rank: i + 1,
    trigger: t.trigger.replace(/\b\w/g, (c) => c.toUpperCase()),
    volume: t.count,
    zone: t.top_zones[0] ?? "Unknown",
    time: peakTime(t.time_of_day_distribution),
    trend: i < 3 ? ("up" as const) : ("down" as const),
    vertical: t.top_vertical ?? null,
  }))
}

export async function fetchCrossChannel(
  range: TimeRange = "all", vertical: VerticalFilter = "all", zone: ZoneFilter = "all",
): Promise<CrossChannelItem[] | null> {
  const data = await apiFetch<ApiCrossChannel>(`/api/v1/analytics/cross-channel${rangeSuffix(range, vertical, zone)}`)
  // null → the fetch failed; keep whatever the chart is already showing. An empty
  // window (no shared intents in range) returns [] so the chart re-scopes to its
  // empty state instead of silently retaining the previous window's data.
  if (!data) return null

  const intentLabel: Record<string, string> = {
    complaint: "Complaints",
    refund: "Refunds",
    order_query: "Order Query",
    cancellation_request: "Cancellation",
    praise: "General",
  }

  return (data.shared_intents ?? []).map((s) => ({
    intent: intentLabel[s.intent] ?? s.intent,
    calls: s.call_count,
    messages: s.text_count,
  }))
}

export async function fetchZoneHeatmap(
  range: TimeRange = "all", vertical: VerticalFilter = "all",
): Promise<ZoneItem[] | null> {
  const data = await apiFetch<ApiZoneHeatmap>(`/api/v1/analytics/zone-heatmap${rangeSuffix(range, vertical)}`)
  // See fetchCrossChannel: null = fetch error (keep stale), [] = empty window (re-scope).
  if (!data) return null

  return (data.zones ?? []).map((z) => ({
    zone: z.zone,
    negativePct: Math.round(z.negative_pct),
  }))
}

const RESULTS_MAX_ITEMS = 1000

export async function fetchMessages(range: TimeRange = "all"): Promise<SupportMessage[] | null> {
  // Scope the feed to the active window's created_at. Without this the endpoint
  // returns the newest-*classified* 1000 rows across the whole corpus (the bulk
  // backfill was all classified at once), whose created_at dates rarely fall in
  // a recent window — so the client-side date filter would empty the table even
  // though the window has messages. ponytail: still capped at 1000 (a sample for
  // wide windows); stat cards use the server aggregate for true totals.
  // One request for the full cap — a single BQ query costs the same as five.
  const { start, end } = rangeParams(range)
  const dateQs = [start && `from_date=${start}`, end && `to_date=${end}`].filter(Boolean).join("&")
  const data = await apiFetch<ApiSentimentResults>(
    `/api/v1/sentiment/results?page=1&page_size=${RESULTS_MAX_ITEMS}${dateQs ? `&${dateQs}` : ""}`
  )
  if (!data?.items?.length) return null

  const intentMap: Record<string, MessageIntent> = {
    complaint: "Complaint",
    refund: "Refund",
    order_query: "Order Query",
    cancellation_request: "Cancellation",
    praise: "Praise",
  }
  const sentimentMap: Record<string, Sentiment> = {
    positive: "Positive",
    neutral: "Neutral",
    negative: "Negative",
  }
  const channelMap: Record<string, Channel> = {
    app: "App",
    whatsapp: "WhatsApp",
    ticket: "Ticket",
  }
  const replyMap: Record<string, string> = {
    Complaint: "We sincerely apologize. Our team is looking into this immediately.",
    Refund: "Your refund request has been noted and will be processed within 3–5 business days.",
    "Order Query": "Let me check the status of your order right away.",
    Cancellation: "Your order has been canceled successfully. No further charges will be made.",
    Praise: "Thank you for the wonderful feedback! We're so glad you had a great experience!",
  }

  const toTimeOfDay = (iso: string): TimeOfDay => {
    const h = new Date(iso).getHours()
    if (h >= 6 && h < 12) return "Morning"
    if (h >= 12 && h < 18) return "Afternoon"
    if (h >= 18 && h < 22) return "Evening"
    return "Night"
  }

  // Backend emits timestamps as "YYYY-MM-DD HH:MM:SS+00" — normalise to ISO so
  // Date() parses them reliably (space→T, bare "+00" → "+00:00").
  const parseTs = (s?: string | null): number => {
    if (!s) return NaN
    const iso = s.trim().replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00")
    return new Date(iso).getTime()
  }

  // Collapse duplicate classifications for the same message_id (a back-to-back
  // backfill can insert the same chat twice).
  // Keep the first — they're identical classifications of the same text.
  const seen = new Set<string>()
  const uniqueItems = data.items.filter((it) => {
    const id = it.classification.message_id
    if (seen.has(id)) return false
    seen.add(id)
    return true
  })

  return uniqueItems
    .map((item) => {
      const { classification: clf, message: msg } = item
      const intent = intentMap[clf.intent] ?? "Complaint"
      const createdRaw = msg.created_at || clf.classified_at
      const createdTs = parseTs(createdRaw)
      const closedTs = parseTs(msg.closed_at)
      const handlingMinutes =
        Number.isNaN(createdTs) || Number.isNaN(closedTs)
          ? undefined
          : Math.max(0, Math.round((closedTs - createdTs) / 60000))
      return {
        id: `MSG-${clf.message_id.slice(0, 8).toUpperCase()}`,
        channel: channelMap[msg.source_channel] ?? "App",
        customerId: msg.customer_id ? `Customer #${msg.customer_id}` : "Unknown",
        text: msg.content,
        intent,
        sentiment: sentimentMap[clf.sentiment] ?? "Neutral",
        confidence: Math.round(clf.sentiment_confidence * 100),
        zone: msg.zone ?? "Unknown",
        timeOfDay: toTimeOfDay(createdRaw),
        date: createdRaw.replace("T", " ").slice(0, 16),
        merchant: msg.merchant_name ?? undefined,
        vertical: msg.vertical ?? undefined,
        suggestedReply: replyMap[intent] ?? "",
        // A chat is "resolved" once it has been closed (has a closed_at).
        resolved: !!msg.closed_at,
        closedAt: msg.closed_at ? msg.closed_at.replace("T", " ").slice(0, 16) : undefined,
        handlingMinutes,
        agentName: msg.agent_name ?? undefined,
      } satisfies SupportMessage
    })
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
}

// ---------------------------------------------------------------------------
// Fetch everything in parallel — returns real data or null per field
// ---------------------------------------------------------------------------

export type MessageOverview = {
  total: number
  negativePct: number
  // % of chats escalated from the bot to a human agent (agent_name non-null).
  escalationPct: number | null
  topIntent: string
  topChannel: string
  topVertical: string | null
  timeOfDay: TimeItem[]
  slaBreaches: { channel: string; count: number }[]
}

type ApiMessageOverview = {
  total: number
  negative_pct: number
  escalation_rate_pct?: number
  top_intent: string | null
  top_channel: string | null
  top_vertical?: string | null
  time_of_day: TimeItem[]
  sla_breaches: { channel: string; count: number }[]
}

// Full-corpus stats for the stat cards / time-of-day chart / SLA banner. Unlike
// the paginated feed (capped at RESULTS_MAX_ITEMS) these are aggregated in
// SQL, so they reflect every message in the window, not just the sample.
// SLA thresholds come from the user's settings (Ticket → general, else chat).
export async function fetchMessageOverview(
  range: TimeRange, chatSlaHours: number, generalSlaHours: number,
  vertical: VerticalFilter = "all", zone: ZoneFilter = "all",
): Promise<MessageOverview | null> {
  const q = rangeSuffix(range, vertical, zone)
  const sep = q ? "&" : "?"
  const data = await apiFetch<ApiMessageOverview>(
    `/api/v1/analytics/message-overview${q}${sep}chat_sla_hours=${chatSlaHours}&general_sla_hours=${generalSlaHours}`
  )
  if (!data) return null

  const intentLabel: Record<string, string> = {
    complaint: "Complaint", refund: "Refund", order_query: "Order Query",
    cancellation_request: "Cancellation", praise: "Praise",
  }
  const channelLabel: Record<string, string> = { app: "App", whatsapp: "WhatsApp", ticket: "Ticket" }
  const chan = (c: string) => channelLabel[c] ?? c

  return {
    total: data.total,
    negativePct: data.negative_pct,
    escalationPct: data.escalation_rate_pct ?? null,
    topIntent: data.top_intent ? (intentLabel[data.top_intent] ?? data.top_intent) : "—",
    topChannel: data.top_channel ? chan(data.top_channel) : "—",
    topVertical: data.top_vertical ?? null,
    timeOfDay: data.time_of_day,
    slaBreaches: (data.sla_breaches ?? []).map((b) => ({ channel: chan(b.channel), count: b.count })),
  }
}

// Individual SLA-breaching messages (server-computed, full window — not the
// capped feed), so notifications can list and deep-link each one. `channel` is
// raw ("app"|"whatsapp"|"ticket"); the caller display-maps it.
export type SlaBreachItem = { message_id: string; channel: string; hours: number; resolved: boolean }

export async function fetchSlaBreaches(
  range: TimeRange, chatSlaHours: number, generalSlaHours: number,
  vertical: VerticalFilter = "all", zone: ZoneFilter = "all",
): Promise<SlaBreachItem[] | null> {
  const q = rangeSuffix(range, vertical, zone)
  const sep = q ? "&" : "?"
  const data = await apiFetch<{ breaches: SlaBreachItem[] }>(
    `/api/v1/analytics/sla-breaches${q}${sep}chat_sla_hours=${chatSlaHours}&general_sla_hours=${generalSlaHours}`
  )
  return data?.breaches ?? null
}

export async function fetchAllMessagesData(
  range: TimeRange = "all", chatSlaHours = 4, generalSlaHours = 24,
  vertical: VerticalFilter = "all", zone: ZoneFilter = "all",
) {
  // The raw message feed is fetched in full and filtered client-side (so the
  // table/stat cards re-scope instantly on toggle); the pre-aggregated panels
  // are re-queried server-side for the selected window + vertical.
  const [messages, overview, triggers, crossChannel, trend, zones, handledBy] = await Promise.all([
    fetchMessages(range),
    fetchMessageOverview(range, chatSlaHours, generalSlaHours, vertical, zone),
    fetchTopNegativeTriggers(range, vertical, zone),
    fetchCrossChannel(range, vertical, zone),
    fetchSentimentTrend(range, vertical, zone),
    // The zone heatmap IS the zone comparison — scoping it to one zone would
    // leave a single bar, so it stays window-wide for context.
    fetchZoneHeatmap(range, vertical),
    fetchHandledBy(range, vertical, zone),
  ])
  return { messages, overview, triggers, crossChannel, trend, zones, handledBy }
}

// Bot vs human-agent handling, with each handler's sentiment outcome.
export type HandlerRow = {
  handler: "Bot" | "Agent"
  handled: number
  positive: number
  neutral: number
  negative: number
  resolved: number
  share_pct: number
  positive_pct: number
  neutral_pct: number
  negative_pct: number
  resolved_pct: number
}
export type HandledBy = { total: number; handlers: HandlerRow[] }

export const fetchHandledBy = (range: TimeRange = "all", vertical: VerticalFilter = "all", zone: ZoneFilter = "all") =>
  apiFetch<HandledBy>(`/api/v1/analytics/handled-by${rangeSuffix(range, vertical, zone)}`)

// % of orders that generated a support chat (join on chat_history.order_id).
export type ContactRate = {
  total_orders: number
  orders_with_chat: number
  orders_with_chat_after: number
  contact_rate_pct: number
}

export async function fetchContactRate(range: TimeRange = "all"): Promise<ContactRate | null> {
  return apiFetch<ContactRate>(`/api/messages/contact-rate${rangeSuffix(range)}`)
}

// ---------------------------------------------------------------------------
// Call analysis — fetch existing analysed calls
// ---------------------------------------------------------------------------

type ApiCallRow = {
  call_id: string
  transcript: string | null
  intents: string[]
  primary_intent: string | null
  sentiment: string | null
  sentiment_confidence: number | null
  order_ids: string[]
  restaurant_names: string[]
  areas: string[]
  product_names: string[]
  qar_amounts: string[]
  summary: string | null
  call_reason?: string | null
  analysed_at: string | null
  vertical?: string | null
  agent_name?: string | null
  agent_helpfulness?: string | null
  customer_behavior?: string | null
}

type ApiCallsResponse = {
  total: number
  items: ApiCallRow[]
}

const CALL_INTENT_TO_CATEGORY: Record<string, Category> = {
  order_status: "General",
  refund_request: "Billing",
  complaint: "Complaints",
  cancellation: "Returns",
  escalation: "Complaints",
  praise: "General",
  delivery_issue: "Technical",
  wrong_item: "Returns",
  payment_issue: "Billing",
  account_issue: "Account Access",
  general_inquiry: "General",
}

const VALID_HELPFULNESS = new Set(["Highly Helpful", "Helpful", "Neutral", "Unhelpful", "N/A"])
const VALID_BEHAVIOR = new Set(["Cooperative", "Polite", "Neutral", "Frustrated", "Angry", "N/A"])

function rowToCallRecord(r: ApiCallRow): CallRecord {
  const intentRaw = r.primary_intent ?? r.intents[0] ?? "general_inquiry"
  const intent = intentRaw
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ")
  const wordCount = (r.transcript ?? "").trim().split(/\s+/).length
  const sentRaw = (r.sentiment ?? "neutral").toLowerCase()
  const sentiment = (sentRaw.charAt(0).toUpperCase() + sentRaw.slice(1)) as Sentiment

  const rawHelpfulness = r.agent_helpfulness ?? "N/A"
  const rawBehavior = r.customer_behavior ?? "N/A"

  return {
    id: `RFQ-${r.call_id.slice(0, 8).toUpperCase()}`,
    datetime: r.analysed_at?.replace("T", " ").slice(0, 16) ?? "—",
    durationSec: Math.max(30, Math.round((wordCount / 130) * 60)),
    agent: r.agent_name && r.agent_name !== "—" ? r.agent_name : "—",
    city: r.areas[0] ?? "Qatar",
    category: CALL_INTENT_TO_CATEGORY[intentRaw] ?? "General",
    sentiment,
    intent,
    confidence: Math.round((r.sentiment_confidence ?? 0.5) * 100),
    transcript: r.transcript ?? "",
    summary: r.summary ?? "",
    reason: r.call_reason?.trim() || intent,
    agentHelpfulness: (VALID_HELPFULNESS.has(rawHelpfulness) ? rawHelpfulness : "N/A") as AgentHelpfulness,
    customerBehavior: (VALID_BEHAVIOR.has(rawBehavior) ? rawBehavior : "N/A") as CustomerBehavior,
    vertical: r.vertical ?? undefined,
  }
}

const CALLS_MAX_ITEMS = 1000

export async function fetchCalls(): Promise<CallRecord[] | null> {
  // One request for the full cap — a single BQ query costs the same as five.
  const data = await apiFetch<ApiCallsResponse>(`/calls?page=1&page_size=${CALLS_MAX_ITEMS}`)
  if (!data?.items?.length) return null
  return data.items.map(rowToCallRecord)
}

// ===========================================================================
// Cancellation prediction — Pillar 03
// Endpoints under /api/cancellation/*
// ===========================================================================

export type CancelTrendPoint = {
  period: string
  total_orders: number
  cancelled: number
  cancel_rate_pct: number
}
export type CancelTrend = { monthly: CancelTrendPoint[]; weekly: CancelTrendPoint[] }

export type MerchantCancelRow = {
  restaurant_name: string
  vertical?: string
  total_orders: number
  cancelled: number
  cancel_rate_pct: number
  avg_order_value: number
}
export type CancelByMerchant = { by_volume: MerchantCancelRow[]; by_rate: MerchantCancelRow[] }

export type ZoneCancelRow = {
  zone: string
  vertical?: string
  total_orders: number
  cancelled: number
  cancel_rate_pct: number
}

export type VerticalMerchant = {
  restaurant_name: string
  cancelled: number
  cancel_rate_pct: number
  /** Vendor's cancels ÷ the vertical's total orders — its slice of the vertical
   *  cancel rate (all merchants' shares sum to that rate, e.g. 2.3%). */
  rate_contribution_pct: number
}
export type VerticalCancelRow = {
  vertical: string
  total_orders: number
  cancelled: number
  cancel_rate_pct: number
  avg_order_value: number
  /** Top contributors (>5 cancels/active day), ranked by rate_contribution_pct. */
  top_merchants: VerticalMerchant[]
}
export type CancelByZone = { by_zone_name: ZoneCancelRow[]; by_customer_zone: ZoneCancelRow[] }

export type TimeCancelRow = {
  time_bucket: string
  total_orders: number
  cancelled: number
  cancel_rate_pct: number
}

export type HourCancelRow = {
  hour: number
  total_orders: number
  cancelled: number
  cancel_rate_pct: number
}

export type DowCancelRow = {
  day_of_week: string
  dow_index: number
  total_orders: number
  cancelled: number
  cancel_rate_pct: number
}

export type OrderSizeRow = {
  quartile: number
  total_orders: number
  cancelled: number
  cancel_rate_pct: number
  min_value: number
  max_value: number
}

export type ActorRow = { cancelled_by: string; cancellations: number; avg_order_value: number }

export type CrosstabRow = {
  zone_name?: string
  restaurant_name?: string
  time_bucket?: string
  day_of_week?: string
  total_orders: number
  cancelled: number
  cancel_rate_pct: number
}
export type CancelCrosstabs = { zone_x_time: CrosstabRow[]; merchant_x_dow: CrosstabRow[]; merchant_x_zone: CrosstabRow[] }

export type RiskFactor = {
  feature: string
  value: unknown
  contribution: number
  direction: string
}

export type PredictionEngine = "auto" | "model" | "gemini"

export type CancelPrediction = {
  order_id: string | null
  probability: number
  risk_level: string
  threshold: number
  flagged: boolean
  top_risk_factors: RiskFactor[]
  gemini_explanation: string | null
  recommended_action: string | null
  engine?: string
  restaurant_name?: string | null
  zone_name?: string | null
}

export type LiveQueue = {
  count: number
  threshold: number
  engine?: string
  generated_at: string
  orders: CancelPrediction[]
}

export type FeatureImportance = {
  top_features?: Array<{ feature: string; importance: number }>
  available?: boolean
}

export type ThresholdAnalysis = {
  thresholds?: Array<{ threshold: number; precision: number; recall: number; f1: number; flagged: number }>
  available?: boolean
}

export type ModelInfo = {
  available: boolean
  algorithm: string | null
  version: string | null
  trained_at: string | null
  roc_auc: number | null
  threshold: number | null
  n_features: number | null
  n_training_rows: number | null
}

export type DriversReport = {
  executive_summary: string
  top_drivers: Array<{ name: string; importance: number; explanation: string; recommendation: string }>
  high_risk_segments: Array<{ segment: string; cancel_rate: number | null; recommendation: string }>
  trend_insight: string
  generated_at: string
}

// Cancellation analytics are pre-aggregated server-side, so the range/vertical
// are sent to the backend (which re-aggregates) rather than filtered locally.
export const fetchCancelTrend = (range: TimeRange = "all", vertical: VerticalFilter = "all", zone: ZoneFilter = "all") =>
  apiFetch<CancelTrend>(`/api/cancellation/analytics/trend${rangeSuffix(range, vertical, zone)}`)
export const fetchCancelByMerchant = (range: TimeRange = "all", vertical: VerticalFilter = "all", zone: ZoneFilter = "all") =>
  apiFetch<CancelByMerchant>(`/api/cancellation/analytics/by-merchant${rangeSuffix(range, vertical, zone)}`)
export const fetchCancelByZone = (range: TimeRange = "all", vertical: VerticalFilter = "all", zone: ZoneFilter = "all") =>
  apiFetch<CancelByZone>(`/api/cancellation/analytics/by-zone${rangeSuffix(range, vertical, zone)}`)
export const fetchCancelByTime = (range: TimeRange = "all", vertical: VerticalFilter = "all", zone: ZoneFilter = "all") =>
  apiFetch<TimeCancelRow[]>(`/api/cancellation/analytics/by-time${rangeSuffix(range, vertical, zone)}`)
export const fetchCancelByHour = (range: TimeRange = "all", vertical: VerticalFilter = "all", zone: ZoneFilter = "all") =>
  apiFetch<{ by_hour: HourCancelRow[] }>(`/api/cancellation/analytics/by-hour${rangeSuffix(range, vertical, zone)}`)
export const fetchCancelByDay = (range: TimeRange = "all", vertical: VerticalFilter = "all", zone: ZoneFilter = "all") =>
  apiFetch<DowCancelRow[]>(`/api/cancellation/analytics/by-day${rangeSuffix(range, vertical, zone)}`)
export const fetchCancelByOrderSize = (range: TimeRange = "all", vertical: VerticalFilter = "all", zone: ZoneFilter = "all") =>
  apiFetch<OrderSizeRow[]>(`/api/cancellation/analytics/by-order-size${rangeSuffix(range, vertical, zone)}`)
export const fetchCancelByActor = (range: TimeRange = "all", vertical: VerticalFilter = "all", zone: ZoneFilter = "all") =>
  apiFetch<ActorRow[]>(`/api/cancellation/analytics/by-actor${rangeSuffix(range, vertical, zone)}`)
export const fetchCancelCrosstabs = (range: TimeRange = "all", vertical: VerticalFilter = "all", zone: ZoneFilter = "all") =>
  apiFetch<CancelCrosstabs>(`/api/cancellation/analytics/crosstabs${rangeSuffix(range, vertical, zone)}`)
export const fetchCancelByVertical = (range: TimeRange = "all", zone: ZoneFilter = "all") =>
  apiFetch<VerticalCancelRow[]>(`/api/cancellation/analytics/by-vertical${rangeSuffix(range, "all", zone)}`)
export const fetchDriversReport = () =>
  apiFetch<DriversReport>("/api/cancellation/analytics/drivers-report")
export const fetchFeatureImportance = () =>
  apiFetch<FeatureImportance>("/api/cancellation/analytics/feature-importance")
export const fetchThresholdAnalysis = () =>
  apiFetch<ThresholdAnalysis>("/api/cancellation/analytics/threshold-analysis")
export const fetchModelInfo = () =>
  apiFetch<ModelInfo>("/api/cancellation/model/info")
// The dashboard scores exclusively with Gemini (the ML engines remain available
// on the API for programmatic use).
export const fetchLiveQueue = (limit = 500, engine: PredictionEngine = "gemini") =>
  apiFetch<LiveQueue>(`/api/cancellation/predict/live-queue?limit=${limit}&engine=${engine}`)
export const explainOrder = (orderId: string, engine: PredictionEngine = "gemini") =>
  apiPost<CancelPrediction>(`/api/cancellation/explain/${encodeURIComponent(orderId)}?engine=${engine}`, {})
export const askCancellationChat = (question: string) =>
  apiPost<{ answer: string }>("/api/cancellation/chat", { question })

// Fast dashboard data. The Gemini drivers report is intentionally NOT here —
// it's slow to generate, so the page fetches it separately (see fetchDriversReport)
// and fills it in after the charts have already painted.
export async function fetchAllCancellationData(
  range: TimeRange = "all", vertical: VerticalFilter = "all", zone: ZoneFilter = "all",
) {
  // Analytics aggregates respect the selected window + vertical; model artifacts
  // (feature importance, model info) and the live queue are filter-independent.
  const [trend, byMerchant, byZone, byTime, byHour, byDay, byOrderSize, byActor, crosstabs, byVertical,
    featureImportance, modelInfo, liveQueue] = await Promise.all([
    fetchCancelTrend(range, vertical, zone),
    fetchCancelByMerchant(range, vertical, zone),
    fetchCancelByZone(range, vertical),
    fetchCancelByTime(range, vertical, zone),
    fetchCancelByHour(range, vertical, zone),
    fetchCancelByDay(range, vertical, zone),
    fetchCancelByOrderSize(range, vertical, zone),
    fetchCancelByActor(range, vertical, zone),
    fetchCancelCrosstabs(range, vertical, zone),
    fetchCancelByVertical(range, zone),
    fetchFeatureImportance(),
    fetchModelInfo(),
    fetchLiveQueue(),
  ])
  return {
    trend, byMerchant, byZone, byTime, byHour: byHour?.by_hour ?? null,
    byDay, byOrderSize, byActor, crosstabs, byVertical,
    featureImportance, modelInfo, liveQueue,
  }
}

// ---------------------------------------------------------------------------
// Data freshness
// ---------------------------------------------------------------------------

/** How current the warehouse is — see backend/app/routers/live.py. */
export type LiveStatus = {
  state: "live" | "lagging" | "stale" | "frozen" | "unknown"
  clock: string
  warehouse: string
  server_now: string
  orders: { last_at: string | null; age_seconds: number | null; today: number; in_flight: number }
  messages: { last_at: string | null; age_seconds: number | null; today: number }
  calls: { last_at: string | null }
}

/**
 * Poll target for the freshness badge.
 *
 * Returns null rather than throwing on failure: a dashboard must not break
 * because the liveness probe did, and the badge renders "unknown" — which is
 * the honest answer when we cannot tell.
 */
export async function fetchLiveStatus(): Promise<LiveStatus | null> {
  try {
    const res = await fetch(`${BASE}/api/v1/live`, { cache: "no-store" })
    if (!res.ok) return null
    return (await res.json()) as LiveStatus
  } catch {
    return null
  }
}
