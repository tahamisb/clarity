"use client"

import { useEffect, useMemo, useState } from "react"
import { Bot, CheckCircle2, ChevronLeft, ChevronRight, Download, Flag, FilterX, MessageSquare, Smartphone, Ticket, UserRound } from "lucide-react"
import { SENTIMENT_COLORS } from "@/lib/clarity-data"
import { type SupportMessage, type MessageIntent } from "@/lib/mock-messages"
import { useMessageStatus } from "@/lib/message-status-context"
import { useTimeFilter } from "@/lib/time-filter-context"
import { negativeCustomersCsvUrl } from "@/lib/api"
import { Panel } from "./panel"
import { MessageDetailModal } from "./message-detail-modal"
import { ColumnFilter, useColumnFilters, type ColumnDef } from "./column-filter"
import { useT, useTV } from "@/lib/i18n"

const PAGE_SIZE = 10

// Review status is stored separately (message-status-context), so we fold it
// onto each row as plain strings to make it filterable with the same machinery.
type StatusRow = SupportMessage & { reviewFlagged: string; reviewResolved: string }
const FLAG_YES = "Flagged"
const FLAG_NO = "Not flagged"
const RESOLVE_YES = "Resolved"
const RESOLVE_NO = "Unresolved"

// Categorical columns get an Excel-style dropdown filter. Module-level for a
// stable reference (required by useColumnFilters).
const MSG_FILTER_COLUMNS: ColumnDef<StatusRow>[] = [
  { id: "channel", accessor: (m) => m.channel },
  { id: "customer", accessor: (m) => m.customerId },
  { id: "intent", accessor: (m) => m.intent },
  { id: "sentiment", accessor: (m) => m.sentiment },
  { id: "zone", accessor: (m) => m.zone },
  { id: "time", accessor: (m) => m.timeOfDay },
  { id: "flagged", accessor: (m) => m.reviewFlagged },
  { id: "resolved", accessor: (m) => m.reviewResolved },
]

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
  const t = useT()
  const tv = useTV()
  const [page, setPage] = useState(0)
  const [active, setActive] = useState<SupportMessage | null>(null)
  const { getStatus } = useMessageStatus()
  const { range, vertical } = useTimeFilter()

  // Fold the per-message review status onto each row so the "Flagged" /
  // "Resolved" columns filter through the same Excel-style machinery as the rest.
  const statusRows = useMemo<StatusRow[]>(
    () =>
      messages.map((m) => {
        const s = getStatus(m.id)
        return {
          ...m,
          reviewFlagged: s.flagged ? FLAG_YES : FLAG_NO,
          reviewResolved: s.resolved ? RESOLVE_YES : RESOLVE_NO,
        }
      }),
    [messages, getStatus],
  )

  const { filteredRows, distinct, selected, setSelected, clearAll, anyActive } = useColumnFilters(
    statusRows,
    MSG_FILTER_COLUMNS,
  )
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE))

  useEffect(() => {
    setPage(0)
  }, [filteredRows.length])

  const safePage = Math.min(page, totalPages - 1)
  const pageStart = safePage * PAGE_SIZE
  const rows = filteredRows.slice(pageStart, pageStart + PAGE_SIZE)

  return (
    <>
      <Panel
        title={t("nav.supportMessages")}
        action={
          <span className="flex items-center gap-2">
            {anyActive && (
              <button
                onClick={clearAll}
                className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground"
              >
                <FilterX className="size-3.5" />
                {t("table.clearFilters")}
              </button>
            )}
            {/* Full-corpus export (backend query, not the capped feed): every
                customer with a negative message in the active window/vertical. */}
            <a
              href={negativeCustomersCsvUrl(range, vertical)}
              download
              className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary transition-colors hover:bg-primary/20"
              title={t("table.exportNegativeTitle")}
            >
              <Download className="size-3.5" />
              {t("table.exportNegative")}
            </a>
            <span className="text-xs text-muted-foreground">
              {t("mft.messagesCount", { n: filteredRows.length.toLocaleString() })}
            </span>
          </span>
        }
      >
        <div className="-mx-2 overflow-x-auto">
          <table className="w-full min-w-[1080px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2 font-semibold">{t("col.msgId")}</th>
                <th className="whitespace-nowrap px-3 py-2 font-semibold">
                  {t("col.channel")}
                  <ColumnFilter label={t("col.channel")} values={distinct.channel} selected={selected.channel ?? null} onChange={(n) => setSelected("channel", n)} />
                </th>
                <th className="whitespace-nowrap px-3 py-2 font-semibold">
                  {t("col.customer")}
                  <ColumnFilter label={t("col.customer")} values={distinct.customer} selected={selected.customer ?? null} onChange={(n) => setSelected("customer", n)} />
                </th>
                <th className="whitespace-nowrap px-3 py-2 font-semibold">{t("col.handledBy")}</th>
                <th className="px-3 py-2 font-semibold">{t("col.preview")}</th>
                <th className="whitespace-nowrap px-3 py-2 font-semibold">
                  {t("col.intent")}
                  <ColumnFilter label={t("col.intent")} values={distinct.intent} selected={selected.intent ?? null} onChange={(n) => setSelected("intent", n)} />
                </th>
                <th className="whitespace-nowrap px-3 py-2 font-semibold">
                  {t("col.sentiment")}
                  <ColumnFilter label={t("col.sentiment")} values={distinct.sentiment} selected={selected.sentiment ?? null} onChange={(n) => setSelected("sentiment", n)} />
                </th>
                <th className="px-3 py-2 font-semibold">{t("col.confidence")}</th>
                <th className="whitespace-nowrap px-3 py-2 font-semibold">
                  {t("col.zone")}
                  <ColumnFilter label={t("col.zone")} values={distinct.zone} selected={selected.zone ?? null} onChange={(n) => setSelected("zone", n)} />
                </th>
                <th className="whitespace-nowrap px-3 py-2 font-semibold">
                  {t("col.time")}
                  <ColumnFilter label={t("col.time")} values={distinct.time} selected={selected.time ?? null} onChange={(n) => setSelected("time", n)} />
                </th>
                <th className="whitespace-nowrap px-3 py-2 font-semibold">
                  {t("col.flagged")}
                  <ColumnFilter label={t("mft.flaggedForReview")} values={distinct.flagged} selected={selected.flagged ?? null} onChange={(n) => setSelected("flagged", n)} />
                </th>
                <th className="whitespace-nowrap px-3 py-2 font-semibold">
                  {t("col.resolved")}
                  <ColumnFilter label={t("col.resolved")} values={distinct.resolved} selected={selected.resolved ?? null} onChange={(n) => setSelected("resolved", n)} />
                </th>
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
                    <span className="flex items-center gap-1.5">
                      {m.id}
                      {getStatus(m.id).resolved && (
                        <CheckCircle2 className="size-3.5 text-positive" aria-label="Resolved" />
                      )}
                      {getStatus(m.id).flagged && (
                        <Flag className="size-3.5 fill-current text-amber-500" aria-label="Flagged for review" />
                      )}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <ChannelIcon channel={m.channel} />
                      <span>{tv(m.channel)}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-foreground">{m.customerId}</td>
                  <td className="whitespace-nowrap px-3 py-2.5">
                    {m.agentName ? (
                      <span className="inline-flex items-center gap-1.5 text-foreground" title={`Handed over to agent ${m.agentName}`}>
                        <UserRound className="size-3.5 text-accent" />
                        {m.agentName}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-muted-foreground" title="Handled by the bot — no agent handover">
                        <Bot className="size-3.5" />
                        {t("mft.bot")}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-muted-foreground max-w-[200px] truncate" title={m.text}>
                    {m.text}
                  </td>
                  <td className="px-3 py-2.5">
                    <Pill color={INTENT_COLORS[m.intent]}>{tv(m.intent)}</Pill>
                  </td>
                  <td className="px-3 py-2.5">
                    <Pill color={SENTIMENT_COLORS[m.sentiment]} solid>
                      {tv(m.sentiment)}
                    </Pill>
                  </td>
                  <td className="px-3 py-2.5 tabular-nums text-foreground">
                    {m.confidence}%
                  </td>
                  <td className="px-3 py-2.5 text-muted-foreground">{tv(m.zone)}</td>
                  <td className="px-3 py-2.5 text-muted-foreground">{tv(m.timeOfDay)}</td>
                  <td className="px-3 py-2.5">
                    {getStatus(m.id).flagged ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-semibold text-amber-500">
                        <Flag className="size-3 fill-current" />
                        {t("col.flagged")}
                      </span>
                    ) : (
                      <span className="text-muted-foreground/50">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    {getStatus(m.id).resolved ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-positive/15 px-2 py-0.5 text-xs font-semibold text-positive">
                        <CheckCircle2 className="size-3" />
                        {t("col.resolved")}
                      </span>
                    ) : (
                      <span className="text-muted-foreground/50">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <button
                      onClick={() => setActive(m)}
                      className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium text-accent transition-colors hover:bg-accent/10"
                    >
                      {t("table.view")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {filteredRows.length === 0
              ? t("table.noMessages")
              : t("mft.pageRange", { from: pageStart + 1, to: Math.min(pageStart + PAGE_SIZE, filteredRows.length), total: filteredRows.length.toLocaleString() })}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(Math.max(0, safePage - 1))}
              disabled={safePage === 0}
              className="flex size-7 items-center justify-center rounded-md border border-border disabled:opacity-40"
              aria-label={t("a11y.prevPage")}
            >
              <ChevronLeft className="size-4 rtl:-scale-x-100" />
            </button>
            <span className="px-2 tabular-nums">
              {safePage + 1} / {totalPages}
            </span>
            <button
              onClick={() => setPage(Math.min(totalPages - 1, safePage + 1))}
              disabled={safePage >= totalPages - 1}
              className="flex size-7 items-center justify-center rounded-md border border-border disabled:opacity-40"
              aria-label={t("a11y.nextPage")}
            >
              <ChevronRight className="size-4 rtl:-scale-x-100" />
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
