import { ReactNode } from "react"
import { Authenticated, Unauthenticated, AuthLoading } from "convex/react"
import { AuthButton } from "./AuthButton"

interface AuthWrapperProps {
  children: ReactNode
}

export function AuthWrapper({ children }: AuthWrapperProps) {
  return (
    <>
      <AuthLoading>
        <div className="flex items-center justify-center min-h-screen">
          <div className="text-center">
            <div className="animate-pulse text-lg mb-2">Loading...</div>
            <p className="text-sm text-muted-foreground">Checking authentication status</p>
          </div>
        </div>
      </AuthLoading>
      
      <Unauthenticated>
        <div className="flex items-center justify-center min-h-screen">
          <div className="text-center space-y-4">
            <h1 className="text-2xl font-bold">Welcome to Intent Worker</h1>
            <p className="text-muted-foreground">Please sign in to continue</p>
            <AuthButton />
          </div>
        </div>
      </Unauthenticated>
      
      <Authenticated>
        {children}
      </Authenticated>
    </>
  )
}