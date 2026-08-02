"use client"

import { useEffect, useState } from "react"

/**
 * Debounce a rapidly-changing value (e.g. a search query). Returns the settled
 * value plus a `pending` flag that's true while a change is waiting out the
 * delay — used to show a "searching…" spinner even though the actual filtering
 * is instant client-side work.
 */
export function useDebouncedValue<T>(value: T, delay = 250): { value: T; pending: boolean } {
  const [debounced, setDebounced] = useState(value)
  const [pending, setPending] = useState(false)

  useEffect(() => {
    if (value === debounced) return
    setPending(true)
    const timer = setTimeout(() => {
      setDebounced(value)
      setPending(false)
    }, delay)
    return () => clearTimeout(timer)
  }, [value, delay, debounced])

  return { value: debounced, pending }
}
