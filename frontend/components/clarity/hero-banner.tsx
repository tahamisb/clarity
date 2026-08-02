"use client"

import { Upload } from "lucide-react"
import { LightningBolt } from "./logo"
import { useT } from "@/lib/i18n"

export function HeroBanner({ onUpload }: { onUpload?: () => void }) {
  const t = useT()
  return (
    <section className="relative overflow-hidden rounded-3xl px-6 py-8 shadow-[0_8px_40px_rgba(40,9,73,0.35)] md:px-10 md:py-10">
      {/* Brand gradient surface: deep purple → brand purple */}
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,var(--brand-deep)_0%,var(--brand)_60%,var(--brand-bright)_120%)]" />
      <div className="pointer-events-none absolute inset-0 brand-grid-bg opacity-40" />
      {/* Signature lightning bolt motif */}
      <LightningBolt className="pointer-events-none absolute -right-6 top-1/2 size-56 -translate-y-1/2 rotate-6 text-white/15 md:size-72" />

      <div className="relative max-w-2xl">
        <span className="mb-4 inline-flex -skew-x-6 items-center gap-1.5 rounded-[4px] bg-brand-cyan px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-wide text-[#08120f]">
          {t("hero.badge")}
        </span>
        <h1 className="display-italic text-4xl text-white md:text-6xl">
          {t("hero.title1")}
          <br />
          {t("hero.title2")}
        </h1>
        <p className="mt-4 max-w-md text-sm leading-relaxed text-white/75">
          {t("hero.subtitle")}
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button
            onClick={onUpload}
            className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-bold text-brand-deep shadow-sm transition-transform hover:-translate-y-0.5"
          >
            <Upload className="size-4" />
            {t("hero.upload")}
          </button>
          <span className="text-xs text-white/60">
            {t("hero.accepts")}
          </span>
        </div>
      </div>
    </section>
  )
}
