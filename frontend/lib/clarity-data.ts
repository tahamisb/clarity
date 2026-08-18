// Clarity Call Intelligence — mock data + Qatar geography

export type Sentiment = "Positive" | "Neutral" | "Negative"
export type Category =
  | "Billing"
  | "Technical"
  | "Returns"
  | "Roaming"
  | "Account Access"
  | "Complaints"
  | "General"

export type AgentHelpfulness = "Highly Helpful" | "Helpful" | "Neutral" | "Unhelpful" | "N/A"
export type CustomerBehavior = "Cooperative" | "Polite" | "Neutral" | "Frustrated" | "Angry" | "N/A"

export type CallRecord = {
  id: string
  datetime: string
  durationSec: number
  agent: string
  city: string
  category: Category
  sentiment: Sentiment
  intent: string
  /** Specific reason the customer called — never a generic "General" label. */
  reason: string
  confidence: number
  transcript: string
  summary: string
  agentHelpfulness: AgentHelpfulness
  customerBehavior: CustomerBehavior
  /** Business vertical of the first merchant named in the call. */
  vertical?: string
}

export const HELPFULNESS_COLORS: Record<AgentHelpfulness, string> = {
  "Highly Helpful": "#22c55e",
  "Helpful": "#84cc16",
  "Neutral": "#f5a623",
  "Unhelpful": "#ef4444",
  "N/A": "#6b7280",
}

export const CUSTOMER_BEHAVIOR_COLORS: Record<CustomerBehavior, string> = {
  "Cooperative": "#22c55e",
  "Polite": "#06b6d4",
  "Neutral": "#a98fcb",
  "Frustrated": "#f97316",
  "Angry": "#ef4444",
  "N/A": "#6b7280",
}

export const AGENTS = [
  "Ahmed Al-Rashidi",
  "Sara Al-Mansoori",
  "Khalid Al-Thani",
  "Noora Al-Kuwari",
  "Fahad Al-Sulaiti",
  "Mariam Al-Hajri",
]

export const SENTIMENT_COLORS: Record<Sentiment, string> = {
  Positive: "#1cb57a",
  Neutral: "#f5a623",
  Negative: "#e23d5c",
}

export const CATEGORY_COLORS: Record<Category, string> = {
  Billing: "#9b4dff",
  Technical: "#3b82f6",
  Returns: "#06b6d4",
  Roaming: "#f5a623",
  "Account Access": "#22c55e",
  Complaints: "#ef4444",
  General: "#a98fcb",
}

// --- Qatar geography -------------------------------------------------------
export const QATAR_OUTLINE: [number, number][] = [
  [50.75, 24.75],
  [50.81, 24.85],
  [50.83, 25.00],
  [50.79, 25.10],
  [50.76, 25.20],
  [50.75, 25.30],
  [50.77, 25.40],
  [50.82, 25.50],
  [50.87, 25.60],
  [50.93, 25.70],
  [51.00, 25.85],
  [51.05, 25.95],
  [51.10, 26.05],
  [51.17, 26.12],
  [51.22, 26.15],
  [51.27, 26.13],
  [51.32, 26.05],
  [51.37, 25.98],
  [51.42, 25.94],
  [51.48, 25.91],
  [51.56, 25.88],
  [51.59, 25.84],
  [51.60, 25.75],
  [51.55, 25.65],
  [51.54, 25.55],
  [51.56, 25.45],
  [51.52, 25.35],
  [51.59, 25.32],
  [51.63, 25.26],
  [51.62, 25.18],
  [51.64, 25.10],
  [51.60, 25.00],
  [51.57, 24.90],
  [51.52, 24.80],
  [51.45, 24.65],
  [51.35, 24.60],
  [51.25, 24.61],
  [51.15, 24.64],
  [51.05, 24.68],
  [50.95, 24.71],
  [50.85, 24.73],
]

export type QatarCity = {
  name: string
  lon: number
  lat: number
  calls: number
  rate: string
}

// Top cities by call origin — Qatar only
export const QATAR_CITIES: QatarCity[] = [
  { name: "Doha", lon: 51.53, lat: 25.29, calls: 118_204, rate: "412/s" },
  { name: "Al Rayyan", lon: 51.42, lat: 25.29, calls: 41_870, rate: "146/s" },
  { name: "Al Wakrah", lon: 51.6, lat: 25.17, calls: 22_540, rate: "78/s" },
  { name: "Lusail", lon: 51.53, lat: 25.43, calls: 18_932, rate: "66/s" },
  { name: "Al Khor", lon: 51.5, lat: 25.68, calls: 12_415, rate: "43/s" },
  { name: "Umm Salal", lon: 51.4, lat: 25.42, calls: 9_870, rate: "34/s" },
  { name: "Mesaieed", lon: 51.55, lat: 24.99, calls: 6_402, rate: "22/s" },
  { name: "Dukhan", lon: 50.78, lat: 25.43, calls: 4_120, rate: "14/s" },
]

export const QATAR_TOTAL_CALLS = QATAR_CITIES.reduce((s, c) => s + c.calls, 0)

// --- Aggregated analytics --------------------------------------------------
export const SENTIMENT_DISTRIBUTION = [
  { name: "Positive" as Sentiment, value: 132_140 },
  { name: "Neutral" as Sentiment, value: 61_205 },
  { name: "Negative" as Sentiment, value: 41_008 },
]

