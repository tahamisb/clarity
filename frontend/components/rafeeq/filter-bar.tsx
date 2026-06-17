"use client"

import { Download, RotateCcw } from "lucide-react"
import { Dropdown } from "./dropdown"

export type CallFilters = {
  category: string | null
  sentiment: string | null
  agent: string | null
}

export function FilterBar({
  filters,
  categories,
  sentiments,
  agents,
  resultCount,
  onChange,
  onReset,
  onExport,
}: {
  filters: CallFilters
  categories: string[]
  sentiments: string[]
  agents: string[]
  resultCount: number
  onChange: (next: CallFilters) => void
  onReset: () => void
  onExport: () => void
}) {
  const hasActive =
    filters.category !== null ||
    filters.sentiment !== null ||
    filters.agent !== null

  return (
    <div className="glass flex flex-wrap items-center gap-2 rounded-2xl p-3">
      <Dropdown
        label="All categories"
        value={filters.category}
        options={categories}
        onChange={(v) => onChange({ ...filters, category: v })}
      />
      <Dropdown
        label="All sentiment"
        value={filters.sentiment}
        options={sentiments}
        onChange={(v) => onChange({ ...filters, sentiment: v })}
      />
      <Dropdown
        label="All agents"
        value={filters.agent}
        options={agents}
        onChange={(v) => onChange({ ...filters, agent: v })}
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
        {resultCount.toLocaleString()} matching calls
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
