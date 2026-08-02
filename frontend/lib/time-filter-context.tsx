"use client"

import { createContext, useContext, useEffect, useMemo, useState } from "react"
import {
  DEFAULT_TIME_RANGE,
  parseRange,
  rangeParams,
  serializeRange,
  type TimeRange,
} from "./time-range"
import { DEFAULT_VERTICAL, parseVertical, verticalParam, type VerticalFilter } from "./verticals"

// ---------------------------------------------------------------------------
// App-wide global filters — time range + business vertical — the single source
// of truth shared by every dashboard (calls, messages, cancellations, CX).
// Persisted to localStorage and synced across tabs, mirroring the settings
// context.
//
// Pages consume it two ways:
//   • range/vertical   → client-side filtering of record lists
//   • params/queryKey  → re-fetch server-aggregated endpoints when it changes
// ---------------------------------------------------------------------------

const STORAGE_KEY = "clarity.timeRange.v1"
const VERTICAL_KEY = "clarity.vertical.v1"

type TimeFilterContextValue = {
  range: TimeRange
  setRange: (r: TimeRange) => void
  vertical: VerticalFilter
  setVertical: (v: VerticalFilter) => void
  /** Backend query params for the current filters ({} for "all"). */
  params: { start?: string; end?: string; vertical?: string }
  /** Stable string key for the current filters — use in fetch effect deps. */
  queryKey: string
  /** Whether the persisted value has loaded (avoids an SSR/first-paint flash). */
  hydrated: boolean
}

const TimeFilterContext = createContext<TimeFilterContextValue | null>(null)

function loadStored(): TimeRange {
  if (typeof window === "undefined") return DEFAULT_TIME_RANGE
  try {
    return parseRange(window.localStorage.getItem(STORAGE_KEY)) ?? DEFAULT_TIME_RANGE
  } catch {
    return DEFAULT_TIME_RANGE
  }
}

function loadStoredVertical(): VerticalFilter {
  if (typeof window === "undefined") return DEFAULT_VERTICAL
  try {
    return parseVertical(window.localStorage.getItem(VERTICAL_KEY)) ?? DEFAULT_VERTICAL
  } catch {
    return DEFAULT_VERTICAL
  }
}

export function TimeFilterProvider({ children }: { children: React.ReactNode }) {
  const [range, setRange] = useState<TimeRange>(DEFAULT_TIME_RANGE)
  const [vertical, setVertical] = useState<VerticalFilter>(DEFAULT_VERTICAL)
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    setRange(loadStored())
    setVertical(loadStoredVertical())
    setHydrated(true)
  }, [])

  useEffect(() => {
    if (!hydrated) return
    try {
      window.localStorage.setItem(STORAGE_KEY, serializeRange(range))
      window.localStorage.setItem(VERTICAL_KEY, vertical)
    } catch {
      /* storage may be unavailable (private mode) — non-fatal */
    }
  }, [range, vertical, hydrated])

  // Keep other tabs in sync.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) {
        const parsed = parseRange(e.newValue)
        if (parsed) setRange(parsed)
      } else if (e.key === VERTICAL_KEY) {
        const parsed = parseVertical(e.newValue)
        if (parsed) setVertical(parsed)
      }
    }
    window.addEventListener("storage", onStorage)
    return () => window.removeEventListener("storage", onStorage)
  }, [])

  const value = useMemo<TimeFilterContextValue>(() => {
    const params = { ...rangeParams(range), vertical: verticalParam(vertical) }
    return {
      range,
      setRange,
      vertical,
      setVertical,
      params,
      queryKey: `${params.start ?? ""}|${params.end ?? ""}|${params.vertical ?? ""}`,
      hydrated,
    }
  }, [range, vertical, hydrated])

  return <TimeFilterContext.Provider value={value}>{children}</TimeFilterContext.Provider>
}

export function useTimeFilter(): TimeFilterContextValue {
  const ctx = useContext(TimeFilterContext)
  if (!ctx) throw new Error("useTimeFilter must be used within a TimeFilterProvider")
  return ctx
}
