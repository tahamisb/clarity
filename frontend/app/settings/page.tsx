"use client"

import { useState } from "react"
import {
  Palette, Clock, SlidersHorizontal, Plug, Database,
  MessageSquare, Plus, X, Save, Check, Mail, Hash, RefreshCw,
  Bell, Ban, Frown, Lock,
} from "lucide-react"
import { Sidebar } from "@/components/clarity/sidebar"
import { Topbar } from "@/components/clarity/topbar"
import { Panel } from "@/components/clarity/panel"
import { ThemeToggle } from "@/components/clarity/theme-toggle"
import { WorkInProgress, WipBadge } from "@/components/clarity/work-in-progress"
import { REFRESH_OPTIONS, useSettings } from "@/lib/settings-context"
import { useRole } from "@/lib/use-role"
import { useT } from "@/lib/i18n"
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

function SettingRow({ title, desc, children }: { title: React.ReactNode; desc?: string; children: React.ReactNode }) {
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

// Names/descriptions resolve through i18n at render time (see lib/i18n.tsx).
const INTEGRATIONS = [
  { nameKey: "integ.dispatch", descKey: "integ.dispatchDesc", icon: MessageSquare, connected: true },
  { nameKey: "integ.crm", descKey: "integ.crmDesc", icon: Database, connected: true },
  { nameKey: "integ.customerDb", descKey: "integ.customerDbDesc", icon: Database, connected: false },
]

export default function SettingsPage() {
  const t = useT()
  const [search, setSearch] = useState("")
  const { settings, update } = useSettings()
  const role = useRole()
  const isManager = role === "manager"

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
        <Topbar title={t("set.title")} search={search} onSearch={setSearch} />

        <main className="flex flex-1 flex-col gap-6 p-4 md:p-6">
          {/* Header */}
          <div className="flex flex-col items-start gap-2 border-b border-border pb-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">{t("set.title")}</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("set.subtitle")}
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
              {saved ? t("set.saved") : t("set.save")}
            </button>
          </div>

          {/* Appearance */}
          <Panel title={t("set.appearance")} action={<Palette className="size-4 text-accent" />}>
            <SettingRow title={t("set.theme")} desc={t("set.themeDesc")}>
              <ThemeToggle />
            </SettingRow>
            <SettingRow title={t("set.language")} desc={t("set.languageDesc")}>
              <Segmented
                value={settings.language}
                onChange={(v) => update({ language: v })}
                options={[{ value: "en", label: "English" }, { value: "ar", label: "العربية" }]}
              />
            </SettingRow>
          </Panel>

          {/* Live data & auto-refresh */}
          <Panel title={t("set.liveData")} action={<RefreshCw className="size-4 text-accent" />}>
            <SettingRow
              title={t("set.refreshInterval")}
              desc={t("set.refreshIntervalDesc")}
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
                    {t(`refresh.${o.value}`)}
                  </button>
                ))}
              </div>
            </SettingRow>
          </Panel>

          {/* SLA & Alerts */}
          <Panel title={t("set.slaAlerts")} action={<Clock className="size-4 text-accent" />}>
            <SettingRow title={t("set.customSla")} desc={t("set.customSlaDesc")}>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  {t("set.chat")} <NumberField value={settings.chatSlaHours} onChange={(v) => update({ chatSlaHours: v })} suffix={t("set.hoursSuffix")} />
                </label>
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  {t("set.general")} <NumberField value={settings.generalSlaHours} onChange={(v) => update({ generalSlaHours: v })} suffix={t("set.hoursSuffix")} />
                </label>
              </div>
            </SettingRow>
            <SettingRow title={t("set.cancelThreshold")} desc={t("set.cancelThresholdDesc")}>
              <NumberField value={settings.cancelThresholdPct} onChange={(v) => update({ cancelThresholdPct: v })} suffix="%" />
            </SettingRow>
            <SettingRow title={t("set.sentimentSpike")} desc={t("set.sentimentSpikeDesc")}>
              <NumberField value={settings.sentimentSpikePct} onChange={(v) => update({ sentimentSpikePct: v })} suffix={t("set.ptsSuffix")} />
            </SettingRow>
            <SettingRow title={t("set.alertChannels")} desc={t("set.alertChannelsDesc")}>
              <div className="flex items-center gap-5">
                <span className="flex items-center gap-2 text-sm text-foreground"><Hash className="size-4 text-muted-foreground" />{t("set.slack")} <Switch checked={settings.slackAlerts} onChange={(v) => update({ slackAlerts: v })} label={t("set.slack")} /></span>
                <span className="flex items-center gap-2 text-sm text-foreground"><Mail className="size-4 text-muted-foreground" />{t("set.email")} <Switch checked={settings.emailAlerts} onChange={(v) => update({ emailAlerts: v })} label={t("set.email")} /></span>
              </div>
            </SettingRow>
          </Panel>

          {/* Notifications */}
          <Panel
            title={t("set.notifications")}
            action={
              <span className="flex items-center gap-2">
                <span className="rounded-full bg-accent/15 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-accent">
                  {t(`role.${role}`)}
                </span>
                <Bell className="size-4 text-accent" />
              </span>
            }
          >
            <p className="border-b border-border pb-4 text-xs leading-relaxed text-muted-foreground">
              {t("set.notifIntro")}{" "}
              <span className="font-semibold text-foreground">{t(`role.${role}`)}</span>{" "}
              {isManager ? t("set.notifIntroManager") : t("set.notifIntroEmployee")}
            </p>

            <SettingRow
              title={<span className="flex items-center gap-2"><Clock className="size-4 text-destructive" />{t("set.slaBreach")}</span>}
              desc={t("set.slaBreachDesc", { chat: settings.chatSlaHours, general: settings.generalSlaHours })}
            >
              <Switch checked={settings.notifySlaBreaches} onChange={(v) => update({ notifySlaBreaches: v })} label={t("set.slaBreach")} />
            </SettingRow>

            <SettingRow
              title={<span className="flex items-center gap-2"><Ban className="size-4 text-destructive" />{t("set.highRisk")}</span>}
              desc={t("set.highRiskDesc")}
            >
              <Switch checked={settings.notifyHighRiskCancellations} onChange={(v) => update({ notifyHighRiskCancellations: v })} label={t("set.highRisk")} />
            </SettingRow>

            <SettingRow
              title={
                <span className="flex items-center gap-2">
                  <Frown className="size-4 text-amber-500" />{t("set.helpfulness")}
                  {!isManager && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                      <Lock className="size-3" />{t("set.managerOnly")}
                    </span>
                  )}
                </span>
              }
              desc={t("set.helpfulnessDesc")}
            >
              <span className={cn(!isManager && "cursor-not-allowed opacity-40")} title={isManager ? undefined : t("set.managerOnlyTitle")}>
                <span className={cn(!isManager && "pointer-events-none")}>
                  <Switch
                    checked={isManager && settings.notifyAgentHelpfulness}
                    onChange={(v) => isManager && update({ notifyAgentHelpfulness: v })}
                    label={t("set.helpfulness")}
                  />
                </span>
              </span>
            </SettingRow>
          </Panel>

          {/* ML Model Tuning */}
          <Panel
            title={t("set.mlTuning")}
            action={<span className="flex items-center gap-2"><WipBadge /><SlidersHorizontal className="size-4 text-accent" /></span>}
          >
           <WorkInProgress note={t("set.mlWipNote")} label={t("common.workInProgress")}>
            <div className="border-b border-border py-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-foreground">{t("set.confidence")}</p>
                <span className="rounded-full bg-accent/15 px-2.5 py-0.5 text-xs font-bold text-accent">{settings.confidencePct}%</span>
              </div>
              <p className="mt-0.5 max-w-md text-xs leading-relaxed text-muted-foreground">
                {t("set.confidenceDesc")}
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
                <span>{t("set.confidenceMore")}</span>
                <span>{t("set.confidenceHigh")}</span>
              </div>
            </div>

            <div className="py-4">
              <p className="text-sm font-semibold text-foreground">{t("set.keywordIntent")}</p>
              <p className="mt-0.5 max-w-md text-xs leading-relaxed text-muted-foreground">
                {t("set.keywordIntentDesc")}
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
                      aria-label={t("set.removeMapping")}
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
                  placeholder={t("set.keywordPlaceholder")}
                  className="flex-1 min-w-[140px] rounded-lg border border-border bg-secondary/50 px-3 py-1.5 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-accent/50"
                />
                <span className="text-muted-foreground rtl:-scale-x-100">→</span>
                <input
                  value={newIntent}
                  onChange={(e) => setNewIntent(e.target.value)}
                  placeholder={t("set.intentPlaceholder")}
                  className="flex-1 min-w-[140px] rounded-lg border border-border bg-secondary/50 px-3 py-1.5 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-accent/50"
                />
                <button
                  onClick={addMapping}
                  className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-1.5 text-xs font-bold text-primary-foreground transition-transform hover:-translate-y-0.5"
                >
                  <Plus className="size-3.5" />
                  {t("set.add")}
                </button>
              </div>
            </div>
           </WorkInProgress>
          </Panel>

          {/* Integrations */}
          <Panel
            title={t("set.integrations")}
            action={<span className="flex items-center gap-2"><WipBadge /><Plug className="size-4 text-accent" /></span>}
          >
           <WorkInProgress note={t("set.integrationsWipNote")} label={t("common.workInProgress")}>
            <ul className="flex flex-col">
              {INTEGRATIONS.map((it) => (
                  <li key={it.nameKey} className="flex items-center gap-3 border-b border-border py-4 last:border-b-0">
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary/20 to-brand-bright/10 text-accent ring-1 ring-accent/20">
                      <it.icon className="size-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-foreground">{t(it.nameKey)}</p>
                      <p className="truncate text-xs text-muted-foreground">{t(it.descKey)}</p>
                    </div>
                    <span className={cn(
                      "hidden items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold sm:inline-flex",
                      it.connected ? "bg-positive/15 text-positive" : "bg-secondary text-muted-foreground",
                    )}>
                      <span className={cn("size-1.5 rounded-full", it.connected ? "bg-positive" : "bg-muted-foreground")} />
                      {t(it.connected ? "integ.connected" : "integ.notConnected")}
                    </span>
                    <button className="rounded-full border border-border bg-secondary/50 px-4 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-secondary">
                      {t(it.connected ? "integ.configure" : "integ.connect")}
                    </button>
                  </li>
              ))}
            </ul>
           </WorkInProgress>
          </Panel>

          <footer className="pb-4 pt-2 text-center text-xs text-muted-foreground">
            {t("set.footer")}
          </footer>
        </main>
      </div>
    </div>
  )
}
