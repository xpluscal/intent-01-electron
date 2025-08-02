import { UserButton } from '@clerk/clerk-react'

export function Header() {
  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex h-14 items-center px-4">
        <div className="flex flex-1 items-center justify-between">
          <h1 className="text-lg font-semibold uppercase">Intent-01</h1>
          <UserButton />
        </div>
      </div>
    </header>
  )
}