"use client"

import { useRef, useState } from "react"
import { Send, Sparkles, Loader2 } from "lucide-react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { askCancellationChat } from "@/lib/api"
import { useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"

type ChatMessage = { role: "user" | "bot"; text: string }

const SUGGESTION_KEYS = ["cc.suggestion1", "cc.suggestion2", "cc.suggestion3"]

// Markdown renderers — mirror the main chatbot styling
const MD_COMPONENTS = {
  h3: ({ children }: any) => <h3 className="mb-2 mt-4 text-sm font-bold text-foreground first:mt-0">{children}</h3>,
  h4: ({ children }: any) => <h4 className="mb-1.5 mt-3 text-sm font-bold text-foreground first:mt-0">{children}</h4>,
  p: ({ children }: any) => <p className="mb-2 leading-relaxed text-foreground/85 last:mb-0">{children}</p>,
  strong: ({ children }: any) => <strong className="font-semibold text-foreground">{children}</strong>,
  em: ({ children }: any) => <em className="font-medium not-italic text-accent">{children}</em>,
  ul: ({ children }: any) => <ul className="mb-2 space-y-1 pl-1">{children}</ul>,
  ol: ({ children }: any) => <ol className="mb-2 list-decimal space-y-1 pl-4">{children}</ol>,
  li: ({ children }: any) => (
    <li className="flex gap-2 text-foreground/85">
      <span className="mt-1.5 shrink-0 text-accent">•</span>
      <span>{children}</span>
    </li>
  ),
  blockquote: ({ children }: any) => (
    <blockquote className="my-2 rounded-r-lg border-l-2 border-accent bg-accent/5 py-1 pl-3 italic text-foreground/80">
      {children}
    </blockquote>
  ),
  table: ({ children }: any) => (
    <div className="my-2 overflow-x-auto rounded-lg border border-border">
      <table className="w-full border-collapse text-xs">{children}</table>
    </div>
  ),
  thead: ({ children }: any) => <thead className="bg-primary/15 text-primary">{children}</thead>,
  th: ({ children }: any) => <th className="whitespace-nowrap px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider">{children}</th>,
  td: ({ children }: any) => <td className="whitespace-nowrap px-3 py-2 text-foreground/80">{children}</td>,
}

export function CancellationChat() {
  const t = useT()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState("")
  const [loading, setLoading] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  async function send(question: string) {
    const q = question.trim()
    if (!q || loading) return
    const next: ChatMessage[] = [...messages, { role: "user", text: q }]
    setMessages(next)
    setInput("")
    setLoading(true)
    const res = await askCancellationChat(q)
    setMessages([
      ...next,
      { role: "bot", text: res?.answer ?? t("cc.error") },
    ])
    setLoading(false)
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }))
  }

  return (
    <div className="flex h-full flex-col rounded-xl border border-border bg-card shadow-sm">
      <div className="flex items-center gap-2 border-b border-border p-4 text-primary">
        <Sparkles className="size-5" />
        <h2 className="text-sm font-semibold uppercase tracking-wide">{t("cc.title")}</h2>
      </div>

      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-4" style={{ maxHeight: 420 }}>
        {messages.length === 0 && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {t("cc.intro")}
            </p>
            <div className="flex flex-wrap gap-2">
              {SUGGESTION_KEYS.map((key) => (
                <button
                  key={key}
                  onClick={() => send(t(key))}
                  className="rounded-full border border-border bg-secondary/60 px-3 py-1.5 text-xs text-foreground transition-colors hover:border-accent/50"
                >
                  {t(key)}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
            <div
              className={cn(
                "max-w-[85%] rounded-2xl px-4 py-2.5 text-sm",
                m.role === "user"
                  ? "bg-gradient-to-br from-primary to-brand-deep text-primary-foreground"
                  : "border border-border bg-secondary/40 text-foreground",
              )}
            >
              {m.role === "bot" ? (
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>
                  {m.text}
                </ReactMarkdown>
              ) : (
                m.text
              )}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin text-accent" />
            {t("cc.analyzing")}
          </div>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          send(input)
        }}
        className="flex items-center gap-2 border-t border-border p-3"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t("cc.placeholder")}
          className="flex-1 rounded-full border border-border bg-background px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40"
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="flex size-9 items-center justify-center rounded-full bg-primary text-primary-foreground transition-transform hover:-translate-y-0.5 disabled:opacity-50"
        >
          <Send className="size-4" />
        </button>
      </form>
    </div>
  )
}
