"use client"

import { createContext, useContext, useEffect, useMemo, useState } from "react"
import {
  DEFAULT_TIME_RANGE,
  isTimeRange,
  rangeParams,
  type TimeRange,
} from "./time-range"

// ---------------------------------------------------------------------------
// App-wide time-range filter — the single source of truth shared by every
// dashboard (calls, messages, cancellations, CX). Persisted to localStorage
// and synced across tabs, mirroring the settings context.
//
// Pages consume it two ways:
//   • range            → client-side filtering of record lists (filterByRange)
//   • params/queryKey  → re-fetch server-aggregated endpoints when it changes
// ---------------------------------------------------------------------------

const STORAGE_KEY = "rafeeq.timeRange.v1"

type TimeFilterContextValue = {
  range: TimeRange
  setRange: (r: TimeRange) => void
  /** Backend query params for the current range ({} for "all"). */
  params: { start?: string; end?: string }
  /** Stable string key for the current range — use in fetch effect deps. */
  queryKey: string
  /** Whether the persisted value has loaded (avoids an SSR/first-paint flash). */
  hydrated: boolean
}

const TimeFilterContext = createContext<TimeFilterContextValue | null>(null)

function loadStored(): TimeRange {
  if (typeof window === "undefined") return DEFAULT_TIME_RANGE
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return isTimeRange(raw) ? raw : DEFAULT_TIME_RANGE
  } catch {
    return DEFAULT_TIME_RANGE
  }
}

export function TimeFilterProvider({ children }: { children: React.ReactNode }) {
  const [range, setRange] = useState<TimeRange>(DEFAULT_TIME_RANGE)
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    setRange(loadStored())
    setHydrated(true)
  }, [])

  useEffect(() => {
    if (!hydrated) return
    try {
      window.localStorage.setItem(STORAGE_KEY, range)
    } catch {
      /* storage may be unavailable (private mode) — non-fatal */
    }
  }, [range, hydrated])

  // Keep other tabs in sync.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && isTimeRange(e.newValue)) setRange(e.newValue)
    }
    window.addEventListener("storage", onStorage)
    return () => window.removeEventListener("storage", onStorage)
  }, [])

  const value = useMemo<TimeFilterContextValue>(() => {
    const params = rangeParams(range)
    return {
      range,
      setRange,
      params,
      queryKey: `${params.start ?? ""}|${params.end ?? ""}`,
      hydrated,
    }
  }, [range, hydrated])

  return <TimeFilterContext.Provider value={value}>{children}</TimeFilterContext.Provider>
}

export function useTimeFilter(): TimeFilterContextValue {
  const ctx = useContext(TimeFilterContext)
  if (!ctx) throw new Error("useTimeFilter must be used within a TimeFilterProvider")
  return ctx
}
