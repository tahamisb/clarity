"use client"

import { useEffect, useState } from "react"
import { createPortal } from "react-dom"
import { Check, Loader2, Sparkles, X } from "lucide-react"
import { LightningBolt } from "./logo"
import { joinWaitlist } from "@/lib/api"
import { useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"

// Deliberately price-free: every tier reads "talk to sales". The modal only
// captures an email (POST /api/v1/waitlist) so sales can scope a solution.
const PLANS = [
  {
    id: "team",
    nameKey: "up.team.name",
    blurbKey: "up.team.blurb",
    featureKeys: ["up.team.f1", "up.team.f2", "up.team.f3", "up.team.f4"],
    featured: false,
  },
  {
    id: "growth",
    nameKey: "up.growth.name",
    blurbKey: "up.growth.blurb",
    featureKeys: ["up.growth.f1", "up.growth.f2", "up.growth.f3", "up.growth.f4"],
    featured: true,
  },
  {
    id: "enterprise",
    nameKey: "up.ent.name",
    blurbKey: "up.ent.blurb",
    featureKeys: ["up.ent.f1", "up.ent.f2", "up.ent.f3", "up.ent.f4"],
    featured: false,
  },
] as const

/** Sidebar call-to-action that opens the waitlist modal. */
export function UpgradeCTA() {
  const t = useT()
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="group relative w-full overflow-hidden rounded-xl px-3 py-3 text-left shadow-[0_6px_24px_rgba(40,9,73,0.28)] transition-transform hover:-translate-y-0.5"
      >
        <span className="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,var(--brand-deep)_0%,var(--brand)_65%,var(--brand-bright)_130%)]" />
        <LightningBolt className="pointer-events-none absolute -right-2 top-1/2 size-16 -translate-y-1/2 rotate-6 text-white/15" />
        <span className="relative block text-[11px] font-semibold uppercase tracking-widest text-brand-cyan">
          {t("up.ctaKicker")}
        </span>
        <span className="relative mt-0.5 flex items-center gap-1.5 text-sm font-bold text-white">
          <Sparkles className="size-4" />
          {t("up.ctaLabel")}
        </span>
      </button>

      {open && <UpgradeModal onClose={() => setOpen(false)} />}
    </>
  )
}

export function UpgradeModal({ onClose }: { onClose: () => void }) {
  const t = useT()
  const [plan, setPlan] = useState<string>("growth")
  const [email, setEmail] = useState("")
  const [company, setCompany] = useState("")
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle")

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose()
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [onClose])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setState("sending")
    const ok = await joinWaitlist({ email, company: company || undefined, plan })
    setState(ok ? "done" : "error")
  }

  // Portalled to <body>: the sidebar this opens from is a `backdrop-filter`
  // surface, which makes it its own stacking context — a z-50 child of it still
  // paints under the main content. ponytail: client-only, never server-rendered.
  if (typeof document === "undefined") return null

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="glass-frosted flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-3xl"
        role="dialog"
        aria-modal="true"
        aria-label={t("up.title")}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Brand header — same gradient surface as the dashboard hero */}
        <div className="relative shrink-0 overflow-hidden px-6 py-7 md:px-9">
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,var(--brand-deep)_0%,var(--brand)_60%,var(--brand-bright)_120%)]" />
          <div className="pointer-events-none absolute inset-0 brand-grid-bg opacity-40" />
          <LightningBolt className="pointer-events-none absolute -right-4 top-1/2 size-44 -translate-y-1/2 rotate-6 text-white/15" />

          <button
            onClick={onClose}
            aria-label={t("a11y.close")}
            className="absolute right-4 top-4 z-10 flex size-8 items-center justify-center rounded-lg border border-white/25 text-white/80 transition-colors hover:bg-white/15 hover:text-white rtl:left-4 rtl:right-auto"
          >
            <X className="size-4" />
          </button>

          <div className="relative max-w-xl">
            <span className="mb-3 inline-flex -skew-x-6 items-center gap-1.5 rounded-[4px] bg-brand-cyan px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-wide text-[#08120f]">
              {t("up.badge")}
            </span>
            <h2 className="display-italic text-3xl text-white md:text-4xl">
              {t("up.title")}
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-white/75">
              {t("up.subtitle")}
            </p>
          </div>
        </div>

        {/* Plans */}
        <div className="flex-1 overflow-y-auto px-6 py-6 md:px-9">
          <div className="grid gap-3 md:grid-cols-3">
            {PLANS.map((p) => {
              const selected = plan === p.id
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPlan(p.id)}
                  aria-pressed={selected}
                  className={cn(
                    "glass relative flex flex-col rounded-2xl p-4 text-left transition-all hover:-translate-y-0.5",
                    selected
                      ? "border-primary/60 ring-2 ring-primary/40"
                      : "hover:border-primary/30",
                  )}
                >
                  {p.featured && (
                    <span className="absolute -top-2 right-4 rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary-foreground rtl:left-4 rtl:right-auto">
                      {t("up.popular")}
                    </span>
                  )}

                  <p className="text-sm font-bold text-foreground">{t(p.nameKey)}</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {t(p.blurbKey)}
                  </p>

                  {/* Where a price would go. Intentionally none. */}
                  <p className="mt-4 text-lg font-bold text-primary">
                    {t("up.customPricing")}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {t("up.scopedWithYou")}
                  </p>

                  <ul className="mt-4 flex flex-col gap-2 border-t border-border pt-4">
                    {p.featureKeys.map((k) => (
                      <li key={k} className="flex items-start gap-2 text-xs text-foreground">
                        <Check className="mt-0.5 size-3.5 shrink-0 text-positive" />
                        {t(k)}
                      </li>
                    ))}
                  </ul>
                </button>
              )
            })}
          </div>
        </div>

        {/* Waitlist form */}
        <div className="shrink-0 border-t border-border bg-secondary/40 px-6 py-5 md:px-9">
          {state === "done" ? (
            <div className="flex items-center gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-positive/15 text-positive">
                <Check className="size-5" />
              </span>
              <div>
                <p className="text-sm font-bold text-foreground">{t("up.doneTitle")}</p>
                <p className="text-xs text-muted-foreground">{t("up.doneBody")}</p>
              </div>
            </div>
          ) : (
            <form onSubmit={submit} className="flex flex-col gap-3">
              <div>
                <p className="text-sm font-bold text-foreground">{t("up.formTitle")}</p>
                <p className="text-xs text-muted-foreground">{t("up.formBody")}</p>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row">
                {/* type=email + required: the browser does the format check. */}
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t("up.emailPlaceholder")}
                  aria-label={t("up.emailPlaceholder")}
                  className="min-w-0 flex-1 rounded-full border border-border bg-background/70 px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-accent/60 focus:outline-none"
                />
                <input
                  type="text"
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  placeholder={t("up.companyPlaceholder")}
                  aria-label={t("up.companyPlaceholder")}
                  className="min-w-0 rounded-full border border-border bg-background/70 px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-accent/60 focus:outline-none sm:w-48"
                />
                <button
                  type="submit"
                  disabled={state === "sending"}
                  className="inline-flex shrink-0 items-center justify-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground transition-colors hover:bg-accent disabled:opacity-60"
                >
                  {state === "sending" && <Loader2 className="size-4 animate-spin" />}
                  {t("up.joinWaitlist")}
                </button>
              </div>

              {state === "error" && (
                <p className="text-xs font-medium text-destructive">{t("up.error")}</p>
              )}
              <p className="text-[11px] text-muted-foreground">{t("up.noCard")}</p>
            </form>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
