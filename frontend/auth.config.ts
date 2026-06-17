import type { NextAuthConfig } from "next-auth"
import Google from "next-auth/providers/google"

/**
 * Only Google accounts on this email domain may sign in.
 * There is no sign-up flow — any @gorafeeq.com Google account can log in,
 * everyone else is rejected.
 */
export const ALLOWED_DOMAIN = "gorafeeq.com"

/**
 * TEMPORARY DEV BYPASS.
 * When NEXT_PUBLIC_AUTH_BYPASS === "true", all route protection is disabled and
 * the whole app is reachable WITHOUT signing in. This exists only because we do
 * not yet have Google OAuth credentials (waiting on a managed client from IT).
 *
 * The entire auth system below stays in place — flip this flag back to false
 * (or remove it) once AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET are filled in.
 * See AUTH_SETUP.md → "Temporary auth bypass".
 */
export const AUTH_BYPASS = process.env.NEXT_PUBLIC_AUTH_BYPASS === "true"

export const authConfig = {
  pages: {
    signIn: "/login",
    error: "/login",
  },
  providers: [
    Google({
      authorization: {
        params: {
          // Restrict the Google account chooser to the gorafeeq.com workspace
          // and always let the user pick which account to use.
          hd: ALLOWED_DOMAIN,
          prompt: "select_account",
        },
      },
    }),
  ],
  callbacks: {
    /**
     * Hard gate: reject anyone whose verified email is not on the allowed
     * domain. This runs server-side, so it cannot be bypassed from the client.
     */
    signIn({ profile }) {
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
