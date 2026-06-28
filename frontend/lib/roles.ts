// ---------------------------------------------------------------------------
// User roles — chosen on the login screen and carried through the NextAuth
// session. Drives which notifications a signed-in user receives.
//
//   employee → SLA breaches + high-risk cancellations
//   manager  → the above + poor agent-helpfulness alerts (with the agent name)
//
// Kept dependency-free so it is safe to import from both server (auth.ts) and
// client code.
// ---------------------------------------------------------------------------

export type UserRole = "employee" | "manager"

export const ROLES: UserRole[] = ["employee", "manager"]

export const DEFAULT_ROLE: UserRole = "employee"

export const ROLE_LABELS: Record<UserRole, string> = {
  employee: "Employee",
  manager: "Manager",
}

export const ROLE_DESCRIPTIONS: Record<UserRole, string> = {
  employee:
    "Get notified when an SLA target is exceeded or an order is flagged as high-risk for cancellation.",
  manager:
    "Everything an employee sees, plus alerts when an agent's call helpfulness is rated poorly.",
}

export function isRole(value: unknown): value is UserRole {
  return value === "employee" || value === "manager"
}

export function asRole(value: unknown, fallback: UserRole = DEFAULT_ROLE): UserRole {
  return isRole(value) ? value : fallback
}
