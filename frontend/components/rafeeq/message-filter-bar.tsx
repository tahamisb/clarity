"use client"

import { Download, RotateCcw } from "lucide-react"
import { Dropdown } from "./dropdown"

export type MessageFilters = {
  channel: string | null
  intent: string | null
  sentiment: string | null
  zone: string | null
  timeOfDay: string | null
}

export function MessageFilterBar({
  filters,
  channels,
  intents,
  sentiments,
  zones,
  timesOfDay,
  resultCount,
  onChange,
  onReset,
  onExport,
}: {
  filters: MessageFilters
  channels: string[]
  intents: string[]
  sentiments: string[]
  zones: string[]
  timesOfDay: string[]
  resultCount: number
  onChange: (next: MessageFilters) => void
  onReset: () => void
  onExport: () => void
}) {
  const hasActive =
    filters.channel !== null ||
    filters.intent !== null ||
    filters.sentiment !== null ||
    filters.zone !== null ||
    filters.timeOfDay !== null

  return (
    <div className="glass flex flex-wrap items-center gap-2 rounded-2xl p-3">
      <Dropdown
        label="All channels"
        value={filters.channel}
        options={channels}
        onChange={(v) => onChange({ ...filters, channel: v })}
      />
      <Dropdown
        label="All intents"
        value={filters.intent}
        options={intents}
        onChange={(v) => onChange({ ...filters, intent: v })}
      />
      <Dropdown
        label="All sentiment"
        value={filters.sentiment}
        options={sentiments}
        onChange={(v) => onChange({ ...filters, sentiment: v })}
      />
      <Dropdown
        label="All zones"
        value={filters.zone}
        options={zones}
        onChange={(v) => onChange({ ...filters, zone: v })}
      />
      <Dropdown
        label="All times"
        value={filters.timeOfDay}
        options={timesOfDay}
        onChange={(v) => onChange({ ...filters, timeOfDay: v })}
      />

      {hasActive && (
        <button
          onClick={onReset}
          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <RotateCcw className="size-3.5" />
          Reset
        </button>
      )}

      <span className="hidden text-xs text-muted-foreground sm:inline">
        {resultCount.toLocaleString()} matching msgs
      </span>

      <button
        onClick={onExport}
        className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-1.5 text-xs font-bold text-primary-foreground shadow-sm transition-transform hover:-translate-y-0.5"
      >
        <Download className="size-3.5" />
        Export CSV
      </button>
    </div>
  )
}
