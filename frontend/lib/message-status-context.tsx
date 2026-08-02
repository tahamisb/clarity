"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react"

// ---------------------------------------------------------------------------
// Client-side review status for support messages: "flagged for review" and
// "resolved". Persisted to localStorage (no backend mutation endpoint yet).
//
// Resolving a message also clears its SLA-breach notification — the
// notifications provider treats a locally-resolved message as resolved.
// ---------------------------------------------------------------------------

export type MessageStatus = { resolved: boolean; flagged: boolean }

const STORAGE_KEY = "clarity.message-status.v1"

type StatusMap = Record<string, Partial<MessageStatus>>

type MessageStatusContextValue = {
  statuses: StatusMap
  getStatus: (id: string) => MessageStatus
  setResolved: (id: string, resolved: boolean) => void
  setFlagged: (id: string, flagged: boolean) => void
  /** Set of message ids the user has locally resolved. */
  resolvedIds: Set<string>
}

const MessageStatusContext = createContext<MessageStatusContextValue | null>(null)

function load(): StatusMap {
  if (typeof window === "undefined") return {}
  try {
    return JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}") as StatusMap
  } catch {
    return {}
  }
}

export function MessageStatusProvider({ children }: { children: React.ReactNode }) {
  const [statuses, setStatuses] = useState<StatusMap>({})

  useEffect(() => {
    setStatuses(load())
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setStatuses(load())
    }
    window.addEventListener("storage", onStorage)
    return () => window.removeEventListener("storage", onStorage)
  }, [])

  const persist = useCallback((next: StatusMap) => {
    setStatuses(next)
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    } catch {
      /* storage unavailable — non-fatal */
    }
  }, [])

  const update = useCallback(
    (id: string, patch: Partial<MessageStatus>) =>
      persist({ ...statuses, [id]: { ...statuses[id], ...patch } }),
    [statuses, persist],
  )

  const getStatus = useCallback(
    (id: string): MessageStatus => ({
      resolved: statuses[id]?.resolved ?? false,
      flagged: statuses[id]?.flagged ?? false,
    }),
    [statuses],
  )

  const resolvedIds = useMemo(
    () => new Set(Object.keys(statuses).filter((id) => statuses[id]?.resolved)),
    [statuses],
  )

  const value: MessageStatusContextValue = {
    statuses,
    getStatus,
    setResolved: (id, resolved) => update(id, { resolved }),
    setFlagged: (id, flagged) => update(id, { flagged }),
    resolvedIds,
  }

  return <MessageStatusContext.Provider value={value}>{children}</MessageStatusContext.Provider>
}

export function useMessageStatus(): MessageStatusContextValue {
  const ctx = useContext(MessageStatusContext)
  if (!ctx) throw new Error("useMessageStatus must be used within a MessageStatusProvider")
  return ctx
}
