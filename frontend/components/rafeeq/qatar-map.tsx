"use client"

import { useMemo } from "react"
import dynamic from "next/dynamic"
import { Loader2 } from "lucide-react"
import { QATAR_CITIES, type CallRecord } from "@/lib/rafeeq-data"
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

const CITY_COLORS: Record<string, string> = {
  Doha:        "#9b4dff",
  "Al Rayyan": "#f5a623",
  "Al Wakrah": "#22c55e",
  Lusail:      "#3b82f6",
  "Al Khor":   "#06b6d4",
  "Umm Salal": "#ec4899",
  Mesaieed:    "#22c55e",
  Dukhan:      "#ef4444",
}

export function QatarMap({ calls }: { calls: CallRecord[] }) {
  // Aggregate live call counts per city
  const cityCounts = useMemo(() => {
    const map: Record<string, number> = {}
    for (const c of calls) map[c.city] = (map[c.city] || 0) + 1
    return map
  }, [calls])

  // Build the marker set from the known Qatar city coordinates
  const cities = useMemo<MapCity[]>(
    () =>
      QATAR_CITIES.map((c) => ({
        name: c.name,
        lat: c.lat,
        lon: c.lon,
        calls: cityCounts[c.name] ?? 0,
        color: CITY_COLORS[c.name] ?? "#9b4dff",
      })),
    [cityCounts],
  )

  const totalCalls = calls.length

  const listedCities = useMemo(
    () => cities.filter((c) => c.calls > 0).sort((a, b) => b.calls - a.calls).slice(0, 8),
    [cities],
  )

  return (
    <div className="glass overflow-hidden rounded-2xl">
      <div className="grid gap-6 p-5 md:grid-cols-[260px_1fr] md:gap-0 md:p-0">

        {/* Left info panel */}
        <div className="flex flex-col gap-6 font-mono text-foreground select-none md:p-6">
          <div>
            <p className="text-[10px] tracking-widest text-muted-foreground">CALL ORIGINS — QATAR</p>
            <p className="text-[10px] tracking-widest text-muted-foreground">[STATE OF QATAR · 2026]</p>
          </div>

          <div>
            <p className="text-[10px] tracking-widest text-muted-foreground">TOTAL CALLS</p>
            <p className="mt-1 text-3xl font-bold tracking-tight md:text-4xl">
              {totalCalls.toLocaleString()}
            </p>
            {totalCalls === 0 && (
              <p className="mt-1 text-[11px] text-muted-foreground">Upload transcripts to populate</p>
            )}
          </div>

          <div>
            <p className="text-[10px] tracking-widest text-muted-foreground">TOP CITIES BY CALLS</p>
            {listedCities.length === 0 ? (
              <p className="mt-2 text-[11px] text-muted-foreground">No city data yet</p>
            ) : (
              <ul className="mt-2 space-y-1.5 text-xs">
                {listedCities.map((c) => (
                  <li key={c.name} className="flex items-center gap-2">
                    <span
                      className="inline-block size-2 shrink-0 rounded-full"
                      style={{ background: c.color }}
                    />
                    <span className="w-24 shrink-0 text-foreground">{c.name}</span>
                    <span className="ml-auto tabular-nums text-muted-foreground">
                      {c.calls.toLocaleString()}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <p className="text-[10px] leading-relaxed tracking-wide text-muted-foreground">
            Marker size scales with call volume. Hover a city for its exact count.
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
