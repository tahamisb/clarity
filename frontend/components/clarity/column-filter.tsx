"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { Check, Filter, Search } from "lucide-react"
import { cn } from "@/lib/utils"
import { useT, useTV } from "@/lib/i18n"

// ---------------------------------------------------------------------------
// Excel-style per-column filtering.
//
// `useColumnFilters` holds the selection state and derives the distinct values
// + filtered rows. `ColumnFilter` is the funnel button + checkbox popover that
// goes in each <th>. A column's selection is `null` when no filter is applied
// (show all); otherwise it's the set of values to keep.
//
// IMPORTANT: pass a STABLE `columns` array (module constant or useMemo) so the
// memoised derivations don't recompute on every render.
// ---------------------------------------------------------------------------

export type ColumnDef<T> = { id: string; accessor: (row: T) => string }
export type ColumnFilterState = Record<string, Set<string> | null>

/**
 * Apply a column-filter selection to a row set.
 *
 * Exported so a page can run the SAME filter over its charts as the table runs
 * over its rows — otherwise a header filter silently scopes only the table and
 * every other card on the page keeps showing the unfiltered totals.
 *
 * `skip` excludes one column, which is how a column's own dropdown keeps
 * listing every value instead of collapsing to the one already picked.
 */
export function applyColumnFilters<T>(
  rows: T[],
  columns: ColumnDef<T>[],
  selected: ColumnFilterState,
  skip?: string,
): T[] {
  const active = columns.filter((c) => c.id !== skip && selected[c.id] != null)
  if (active.length === 0) return rows
  return rows.filter((r) => active.every((c) => selected[c.id]!.has(String(c.accessor(r)))))
}

/** Distinct values per column, for the dropdowns. */
export function distinctValues<T>(rows: T[], columns: ColumnDef<T>[]): Record<string, string[]> {
  const map: Record<string, string[]> = {}
  for (const col of columns) {
    const set = new Set<string>()
    for (const r of rows) {
      const v = col.accessor(r)
      if (v != null && String(v) !== "") set.add(String(v))
    }
    map[col.id] = Array.from(set).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  }
  return map
}

export function useColumnFilters<T>(rows: T[], columns: ColumnDef<T>[]) {
  const [selected, setSelectedState] = useState<ColumnFilterState>({})

  const distinct = useMemo(() => distinctValues(rows, columns), [rows, columns])

  const filteredRows = useMemo(
    () => applyColumnFilters(rows, columns, selected),
    [rows, columns, selected],
  )

  const setSelected = (id: string, next: Set<string> | null) =>
    setSelectedState((s) => ({ ...s, [id]: next }))
  const clearAll = () => setSelectedState({})
  const anyActive = columns.some((c) => selected[c.id] != null)

  return { filteredRows, distinct, selected, setSelected, clearAll, anyActive }
}

export function ColumnFilter({
  label,
  values,
  selected,
  onChange,
}: {
  label: string
  values: string[]
  selected: Set<string> | null
  onChange: (next: Set<string> | null) => void
}) {
  const t = useT()
  // Translate display of enumerable values (sentiments, channels, statuses…)
  // while filtering on the raw English value, so the logic stays stable.
  const tv = useTV()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState("")
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)

  const active = selected != null
  const checked = selected ?? new Set(values)

  const place = () => {
    const rect = btnRef.current?.getBoundingClientRect()
    if (!rect) return
    const width = 232
    const left = Math.min(rect.left, window.innerWidth - width - 8)
    setPos({ top: rect.bottom + 6, left: Math.max(8, left) })
  }

  useEffect(() => {
    if (!open) return
    place()
    const onDocClick = (e: MouseEvent) => {
      const t = e.target as Node
      if (popRef.current?.contains(t) || btnRef.current?.contains(t)) return
      setOpen(false)
    }
    // Close on page scroll/resize (the popup is fixed-positioned to the button so
    // it would drift) — but ignore scrolling INSIDE the popup's own value list.
    const onReflow = (e?: Event) => {
      if (e && e.target instanceof Node && popRef.current?.contains(e.target)) return
      setOpen(false)
    }
    document.addEventListener("mousedown", onDocClick)
    window.addEventListener("scroll", onReflow, true)
    window.addEventListener("resize", onReflow)
    return () => {
      document.removeEventListener("mousedown", onDocClick)
      window.removeEventListener("scroll", onReflow, true)
      window.removeEventListener("resize", onReflow)
    }
  }, [open])

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return values
    return values.filter(
      (v) => v.toLowerCase().includes(needle) || tv(v).toLowerCase().includes(needle),
    )
  }, [values, q, tv])

  const toggle = (v: string) => {
    const next = new Set(checked)
    if (next.has(v)) next.delete(v)
    else next.add(v)
    onChange(next.size === values.length ? null : next)
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={t("a11y.filter", { label })}
        className={cn(
          "ml-1 inline-flex size-5 items-center justify-center rounded transition-colors",
          active
            ? "bg-accent/20 text-accent"
            : "text-muted-foreground/60 hover:bg-secondary hover:text-foreground",
        )}
      >
        <Filter className={cn("size-3", active && "fill-current")} />
      </button>

      {open &&
        pos &&
        createPortal(
          <div
            ref={popRef}
            style={{ top: pos.top, left: pos.left, width: 232 }}
            className="glass-frosted fixed z-[60] flex max-h-80 flex-col overflow-hidden rounded-xl shadow-2xl"
          >
            <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
              <span className="truncate text-xs font-bold text-foreground">{label}</span>
              <button
                onClick={() => onChange(null)}
                className="text-[11px] font-semibold text-accent transition-colors hover:underline"
              >
                {t("cf.clear")}
              </button>
            </div>

            <div className="flex items-center gap-1.5 border-b border-border px-2.5 py-1.5">
              <Search className="size-3.5 text-muted-foreground" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={t("cf.search")}
                autoFocus
                className="w-full bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
              />
            </div>

            <div className="flex items-center justify-between border-b border-border px-3 py-1.5 text-[11px]">
              <button onClick={() => onChange(null)} className="font-semibold text-muted-foreground hover:text-foreground">
                {t("cf.selectAll")}
              </button>
              <button onClick={() => onChange(new Set())} className="font-semibold text-muted-foreground hover:text-foreground">
                {t("cf.clearAll")}
              </button>
            </div>

            <ul className="min-h-0 flex-1 overflow-y-auto py-1">
              {shown.length === 0 ? (
                <li className="px-3 py-3 text-center text-xs text-muted-foreground">{t("cf.noMatches")}</li>
              ) : (
                shown.map((v) => {
                  const on = checked.has(v)
                  return (
                    <li key={v}>
                      <button
                        onClick={() => toggle(v)}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-foreground transition-colors hover:bg-secondary/60"
                      >
                        <span
                          className={cn(
                            "flex size-4 shrink-0 items-center justify-center rounded border",
                            on ? "border-primary bg-primary text-primary-foreground" : "border-border",
                          )}
                        >
                          {on && <Check className="size-3" />}
                        </span>
                        <span className="truncate">{tv(v)}</span>
                      </button>
                    </li>
                  )
                })
              )}
            </ul>
          </div>,
          document.body,
        )}
    </>
  )
}
