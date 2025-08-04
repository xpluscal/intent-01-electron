import { useConvexAuth } from "convex/react"
import { Button } from "../ui/button"
import { Terminal } from 'lucide-react'

export function AuthButton() {
  const { isLoading, isAuthenticated } = useConvexAuth()
  
  const login = async () => {
    await window.authAPI.openLogin()
  }
  
  const logout = async () => {
    await window.authAPI.clearToken()
    window.location.reload() // Reload to reset auth state
  }

  if (isLoading) {
    return (
      <Button disabled variant="outline">
        Loading...
      </Button>
    )
  }

  if (isAuthenticated) {
    return (
      <Button onClick={logout} variant="outline">
        Sign Out
      </Button>
    )
  }

  return (
    <Button onClick={login} variant="default" className="bg-background text-black hover:bg-gray-200 hover:text-black">
      <Terminal className="mr-2 h-4 w-4" />
      Sign In
    </Button>
  )
}