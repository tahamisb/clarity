"use client"

import { useState } from "react"
import {
  BookOpen, Calculator, ShieldAlert, Compass, HelpCircle, Bug,
  Send, ChevronDown, PhoneCall, MessageSquare, Ban, Check, PlayCircle,
} from "lucide-react"
import { Sidebar } from "@/components/rafeeq/sidebar"
import { Topbar } from "@/components/rafeeq/topbar"
import { Panel } from "@/components/rafeeq/panel"
import { WorkInProgress, WipBadge } from "@/components/rafeeq/work-in-progress"
import { useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"

// Text resolves through i18n at render (see lib/i18n.tsx).
const METRICS = [
  { termKey: "help.metric.cancelRate", howKey: "help.metric.cancelRateHow" },
  { termKey: "help.metric.wow", howKey: "help.metric.wowHow" },
  { termKey: "help.metric.nlp", howKey: "help.metric.nlpHow" },
  { termKey: "help.metric.sentiment", howKey: "help.metric.sentimentHow" },
]

const FAQS = [
  { qKey: "help.faq.q1", aKey: "help.faq.a1" },
  { qKey: "help.faq.q2", aKey: "help.faq.a2" },
  { qKey: "help.faq.q3", aKey: "help.faq.a3" },
  { qKey: "help.faq.q4", aKey: "help.faq.a4" },
]

const GUIDES = [
  { nameKey: "nav.callIntelligence", descKey: "help.guide.callDesc", icon: PhoneCall },
  { nameKey: "nav.supportMessages", descKey: "help.guide.msgDesc", icon: MessageSquare },
  { nameKey: "nav.cancellations", descKey: "help.guide.cancelDesc", icon: Ban },
]

function Accordion({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border-b border-border last:border-b-0">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 py-3.5 text-left"
      >
        <span className="text-sm font-medium text-foreground">{q}</span>
        <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open && <p className="pb-4 pr-8 text-sm leading-relaxed text-muted-foreground">{a}</p>}
    </div>
  )
}

export default function HelpPage() {
  const t = useT()
  const [search, setSearch] = useState("")
  const [feedbackType, setFeedbackType] = useState<"bug" | "feature" | "label">("bug")
  const [message, setMessage] = useState("")
  const [sent, setSent] = useState(false)

  const submit = () => {
    if (!message.trim()) return
    setSent(true)
    setMessage("")
    window.setTimeout(() => setSent(false), 2600)
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar title={t("help.title")} search={search} onSearch={setSearch} />

        <main className="flex flex-1 flex-col gap-6 p-4 md:p-6">
          {/* Header */}
          <div className="flex flex-col items-start gap-2 border-b border-border pb-5">
            <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">{t("help.title")}</h1>
            <p className="text-sm text-muted-foreground">
              {t("help.subtitle")}
            </p>
          </div>

          {/* Glossary */}
          <Panel title={t("help.glossary")} action={<BookOpen className="size-4 text-accent" />}>
            <div className="mb-4 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <Calculator className="size-3.5" /> {t("help.metricsDecoder")}
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {METRICS.map((m) => (
                <div key={m.termKey} className="rounded-xl border border-border bg-secondary/40 p-4">
                  <p className="text-sm font-bold text-foreground">{t(m.termKey)}</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t(m.howKey)}</p>
                </div>
              ))}
            </div>

            <div className="mt-5 flex items-start gap-3 rounded-xl border border-accent/20 bg-accent/5 p-4">
              <div className="mt-0.5 rounded-full bg-accent/20 p-1.5 text-accent"><ShieldAlert className="size-4" /></div>
              <div>
                <p className="text-sm font-semibold text-foreground">{t("help.mlGuide")}</p>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  {t("help.mlGuidePre")}<span className="font-semibold text-foreground">{t("help.highRisk")}</span>{t("help.mlGuideMid")}<span className="font-semibold text-foreground">{t("help.urgent")}</span>{t("help.mlGuidePost")}
                </p>
              </div>
            </div>
          </Panel>

          {/* Walkthroughs */}
          <Panel
            title={t("help.walkthroughs")}
            action={<span className="flex items-center gap-2"><WipBadge /><Compass className="size-4 text-accent" /></span>}
          >
            <WorkInProgress note={t("help.walkthroughsWip")} label={t("common.workInProgress")}>
              <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
                {GUIDES.map((g) => (
                  <div key={g.nameKey} className="flex flex-col rounded-xl border border-border bg-secondary/40 p-4">
                    <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary/20 to-brand-bright/10 text-accent ring-1 ring-accent/20">
                      <g.icon className="size-4" />
                    </div>
                    <p className="mt-3 text-sm font-semibold text-foreground">{t(g.nameKey)}</p>
                    <p className="mt-1 flex-1 text-xs leading-relaxed text-muted-foreground">{t(g.descKey)}</p>
                    <span className="mt-3 inline-flex items-center gap-1.5 self-start rounded-full bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary">
                      <PlayCircle className="size-3.5" /> {t("help.startTour")}
                    </span>
                  </div>
                ))}
              </div>
            </WorkInProgress>

            <div className="mt-6 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <HelpCircle className="size-3.5" /> {t("help.faq")}
            </div>
            <div className="mt-1">
              {FAQS.map((f) => <Accordion key={f.qKey} q={t(f.qKey)} a={t(f.aKey)} />)}
            </div>
          </Panel>

          {/* Feedback */}
          <Panel title={t("help.feedback")} action={<Bug className="size-4 text-accent" />}>
            <p className="text-sm text-muted-foreground">
              {t("help.feedbackDesc")}
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-1 rounded-full border border-border bg-secondary/60 p-1">
              {([
                { value: "bug", label: t("help.reportBug") },
                { value: "feature", label: t("help.requestFeature") },
                { value: "label", label: t("help.flagAi") },
              ] as const).map((o) => (
                <button
                  key={o.value}
                  onClick={() => setFeedbackType(o.value)}
                  className={cn(
                    "rounded-full px-4 py-1.5 text-xs font-semibold transition-colors",
                    feedbackType === o.value ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {o.label}
                </button>
              ))}
            </div>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={4}
              placeholder={t("help.feedbackPlaceholder")}
              className="mt-3 w-full resize-none rounded-xl border border-border bg-secondary/50 p-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-accent/50"
            />
            <div className="mt-3 flex items-center justify-end">
              <button
                onClick={submit}
                className={cn(
                  "inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-bold shadow-sm transition-all",
                  sent ? "bg-positive text-white" : "bg-primary text-primary-foreground hover:-translate-y-0.5",
                )}
              >
                {sent ? <Check className="size-4" /> : <Send className="size-4" />}
                {sent ? t("help.submitted") : t("help.submit")}
              </button>
            </div>
          </Panel>

          <footer className="pb-4 pt-2 text-center text-xs text-muted-foreground">
            {t("help.footer")}
          </footer>
        </main>
      </div>
    </div>
  )
}
