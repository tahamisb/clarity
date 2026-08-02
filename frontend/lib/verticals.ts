// Business verticals — mirror of backend app/services/verticals.py.
// Canonical list with historic renames merged (The Stars→Stars, Last Mile
// Delivery→Last Mile, Health & Beauty→Health & Wellness); NULL/junk platform
// values have no vertical and are never offered as a filter.

export const VERTICALS = [
  "Restaurants",
  "Grocery",
  "Market",
  "Health & Wellness",
  "Stars",
  "Flowers",
  "Charity",
  "Last Mile",
  "Pets",
  "Pet Grooming",
  "Events",
  "Salons",
  "OUTLET",
] as const

export type Vertical = (typeof VERTICALS)[number]

/** Global filter value — "all" means no vertical filter. */
export type VerticalFilter = Vertical | "all"

export const DEFAULT_VERTICAL: VerticalFilter = "all"

export const VERTICAL_OPTIONS: VerticalFilter[] = ["all", ...VERTICALS]

export function parseVertical(raw: string | null): VerticalFilter | null {
  return raw && (VERTICAL_OPTIONS as string[]).includes(raw) ? (raw as VerticalFilter) : null
}

/** Backend query-param value ("" for all). */
export function verticalParam(v: VerticalFilter): string | undefined {
  return v === "all" ? undefined : v
}
