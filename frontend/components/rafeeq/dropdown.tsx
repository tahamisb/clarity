"use client"

import { useEffect, useRef, useState } from "react"
import { ChevronDown, Check } from "lucide-react"
import { cn } from "@/lib/utils"

export function Dropdown({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string | null
  options: string[]
  onChange: (value: string | null) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", onClick)
    return () => document.removeEventListener("mousedown", onClick)
  }, [])

  const active = value !== null

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
          active
            ? "border-accent/40 bg-accent/15 text-accent"
            : "border-border bg-secondary/60 text-foreground hover:border-accent/50",
        )}
      >
        {active ? value : label}
        <ChevronDown
          className={cn(
            "size-3.5 transition-transform",
            active ? "text-accent" : "text-muted-foreground",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <div className="glass-strong absolute left-0 top-full z-30 mt-1.5 min-w-[180px] overflow-hidden rounded-xl py-1">
          <button
            onClick={() => {
              onChange(null)
              setOpen(false)
            }}
            className="flex w-full items-center justify-between px-3 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-secondary"
          >
            {label}
            {!active && <Check className="size-3.5 text-accent" />}
          </button>
          {options.map((opt) => (
            <button
              key={opt}
              onClick={() => {
                onChange(opt)
                setOpen(false)
              }}
              className="flex w-full items-center justify-between px-3 py-1.5 text-left text-xs text-foreground transition-colors hover:bg-secondary"
            >
              {opt}
              {value === opt && <Check className="size-3.5 text-accent" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
