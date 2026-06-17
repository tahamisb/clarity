"use client"

import {
  LayoutDashboard,
  PhoneCall,
  Workflow,
  FileBarChart,
  Tags,
  Map,
  Settings,
  HelpCircle,
  MessageSquare,
  ChevronDown,
  ChevronRight,
  Ban,
  Bot,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useState, useEffect } from "react"
import { usePathname, useRouter } from "next/navigation"

const PAGES = [
  {
    id: "cx-dashboard",
    label: "CX Dashboard",
    href: "/cx-dashboard",
    icon: LayoutDashboard,
    parts: []
  },
  {
    id: "chatbot",
    label: "Chatbot",
    href: "/chatbot",
    icon: Bot,
    parts: [],
    disabled: true
  },
  {
    id: "call-intelligence",
    label: "Call Intelligence",
    href: "/",
    icon: PhoneCall,
    parts: [
      { label: "Overview", id: "dashboard", icon: LayoutDashboard },
      { label: "Call Logs", id: "calls", icon: PhoneCall },
      { label: "Pipeline", id: "pipeline", icon: Workflow },
      { label: "Intents", id: "intents", icon: Tags },
      { label: "Coverage", id: "coverage", icon: Map },
      { label: "Reports", id: "reports", icon: FileBarChart },
    ]
  },
  {
    id: "messages",
    label: "Support Messages",
    href: "/messages",
    icon: MessageSquare,
    parts: []
  },
  {
    id: "cancellations",
    label: "Cancellations",
    href: "/cancellations",
    icon: Ban,
    parts: []
  }
]

export function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const [activeTab, setActiveTab] = useState("dashboard")
  const [expanded, setExpanded] = useState("call-intelligence")

  // Active-state highlighting is derived from the current pathname, which is
  // not reliably available during static server rendering. Defer it to the
  // client (post-mount) so the server and first client render agree, avoiding
  // a hydration mismatch.
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (pathname === "/messages") {
      setActiveTab("messages")
      setExpanded("messages")
    } else if (pathname === "/cancellations") {
      setActiveTab("cancellations")
      setExpanded("cancellations")
    } else if (pathname === "/cx-dashboard") {
      setActiveTab("cx-dashboard")
      setExpanded("cx-dashboard")
    } else if (pathname === "/chatbot") {
      setActiveTab("chatbot")
      setExpanded("chatbot")
    } else {
      setExpanded("call-intelligence")
      if (activeTab === "messages" || activeTab === "cancellations" || activeTab === "cx-dashboard" || activeTab === "chatbot") {
        setActiveTab("dashboard")
      }
    }
  }, [pathname, activeTab])

  const handlePageClick = (pageId: string, pageHref: string) => {
    if (pathname !== pageHref) {
      router.push(pageHref)
    } else {
      window.scrollTo({ top: 0, behavior: "smooth" })
    }
    setExpanded(pageId)
    setActiveTab(pageId === "messages" ? "messages" : pageId === "cancellations" ? "cancellations" : pageId === "cx-dashboard" ? "cx-dashboard" : pageId === "chatbot" ? "chatbot" : "dashboard")
  }

  const handlePartClick = (id: string, pageHref: string) => {
    setActiveTab(id)
    
    if (pathname !== pageHref) {
      router.push(`${pageHref}#${id}`)
      return
    }

    const el = document.getElementById(id)
    if (el) {
      el.scrollIntoView({ behavior: "smooth" })
    }
  }

  return (
    <aside className="glass-strong sticky top-0 hidden h-screen w-60 shrink-0 flex-col rounded-none border-y-0 border-l-0 lg:flex">
      <div className="flex items-center gap-3 border-b border-sidebar-border px-5 py-5">
        <img
          src="/rafeeq-logotype.svg"
          alt="Rafeeq"
          className="h-7 w-auto dark:brightness-125"
        />
      </div>

      <nav className="flex-1 px-3 py-5">
        <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Modules
        </p>
        <div className="flex flex-col gap-3">
          {PAGES.map((page) => {
            const isExpanded = expanded === page.id
            const isActivePage = mounted && pathname === page.href
            const isDisabled = "disabled" in page && page.disabled

            if (isDisabled) {
              return (
                <div key={page.id} className="flex flex-col gap-1">
                  <div
                    className="flex cursor-not-allowed items-center justify-between rounded-lg px-2 py-1.5 text-muted-foreground/50"
                    aria-disabled="true"
                    title="Chatbot is temporarily unavailable"
                  >
                    <span className="flex flex-1 items-center gap-2.5 px-1 py-0.5 text-sm font-semibold">
                      <page.icon className="size-4" />
                      {page.label}
                    </span>
                    <span className="rounded-full bg-secondary px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
                      Soon
                    </span>
                  </div>
                </div>
              )
            }

            return (
              <div key={page.id} className="flex flex-col gap-1">
                <div className={cn(
                  "flex items-center justify-between rounded-lg px-2 py-1.5 transition-colors",
                  isActivePage && !isExpanded ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
                  isExpanded ? "text-foreground" : ""
                )}>
                  <button
                    className="flex flex-1 items-center gap-2.5 px-1 py-0.5 text-sm font-semibold"
                    onClick={() => handlePageClick(page.id, page.href)}
                  >
                    <page.icon className="size-4" />
                    {page.label}
                  </button>

                  {page.parts.length > 0 && (
                    <button 
                      className="flex size-6 items-center justify-center rounded-md hover:bg-secondary/60 text-muted-foreground transition-colors"
                      onClick={(e) => {
                        e.stopPropagation()
                        setExpanded(isExpanded ? "" : page.id)
                      }}
                    >
                      {isExpanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                    </button>
                  )}
                </div>

                {isExpanded && page.parts.length > 0 && (
                  <ul className="mt-1 flex flex-col gap-0.5 pl-4 relative before:absolute before:left-[21px] before:top-1 before:bottom-1 before:w-[1px] before:bg-border">
                    {page.parts.map((part) => {
                      const isPartActive = activeTab === part.id && isActivePage
                      return (
                        <li key={part.id} className="relative z-10 pl-6">
                          <button
                            onClick={() => handlePartClick(part.id, page.href)}
                            className={cn(
                              "flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-[13px] font-medium transition-all",
                              isPartActive
                                ? "bg-primary/10 text-primary shadow-sm"
                                : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
                            )}
                          >
                            <part.icon className={cn("size-3.5", isPartActive ? "text-primary" : "text-muted-foreground/70")} />
                            {part.label}
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            )
          })}
        </div>
      </nav>

      <div className="border-t border-sidebar-border px-3 py-4">
        <ul className="flex flex-col gap-1">
          {[
            { label: "Settings", icon: Settings, href: "/settings" },
            { label: "Help", icon: HelpCircle, href: "/help" },
          ].map((item) => {
            const isActive = mounted && pathname === item.href
            return (
              <li key={item.label}>
                <button
                  onClick={() => {
                    if (pathname !== item.href) router.push(item.href)
                    else window.scrollTo({ top: 0, behavior: "smooth" })
                  }}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                    isActive
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
                  )}
                >
                  <item.icon className="size-4" />
                  {item.label}
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    </aside>
  )
}

