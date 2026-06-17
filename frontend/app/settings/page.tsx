"use client"

import { useState } from "react"
import {
  Palette, Clock, SlidersHorizontal, Plug, Database,
  MessageSquare, Plus, X, Save, Check, Mail, Hash, RefreshCw,
} from "lucide-react"
import { Sidebar } from "@/components/rafeeq/sidebar"
import { Topbar } from "@/components/rafeeq/topbar"
import { Panel } from "@/components/rafeeq/panel"
import { ThemeToggle } from "@/components/rafeeq/theme-toggle"
import { WorkInProgress, WipBadge } from "@/components/rafeeq/work-in-progress"
import { REFRESH_OPTIONS, useSettings } from "@/lib/settings-context"
import { cn } from "@/lib/utils"

// ---------------------------------------------------------------------------
// Small form primitives (prototype-level, local state only)
// ---------------------------------------------------------------------------
function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors",
        checked ? "bg-primary" : "bg-secondary",
      )}
    >
      <span
        className={cn(
          "inline-block size-5 transform rounded-full bg-white shadow-sm transition-transform",
          checked ? "translate-x-5" : "translate-x-0.5",
        )}
      />
    </button>
  )
}

function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="flex items-center gap-1 rounded-full border border-border bg-secondary/60 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-full px-4 py-1.5 text-xs font-semibold transition-colors",
            value === o.value ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function NumberField({ value, onChange, suffix, className }: { value: number; onChange: (v: number) => void; suffix?: string; className?: string }) {
  return (
    <div className={cn("inline-flex items-center gap-1.5 rounded-lg border border-border bg-secondary/50 px-3 py-1.5", className)}>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-16 bg-transparent text-sm font-semibold text-foreground outline-none"
      />
      {suffix && <span className="text-xs text-muted-foreground">{suffix}</span>}
    </div>
  )
}

