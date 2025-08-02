"use client";

import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Authenticated, Unauthenticated } from "convex/react";
import { SignInButton, SignUpButton } from "@clerk/clerk-react";
import { SimplifiedLayout } from './components/layout/SimplifiedLayout'
import { SimplifiedProjectBrowser } from './components/file-browser/SimplifiedProjectBrowser'
import { Toaster } from './components/ui/sonner'

export default function App() {
  return (
    <BrowserRouter>
      <Toaster />
      <Authenticated>
        <SimplifiedLayout>
          <SimplifiedProjectBrowser />
        </SimplifiedLayout>
      </Authenticated>
      <Unauthenticated>
        <SignInForm />
      </Unauthenticated>
    </BrowserRouter>
  );
}

function SignInForm() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="flex flex-col gap-8 w-96 mx-auto p-8">
        <div className="text-center">
          <h1 className="text-3xl font-bold mb-2">Intent Workspace</h1>
          <p className="text-muted-foreground">Sign in to access your workspace</p>
        </div>
        <SignInButton mode="modal">
          <button className="w-full bg-primary text-primary-foreground hover:bg-primary/90 px-4 py-2 rounded-md transition-colors">
            Sign in
          </button>
        </SignInButton>
        <SignUpButton mode="modal">
          <button className="w-full bg-secondary text-secondary-foreground hover:bg-secondary/80 px-4 py-2 rounded-md transition-colors">
            Sign up
          </button>
        </SignUpButton>
      </div>
    </div>
  );
}