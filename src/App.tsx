"use client";

import { BrowserRouter } from 'react-router-dom'
import { Authenticated, Unauthenticated } from "convex/react";
import { SimplifiedLayout } from './components/layout/SimplifiedLayout'
import { SimplifiedProjectBrowser } from './components/file-browser/SimplifiedProjectBrowser'
import { Toaster } from './components/ui/sonner'
import { GitCheckDialog } from './components/dialogs/GitCheckDialog'
import { AuthButton } from './components/Auth/AuthButton'
import { useState, useEffect } from 'react'

export default function App() {
  const [gitCheckOpen, setGitCheckOpen] = useState(false)
  const [hasCheckedGit, setHasCheckedGit] = useState(false)

  useEffect(() => {
    // Check Git installation once when authenticated
    const checkGitOnce = async () => {
      if (hasCheckedGit) return
      
      try {
        const result = await window.intentAPI.checkGit()
        if (!result.installed) {
          setGitCheckOpen(true)
        }
        setHasCheckedGit(true)
      } catch (error) {
        console.error('Failed to check Git:', error)
      }
    }
    
    // Delay check slightly to ensure app is fully loaded
    const timer = setTimeout(checkGitOnce, 1000)
    return () => clearTimeout(timer)
  }, [hasCheckedGit])

  return (
    <BrowserRouter>
      <Toaster />
      <Authenticated>
        <SimplifiedLayout>
          <SimplifiedProjectBrowser />
        </SimplifiedLayout>
        <GitCheckDialog open={gitCheckOpen} onOpenChange={setGitCheckOpen} />
      </Authenticated>
      <Unauthenticated>
        <SignInForm />
      </Unauthenticated>
    </BrowserRouter>
  );
}

function SignInForm() {
  return (
    <div className="signin-background min-h-screen flex items-center justify-center bg-background">
      <div className="flex flex-col gap-8 w-96 mx-auto p-8 rounded-lg">
        <div className="text-center text-white flex flex-col gap-2 items-center">
          <pre className="text-background font-mono" style={{ fontSize: '0.7rem', lineHeight: '0.8rem' }}>
{`

██╗███╗   ██╗████████╗███████╗███╗   ██╗████████╗    ██████╗  ██╗
██║████╗  ██║╚══██╔══╝██╔════╝████╗  ██║╚══██╔══╝   ██╔═████╗███║
██║██╔██╗ ██║   ██║   █████╗  ██╔██╗ ██║   ██║█████╗██║██╔██║╚██║
██║██║╚██╗██║   ██║   ██╔══╝  ██║╚██╗██║   ██║╚════╝████╔╝██║ ██║
██║██║ ╚████║   ██║   ███████╗██║ ╚████║   ██║      ╚██████╔╝ ██║
╚═╝╚═╝  ╚═══╝   ╚═╝   ╚══════╝╚═╝  ╚═══╝   ╚═╝       ╚═════╝  ╚═╝
                                                                
`}
          </pre>
          {/* <p className="text-muted-foreground">Sign in to access your workspace</p> */}
        </div>
        <AuthButton />
      </div>
    </div>
  );
}