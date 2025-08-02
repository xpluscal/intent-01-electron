import { cn } from '@/lib/utils'

interface KeyboardHintProps {
  keys: string[]
  className?: string
}

export function KeyboardHint({ keys, className }: KeyboardHintProps) {
  return (
    <div className={cn("flex items-center gap-1", className)}>
      {keys.map((key, index) => (
        <span key={index} className="flex items-center gap-1">
          {index > 0 && <span className="text-muted-foreground">+</span>}
          <kbd className="pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground opacity-100">
            {key}
          </kbd>
        </span>
      ))}
    </div>
  )
}