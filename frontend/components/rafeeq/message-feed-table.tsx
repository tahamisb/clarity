"use client"

import { useEffect, useState } from "react"
import { ChevronLeft, ChevronRight, MessageSquare, Smartphone, Ticket } from "lucide-react"
import { SENTIMENT_COLORS } from "@/lib/rafeeq-data"
import { type SupportMessage, type MessageIntent } from "@/lib/mock-messages"
import { Panel } from "./panel"
import { MessageDetailModal } from "./message-detail-modal"

const PAGE_SIZE = 10

export const INTENT_COLORS: Record<MessageIntent, string> = {
  Complaint: "#ef4444",
  Refund: "#f5a623",
  "Order Query": "#3b82f6",
  Cancellation: "#9b4dff",
  Praise: "#22c55e",
}

function ChannelIcon({ channel }: { channel: string }) {
  if (channel === "WhatsApp") return <MessageSquare className="size-3.5 text-green-500" />
  if (channel === "App") return <Smartphone className="size-3.5 text-blue-400" />
  return <Ticket className="size-3.5 text-orange-400" />
}

export function MessageFeedTable({
  messages,
}: {
  messages: SupportMessage[]
}) {
  const [page, setPage] = useState(0)
  const [active, setActive] = useState<SupportMessage | null>(null)

  const totalPages = Math.max(1, Math.ceil(messages.length / PAGE_SIZE))

  useEffect(() => {
    setPage(0)
  }, [messages.length])

  const safePage = Math.min(page, totalPages - 1)
  const pageStart = safePage * PAGE_SIZE
  const rows = messages.slice(pageStart, pageStart + PAGE_SIZE)

  return (
    <>
      <Panel
        title="Support Messages"
        action={
          <span className="text-xs text-muted-foreground">
            {messages.length.toLocaleString()} messages
          </span>
        }
      >
        <div className="-mx-2 overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2 font-semibold">Msg ID</th>
                <th className="px-3 py-2 font-semibold">Channel</th>
                <th className="px-3 py-2 font-semibold">Customer</th>
                <th className="px-3 py-2 font-semibold">Preview</th>
                <th className="px-3 py-2 font-semibold">Intent</th>
                <th className="px-3 py-2 font-semibold">Sentiment</th>
                <th className="px-3 py-2 font-semibold">Conf.</th>
                <th className="px-3 py-2 font-semibold">Zone</th>
                <th className="px-3 py-2 font-semibold">Time</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr
                  key={m.id}
                  className="border-b border-border/60 transition-colors hover:bg-secondary/50"
                >
                  <td className="px-3 py-2.5 font-mono text-xs text-foreground">
                    {m.id}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <ChannelIcon channel={m.channel} />
                      <span>{m.channel}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-foreground">{m.customerId}</td>
                  <td className="px-3 py-2.5 text-muted-foreground max-w-[200px] truncate" title={m.text}>
                    {m.text}
                  </td>
                  <td className="px-3 py-2.5">
                    <Pill color={INTENT_COLORS[m.intent]}>{m.intent}</Pill>
                  </td>
                  <td className="px-3 py-2.5">
                    <Pill color={SENTIMENT_COLORS[m.sentiment]} solid>
                      {m.sentiment}
                    </Pill>
                  </td>
                  <td className="px-3 py-2.5 tabular-nums text-foreground">
                    {m.confidence}%
                  </td>
                  <td className="px-3 py-2.5 text-muted-foreground">{m.zone}</td>
                  <td className="px-3 py-2.5 text-muted-foreground">{m.timeOfDay}</td>
                  <td className="px-3 py-2.5 text-right">
                    <button
                      onClick={() => setActive(m)}
                      className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium text-accent transition-colors hover:bg-accent/10"
                    >
                      View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {messages.length === 0
              ? "No messages"
              : `${pageStart + 1}–${Math.min(pageStart + PAGE_SIZE, messages.length)} of ${messages.length.toLocaleString()} messages`}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(Math.max(0, safePage - 1))}
              disabled={safePage === 0}
              className="flex size-7 items-center justify-center rounded-md border border-border disabled:opacity-40"
              aria-label="Previous page"
            >
              <ChevronLeft className="size-4" />
            </button>
            <span className="px-2 tabular-nums">
              {safePage + 1} / {totalPages}
            </span>
            <button
              onClick={() => setPage(Math.min(totalPages - 1, safePage + 1))}
              disabled={safePage >= totalPages - 1}
              className="flex size-7 items-center justify-center rounded-md border border-border disabled:opacity-40"
              aria-label="Next page"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>
        </div>
      </Panel>

      {active && (
        <MessageDetailModal message={active} onClose={() => setActive(null)} />
      )}
    </>
  )
}

function Pill({
  children,
  color,
  solid,
}: {
  children: React.ReactNode
  color: string
  solid?: boolean
}) {
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold"
      style={
        solid
          ? { background: color, color: "#0a0612" }
          : { background: `${color}22`, color }
      }
    >
      {children}
    </span>
  )
}
