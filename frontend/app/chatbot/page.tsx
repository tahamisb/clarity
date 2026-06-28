"use client"

import React, { useState, useRef, useEffect } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { Sidebar } from "@/components/rafeeq/sidebar"
import { Paperclip, Mic, Send, Bot, User, Loader2, X, Diamond, MessageSquare } from "lucide-react"
import { cn } from "@/lib/utils"
import { useT } from "@/lib/i18n"

interface ChatMessage {
  role: "user" | "bot"
  text: string
  image?: {
    mime_type: string
    data: string
  }
}

const SUGGESTION_KEYS = [
  "bot.suggestion1",
  "bot.suggestion2",
  "bot.suggestion3",
  "bot.suggestion4",
]

export default function ChatbotPage() {
  const t = useT()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [attachedImage, setAttachedImage] = useState<{ url: string; mime_type: string; data: string } | null>(null)
  const [isRecording, setIsRecording] = useState(false)
  
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  
  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  const handleSend = async (text: string = input, img = attachedImage) => {
    if (!text.trim() && !img) return
    
    const newMessage: ChatMessage = { role: "user", text: text.trim() }
    if (img) {
      newMessage.image = { mime_type: img.mime_type, data: img.data }
    }
    
    const newMessages = [...messages, newMessage]
    setMessages(newMessages)
    setInput("")
    setAttachedImage(null)
    setIsLoading(true)

    try {
      const res = await fetch("http://localhost:8000/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: newMessages }),
      })
      
      if (!res.ok) throw new Error("Failed to fetch response")
        
      const data = await res.json()
      setMessages([...newMessages, { role: "bot", text: data.text }])
    } catch (error) {
      console.error(error)
      setMessages([...newMessages, { role: "bot", text: t("bot.error") }])
    } finally {
      setIsLoading(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      const reader = new FileReader()
      reader.onload = (event) => {
        const base64String = (event.target?.result as string).split(',')[1]
        setAttachedImage({
          url: URL.createObjectURL(file),
          mime_type: file.type,
          data: base64String
        })
      }
      reader.readAsDataURL(file)
    }
  }

  const toggleRecording = () => {
    if (isRecording) {
      setIsRecording(false)
      return
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SpeechRecognition) {
      alert(t("bot.speechUnsupported"))
      return
    }

    const recognition = new SpeechRecognition()
    recognition.continuous = false
    recognition.interimResults = false
    recognition.lang = 'en-US'

    recognition.onstart = () => {
      setIsRecording(true)
    }

    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript
      setInput((prev) => prev + (prev ? " " : "") + transcript)
    }

    recognition.onerror = (event: any) => {
      console.error(event.error)
      setIsRecording(false)
    }

    recognition.onend = () => {
      setIsRecording(false)
    }

    recognition.start()
  }

  return (
    <div className="flex h-screen overflow-hidden font-sans text-foreground">
      <Sidebar />

      <div className="relative flex flex-1 flex-col">
        {/* Top Header */}
        <header className="glass-strong z-10 flex items-center justify-between border-x-0 border-t-0 px-6 py-4 md:px-8">
          <h1 className="flex items-center gap-3 text-xl font-bold tracking-tight text-foreground">
            <MessageSquare className="size-5 text-accent" />
            {t("bot.title")}
          </h1>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 rounded-full border border-border bg-secondary/50 px-3 py-1.5 text-sm font-medium text-accent">
              <Diamond className="size-4 fill-accent text-accent" />
              6 / 75
            </div>
            <div className="flex size-8 items-center justify-center rounded-full bg-gradient-to-br from-primary to-brand-bright text-sm font-bold text-primary-foreground">
              <User className="size-5" />
            </div>
          </div>
        </header>

        {/* Chat Area */}
        <div className="scroll-smooth flex-1 overflow-y-auto p-4 sm:p-8">
          <div className="mx-auto flex max-w-4xl flex-col gap-8 pb-32">

            {messages.length === 0 ? (
              <div className="flex h-full min-h-[400px] animate-in flex-col items-center justify-center px-4 text-center duration-700 fade-in">
                <div className="mb-6 flex size-16 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-brand-bright shadow-lg shadow-primary/25">
                  <Bot className="size-8 text-primary-foreground" />
                </div>
                <h2 className="mb-3 bg-gradient-to-r from-foreground to-muted-foreground bg-clip-text text-3xl font-extrabold text-transparent">
                  {t("bot.greeting")}
                </h2>
                <p className="mb-10 max-w-lg text-lg text-muted-foreground">
                  {t("bot.intro")}
                </p>

                <div className="grid w-full max-w-2xl grid-cols-1 gap-3 sm:grid-cols-2">
                  {SUGGESTION_KEYS.map((key) => (
                    <button
                      key={key}
                      onClick={() => handleSend(t(key))}
                      className="glass group flex items-center gap-3 rounded-2xl p-4 text-left transition-all duration-300 hover:-translate-y-0.5"
                    >
                      <div className="flex size-8 items-center justify-center rounded-full bg-accent/10 transition-colors group-hover:bg-accent/20">
                        <MessageSquare className="size-4 text-accent" />
                      </div>
                      <span className="text-sm font-medium text-foreground/80 group-hover:text-foreground">{t(key)}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((msg, idx) => {
                const isBot = msg.role === "bot"
                return (
                  <div key={idx} className={cn("flex w-full", isBot ? "justify-start" : "justify-end")}>
                    {isBot && (
                      <div className="mr-4 mt-1 flex size-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-brand-bright shadow-sm">
                        <Bot className="size-4 text-primary-foreground" />
                      </div>
                    )}
                    <div className={cn(
                      "max-w-[85%] rounded-2xl px-5 py-4 text-[15px] leading-relaxed shadow-sm",
                      isBot
                        ? "glass rounded-tl-sm text-foreground"
                        : "rounded-tr-sm bg-gradient-to-br from-primary to-brand-deep text-white"
                    )}>
                      {msg.image && (
                        <div className="mb-3">
                          <img src={`data:${msg.image.mime_type};base64,${msg.image.data}`} alt="Attached" className="max-w-xs rounded-lg border border-border shadow-md" />
                        </div>
                      )}
                      {isBot ? (
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          components={{
                            h3: ({ children }) => <h3 className="mb-2 mt-4 text-base font-bold text-foreground first:mt-0">{children}</h3>,
                            h4: ({ children }) => <h4 className="mb-1.5 mt-3 text-sm font-bold text-foreground first:mt-0">{children}</h4>,
                            p: ({ children }) => <p className="mb-2 leading-relaxed text-foreground/85 last:mb-0">{children}</p>,
                            strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
                            em: ({ children }) => <em className="font-medium not-italic text-accent">{children}</em>,
                            ul: ({ children }) => <ul className="mb-2 space-y-1 pl-4">{children}</ul>,
                            ol: ({ children }) => <ol className="mb-2 list-decimal space-y-1 pl-4">{children}</ol>,
                            li: ({ children }) => (
                              <li className="flex gap-2 text-foreground/85">
                                <span className="mt-1.5 shrink-0 text-accent">•</span>
                                <span>{children}</span>
                              </li>
                            ),
                            blockquote: ({ children }) => (
                              <blockquote className="my-3 rounded-r-lg border-l-2 border-accent bg-accent/5 py-1 pl-4 italic text-foreground/80">
                                {children}
                              </blockquote>
                            ),
                            code: ({ children, className }) => {
                              const isBlock = className?.includes("language-")
                              return isBlock ? (
                                <code className="my-2 block overflow-x-auto rounded-lg border border-border bg-secondary/60 p-3 font-mono text-xs text-foreground">{children}</code>
                              ) : (
                                <code className="rounded bg-secondary px-1.5 py-0.5 font-mono text-xs text-accent">{children}</code>
                              )
                            },
                            table: ({ children }) => (
                              <div className="my-3 overflow-x-auto rounded-lg border border-border">
                                <table className="w-full border-collapse text-sm">{children}</table>
                              </div>
                            ),
                            thead: ({ children }) => <thead className="bg-primary/15 text-primary">{children}</thead>,
                            tbody: ({ children }) => <tbody className="divide-y divide-border">{children}</tbody>,
                            th: ({ children }) => <th className="whitespace-nowrap px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider">{children}</th>,
                            td: ({ children }) => <td className="whitespace-nowrap px-4 py-2.5 text-foreground/80">{children}</td>,
                            tr: ({ children }) => <tr className="transition-colors hover:bg-secondary/50">{children}</tr>,
                            hr: () => <hr className="my-3 border-border" />,
                          }}
                        >
                          {msg.text}
                        </ReactMarkdown>
                      ) : (
                        msg.text
                      )}
                    </div>
                    {!isBot && (
                      <div className="ml-4 mt-1 flex size-8 shrink-0 items-center justify-center rounded-full border border-accent/30 bg-accent/15">
                        <User className="size-4 text-accent" />
                      </div>
                    )}
                  </div>
                )
              })
            )}

            {isLoading && (
              <div className="flex w-full justify-start">
                <div className="mr-4 mt-1 flex size-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-brand-bright shadow-sm">
                  <Bot className="size-4 text-primary-foreground" />
                </div>
                <div className="glass flex max-w-[85%] items-center gap-2 rounded-2xl rounded-tl-sm px-5 py-4">
                  <Loader2 className="size-4 animate-spin text-accent" />
                  <span className="text-sm text-muted-foreground">{t("bot.analyzing")}</span>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Input Area */}
        <div className="absolute bottom-0 w-full bg-gradient-to-t from-background via-background to-transparent px-4 pb-8 pt-10 sm:px-8">
          <div className="relative mx-auto max-w-4xl">

            {attachedImage && (
              <div className="glass absolute -top-20 left-4 flex items-start gap-2 rounded-xl p-1">
                <img src={attachedImage.url} alt="Preview" className="h-16 w-16 rounded-md object-cover" />
                <button
                  onClick={() => setAttachedImage(null)}
                  className="rounded-full p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                >
                  <X className="size-4" />
                </button>
              </div>
            )}

            <div className="glass-strong flex items-center gap-2 rounded-full p-2 pr-3 transition-all focus-within:border-accent/50">
              <input
                type="file"
                accept="image/*"
                ref={fileInputRef}
                onChange={handleFileChange}
                className="hidden"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="shrink-0 rounded-full p-3 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                title={t("bot.attachImage")}
              >
                <Paperclip className="size-5" />
              </button>

              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={t("bot.placeholder")}
                className="flex-1 border-none bg-transparent px-2 text-[15px] text-foreground outline-none placeholder:text-muted-foreground"
              />

              <button
                onClick={toggleRecording}
                className={cn(
                  "relative shrink-0 rounded-full p-3 transition-colors",
                  isRecording
                    ? "bg-negative/10 text-negative hover:bg-negative/20"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                )}
                title={t("bot.voiceInput")}
              >
                <Mic className="size-5" />
                {isRecording && <span className="absolute right-2 top-2 size-2 animate-ping rounded-full bg-negative" />}
              </button>

              <button
                onClick={() => handleSend()}
                disabled={!input.trim() && !attachedImage || isLoading}
                className="ml-1 shrink-0 rounded-full bg-primary p-3 text-primary-foreground shadow-md shadow-primary/25 transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                <Send className="size-5 pl-0.5" />
              </button>
            </div>

            <p className="mt-3 text-center text-[11px] font-medium tracking-wide text-muted-foreground">
              {t("bot.disclaimer")}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