function SettingRow({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 border-b border-border py-4 last:border-b-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="max-w-md">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        {desc && <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{desc}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

const INTEGRATIONS = [
  { name: "Delivery Dispatch System", desc: "Correlate driver delays with cancellations", icon: MessageSquare, status: "Connected" },
  { name: "Zendesk / Salesforce", desc: "Sync inbound support messages & tickets", icon: Database, status: "Connected" },
  { name: "Customer Database", desc: "Enrich profiles, order history & zones", icon: Database, status: "Not connected" },
]

export default function SettingsPage() {
  const [search, setSearch] = useState("")
  const { settings, update } = useSettings()

  // ML tuning (keyword → intent mappings remain a local prototype — see WIP badge)
  const [mappings, setMappings] = useState([
    { keyword: "where is my food", intent: "Late Delivery" },
    { keyword: "stuck", intent: "Late Delivery" },
    { keyword: "refund", intent: "Refund Request" },
    { keyword: "cold", intent: "Food Quality" },
  ])
  const [newKeyword, setNewKeyword] = useState("")
  const [newIntent, setNewIntent] = useState("")

  const [saved, setSaved] = useState(false)
  const onSave = () => {
    setSaved(true)
    window.setTimeout(() => setSaved(false), 2400)
  }

  const addMapping = () => {
    if (!newKeyword.trim() || !newIntent.trim()) return
    setMappings((m) => [...m, { keyword: newKeyword.trim(), intent: newIntent.trim() }])
    setNewKeyword("")
    setNewIntent("")
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar title="Settings" search={search} onSearch={setSearch} />

        <main className="flex flex-1 flex-col gap-6 p-4 md:p-6">
          {/* Header */}
          <div className="flex flex-col items-start gap-2 border-b border-border pb-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Settings</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Configure appearance, SLAs, alerting, the ML classifier, and integrations.
              </p>
            </div>
            <button
              onClick={onSave}
              className={cn(
                "inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-bold shadow-sm transition-all",
                saved ? "bg-positive text-white" : "bg-primary text-primary-foreground hover:-translate-y-0.5",
              )}
            >
              {saved ? <Check className="size-4" /> : <Save className="size-4" />}
              {saved ? "Saved" : "Save changes"}
            </button>
          </div>

          {/* Appearance */}
          <Panel title="Appearance" action={<Palette className="size-4 text-accent" />}>
            <SettingRow title="Theme" desc="Switch between light and dark, or follow your device. System matches your OS setting automatically.">
              <ThemeToggle />
            </SettingRow>
            <SettingRow title="Language" desc="Dashboard localization. Arabic switches the interface to right-to-left.">
              <Segmented
                value={settings.language}
                onChange={(v) => update({ language: v })}
                options={[{ value: "en", label: "English" }, { value: "ar", label: "العربية" }]}
              />
            </SettingRow>
          </Panel>

          {/* Live data & auto-refresh */}
          <Panel title="Live Data & Auto-Refresh" action={<RefreshCw className="size-4 text-accent" />}>
            <SettingRow
              title="Auto-refresh interval"
              desc="How often Call Intelligence, Support Messages and Cancellations re-fetch their data from the backend in the background. Set to Off to refresh manually only."
            >
              <div className="flex flex-wrap items-center gap-1 rounded-full border border-border bg-secondary/60 p-1">
                {REFRESH_OPTIONS.map((o) => (
                  <button
                    key={o.value}
                    onClick={() => update({ refreshIntervalSec: o.value })}
                    className={cn(
                      "rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors",
                      settings.refreshIntervalSec === o.value
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </SettingRow>
          </Panel>

          {/* SLA & Alerts */}
          <Panel title="SLA & Alert Configurations" action={<Clock className="size-4 text-accent" />}>
            <SettingRow title="Custom SLA Targets" desc="Define target resolution times. Visual breach indicators appear on the dashboards as teams near these limits.">
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  Chat <NumberField value={settings.chatSlaHours} onChange={(v) => update({ chatSlaHours: v })} suffix="h" />
                </label>
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  General <NumberField value={settings.generalSlaHours} onChange={(v) => update({ generalSlaHours: v })} suffix="h" />
                </label>
              </div>
            </SettingRow>
            <SettingRow title="Cancellation alert threshold" desc="Show an alert on the Cancellations dashboard (and notify the channels below) when the cancellation rate in any zone exceeds this percentage.">
              <NumberField value={settings.cancelThresholdPct} onChange={(v) => update({ cancelThresholdPct: v })} suffix="%" />
            </SettingRow>
            <SettingRow title="Sentiment spike threshold" desc="Alert on the Support Messages dashboard when negative sentiment jumps week-over-week by more than this many points.">
              <NumberField value={settings.sentimentSpikePct} onChange={(v) => update({ sentimentSpikePct: v })} suffix="pts" />
            </SettingRow>
            <SettingRow title="Alert channels" desc="Which channels the threshold alerts above are delivered to.">
              <div className="flex items-center gap-5">
                <span className="flex items-center gap-2 text-sm text-foreground"><Hash className="size-4 text-muted-foreground" />Slack <Switch checked={settings.slackAlerts} onChange={(v) => update({ slackAlerts: v })} label="Slack alerts" /></span>
                <span className="flex items-center gap-2 text-sm text-foreground"><Mail className="size-4 text-muted-foreground" />Email <Switch checked={settings.emailAlerts} onChange={(v) => update({ emailAlerts: v })} label="Email alerts" /></span>
              </div>
            </SettingRow>
          </Panel>

          {/* ML Model Tuning */}
          <Panel
            title="ML Model Tuning & Simulator"
            action={<span className="flex items-center gap-2"><WipBadge /><SlidersHorizontal className="size-4 text-accent" /></span>}
          >
           <WorkInProgress note="Confidence tuning and the keyword → intent simulator are under active development.">
            <div className="border-b border-border py-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-foreground">Confidence threshold</p>
                <span className="rounded-full bg-accent/15 px-2.5 py-0.5 text-xs font-bold text-accent">{settings.confidencePct}%</span>
              </div>
              <p className="mt-0.5 max-w-md text-xs leading-relaxed text-muted-foreground">
                Cutoff used to flag “Live High-Risk Orders” on the Cancellations page. Higher values surface fewer, higher-confidence orders.
              </p>
              <input
                type="range"
                min={50}
                max={90}
                value={settings.confidencePct}
                onChange={(e) => update({ confidencePct: Number(e.target.value) })}
                className="mt-3 w-full accent-[var(--primary)]"
              />
              <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
                <span>50% · more flags</span>
                <span>90% · high precision</span>
              </div>
            </div>

            <div className="py-4">
              <p className="text-sm font-semibold text-foreground">Keyword → Intent mapping</p>
              <p className="mt-0.5 max-w-md text-xs leading-relaxed text-muted-foreground">
                Customize how the NLP engine maps incoming customer keywords to support intents.
              </p>
              <ul className="mt-3 flex flex-col gap-2">
                {mappings.map((m, i) => (
                  <li key={i} className="flex items-center gap-2 rounded-lg border border-border bg-secondary/40 px-3 py-2 text-sm">
                    <span className="font-mono text-xs text-foreground">“{m.keyword}”</span>
                    <span className="text-muted-foreground">→</span>
                    <span className="rounded-full bg-accent/15 px-2 py-0.5 text-xs font-semibold text-accent">{m.intent}</span>
                    <button
                      onClick={() => setMappings((arr) => arr.filter((_, idx) => idx !== i))}
                      className="ml-auto text-muted-foreground transition-colors hover:text-negative"
                      aria-label="Remove mapping"
                    >
                      <X className="size-4" />
                    </button>
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <input
                  value={newKeyword}
                  onChange={(e) => setNewKeyword(e.target.value)}
                  placeholder="customer keyword"
                  className="flex-1 min-w-[140px] rounded-lg border border-border bg-secondary/50 px-3 py-1.5 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-accent/50"
                />
                <span className="text-muted-foreground">→</span>
                <input
                  value={newIntent}
                  onChange={(e) => setNewIntent(e.target.value)}
                  placeholder="intent label"
                  className="flex-1 min-w-[140px] rounded-lg border border-border bg-secondary/50 px-3 py-1.5 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-accent/50"
                />
                <button
                  onClick={addMapping}
                  className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-1.5 text-xs font-bold text-primary-foreground transition-transform hover:-translate-y-0.5"
                >
                  <Plus className="size-3.5" />
                  Add
                </button>
              </div>
            </div>
           </WorkInProgress>
          </Panel>

          {/* Integrations */}
          <Panel
            title="Data Connections & Integrations"
            action={<span className="flex items-center gap-2"><WipBadge /><Plug className="size-4 text-accent" /></span>}
          >
           <WorkInProgress note="Connecting external data sources and integrations is coming soon.">
            <ul className="flex flex-col">
              {INTEGRATIONS.map((it) => {
                const connected = it.status === "Connected"
                return (
                  <li key={it.name} className="flex items-center gap-3 border-b border-border py-4 last:border-b-0">
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary/20 to-brand-bright/10 text-accent ring-1 ring-accent/20">
                      <it.icon className="size-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-foreground">{it.name}</p>
                      <p className="truncate text-xs text-muted-foreground">{it.desc}</p>
                    </div>
                    <span className={cn(
                      "hidden items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold sm:inline-flex",
                      connected ? "bg-positive/15 text-positive" : "bg-secondary text-muted-foreground",
                    )}>
                      <span className={cn("size-1.5 rounded-full", connected ? "bg-positive" : "bg-muted-foreground")} />
                      {it.status}
                    </span>
                    <button className="rounded-full border border-border bg-secondary/50 px-4 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-secondary">
                      {connected ? "Configure" : "Connect"}
                    </button>
                  </li>
                )
              })}
            </ul>
           </WorkInProgress>
          </Panel>

          <footer className="pb-4 pt-2 text-center text-xs text-muted-foreground">
            Rafeeq Analytics · Settings
          </footer>
        </main>
      </div>
    </div>
  )
}
