"use client"

import { Fragment, useEffect, useMemo } from "react"
import { useTheme } from "next-themes"
import {
  MapContainer,
  TileLayer,
  CircleMarker,
  Tooltip,
  useMap,
} from "react-leaflet"
import L from "leaflet"
import "leaflet/dist/leaflet.css"

export type MapCity = {
  name: string
  lat: number
  lon: number
  calls: number
  color: string
}

// Qatar bounding box — keeps the view locked on the country
const QATAR_CENTER: [number, number] = [25.33, 51.22]
const QATAR_BOUNDS: [[number, number], [number, number]] = [
  [24.4, 50.6],
  [26.3, 51.85],
]

// Re-fit the map to whichever cities actually have calls, so the view always
// frames the live data rather than a hardcoded zoom.
function FitToData({ cities }: { cities: MapCity[] }) {
  const map = useMap()

  useEffect(() => {
    const active = cities.filter((c) => c.calls > 0)
    if (active.length === 0) {
      map.setView(QATAR_CENTER, 8)
      return
    }
    if (active.length === 1) {
      map.setView([active[0].lat, active[0].lon], 10)
      return
    }
    const bounds = L.latLngBounds(active.map((c) => [c.lat, c.lon] as [number, number]))
    map.fitBounds(bounds, { padding: [56, 56], maxZoom: 11 })
  }, [cities, map])

  return null
}

export default function QatarMapLeaflet({ cities }: { cities: MapCity[] }) {
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme !== "light"

  // CartoDB basemaps — dark/light variants matched to the dashboard theme
  const tileUrl = isDark
    ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
    : "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"

  const maxCalls = useMemo(
    () => Math.max(1, ...cities.map((c) => c.calls)),
    [cities],
  )

  // Pixel radius scaled by call volume (sqrt keeps small cities visible)
  const radiusFor = (calls: number) =>
    9 + (Math.sqrt(calls) / Math.sqrt(maxCalls)) * 22

  const active = cities.filter((c) => c.calls > 0)

  return (
    <MapContainer
      center={QATAR_CENTER}
      zoom={8}
      minZoom={7}
      maxZoom={13}
      maxBounds={QATAR_BOUNDS}
      maxBoundsViscosity={0.9}
      scrollWheelZoom={false}
      zoomControl
      attributionControl
      className="h-full w-full"
      style={{ background: isDark ? "#0d0619" : "#eef2f6" }}
    >
      <TileLayer
        key={isDark ? "dark" : "light"}
        url={tileUrl}
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
        subdomains="abcd"
        maxZoom={20}
      />

      <FitToData cities={cities} />

      {active.map((c) => {
        const r = radiusFor(c.calls)
        return (
          <Fragment key={c.name}>
            {/* Soft outer glow */}
            <CircleMarker
              center={[c.lat, c.lon]}
              radius={r * 1.9}
              pathOptions={{
                color: "transparent",
                fillColor: c.color,
                fillOpacity: 0.12,
              }}
              interactive={false}
            />
            {/* Solid core marker */}
            <CircleMarker
              center={[c.lat, c.lon]}
              radius={r}
              pathOptions={{
                color: isDark ? "#ffffff" : "#1a1226",
                weight: 1.5,
                fillColor: c.color,
                fillOpacity: 0.85,
              }}
            >
              <Tooltip direction="top" offset={[0, -r]} opacity={1} sticky>
                <span style={{ fontWeight: 700 }}>{c.name}</span>
                <br />
                {c.calls.toLocaleString()} call{c.calls !== 1 ? "s" : ""}
              </Tooltip>
            </CircleMarker>
          </Fragment>
        )
      })}
    </MapContainer>
  )
}
