"use client"

import { useState } from "react"
import { Headset, ShieldCheck } from "lucide-react"
import { ROLES, ROLE_DESCRIPTIONS, ROLE_LABELS, type UserRole } from "@/lib/roles"
import { cn } from "@/lib/utils"

const ROLE_ICONS: Record<UserRole, typeof Headset> = {
  employee: Headset,
  manager: ShieldCheck,
}

/**
 * Login-screen role picker. Writes the selection into a hidden input named
 * "role" so the surrounding server-action <form> submits it alongside the
 * credentials. Defaults to "employee".
 */
export function RoleSelect({ name = "role", defaultRole = "employee" as UserRole }) {
  const [role, setRole] = useState<UserRole>(defaultRole)

  return (
    <div className="flex flex-col gap-1.5 text-left">
      <span className="text-xs font-semibold text-muted-foreground">Sign in as</span>
      <input type="hidden" name={name} value={role} />
      <div className="grid grid-cols-2 gap-2">
        {ROLES.map((r) => {
          const Icon = ROLE_ICONS[r]
          const active = role === r
          return (
            <button
              key={r}
              type="button"
              onClick={() => setRole(r)}
              aria-pressed={active}
              className={cn(
                "flex flex-col items-start gap-1 rounded-xl border p-3 text-left transition-all",
                active
                  ? "border-accent/60 bg-accent/10 shadow-sm"
                  : "border-border bg-secondary/40 hover:bg-secondary/70",
              )}
            >
              <span className="flex items-center gap-2">
                <span
                  className={cn(
                    "flex size-7 items-center justify-center rounded-lg transition-colors",
                    active ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground",
                  )}
                >
                  <Icon className="size-4" />
                </span>
                <span className={cn("text-sm font-bold", active ? "text-foreground" : "text-muted-foreground")}>
                  {ROLE_LABELS[r]}
                </span>
              </span>
              <span className="text-[11px] leading-snug text-muted-foreground">{ROLE_DESCRIPTIONS[r]}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
