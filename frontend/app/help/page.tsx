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
import { cn } from "@/lib/utils"

const METRICS = [
  { term: "Cancellation Rate", how: "Cancelled orders ÷ total placed orders in the period, expressed as a %. Computed per zone and per merchant from the vendor_kpi feed." },
  { term: "WoW Trend", how: "Week-over-week change: (this week − last week) ÷ last week. A +12% WoW means the metric rose 12% versus the prior 7-day window." },
  { term: "NLP Accuracy", how: "Share of messages where the model’s predicted intent matched a human-reviewed label, across the audited sample set." },
  { term: "Sentiment Score", how: "Weighted blend of positive/neutral/negative classifications per interaction, normalised to a 0–10 scale. Higher is better." },
]

const FAQS = [
  { q: "What should I do when ‘Late Preparation’ is the top cancellation driver?", a: "Cross-reference the affected merchants on the Cancellations page, check prep-time outliers in vendor_kpi, and trigger a merchant ops review. Consider temporarily widening delivery ETAs for those vendors." },
  { q: "Why did a message get classified as the wrong intent?", a: "The NLP engine maps keywords to intents using the rules in Settings → ML Model Tuning. Add or adjust a Keyword → Intent mapping there, or lower the confidence threshold to capture edge cases." },
  { q: "How are ‘Live High-Risk Orders’ chosen?", a: "Orders scoring above the confidence threshold (Settings → ML Model Tuning) on the cancellation-risk model. Raise the threshold to surface fewer, higher-precision orders." },
  { q: "Counts look different between Calls and Messages — why?", a: "They are separate channels with independent ingestion. The Cross-Channel panel on Support Messages reconciles shared intents across both." },
]

const GUIDES = [
  { name: "Call Intelligence", desc: "Transcripts, intent tagging, sentiment and the Qatar coverage map.", icon: PhoneCall },
  { name: "Support Messages", desc: "Cross-channel sentiment, negative triggers and zone/time analysis.", icon: MessageSquare },
  { name: "Cancellations", desc: "Risk drivers, merchant × time heatmap and live high-risk orders.", icon: Ban },
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
        <Topbar title="Help & Documentation" search={search} onSearch={setSearch} />

        <main className="flex flex-1 flex-col gap-6 p-4 md:p-6">
          {/* Header */}
          <div className="flex flex-col items-start gap-2 border-b border-border pb-5">
            <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Help &amp; Documentation</h1>
            <p className="text-sm text-muted-foreground">
              Understand the metrics, learn the dashboards, and reach the analytics &amp; engineering teams.
            </p>
          </div>

          {/* Glossary */}
          <Panel title="CX Data Dictionary & Glossary" action={<BookOpen className="size-4 text-accent" />}>
            <div className="mb-4 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <Calculator className="size-3.5" /> Metrics Decoder
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {METRICS.map((m) => (
                <div key={m.term} className="rounded-xl border border-border bg-secondary/40 p-4">
                  <p className="text-sm font-bold text-foreground">{m.term}</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{m.how}</p>
                </div>
              ))}
            </div>

            <div className="mt-5 flex items-start gap-3 rounded-xl border border-accent/20 bg-accent/5 p-4">
              <div className="mt-0.5 rounded-full bg-accent/20 p-1.5 text-accent"><ShieldAlert className="size-4" /></div>
              <div>
                <p className="text-sm font-semibold text-foreground">ML Classifier Guide</p>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  An order earns the <span className="font-semibold text-foreground">High Risk</span> label when the cancellation-risk model scores it above the confidence threshold (Settings → ML Model Tuning). A message is marked <span className="font-semibold text-foreground">Urgent</span> when it combines strongly negative sentiment with a time-sensitive intent (e.g. Late Delivery or Refund Request).
                </p>
              </div>
            </div>
          </Panel>

          {/* Walkthroughs */}
          <Panel
            title="Interactive Walkthroughs & Onboarding"
            action={<span className="flex items-center gap-2"><WipBadge /><Compass className="size-4 text-accent" /></span>}
          >
            <WorkInProgress note="Guided product tours are still being built. They'll be available here soon.">
              <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
                {GUIDES.map((g) => (
                  <div key={g.name} className="flex flex-col rounded-xl border border-border bg-secondary/40 p-4">
                    <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary/20 to-brand-bright/10 text-accent ring-1 ring-accent/20">
                      <g.icon className="size-4" />
                    </div>
                    <p className="mt-3 text-sm font-semibold text-foreground">{g.name}</p>
                    <p className="mt-1 flex-1 text-xs leading-relaxed text-muted-foreground">{g.desc}</p>
                    <span className="mt-3 inline-flex items-center gap-1.5 self-start rounded-full bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary">
                      <PlayCircle className="size-3.5" /> Start tour
                    </span>
                  </div>
                ))}
              </div>
            </WorkInProgress>

            <div className="mt-6 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <HelpCircle className="size-3.5" /> FAQ & Best Practices
            </div>
            <div className="mt-1">
              {FAQS.map((f) => <Accordion key={f.q} q={f.q} a={f.a} />)}
            </div>
          </Panel>

          {/* Feedback */}
          <Panel title="Internal Escalation & Feedback" action={<Bug className="size-4 text-accent" />}>
            <p className="text-sm text-muted-foreground">
              Report a bug, request a feature, or flag an incorrect AI label directly to the internal analytics &amp; engineering teams.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-1 rounded-full border border-border bg-secondary/60 p-1">
              {([
                { value: "bug", label: "Report a bug" },
                { value: "feature", label: "Request a feature" },
                { value: "label", label: "Flag AI labeling" },
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
              placeholder="Describe the issue, the page it occurred on, and what you expected to happen…"
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
                {sent ? "Submitted" : "Submit"}
              </button>
            </div>
          </Panel>

          <footer className="pb-4 pt-2 text-center text-xs text-muted-foreground">
            Rafeeq Analytics · Help &amp; Documentation
          </footer>
        </main>
      </div>
    </div>
  )
}
