import NextAuth from "next-auth"
import { authConfig } from "./auth.config"

// Edge-safe auth instance used purely for the `authorized` route guard.
// In Next.js 16 the middleware convention was renamed to "proxy".
const { auth } = NextAuth(authConfig)

export default auth

export const config = {
  // Run on every route except Next internals, the auth API, and static assets.
  matcher: [
    "/((?!api/auth|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
}
