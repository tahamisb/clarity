import { type Sentiment } from "./rafeeq-data"

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
  suggestedReply: string
  resolved: boolean
}
