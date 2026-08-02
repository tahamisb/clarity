import { AlertCircle, Info } from "lucide-react"
import { AuthError } from "next-auth"
import { redirect } from "next/navigation"
import { signIn } from "@/auth"
import { ALLOWED_DOMAIN, GOOGLE_ENABLED } from "@/auth.config"
import { ClarityLogo } from "@/components/clarity/logo"
import { RoleSelect } from "@/components/clarity/role-select"

export const metadata = {
  title: "Sign in · Clarity Analytics",
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const { error } = await searchParams

  async function loginWithCredentials(formData: FormData) {
    "use server"
    try {
      await signIn("credentials", {
        email: formData.get("email"),
        password: formData.get("password"),
        role: formData.get("role"),
        redirectTo: "/",
      })
    } catch (err) {
      // A successful sign-in throws a NEXT_REDIRECT we must let through;
      // only credential failures are AuthErrors.
      if (err instanceof AuthError) {
        redirect("/login?error=CredentialsSignin")
      }
      throw err
    }
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background p-6">
      {/* Ambient brand glow */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-32 -top-32 size-96 rounded-full bg-primary/20 blur-3xl" />
        <div className="absolute -bottom-32 -right-32 size-96 rounded-full bg-brand-bright/20 blur-3xl" />
      </div>

      <div className="glass-strong relative z-10 w-full max-w-md rounded-2xl border border-border p-8 shadow-2xl">
        <div className="flex flex-col items-center text-center">
          <ClarityLogo className="text-3xl" />
          <h1 className="mt-6 text-2xl font-bold tracking-tight text-foreground">
            Admin sign in
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Restricted to{" "}
            <span className="font-semibold text-foreground">@{ALLOWED_DOMAIN}</span>{" "}
            accounts. Sign in with your work email to continue.
          </p>
        </div>

        {error && (
          <div className="mt-6 flex items-start gap-2.5 rounded-xl border border-negative/30 bg-negative/10 p-3.5 text-sm text-negative">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <p>
              {error === "CredentialsSignin"
                ? `Invalid credentials. Use your @${ALLOWED_DOMAIN} email and the team access password.`
                : error === "AccessDenied"
                  ? `Access denied. Only @${ALLOWED_DOMAIN} accounts are allowed.`
                  : "Something went wrong while signing in. Please try again."}
            </p>
          </div>
        )}

        {/* Placeholder credentials login */}
        <form action={loginWithCredentials} className="mt-8 flex flex-col gap-3">
          <label className="flex flex-col gap-1.5 text-left">
            <span className="text-xs font-semibold text-muted-foreground">Work email</span>
            <input
              type="email"
              name="email"
              required
              autoComplete="email"
              placeholder={`you@${ALLOWED_DOMAIN}`}
              className="rounded-xl border border-border bg-secondary/50 px-3.5 py-2.5 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-accent/50"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-left">
            <span className="text-xs font-semibold text-muted-foreground">Access password</span>
            <input
              type="password"
              name="password"
              required
              autoComplete="current-password"
              placeholder="••••••••"
              className="rounded-xl border border-border bg-secondary/50 px-3.5 py-2.5 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-accent/50"
            />
          </label>
          <RoleSelect />
          <button
            type="submit"
            className="mt-1 flex w-full items-center justify-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-bold text-primary-foreground shadow-sm transition-all hover:-translate-y-0.5"
          >
            Sign in
          </button>
        </form>

        {/* Google is only offered once IT provisions real OAuth credentials */}
        {GOOGLE_ENABLED && (
          <>
            <div className="my-6 flex items-center gap-3 text-xs text-muted-foreground">
              <span className="h-px flex-1 bg-border" />
              or
              <span className="h-px flex-1 bg-border" />
            </div>
            <form
              action={async () => {
                "use server"
                await signIn("google", { redirectTo: "/" })
              }}
            >
              <button
                type="submit"
                className="flex w-full items-center justify-center gap-3 rounded-full border border-border bg-card px-5 py-3 text-sm font-bold text-foreground shadow-sm transition-all hover:-translate-y-0.5 hover:bg-secondary"
              >
                <GoogleIcon />
                Continue with Google
              </button>
            </form>
          </>
        )}

        <div className="mt-6 flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-700 dark:text-amber-400">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          <p>
            Temporary access: this shared-password login is a placeholder until IT
            provisions Google SSO. Access is by invitation only — there is no
            public sign-up.
          </p>
        </div>
      </div>

      <p className="absolute bottom-5 left-0 right-0 z-10 text-center text-xs text-muted-foreground">
        Clarity Analytics · All Call Data. One Clarity.
      </p>
    </main>
  )
}

function GoogleIcon() {
  return (
    <svg className="size-5" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.76h3.56c2.08-1.92 3.28-4.74 3.28-8.09Z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.56-2.76c-.98.66-2.23 1.06-3.72 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.11a6.6 6.6 0 0 1 0-4.22V7.05H2.18a11 11 0 0 0 0 9.9l3.66-2.84Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.05l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38Z"
      />
    </svg>
  )
}
