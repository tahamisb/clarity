// ---------------------------------------------------------------------------
// Frozen clock — the app treats every real day as the same "today".
//
// The dashboards run on a synthesised dataset that ends on a fixed day, so the
// calendar controls (WTD/MTD/QTD/YTD, the custom range picker) have to be
// anchored there rather than to the wall clock. Otherwise the data would
// silently drift out of the selected window as real days pass.
//
// Backend twin: backend/app/utils/clock.py — keep the two dates in sync.
// ---------------------------------------------------------------------------

/** The dataset's last day, in local time. Every "now" in the app resolves here. */
export const FROZEN_NOW_ISO = "2026-07-28T21:45:00"

export function now(): Date {
  return new Date(FROZEN_NOW_ISO)
}

/** Local YYYY-MM-DD for the frozen day — for filenames and date inputs. */
export function todayStr(): string {
  return FROZEN_NOW_ISO.slice(0, 10)
}
