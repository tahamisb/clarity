"use client"

import { useSession } from "next-auth/react"
import { asRole, type UserRole } from "./roles"

/**
 * The current signed-in user's role, read from the NextAuth session.
 * Falls back to the default role until the session resolves (or when running
 * under the legacy auth bypass, where there is no real session).
 */
export function useRole(): UserRole {
  const { data } = useSession()
  return asRole(data?.user?.role)
}
