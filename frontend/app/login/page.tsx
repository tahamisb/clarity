import { AlertCircle } from "lucide-react"
import { signIn } from "@/auth"
import { ALLOWED_DOMAIN } from "@/auth.config"

export const metadata = {
  title: "Sign in · Rafeeq Analytics",
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const { error } = await searchParams

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background p-6">
      {/* Ambient brand glow */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-32 -top-32 size-96 rounded-full bg-primary/20 blur-3xl" />
        <div className="absolute -bottom-32 -right-32 size-96 rounded-full bg-brand-bright/20 blur-3xl" />
      </div>

      <div className="glass-strong relative z-10 w-full max-w-md rounded-2xl border border-border p-8 shadow-2xl">
        <div className="flex flex-col items-center text-center">
          <img
            src="/rafeeq-logotype.svg"
            alt="Rafeeq"
            className="h-9 w-auto dark:brightness-125"
          />
          <h1 className="mt-6 text-2xl font-bold tracking-tight text-foreground">
            Admin sign in
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Restricted to{" "}
            <span className="font-semibold text-foreground">@{ALLOWED_DOMAIN}</span>{" "}
            accounts. Sign in with your work Google account to continue.
          </p>
        </div>

        {error && (
          <div className="mt-6 flex items-start gap-2.5 rounded-xl border border-negative/30 bg-negative/10 p-3.5 text-sm text-negative">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <p>
              {error === "AccessDenied"
                ? `Access denied. Only @${ALLOWED_DOMAIN} Google accounts are allowed.`
                : "Something went wrong while signing in. Please try again."}
            </p>
          </div>
        )}

        <form
          action={async () => {
            "use server"
            await signIn("google", { redirectTo: "/" })
          }}
          className="mt-8"
        >
          <button
            type="submit"
            className="flex w-full items-center justify-center gap-3 rounded-full border border-border bg-card px-5 py-3 text-sm font-bold text-foreground shadow-sm transition-all hover:-translate-y-0.5 hover:bg-secondary"
          >
            <GoogleIcon />
            Continue with Google
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Access is by invitation only. There is no public sign-up — contact your
          administrator if you need an account.
        </p>
      </div>

      <p className="absolute bottom-5 left-0 right-0 z-10 text-center text-xs text-muted-foreground">
        Rafeeq Analytics · All Daily Needs. One Rafeeq.
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
