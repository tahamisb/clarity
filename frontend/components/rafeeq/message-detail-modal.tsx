"use client"

import { Flag, CheckCircle, RotateCcw, X } from "lucide-react"
import { SENTIMENT_COLORS } from "@/lib/rafeeq-data"
import { type SupportMessage } from "@/lib/mock-messages"
import { useMessageStatus } from "@/lib/message-status-context"
import { INTENT_COLORS } from "./message-feed-table"
import { useT, useTV } from "@/lib/i18n"
import { cn } from "@/lib/utils"

export function MessageDetailModal({
  message,
  onClose,
}: {
  message: SupportMessage
  onClose: () => void
}) {
  const t = useT()
  const tv = useTV()
  const { getStatus, setResolved, setFlagged } = useMessageStatus()
  const status = getStatus(message.id)
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
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-mono text-sm font-semibold text-foreground">{message.id}</p>
              {status.resolved && (
                <span className="inline-flex items-center gap-1 rounded-full bg-positive/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-positive">
                  <CheckCircle className="size-3" />{t("col.resolved")}
                </span>
              )}
              {status.flagged && (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-500">
                  <Flag className="size-3" />{t("col.flagged")}
                </span>
              )}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {message.date} · {message.channel} · {message.customerId} · {message.zone}
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

        {/* body */}
        <div className="flex-1 overflow-y-auto p-5">
          <div className="space-y-6">
            {/* Analysis Row */}
            <div className="grid grid-cols-2 gap-4 rounded-xl border border-border bg-secondary/30 p-4 sm:grid-cols-4">
              <Field label={t("col.intent")}>
                <span
                  className="rounded-full px-2 py-0.5 text-xs font-semibold"
                  style={{
                    background: `${INTENT_COLORS[message.intent]}22`,
                    color: INTENT_COLORS[message.intent],
                  }}
                >
                  {tv(message.intent)}
                </span>
              </Field>
              <Field label={t("col.sentiment")}>
                <span
                  className="rounded-full px-2 py-0.5 text-xs font-semibold"
                  style={{
                    background: `${SENTIMENT_COLORS[message.sentiment]}22`,
                    color: SENTIMENT_COLORS[message.sentiment],
                  }}
                >
                  {tv(message.sentiment)}
                </span>
              </Field>
              <Field label={t("mdm.confidence")}>
                <span className="text-sm font-semibold text-foreground">
                  {message.confidence}%
                </span>
              </Field>
              <Field label={t("mdm.merchant")}>
                <span className="text-sm font-semibold text-foreground">
                  {message.merchant || tv("N/A")}
                </span>
              </Field>
              <Field label={t("col.handledBy")}>
                <span className="text-sm font-semibold text-foreground">
                  {message.agentName ?? t("mft.bot")}
                </span>
              </Field>
              <Field label={t("mdm.handlingTime")}>
                <span className="text-sm font-semibold text-foreground">
                  {formatDuration(message.handlingMinutes)}
                </span>
              </Field>
            </div>

            {/* Original Message */}
            <div>
              <p className="mb-2 text-[11px] uppercase tracking-wide text-muted-foreground">
                {t("mdm.originalMessage")}
              </p>
              <div className="rounded-xl border border-border bg-card p-4 text-sm text-foreground">
                {message.text}
              </div>
            </div>

            {/* Suggested Reply */}
            <div>
              <div className="mb-2 flex items-center gap-2">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  {t("mdm.aiSuggestedReply")}
                </p>
                <span className="rounded-full bg-accent/20 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-accent">
                  {t("mdm.draft")}
                </span>
              </div>
              <div className="rounded-xl border border-dashed border-accent/40 bg-accent/5 p-4 text-sm italic text-foreground/90">
                "{message.suggestedReply}"
              </div>
            </div>
          </div>
        </div>

        {/* footer */}
        <div className="flex items-center justify-end gap-2 border-t border-border p-4">
          <button
            onClick={() => setFlagged(message.id, !status.flagged)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
              status.flagged
                ? "border-amber-500/40 bg-amber-500/10 text-amber-500"
                : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            <Flag className={cn("size-4", status.flagged && "fill-current")} />
            {status.flagged ? t("mdm.flaggedForReview") : t("cdm.flagForReview")}
          </button>
          {status.resolved ? (
            <button
              onClick={() => setResolved(message.id, false)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-bold text-foreground transition-colors hover:bg-secondary"
            >
              <RotateCcw className="size-4" />
              {t("mdm.reopen")}
            </button>
          ) : (
            <button
              onClick={() => {
                setResolved(message.id, true)
                onClose()
              }}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-bold text-primary-foreground transition-colors hover:bg-accent"
            >
              <CheckCircle className="size-4" />
              {t("mdm.markResolved")}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function formatDuration(min?: number): string {
  if (min == null) return "—"
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m ? `${h}h ${m}m` : `${h}h`
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
