"use client"

import { Bot, Headset, Lightbulb } from "lucide-react"
import type { HandledBy, HandlerRow } from "@/lib/api"
import { useT, useTV } from "@/lib/i18n"
import { Panel } from "./panel"

/**
 * Bot vs human-agent handling, with each handler's sentiment outcome.
 *
 * "Handled by bot" = the conversation closed without ever reaching a human;
 * "handled by agent" = it was escalated. Sentiment percentages are within each
 * handler, so the two columns compare outcome quality directly rather than volume.
 */
export function HandledByPanel({ data }: { data?: HandledBy | null }) {
  const t = useT()

  if (!data || data.total === 0) {
    return (
      <Panel title={t("handled.title")}>
        <p className="text-sm text-muted-foreground">{t("handled.empty")}</p>
      </Panel>
    )
  }

  const bot = data.handlers.find((h) => h.handler === "Bot")
  const agent = data.handlers.find((h) => h.handler === "Agent")

  // Which handler leaves customers happier, and by how much.
  let insight = t("handled.insightNone")
  if (bot && agent && bot.handled > 0 && agent.handled > 0) {
    const gap = Math.abs(bot.negative_pct - agent.negative_pct)
    const better = bot.negative_pct <= agent.negative_pct ? t("handled.bot") : t("handled.agent")
    const worse = better === t("handled.bot") ? t("handled.agent") : t("handled.bot")
    insight =
      gap < 2
        ? t("handled.insightEven", { botPct: bot.share_pct, agentPct: agent.share_pct })
        : t("handled.insight", {
            botPct: bot.share_pct,
            agentPct: agent.share_pct,
            better,
            worse,
            gap: gap.toFixed(1),
          })
  }

  return (
    <Panel title={t("handled.title")}>
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {bot && <HandlerCard row={bot} icon={Bot} label={t("handled.bot")} />}
          {agent && <HandlerCard row={agent} icon={Headset} label={t("handled.agent")} />}
        </div>

        <div className="flex items-start gap-3 rounded-xl border border-accent/20 bg-accent/5 p-4">
          <div className="mt-0.5 rounded-full bg-accent/20 p-1.5 text-accent">
            <Lightbulb className="size-4" />
          </div>
          <div>
            <h4 className="text-sm font-semibold text-foreground">{t("common.aiInsight")}</h4>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{insight}</p>
          </div>
        </div>
      </div>
    </Panel>
  )
}

function HandlerCard({
  row,
  icon: Icon,
  label,
}: {
  row: HandlerRow
  icon: typeof Bot
  label: string
}) {
  const t = useT()
  const tv = useTV()
  // Sentiment is never colour-only — each segment is also labelled below the bar.
  const segments = [
    { key: "positive", pct: row.positive_pct, n: row.positive, color: "var(--positive)", label: tv("Positive") },
    { key: "neutral", pct: row.neutral_pct, n: row.neutral, color: "var(--neutral)", label: tv("Neutral") },
    { key: "negative", pct: row.negative_pct, n: row.negative, color: "var(--negative)", label: tv("Negative") },
  ]

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-sidebar p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Icon className="size-4 text-primary" />
          {label}
        </span>
        <span className="text-xs font-semibold text-muted-foreground">
          {t("handled.share", { pct: row.share_pct })}
        </span>
      </div>

      <div>
        <span className="text-2xl font-bold tabular-nums tracking-tight text-foreground">
          {row.handled.toLocaleString()}
        </span>
        <span className="ml-1.5 text-xs text-muted-foreground">{t("handled.conversations")}</span>
      </div>

      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted/40">
        {segments.map((s) => (
          <div key={s.key} style={{ width: `${s.pct}%`, background: s.color }} />
        ))}
      </div>

      <ul className="flex flex-col gap-1 text-xs">
        {segments.map((s) => (
          <li key={s.key} className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <span className="size-2 rounded-full" style={{ background: s.color }} />
              {s.label}
            </span>
            <span className="tabular-nums font-semibold text-foreground">
              {s.n.toLocaleString()} · {s.pct}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
