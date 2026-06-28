"use client"

import { useEffect, useMemo } from "react"
import dynamic from "next/dynamic"
import { Loader2 } from "lucide-react"
import { type CallRecord } from "@/lib/rafeeq-data"
import { useT, useTV } from "@/lib/i18n"
import type { MapCity } from "./qatar-map-leaflet"

// Leaflet touches `window` at import time, so the map is loaded client-side only.
const QatarMapLeaflet = dynamic(() => import("./qatar-map-leaflet"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-brand-deep/10">
      <Loader2 className="size-6 animate-spin text-accent" />
    </div>
  ),
})

// Gazetteer of every Qatar zone/district seen in the call `city` column. Markers
// are driven by these names, so any zone in the data lands on the map with its
// real count. Add a `Name: [lat, lon]` line to plot a new zone — unmapped names
// surface in the panel (see `unmapped`) so they're never silently dropped.
const ZONE_COORDS: Record<string, [number, number]> = {
  Doha: [25.286, 51.533],
  Msheireb: [25.287, 51.527],
  "Bin Mahmoud": [25.281, 51.515],
  "Al Sadd": [25.279, 51.49],
  "Al Waab": [25.262, 51.472],
  "Old Airport": [25.255, 51.56],
  Dafna: [25.318, 51.531],
  "West Bay": [25.327, 51.529],
  "The Pearl": [25.369, 51.548],
  "Al Duhail": [25.345, 51.47],
  "Madinat Khalifa": [25.317, 51.487],
  "Al Gharrafa": [25.335, 51.43],
  Lusail: [25.43, 51.491],
  "Al Rayyan": [25.292, 51.424],
  "Al Wakra": [25.171, 51.603],
  "Al Khor": [25.684, 51.498],
  "Umm Salal": [25.415, 51.4],
  Mesaieed: [24.99, 51.55],
  Dukhan: [25.43, 50.78],
}

// Alternate spellings → canonical zone name, so counts merge instead of splitting.
const ZONE_ALIASES: Record<string, string> = {
  musheireb: "Msheireb",
  msheireb: "Msheireb",
  "al wakrah": "Al Wakra",
  wakra: "Al Wakra",
  "umm salal ali": "Umm Salal",
  "umm salal muhammed": "Umm Salal",
  "the pearl qatar": "The Pearl",
  pearl: "The Pearl",
}

function canonicalName(raw: string): string | null {
  const key = (raw ?? "").trim()
  if (!key || key.toLowerCase() === "qatar") return null
  const canon = ZONE_ALIASES[key.toLowerCase()] ?? key
  return canon in ZONE_COORDS ? canon : null
}

// Vibrant, distinct marker colours assigned by volume rank so the palette stays
// stable across refreshes and the legend dots match the map.
const PALETTE = [
  "#a855f7", "#3b82f6", "#06b6d4", "#22c55e", "#eab308", "#f97316",
  "#ef4444", "#ec4899", "#14b8a6", "#0ea5e9", "#84cc16", "#f59e0b",
  "#f43f5e", "#8b5cf6", "#10b981", "#fb7185",
]

export function QatarMap({ calls }: { calls: CallRecord[] }) {
  const t = useT()
  const tv = useTV()

  // Re-derived on every refresh: each distinct zone in the data becomes a marker
  // with its real count; unknown names are surfaced rather than dropped.
  const { cities, unmapped } = useMemo(() => {
    const counts: Record<string, number> = {}
    const unknown: Record<string, number> = {}
    for (const c of calls) {
      const name = canonicalName(c.city)
      if (name) counts[name] = (counts[name] ?? 0) + 1
      else if (c.city && c.city.trim().toLowerCase() !== "qatar")
        unknown[c.city] = (unknown[c.city] ?? 0) + 1
    }

    const cities: MapCity[] = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count], i) => {
        const [lat, lon] = ZONE_COORDS[name]
        return { name, lat, lon, calls: count, color: PALETTE[i % PALETTE.length] }
      })

    const unmapped = Object.entries(unknown).sort((a, b) => b[1] - a[1])
    return { cities, unmapped }
  }, [calls])

  useEffect(() => {
    if (unmapped.length) {
      console.warn(
        "[QatarMap] Unmapped zones in data (add to ZONE_COORDS to plot):",
        unmapped.map(([n, c]) => `${n} (${c})`).join(", "),
      )
    }
  }, [unmapped])

  const totalCalls = calls.length

  return (
    <div className="glass overflow-hidden rounded-2xl">
      <div className="grid gap-6 p-5 md:grid-cols-[260px_1fr] md:gap-0 md:p-0">

        {/* Left info panel */}
        <div className="flex flex-col gap-6 font-mono text-foreground select-none md:p-6">
          <div>
            <p className="text-[10px] tracking-widest text-muted-foreground">{t("map.callOrigins")}</p>
            <p className="text-[10px] tracking-widest text-muted-foreground">{t("map.stateQatar")}</p>
          </div>

          <div>
            <p className="text-[10px] tracking-widest text-muted-foreground">{t("map.totalCalls")}</p>
            <p className="mt-1 text-3xl font-bold tracking-tight md:text-4xl">
              {totalCalls.toLocaleString()}
            </p>
            {totalCalls === 0 && (
              <p className="mt-1 text-[11px] text-muted-foreground">{t("map.uploadToPopulate")}</p>
            )}
          </div>

          <div className="min-h-0">
            <p className="text-[10px] tracking-widest text-muted-foreground">{t("map.topCities")}</p>
            {cities.length === 0 ? (
              <p className="mt-2 text-[11px] text-muted-foreground">{t("map.noCityData")}</p>
            ) : (
              <ul className="mt-2 max-h-[260px] space-y-1.5 overflow-y-auto pr-1 text-xs md:max-h-[360px]">
                {cities.map((c) => (
                  <li key={c.name} className="flex items-center gap-2">
                    <span
                      className="inline-block size-2 shrink-0 rounded-full"
                      style={{ background: c.color }}
                    />
                    <span className="min-w-0 flex-1 truncate text-foreground">{tv(c.name)}</span>
                    <span className="ml-auto tabular-nums text-muted-foreground">
                      {c.calls.toLocaleString()}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {unmapped.length > 0 && (
              <p className="mt-3 text-[10px] leading-relaxed tracking-wide text-muted-foreground">
                {t("map.unmapped", { n: unmapped.length })}
                <span className="block truncate text-muted-foreground/70">
                  {unmapped.map(([n, c]) => `${tv(n)} (${c})`).join(" · ")}
                </span>
              </p>
            )}
          </div>

          <p className="text-[10px] leading-relaxed tracking-wide text-muted-foreground">
            {t("map.markerHint")}
          </p>
        </div>

        {/* Leaflet map */}
        <div className="isolate h-[400px] w-full overflow-hidden rounded-xl border border-border md:m-4 md:h-[560px] md:w-auto">
          <QatarMapLeaflet cities={cities} />
        </div>

      </div>
    </div>
  )
}
