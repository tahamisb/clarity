import type { DefaultSession } from "next-auth"
import type { UserRole } from "@/lib/roles"

// Augment NextAuth's session/user/jwt with the role chosen at sign-in.
declare module "next-auth" {
  interface User {
    role?: UserRole
  }
  interface Session {
    user: {
      id?: string
      role?: UserRole
    } & DefaultSession["user"]
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: UserRole
  }
}

export {}
