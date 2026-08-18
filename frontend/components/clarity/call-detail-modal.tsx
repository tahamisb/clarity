"use client"

import { useState } from "react"
import { Download, Flag, X } from "lucide-react"
import {
  CallRecord,
  HELPFULNESS_COLORS,
  CUSTOMER_BEHAVIOR_COLORS,
  SENTIMENT_COLORS,
  formatDuration,
} from "@/lib/clarity-data"
import { useT, useTV } from "@/lib/i18n"
import { cn } from "@/lib/utils"

export function CallDetailModal({
  call,
  onClose,
}: {
  call: CallRecord
  onClose: () => void
}) {
  const t = useT()
  const tv = useTV()
  const [tab, setTab] = useState<"transcript" | "analysis">("transcript")

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="glass-strong flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* header */}
        <div className="flex items-start justify-between border-b border-border p-5">
          <div>
            <p className="font-mono text-sm font-semibold text-foreground">
              {call.id}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {call.datetime} · {call.agent} · {formatDuration(call.durationSec)} ·{" "}
              {call.city}
            </p>
          </div>
          <button
            onClick={onClose}
            className="flex size-8 items-center justify-center rounded-lg border border-border text-muted-foreground hover:text-foreground"
            aria-label={t("a11y.close")}
          >
            <X className="size-4" />
          </button>
        </div>

        {/* tabs */}
        <div className="flex gap-1 border-b border-border px-5">
          {(["transcript", "analysis"] as const).map((tabKey) => (
            <button
              key={tabKey}
              onClick={() => setTab(tabKey)}
              className={cn(
                "border-b-2 px-3 py-2.5 text-sm font-medium transition-colors",
                tab === tabKey
                  ? "border-accent text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {t(`cdm.${tabKey}`)}
            </button>
          ))}
        </div>

        {/* body */}
        <div className="flex-1 overflow-y-auto p-5">
          {tab === "transcript" ? (
            <div className="space-y-3 whitespace-pre-wrap text-sm leading-relaxed text-foreground">
              {call.transcript || (
                <p className="text-muted-foreground">{t("cdm.noTranscript")}</p>
              )}
            </div>
          ) : (
            <div className="space-y-4 text-sm">
              {/* Lead with the concrete reason — the first thing an agent or
                  reviewer needs, ahead of the derived buckets below it. */}
              <Field label={t("cdm.callReason")}>
                <p className="text-base font-semibold leading-snug text-foreground">
                  {tv(call.reason || call.intent)}
                </p>
              </Field>
              <Field label={t("cdm.detectedCategory")}>
                <span className="font-semibold text-foreground">
                  {tv(call.category)}
                </span>
                <span className="ml-2 text-muted-foreground">
                  {t("cdm.confidenceSuffix", { n: call.confidence })}
                </span>
              </Field>
              <Field label={t("cdm.detectedIntent")}>
                <span className="font-semibold text-foreground">
                  {tv(call.intent)}
                </span>
              </Field>
              <Field label={t("cdm.overallSentiment")}>
                <span
                  className="rounded-full px-2 py-0.5 text-xs font-semibold"
                  style={{
                    background: `${SENTIMENT_COLORS[call.sentiment]}22`,
                    color: SENTIMENT_COLORS[call.sentiment],
                  }}
                >
                  {tv(call.sentiment)}
                </span>
              </Field>
              <Field label={t("col.helpfulness")}>
                <span
                  className="rounded-full px-2 py-0.5 text-xs font-semibold"
                  style={{
                    background: `${HELPFULNESS_COLORS[call.agentHelpfulness]}22`,
                    color: HELPFULNESS_COLORS[call.agentHelpfulness],
                  }}
                >
                  {tv(call.agentHelpfulness)}
                </span>
              </Field>
              <Field label={t("col.customerMood")}>
                <span
                  className="rounded-full px-2 py-0.5 text-xs font-semibold"
                  style={{
                    background: `${CUSTOMER_BEHAVIOR_COLORS[call.customerBehavior]}22`,
                    color: CUSTOMER_BEHAVIOR_COLORS[call.customerBehavior],
                  }}
                >
                  {tv(call.customerBehavior)}
                </span>
              </Field>
              <Field label={t("cdm.summary")}>
                <p className="leading-relaxed text-muted-foreground">
                  {call.summary || t("cdm.noSummary")}
                </p>
              </Field>
            </div>
          )}
        </div>

        {/* footer */}
        <div className="flex items-center justify-end gap-2 border-t border-border p-4">
          <button className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground">
            <Flag className="size-4" />
            {t("cdm.flagForReview")}
          </button>
          <button className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-bold text-primary-foreground hover:bg-accent">
            <Download className="size-4" />
            {t("cdm.downloadTranscript")}
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div>
      <p className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <div>{children}</div>
    </div>
  )
}
