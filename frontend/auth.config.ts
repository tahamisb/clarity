import type { NextAuthConfig } from "next-auth"
import Google from "next-auth/providers/google"

/**
 * Only Google accounts on this email domain may sign in. There is no sign-up
 * flow — any account on the domain can log in, everyone else is rejected.
 * Set NEXT_PUBLIC_ALLOWED_DOMAIN per deployment; it is shown in the login UI,
 * so it is public by design.
 */
export const ALLOWED_DOMAIN =
  process.env.NEXT_PUBLIC_ALLOWED_DOMAIN ?? "example.com"

/**
 * TEMPORARY PLACEHOLDER LOGIN (until IT provisions real Google OAuth).
 * A NextAuth Credentials provider (configured in auth.ts) accepts ANY
 * email on ALLOWED_DOMAIN plus this shared password. It is intentionally NOT
 * secure — it's a stand-in so the team can use the app and the login UX is
 * real. Swap to Google by filling AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET and
 * removing the credentials provider. See AUTH_SETUP.md.
 */
export const DEV_LOGIN_PASSWORD = process.env.DEV_LOGIN_PASSWORD ?? "clarity"

/** True once real Google OAuth credentials exist. */
export const GOOGLE_ENABLED = !!process.env.AUTH_GOOGLE_ID

/**
 * Legacy full bypass (no login screen at all). Superseded by the placeholder
 * login above; kept so it can still be flipped on in a pinch. Default off.
 * See AUTH_SETUP.md.
 */
export const AUTH_BYPASS = process.env.NEXT_PUBLIC_AUTH_BYPASS === "true"

export const authConfig = {
  // Trust the host header — required for self-hosted / `next start` and when
  // running behind a reverse proxy (otherwise Auth.js throws UntrustedHost).
  trustHost: true,
  pages: {
    signIn: "/login",
    error: "/login",
  },
  providers: [
    // Only offered once real credentials exist. The placeholder Credentials
    // provider (added in auth.ts) handles login in the meantime.
    ...(GOOGLE_ENABLED
      ? [
          Google({
            authorization: {
              params: {
                // Restrict the Google account chooser to the allowed
                // workspace and always let the user pick which account to use.
                hd: ALLOWED_DOMAIN,
                prompt: "select_account",
              },
            },
          }),
        ]
      : []),
  ],
  callbacks: {
    /**
     * Hard gate for Google sign-in: reject anyone whose verified email is not
     * on the allowed domain. (The placeholder Credentials provider enforces the
     * domain inside its own authorize() function.)
     */
    signIn({ account, profile }) {
      if (account?.provider === "credentials") return true
      const email = (profile?.email ?? "").toLowerCase()
      const verified = profile?.email_verified
      return Boolean(verified) && email.endsWith(`@${ALLOWED_DOMAIN}`)
    },
    /**
     * Route protection used by the middleware. Unauthenticated users are
     * redirected to /login; authenticated users hitting /login go to the app.
     */
    authorized({ auth, request: { nextUrl } }) {
      // Dev bypass: let everything through, untouched auth system underneath.
      if (AUTH_BYPASS) {
        if (nextUrl.pathname.startsWith("/login")) {
          return Response.redirect(new URL("/", nextUrl))
        }
        return true
      }

      const isLoggedIn = !!auth?.user
      const isOnLogin = nextUrl.pathname.startsWith("/login")

      if (isOnLogin) {
        if (isLoggedIn) return Response.redirect(new URL("/", nextUrl))
        return true
      }
      return isLoggedIn
    },
  },
} satisfies NextAuthConfig
