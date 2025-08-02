import { useEffect, useState } from 'react'
import { RetroLoader, RetroProgress } from './retro-loader'

interface LoadingScreenProps {
  onComplete?: () => void
}

export function LoadingScreen({ onComplete }: LoadingScreenProps) {
  const [progress, setProgress] = useState(0)
  const [status, setStatus] = useState('INITIALIZING SYSTEM')
  
  useEffect(() => {
    const stages = [
      { progress: 10, status: 'LOADING CORE MODULES', delay: 300 },
      { progress: 25, status: 'ESTABLISHING CONNECTIONS', delay: 500 },
      { progress: 40, status: 'AUTHENTICATING USER', delay: 400 },
      { progress: 60, status: 'LOADING PROJECTS', delay: 600 },
      { progress: 80, status: 'PREPARING INTERFACE', delay: 500 },
      { progress: 95, status: 'FINALIZING', delay: 300 },
      { progress: 100, status: 'READY', delay: 200 }
    ]
    
    let currentStage = 0
    
    const runStage = () => {
      if (currentStage < stages.length) {
        const stage = stages[currentStage]
        setProgress(stage.progress)
        setStatus(stage.status)
        currentStage++
        
        setTimeout(runStage, stage.delay)
      } else {
        // Complete after a short delay
        setTimeout(() => {
          onComplete?.()
        }, 300)
      }
    }
    
    // Start after initial render
    setTimeout(runStage, 500)
  }, [onComplete])

  return (
    <div className="fixed inset-0 bg-background flex flex-col items-center justify-center">
      <div className="flex flex-col items-center gap-8">
        <RetroLoader size="lg" text="" />
        
        <div className="flex flex-col items-center gap-4">
          <div className="font-mono text-xs text-muted-foreground">
            {status}
          </div>
          
          <RetroProgress progress={progress} className="w-64" />
        </div>
        
        <div className="font-mono text-[8px] text-muted-foreground/50 text-center">
          <div>INTENT 01</div>
          <div>© 2025 RESONANCE LABS</div>
        </div>
      </div>
    </div>
  )
}