export const CATEGORY_VOLUME = [
  { name: "Billing Issues", value: 58_420, pct: 24.4 },
  { name: "Technical Support", value: 49_180, pct: 20.5 },
  { name: "Roaming Charges", value: 38_640, pct: 16.1 },
  { name: "Account Access", value: 31_205, pct: 13.0 },
  { name: "Return Requests", value: 27_910, pct: 11.6 },
  { name: "Complaints", value: 34_998, pct: 14.4 },
]

export type Intent = {
  name: string
  value: number
  pct: number
  avgSentiment: number
}

export const INTENT_DISTRIBUTION: Intent[] = [
  { name: "Complaint", value: 62_400, pct: 26.7, avgSentiment: -0.42 },
  { name: "Refund Request", value: 54_120, pct: 23.1, avgSentiment: -0.28 },
  { name: "Order Status Query", value: 41_880, pct: 17.9, avgSentiment: 0.12 },
  { name: "Cancellation", value: 33_240, pct: 14.2, avgSentiment: -0.36 },
  { name: "Escalation", value: 24_910, pct: 10.6, avgSentiment: -0.51 },
  { name: "Praise", value: 17_800, pct: 7.6, avgSentiment: 0.78 },
]

export type WeeklyPoint = {
  week: string
  positive: number
  neutral: number
  negative: number
  peak?: boolean
}

export const SENTIMENT_TREND: WeeklyPoint[] = [
  { week: "W1", positive: 58, neutral: 27, negative: 15 },
  { week: "W2", positive: 55, neutral: 28, negative: 17 },
  { week: "W3", positive: 52, neutral: 29, negative: 19 },
  { week: "W4", positive: 49, neutral: 28, negative: 23 },
  { week: "W5", positive: 47, neutral: 27, negative: 26 },
  { week: "W6", positive: 44, neutral: 27, negative: 29, peak: true },
  { week: "W7", positive: 48, neutral: 28, negative: 24 },
  { week: "W8", positive: 51, neutral: 28, negative: 21 },
  { week: "W9", positive: 53, neutral: 29, negative: 18 },
  { week: "W10", positive: 56, neutral: 28, negative: 16 },
  { week: "W11", positive: 54, neutral: 30, negative: 16 },
  { week: "W12", positive: 57, neutral: 29, negative: 14 },
]

export type TopicRow = {
  rank: number
  topic: string
  volume: number
  pct: number
  negativePct: number
  confidence: number
  trend: "up" | "down"
}

export const TOP_TOPICS_FREQUENCY: TopicRow[] = [
  { rank: 1, topic: "Monthly bill higher than expected", volume: 21_410, pct: 8.9, negativePct: 61, confidence: 96, trend: "up" },
  { rank: 2, topic: "Internet outage in area", volume: 18_220, pct: 7.6, negativePct: 72, confidence: 94, trend: "up" },
  { rank: 3, topic: "Roaming charges dispute", volume: 16_870, pct: 7.0, negativePct: 68, confidence: 93, trend: "down" },
  { rank: 4, topic: "SIM card not activating", volume: 14_530, pct: 6.0, negativePct: 44, confidence: 92, trend: "down" },
  { rank: 5, topic: "Plan upgrade enquiry", volume: 13_110, pct: 5.5, negativePct: 12, confidence: 95, trend: "up" },
  { rank: 6, topic: "Account login locked", volume: 11_980, pct: 5.0, negativePct: 38, confidence: 91, trend: "up" },
  { rank: 7, topic: "Refund not received", volume: 10_640, pct: 4.4, negativePct: 77, confidence: 90, trend: "up" },
  { rank: 8, topic: "Service cancellation request", volume: 9_870, pct: 4.1, negativePct: 55, confidence: 89, trend: "down" },
  { rank: 9, topic: "Slow data speeds", volume: 8_920, pct: 3.7, negativePct: 49, confidence: 90, trend: "up" },
  { rank: 10, topic: "Promotion eligibility", volume: 7_640, pct: 3.2, negativePct: 18, confidence: 92, trend: "down" },
]

export const TOP_TOPICS_NEGATIVE: TopicRow[] = [...TOP_TOPICS_FREQUENCY]
  .sort((a, b) => b.negativePct - a.negativePct)
  .map((t, i) => ({ ...t, rank: i + 1 }))

export const PIPELINE_STEPS = [
  { title: "Audio Ingestion", status: "Completed", desc: "Anonymised batch upload (MP3/WAV/M4A)", stat: "512 calls received" },
  { title: "Transcription", status: "Completed", desc: "Speech-to-text per call", stat: "487 transcribed · 94.2% accuracy" },
  { title: "Pre-processing", status: "Completed", desc: "Silence removal · turn separation", stat: "1,204 silence gaps removed" },
  { title: "Intent Classification", status: "In Progress", desc: "Tagging call intent", stat: "418 / 487 tagged" },
  { title: "Sentiment Analysis", status: "In Progress", desc: "Tone + confidence per call", stat: "402 / 487 scored" },
  { title: "Topic Ranking", status: "Pending", desc: "Top 10 by frequency & negativity", stat: "Awaiting upstream" },
  { title: "Report Generation", status: "Pending", desc: "Final analytics report", stat: "Awaiting upstream" },
] as const

export function formatDuration(sec: number) {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${s.toString().padStart(2, "0")}`
}
