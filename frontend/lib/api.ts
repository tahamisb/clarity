import {
  type SupportMessage,
  type Channel,
  type TimeOfDay,
  type MessageIntent,
} from "./mock-messages"
import type { AgentHelpfulness, CallRecord, Category, CustomerBehavior, Sentiment } from "./rafeeq-data"

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"

async function apiFetch<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${BASE}${path}`, { cache: "no-store" })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
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
  }>
}

type ApiTopTriggers = {
  triggers: Array<{
    trigger: string
    count: number
    top_zones: string[]
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
    created_at: string
    ingested_at: string
  }
}

type ApiSentimentResults = {
  total: number
  items: ApiClassificationResult[]
}

// ---------------------------------------------------------------------------
// Data fetchers
// ---------------------------------------------------------------------------

export async function fetchSentimentTrend(): Promise<TrendItem[] | null> {
  const data = await apiFetch<ApiSentimentTrend>("/api/v1/analytics/sentiment-trend")
  if (!data?.weeks?.length) return null

  return data.weeks.map((w, i) => ({
    week: `W${i + 1}`,
    positive: Math.round(w.positive_pct),
    neutral: Math.round(w.neutral_pct),
    negative: Math.round(w.negative_pct),
  }))
}

export async function fetchTopNegativeTriggers(): Promise<TriggerItem[] | null> {
  const data = await apiFetch<ApiTopTriggers>("/api/v1/analytics/top-negative-triggers")
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
  }))
}

export async function fetchCrossChannel(): Promise<CrossChannelItem[] | null> {
  const data = await apiFetch<ApiCrossChannel>("/api/v1/analytics/cross-channel")
  if (!data?.shared_intents?.length) return null

  const intentLabel: Record<string, string> = {
    complaint: "Complaints",
    refund: "Refunds",
    order_query: "Order Query",
    cancellation_request: "Cancellation",
    praise: "General",
  }

  return data.shared_intents.map((s) => ({
    intent: intentLabel[s.intent] ?? s.intent,
    calls: s.call_count,
    messages: s.text_count,
  }))
}

export async function fetchZoneHeatmap(): Promise<ZoneItem[] | null> {
  const data = await apiFetch<ApiZoneHeatmap>("/api/v1/analytics/zone-heatmap")
  if (!data?.zones?.length) return null

  return data.zones.map((z) => ({
    zone: z.zone,
    negativePct: Math.round(z.negative_pct),
  }))
}

const RESULTS_PAGE_SIZE = 200
const RESULTS_MAX_ITEMS = 1000

export async function fetchMessages(): Promise<SupportMessage[] | null> {
  const first = await apiFetch<ApiSentimentResults>(
    `/api/v1/sentiment/results?page=1&page_size=${RESULTS_PAGE_SIZE}`
  )
  if (!first?.items?.length) return null

  const items = [...first.items]
  const total = Math.min(first.total, RESULTS_MAX_ITEMS)
  for (let page = 2; items.length < total; page++) {
    const next = await apiFetch<ApiSentimentResults>(
      `/api/v1/sentiment/results?page=${page}&page_size=${RESULTS_PAGE_SIZE}`
    )
    if (!next?.items?.length) break
    items.push(...next.items)
  }

  const data = { total: first.total, items }
  if (!data.items.length) return null

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

  return data.items
    .map((item) => {
      const { classification: clf, message: msg } = item
      const intent = intentMap[clf.intent] ?? "Complaint"
      return {
        id: `MSG-${clf.message_id.slice(0, 8).toUpperCase()}`,
        channel: channelMap[msg.source_channel] ?? "App",
        customerId: msg.customer_id ? `Customer #${msg.customer_id}` : "Unknown",
        text: msg.content,
        intent,
        sentiment: sentimentMap[clf.sentiment] ?? "Neutral",
        confidence: Math.round(clf.sentiment_confidence * 100),
        zone: msg.zone ?? "Unknown",
        timeOfDay: toTimeOfDay(msg.created_at || clf.classified_at),
        date: (msg.created_at || clf.classified_at).replace("T", " ").slice(0, 16),
        merchant: msg.merchant_name ?? undefined,
        suggestedReply: replyMap[intent] ?? "",
        resolved: clf.sentiment !== "negative",
      } satisfies SupportMessage
    })
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
}

// ---------------------------------------------------------------------------
// Fetch everything in parallel — returns real data or null per field
// ---------------------------------------------------------------------------

export async function fetchAllMessagesData() {
  const [messages, triggers, crossChannel, trend, zones] = await Promise.all([
    fetchMessages(),
    fetchTopNegativeTriggers(),
    fetchCrossChannel(),
    fetchSentimentTrend(),
    fetchZoneHeatmap(),
  ])
  return { messages, triggers, crossChannel, trend, zones }
}

