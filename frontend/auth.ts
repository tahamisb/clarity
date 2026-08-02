import NextAuth from "next-auth"
import Credentials from "next-auth/providers/credentials"
import { ALLOWED_DOMAIN, DEV_LOGIN_PASSWORD, authConfig } from "./auth.config"
import { asRole } from "./lib/roles"

/** Turn "t.mutahir" into "T Mutahir" for a friendly display name. */
function nameFromEmail(email: string) {
  const local = email.split("@")[0]
  return (
    local
      .split(/[._-]+/)
      .filter(Boolean)
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
      .join(" ") || email
  )
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    ...authConfig.providers,
    // ---------------------------------------------------------------------
    // PLACEHOLDER LOGIN — remove once real Google OAuth is live.
    // Accepts any email on ALLOWED_DOMAIN + the shared DEV_LOGIN_PASSWORD.
    // ---------------------------------------------------------------------
    Credentials({
      name: "Work email",
      credentials: {
        email: { label: "Work email", type: "email" },
        password: { label: "Password", type: "password" },
        role: { label: "Role", type: "text" },
      },
      authorize(credentials) {
        const email = String(credentials?.email ?? "").trim().toLowerCase()
        const password = String(credentials?.password ?? "")

        const okDomain = email.endsWith(`@${ALLOWED_DOMAIN}`)
        const okPassword = password === DEV_LOGIN_PASSWORD
        if (!okDomain || !okPassword) return null

        return { id: email, email, name: nameFromEmail(email), role: asRole(credentials?.role) }
      },
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,
    // Persist the chosen role into the JWT on sign-in, then expose it on the
    // session so client components (the notification panel, settings) can read it.
    jwt({ token, user }) {
      if (user) token.role = asRole((user as { role?: unknown }).role)
      return token
    },
    session({ session, token }) {
      if (session.user) session.user.role = asRole(token.role)
      return session
    },
  },
})
