import { type Sentiment } from "./clarity-data"

export type Channel = "App" | "WhatsApp" | "Ticket"
export type TimeOfDay = "Morning" | "Afternoon" | "Evening" | "Night"
export type MessageIntent = "Complaint" | "Refund" | "Order Query" | "Cancellation" | "Praise"

export type SupportMessage = {
  id: string
  channel: Channel
  customerId: string
  text: string
  intent: MessageIntent
  sentiment: Sentiment
  confidence: number
  zone: string
  timeOfDay: TimeOfDay
  date: string
  merchant?: string
  /** Business vertical of the merchant (Restaurants | Grocery | Market | Health & Wellness | Other). */
  vertical?: string
  suggestedReply: string
  /** True once the conversation has been closed (has a closed_at). */
  resolved: boolean
  /** Conversation END time ("YYYY-MM-DD HH:mm"); undefined while still open. */
  closedAt?: string
  /** Handling time in minutes (closed_at − created_at); undefined while open. */
  handlingMinutes?: number
  /** Human agent who handled/closed the chat; undefined ⇒ bot/customer-only. */
  agentName?: string
}