// ---------------------------------------------------------------------------
// Call analysis — fetch existing calls from BigQuery
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
  analysed_at: string | null
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
    agentHelpfulness: (VALID_HELPFULNESS.has(rawHelpfulness) ? rawHelpfulness : "N/A") as AgentHelpfulness,
    customerBehavior: (VALID_BEHAVIOR.has(rawBehavior) ? rawBehavior : "N/A") as CustomerBehavior,
  }
}

const CALLS_PAGE_SIZE = 200
const CALLS_MAX_ITEMS = 1000

export async function fetchCalls(): Promise<CallRecord[] | null> {
  const first = await apiFetch<ApiCallsResponse>(`/calls?page=1&page_size=${CALLS_PAGE_SIZE}`)
  if (!first?.items?.length) return null

  const items = [...first.items]
  const total = Math.min(first.total, CALLS_MAX_ITEMS)
  for (let page = 2; items.length < total; page++) {
    const next = await apiFetch<ApiCallsResponse>(
      `/calls?page=${page}&page_size=${CALLS_PAGE_SIZE}`
    )
    if (!next?.items?.length) break
    items.push(...next.items)
  }

  return items.map(rowToCallRecord)
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
  total_orders: number
  cancelled: number
  cancel_rate_pct: number
  avg_order_value: number
}
export type CancelByMerchant = { by_volume: MerchantCancelRow[]; by_rate: MerchantCancelRow[] }

export type ZoneCancelRow = {
  zone: string
  total_orders: number
  cancelled: number
  cancel_rate_pct: number
}
export type CancelByZone = { by_zone_name: ZoneCancelRow[]; by_customer_zone: ZoneCancelRow[] }

export type TimeCancelRow = {
  time_bucket: string
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
export type CancelCrosstabs = { zone_x_time: CrosstabRow[]; merchant_x_dow: CrosstabRow[] }

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

export const fetchCancelTrend = () =>
  apiFetch<CancelTrend>("/api/cancellation/analytics/trend")
export const fetchCancelByMerchant = () =>
  apiFetch<CancelByMerchant>("/api/cancellation/analytics/by-merchant")
export const fetchCancelByZone = () =>
  apiFetch<CancelByZone>("/api/cancellation/analytics/by-zone")
export const fetchCancelByTime = () =>
  apiFetch<TimeCancelRow[]>("/api/cancellation/analytics/by-time")
export const fetchCancelByDay = () =>
  apiFetch<DowCancelRow[]>("/api/cancellation/analytics/by-day")
export const fetchCancelByOrderSize = () =>
  apiFetch<OrderSizeRow[]>("/api/cancellation/analytics/by-order-size")
export const fetchCancelByActor = () =>
  apiFetch<ActorRow[]>("/api/cancellation/analytics/by-actor")
export const fetchCancelCrosstabs = () =>
  apiFetch<CancelCrosstabs>("/api/cancellation/analytics/crosstabs")
export const fetchDriversReport = () =>
  apiFetch<DriversReport>("/api/cancellation/analytics/drivers-report")
export const fetchFeatureImportance = () =>
  apiFetch<FeatureImportance>("/api/cancellation/analytics/feature-importance")
export const fetchThresholdAnalysis = () =>
  apiFetch<ThresholdAnalysis>("/api/cancellation/analytics/threshold-analysis")
export const fetchModelInfo = () =>
  apiFetch<ModelInfo>("/api/cancellation/model/info")
export const fetchLiveQueue = (limit = 50, engine: PredictionEngine = "auto") =>
  apiFetch<LiveQueue>(`/api/cancellation/predict/live-queue?limit=${limit}&engine=${engine}`)
export const explainOrder = (orderId: string, engine: PredictionEngine = "auto") =>
  apiPost<CancelPrediction>(`/api/cancellation/explain/${encodeURIComponent(orderId)}?engine=${engine}`, {})
export const askCancellationChat = (question: string) =>
  apiPost<{ answer: string }>("/api/cancellation/chat", { question })

// Fast dashboard data. The Gemini drivers report is intentionally NOT here —
// it's slow to generate, so the page fetches it separately (see fetchDriversReport)
// and fills it in after the charts have already painted.
export async function fetchAllCancellationData() {
  const [trend, byMerchant, byZone, byTime, byDay, byOrderSize, byActor, crosstabs,
    featureImportance, modelInfo, liveQueue] = await Promise.all([
    fetchCancelTrend(),
    fetchCancelByMerchant(),
    fetchCancelByZone(),
    fetchCancelByTime(),
    fetchCancelByDay(),
    fetchCancelByOrderSize(),
    fetchCancelByActor(),
    fetchCancelCrosstabs(),
    fetchFeatureImportance(),
    fetchModelInfo(),
    fetchLiveQueue(),
  ])
  return {
    trend, byMerchant, byZone, byTime, byDay, byOrderSize, byActor, crosstabs,
    featureImportance, modelInfo, liveQueue,
  }
}
