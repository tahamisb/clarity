"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react"

// ---------------------------------------------------------------------------
// App-wide settings — persisted to localStorage and shared across every page.
// This is the single source of truth that the Settings page writes to and that
// the dashboards read from (auto-refresh cadence, SLA targets, alert thresholds).
// ---------------------------------------------------------------------------

export type AppSettings = {
  /** Auto-refresh cadence for the data dashboards, in seconds. 0 = off. */
  refreshIntervalSec: number

  // SLA & alert configuration
  chatSlaHours: number
  generalSlaHours: number
  /** Alert when a zone's cancellation rate (%) exceeds this. */
  cancelThresholdPct: number
  /** Alert when negative sentiment jumps by more than this (percentage points). */
  sentimentSpikePct: number
  slackAlerts: boolean
  emailAlerts: boolean

  // ML tuning
  confidencePct: number

  // Appearance
  language: "en" | "ar"
}

export const DEFAULT_SETTINGS: AppSettings = {
  refreshIntervalSec: 120,
  chatSlaHours: 4,
  generalSlaHours: 24,
  cancelThresholdPct: 8,
  sentimentSpikePct: 15,
  slackAlerts: true,
  emailAlerts: false,
  confidencePct: 65,
  language: "en",
}

const STORAGE_KEY = "rafeeq.settings.v1"

/** Refresh-interval options surfaced in the Settings UI. */
export const REFRESH_OPTIONS: { label: string; value: number }[] = [
  { label: "Off", value: 0 },
  { label: "30s", value: 30 },
  { label: "1 min", value: 60 },
  { label: "2 min", value: 120 },
  { label: "5 min", value: 300 },
  { label: "10 min", value: 600 },
]

type SettingsContextValue = {
  settings: AppSettings
  /** Whether settings have been loaded from localStorage yet (avoids SSR flash). */
  hydrated: boolean
  update: (patch: Partial<AppSettings>) => void
  reset: () => void
}

const SettingsContext = createContext<SettingsContextValue | null>(null)

function loadStored(): AppSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_SETTINGS
    const parsed = JSON.parse(raw) as Partial<AppSettings>
    // Merge so newly-added settings keys always have a sane default.
    return { ...DEFAULT_SETTINGS, ...parsed }
  } catch {
    return DEFAULT_SETTINGS
  }
}

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)
  const [hydrated, setHydrated] = useState(false)

  // Load persisted settings on mount (client only).
  useEffect(() => {
    setSettings(loadStored())
    setHydrated(true)
  }, [])

  // Persist on every change once hydrated, and keep other tabs in sync.
  useEffect(() => {
    if (!hydrated) return
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
    } catch {
      /* storage may be unavailable (private mode) — non-fatal */
    }
  }, [settings, hydrated])

  // Sync across browser tabs.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setSettings(loadStored())
    }
    window.addEventListener("storage", onStorage)
    return () => window.removeEventListener("storage", onStorage)
  }, [])

  const update = useCallback((patch: Partial<AppSettings>) => {
    setSettings((s) => ({ ...s, ...patch }))
  }, [])

  const reset = useCallback(() => setSettings(DEFAULT_SETTINGS), [])

  return (
    <SettingsContext.Provider value={{ settings, hydrated, update, reset }}>
      {children}
    </SettingsContext.Provider>
  )
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext)
  if (!ctx) throw new Error("useSettings must be used within a SettingsProvider")
  return ctx
}

// ---------------------------------------------------------------------------
// useAutoRefresh — invokes `callback` on the cadence configured in settings.
// The callback is held in a ref so the interval is only re-created when the
// cadence itself changes (not on every render / data change).
// ---------------------------------------------------------------------------
export function useAutoRefresh(callback: () => void) {
  const { settings } = useSettings()
  const cbRef = useRef(callback)
  cbRef.current = callback

  const seconds = settings.refreshIntervalSec

  useEffect(() => {
    if (!seconds || seconds <= 0) return
    const id = window.setInterval(() => cbRef.current(), seconds * 1000)
    return () => window.clearInterval(id)
  }, [seconds])

  return seconds
}
