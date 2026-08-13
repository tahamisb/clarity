// ---------------------------------------------------------------------------
// The app's clock — real time, or pinned to a fixed instant.
//
// Every calendar control (WTD/MTD/QTD/YTD, the range picker) resolves against
// this, and the resulting window is sent to the backend. So this has to agree
// with the backend's clock: if it does not, the frontend asks for a window the
// backend has no data for and the charts come back empty for no visible reason.
//
// Which mode applies depends on which warehouse is behind the deploy:
//
//   simulated Postgres warehouse → live. It runs up to the present, so the
//     dashboard should too. This is the default.
//   frozen SQLite snapshot → pinned. Its data stops on a fixed day, so "now"
//     must be that day. Set NEXT_PUBLIC_CLOCK_FROZEN_AT to switch.
//
// The two services are configured together — see docker-compose.warehouse.yml
// — so the modes cannot drift apart by accident. GET /api/v1/health reports the
// backend's clock if you need to confirm.
//
// Backend twin: backend/app/utils/clock.py
// ---------------------------------------------------------------------------

/**
 * Instant to pin "now" to, or "" for the real clock. Inlined at build time by
 * Next (NEXT_PUBLIC_*), so changing it needs a rebuild, not a restart.
 */
export const FROZEN_AT = process.env.NEXT_PUBLIC_CLOCK_FROZEN_AT ?? ""

export const IS_FROZEN = FROZEN_AT !== ""

export function now(): Date {
  return IS_FROZEN ? new Date(FROZEN_AT) : new Date()
}

/** Local YYYY-MM-DD for today — for filenames and date inputs. */
export function todayStr(): string {
  const d = now()
  // Built from local parts rather than toISOString(), which converts to UTC
  // and hands back yesterday's date for anyone east of Greenwich after
  // midnight — Doha included, for three hours every night.
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
