import { cn } from "@/lib/utils"

export function Panel({
  title,
  action,
  children,
  className,
}: {
  title?: string
  action?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={cn("glass min-w-0 overflow-hidden rounded-2xl p-5", className)}>
      {(title || action) && (
        <div className="mb-4 flex items-center justify-between gap-2">
          {title && (
            <h2 className="font-heading text-base font-extrabold uppercase tracking-tight text-foreground">
              {title}
            </h2>
          )}
          {action}
        </div>
      )}
      {children}
    </section>
  )
}
