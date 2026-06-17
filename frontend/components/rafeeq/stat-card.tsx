import { ArrowDownRight, ArrowUpRight, Minus, type LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"

export function StatCard({
  label,
  value,
  change,
  trend = "neutral",
  icon: Icon,
}: {
  label: string
  value: string
  change?: string
  trend?: "up" | "down" | "neutral"
  icon: LucideIcon
}) {
  const TrendIcon =
    trend === "up" ? ArrowUpRight : trend === "down" ? ArrowDownRight : Minus
  const trendColor =
    trend === "up"
      ? "text-positive"
      : trend === "down"
        ? "text-negative"
        : "text-muted-foreground"

  return (
    <div className="glass group rounded-2xl p-4 transition-transform duration-200 hover:-translate-y-0.5">
      <div className="flex items-center justify-between">
        <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary/20 to-brand-bright/10 text-accent ring-1 ring-accent/20">
          <Icon className="size-4" />
        </div>
        {change && (
          <span className={cn("flex items-center gap-0.5 text-xs font-semibold", trendColor)}>
            <TrendIcon className="size-3.5" />
            {change}
          </span>
        )}
      </div>
      <p className="mt-4 font-heading text-3xl font-extrabold tracking-tight text-foreground">
        {value}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">{label}</p>
    </div>
  )
}
