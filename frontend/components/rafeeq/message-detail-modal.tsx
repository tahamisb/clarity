"use client"

import { Flag, CheckCircle, X } from "lucide-react"
import { SENTIMENT_COLORS } from "@/lib/rafeeq-data"
import { type SupportMessage } from "@/lib/mock-messages"
import { INTENT_COLORS } from "./message-feed-table"
import { cn } from "@/lib/utils"

export function MessageDetailModal({
  message,
  onClose,
}: {
  message: SupportMessage
  onClose: () => void
}) {
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
              {message.id}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {message.date} · {message.channel} · {message.customerId} · {message.zone}
            </p>
          </div>
          <button
            onClick={onClose}
            className="flex size-8 items-center justify-center rounded-lg border border-border text-muted-foreground hover:text-foreground"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* body */}
        <div className="flex-1 overflow-y-auto p-5">
          <div className="space-y-6">
            {/* Analysis Row */}
            <div className="grid grid-cols-2 gap-4 rounded-xl border border-border bg-secondary/30 p-4 sm:grid-cols-4">
              <Field label="Intent">
                <span
                  className="rounded-full px-2 py-0.5 text-xs font-semibold"
                  style={{
                    background: `${INTENT_COLORS[message.intent]}22`,
                    color: INTENT_COLORS[message.intent],
                  }}
                >
                  {message.intent}
                </span>
              </Field>
              <Field label="Sentiment">
                <span
                  className="rounded-full px-2 py-0.5 text-xs font-semibold"
                  style={{
                    background: `${SENTIMENT_COLORS[message.sentiment]}22`,
                    color: SENTIMENT_COLORS[message.sentiment],
                  }}
                >
                  {message.sentiment}
                </span>
              </Field>
              <Field label="Confidence">
                <span className="text-sm font-semibold text-foreground">
                  {message.confidence}%
                </span>
              </Field>
              <Field label="Merchant">
                <span className="text-sm font-semibold text-foreground">
                  {message.merchant || "N/A"}
                </span>
              </Field>
            </div>

            {/* Original Message */}
            <div>
              <p className="mb-2 text-[11px] uppercase tracking-wide text-muted-foreground">
                Original Message
              </p>
              <div className="rounded-xl border border-border bg-card p-4 text-sm text-foreground">
                {message.text}
              </div>
            </div>

            {/* Suggested Reply */}
            <div>
              <div className="mb-2 flex items-center gap-2">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  AI Suggested Reply
                </p>
                <span className="rounded-full bg-accent/20 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-accent">
                  Draft
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
          <button className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground">
            <Flag className="size-4" />
            Flag for Review
          </button>
          <button 
            onClick={onClose}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-bold text-primary-foreground hover:bg-accent"
          >
            <CheckCircle className="size-4" />
            Mark as Resolved
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
