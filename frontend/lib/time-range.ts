// ---------------------------------------------------------------------------
// Shared time-range filtering for charts/tables across the whole app.
//
//   wtd → Monday of the current ISO week through today
//   mtd → 1st of the current month through today (default)
//   qtd → 1st of the current quarter through today
//   ytd → Jan 1 of the current year through today
//   all → everything
//
// Two consumption styles:
//   • Client-side  → filterByRange() / rangeStart() on records that carry a date.
//   • Server-side  → rangeParams() yields { start, end } ISO-date strings to send
//                    to the backend analytics endpoints that pre-aggregate data.
// ---------------------------------------------------------------------------

export type TimeRange = "wtd" | "mtd" | "qtd" | "ytd" | "all"

export const TIME_RANGES: { value: TimeRange; label: string; short: string }[] = [
  { value: "wtd", label: "Week to date", short: "WTD" },
  { value: "mtd", label: "Month to date", short: "MTD" },
  { value: "qtd", label: "Quarter to date", short: "QTD" },
  { value: "ytd", label: "Year to date", short: "YTD" },
  { value: "all", label: "All time", short: "All" },
]

export const DEFAULT_TIME_RANGE: TimeRange = "mtd"

export function isTimeRange(v: unknown): v is TimeRange {
  return typeof v === "string" && TIME_RANGES.some((r) => r.value === v)
}

/** Local Monday-of-week (ISO weeks start Monday). */
function startOfWeek(now: Date): Date {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const dow = (d.getDay() + 6) % 7 // Mon=0 … Sun=6
  d.setDate(d.getDate() - dow)
  return d
}

/** Inclusive lower bound (epoch ms) for a range. 0 = no lower bound (all time). */
export function rangeStart(range: TimeRange, now: Date = new Date()): number {
  switch (range) {
    case "wtd":
      return startOfWeek(now).getTime()
    case "mtd":
      return new Date(now.getFullYear(), now.getMonth(), 1).getTime()
    case "qtd":
      return new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1).getTime()
    case "ytd":
      return new Date(now.getFullYear(), 0, 1).getTime()
    default:
      return 0
  }
}

/** Local YYYY-MM-DD (avoids the UTC shift that toISOString would introduce). */
function toDateStr(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

/**
 * Backend query params for a range. `all` → empty (no bounds), so the server
 * returns its full aggregation. Otherwise an inclusive [start, end] date window.
 */
export function rangeParams(
  range: TimeRange,
  now: Date = new Date(),
): { start?: string; end?: string } {
  if (range === "all") return {}
  return { start: toDateStr(new Date(rangeStart(range, now))), end: toDateStr(now) }
}

/** Append `start`/`end` to a query string for the given range. */
export function rangeQuery(range: TimeRange, now: Date = new Date()): string {
  const { start, end } = rangeParams(range, now)
  const parts: string[] = []
  if (start) parts.push(`start=${start}`)
  if (end) parts.push(`end=${end}`)
  return parts.length ? `&${parts.join("&")}` : ""
}

/** Parse the app's "YYYY-MM-DD HH:mm" / ISO-ish date strings to epoch ms. */
export function parseRecordDate(value: string | null | undefined): number {
  if (!value) return NaN
  return new Date(value.replace(" ", "T")).getTime()
}

/**
 * Parse a cancellation-trend `period` to epoch ms. The backend emits
 *   monthly → FORMAT_DATE('%Y-%m')   e.g. "2021-03"
 *   weekly  → FORMAT_DATE('%G-W%V')  e.g. "2021-W03"  (ISO week-year + week)
 * `new Date()` can't read the ISO-week form, which is why a naive parse failed.
 */
export function parseCancellationPeriod(period: string | null | undefined): number {
  if (!period) return NaN

  const monthly = /^(\d{4})-(\d{2})$/.exec(period)
  if (monthly) return new Date(Number(monthly[1]), Number(monthly[2]) - 1, 1).getTime()

  const weekly = /^(\d{4})-W(\d{2})$/.exec(period)
  if (weekly) {
    const year = Number(weekly[1])
    const week = Number(weekly[2])
    // ISO-8601: week 1 holds the year's first Thursday; weeks start Monday.
    const jan4 = new Date(Date.UTC(year, 0, 4))
    const jan4Dow = (jan4.getUTCDay() + 6) % 7 // Mon=0 … Sun=6
    const monday = new Date(jan4)
    monday.setUTCDate(jan4.getUTCDate() - jan4Dow + (week - 1) * 7)
    return monday.getTime()
  }

  return new Date(period).getTime()
}

/**
 * Filter a list of records by a date accessor against the selected range.
 * Records with an unparseable date are kept (so partial data never vanishes),
 * and "all" returns the list untouched.
 */
export function filterByRange<T>(
  rows: T[],
  range: TimeRange,
  getDate: (row: T) => string | null | undefined,
  now: Date = new Date(),
): T[] {
  if (range === "all") return rows
  const start = rangeStart(range, now)
  return rows.filter((r) => {
    const ts = parseRecordDate(getDate(r))
    return Number.isNaN(ts) || ts >= start
  })
}

/** Same as filterByRange but for cancellation trend `period` strings. */
export function filterTrendByRange<T extends { period: string }>(
  rows: T[],
  range: TimeRange,
  now: Date = new Date(),
): T[] {
  if (range === "all") return rows
  const start = rangeStart(range, now)
  return rows.filter((r) => {
    const ts = parseCancellationPeriod(r.period)
    return Number.isNaN(ts) || ts >= start
  })
}
