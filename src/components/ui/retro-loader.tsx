import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

interface RetroLoaderProps {
  className?: string
  size?: 'sm' | 'md' | 'lg'
  text?: string
}

export function RetroLoader({ className, size = 'md', text = 'LOADING' }: RetroLoaderProps) {
  const [dots, setDots] = useState('')
  
  useEffect(() => {
    const interval = setInterval(() => {
      setDots(prev => {
        if (prev.length >= 3) return ''
        return prev + '.'
      })
    }, 500)
    
    return () => clearInterval(interval)
  }, [])

  const sizeClasses = {
    sm: 'text-[8px] leading-[9px]',
    md: 'text-[10px] leading-[11px]',
    lg: 'text-xs leading-tight'
  }

  return (
    <div className={cn('flex flex-col items-center gap-2', className)}>
      <div className={cn('font-mono text-primary select-none', sizeClasses[size])}>
        <pre className="whitespace-pre animate-pulse">
{`╦╔╗╔╔╦╗╔═╗╔╗╔╔╦╗ ╔═╗╦
║║║║ ║ ╠╣ ║║║ ║  ║ ║║
╩╝╚╝ ╩ ╚═╝╝╚╝ ╩  ╚═╝╩`}
        </pre>
      </div>
      <div className="font-mono text-xs text-muted-foreground">
        {text}{dots}
      </div>
    </div>
  )
}

interface RetroProgressProps {
  className?: string
  progress?: number
}

export function RetroProgress({ className, progress = 0 }: RetroProgressProps) {
  const blocks = 20
  const filled = Math.floor((progress / 100) * blocks)
  
  return (
    <div className={cn('font-mono text-xs', className)}>
      <div className="text-muted-foreground mb-1">{Math.floor(progress)}%</div>
      <div className="flex items-center gap-1">
        <span className="text-muted-foreground">[</span>
        <div className="flex">
          {Array.from({ length: blocks }).map((_, i) => (
            <span
              key={i}
              className={cn(
                'w-2 h-3',
                i < filled ? 'bg-primary' : 'bg-border',
                'border border-border'
              )}
            />
          ))}
        </div>
        <span className="text-muted-foreground">]</span>
      </div>
    </div>
  )
}

interface RetroSpinnerProps {
  className?: string
  size?: 'sm' | 'md' | 'lg'
}

export function RetroSpinner({ className, size = 'md' }: RetroSpinnerProps) {
  const [frame, setFrame] = useState(0)
  const frames = ['|', '/', '-', '\\']
  
  useEffect(() => {
    const interval = setInterval(() => {
      setFrame(prev => (prev + 1) % frames.length)
    }, 100)
    
    return () => clearInterval(interval)
  }, [])

  const sizeClasses = {
    sm: 'text-sm',
    md: 'text-base',
    lg: 'text-xl'
  }

  return (
    <span className={cn('font-mono text-primary', sizeClasses[size], className)}>
      {frames[frame]}
    </span>
  )
}