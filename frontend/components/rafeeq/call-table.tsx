"use client"

import { useEffect, useState } from "react"
import { ChevronLeft, ChevronRight, FileText, FilterX } from "lucide-react"
import {
  CallRecord,
  CATEGORY_COLORS,
  HELPFULNESS_COLORS,
  CUSTOMER_BEHAVIOR_COLORS,
  SENTIMENT_COLORS,
  formatDuration,
} from "@/lib/rafeeq-data"
import { Panel } from "./panel"
import { CallDetailModal } from "./call-detail-modal"
import { ColumnFilter, useColumnFilters, type ColumnDef } from "./column-filter"
import { useT, useTV } from "@/lib/i18n"

const PAGE_SIZE = 10

// Categorical columns get an Excel-style dropdown filter. Module-level so the
// reference is stable across renders (required by useColumnFilters).
const CALL_FILTER_COLUMNS: ColumnDef<CallRecord>[] = [
  { id: "agent", accessor: (c) => c.agent },
  { id: "city", accessor: (c) => c.city },
  { id: "category", accessor: (c) => c.category },
  { id: "sentiment", accessor: (c) => c.sentiment },
  { id: "helpfulness", accessor: (c) => c.agentHelpfulness },
  { id: "mood", accessor: (c) => c.customerBehavior },
]

export function CallTable({
  calls,
  activeLabel,
}: {
  calls: CallRecord[]
  activeLabel?: string | null
}) {
  const t = useT()
  const tv = useTV()
  const [page, setPage] = useState(0)
  const [active, setActive] = useState<CallRecord | null>(null)

  const { filteredRows, distinct, selected, setSelected, clearAll, anyActive } = useColumnFilters(
    calls,
    CALL_FILTER_COLUMNS,
  )
  const filtered = filteredRows
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))

  // Reset to first page whenever the filtered result set changes
  useEffect(() => {
    setPage(0)
  }, [filtered.length])

  const safePage = Math.min(page, totalPages - 1)
  const pageStart = safePage * PAGE_SIZE
  const rows = filtered.slice(pageStart, pageStart + PAGE_SIZE)

  return (
    <>
      <Panel
        title={t("table.analyzedCalls")}
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
            {activeLabel ? (
              <span className="rounded-full bg-accent/15 px-2.5 py-1 text-xs font-semibold text-accent">
                {tv(activeLabel)}
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">
                {t("table.callsCount", { n: filtered.length.toLocaleString() })}
              </span>
            )}
          </span>
        }
      >
        <div className="-mx-2 overflow-x-auto">
          <table className="w-full min-w-[1080px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2 font-semibold">{t("col.callId")}</th>
                <th className="px-3 py-2 font-semibold">{t("col.dateTime")}</th>
                <th className="px-3 py-2 font-semibold">{t("col.duration")}</th>
                <th className="whitespace-nowrap px-3 py-2 font-semibold">
                  {t("col.agent")}
                  <ColumnFilter label={t("col.agent")} values={distinct.agent} selected={selected.agent ?? null} onChange={(n) => setSelected("agent", n)} />
                </th>
                <th className="whitespace-nowrap px-3 py-2 font-semibold">
                  {t("col.city")}
                  <ColumnFilter label={t("col.city")} values={distinct.city} selected={selected.city ?? null} onChange={(n) => setSelected("city", n)} />
                </th>
                <th className="whitespace-nowrap px-3 py-2 font-semibold">
                  {t("col.category")}
                  <ColumnFilter label={t("col.category")} values={distinct.category} selected={selected.category ?? null} onChange={(n) => setSelected("category", n)} />
                </th>
                <th className="whitespace-nowrap px-3 py-2 font-semibold">
                  {t("col.sentiment")}
                  <ColumnFilter label={t("col.sentiment")} values={distinct.sentiment} selected={selected.sentiment ?? null} onChange={(n) => setSelected("sentiment", n)} />
                </th>
                <th className="whitespace-nowrap px-3 py-2 font-semibold">
                  {t("col.helpfulness")}
                  <ColumnFilter label={t("col.helpfulness")} values={distinct.helpfulness} selected={selected.helpfulness ?? null} onChange={(n) => setSelected("helpfulness", n)} />
                </th>
                <th className="whitespace-nowrap px-3 py-2 font-semibold">
                  {t("col.customerMood")}
                  <ColumnFilter label={t("col.customerMood")} values={distinct.mood} selected={selected.mood ?? null} onChange={(n) => setSelected("mood", n)} />
                </th>
                <th className="px-3 py-2 font-semibold">{t("col.confidence")}</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr
                  key={c.id}
                  className="border-b border-border/60 transition-colors hover:bg-secondary/50"
                >
                  <td className="px-3 py-2.5 font-mono text-xs text-foreground">
                    {c.id}
                  </td>
                  <td className="px-3 py-2.5 text-muted-foreground">
                    {c.datetime}
                  </td>
                  <td className="px-3 py-2.5 tabular-nums text-muted-foreground">
                    {formatDuration(c.durationSec)}
                  </td>
                  <td className="px-3 py-2.5 text-foreground">{c.agent}</td>
                  <td className="px-3 py-2.5 text-muted-foreground">{c.city}</td>
                  <td className="px-3 py-2.5">
                    <Pill color={CATEGORY_COLORS[c.category]}>{tv(c.category)}</Pill>
                  </td>
                  <td className="px-3 py-2.5">
                    <Pill color={SENTIMENT_COLORS[c.sentiment]} solid>
                      {tv(c.sentiment)}
                    </Pill>
                  </td>
                  <td className="px-3 py-2.5">
                    <Pill color={HELPFULNESS_COLORS[c.agentHelpfulness]}>
                      {tv(c.agentHelpfulness)}
                    </Pill>
                  </td>
                  <td className="px-3 py-2.5">
                    <Pill color={CUSTOMER_BEHAVIOR_COLORS[c.customerBehavior]}>
                      {tv(c.customerBehavior)}
                    </Pill>
                  </td>
                  <td className="px-3 py-2.5 tabular-nums text-foreground">
                    {c.confidence}%
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <button
                      onClick={() => setActive(c)}
                      className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium text-accent transition-colors hover:bg-accent/10"
                    >
                      <FileText className="size-3.5" />
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
            {filtered.length === 0
              ? t("table.noCalls")
              : t("table.callsPage", { from: pageStart + 1, to: Math.min(pageStart + PAGE_SIZE, filtered.length), total: filtered.length.toLocaleString() })}
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
        <CallDetailModal call={active} onClose={() => setActive(null)} />
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
