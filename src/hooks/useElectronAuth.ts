import { useState, useEffect, useCallback, useMemo } from 'react'
import { authEvents } from '../lib/authEvents'

interface AuthState {
  isLoading: boolean
  isAuthenticated: boolean
  token: string | null
}

// Store token outside of React state for immediate access
let currentToken: string | null = null

export function useElectronAuth() {
  const [authState, setAuthState] = useState<AuthState>({
    isLoading: true,
    isAuthenticated: false,
    token: null
  })

  // Initialize auth state from stored token
  useEffect(() => {
    const initAuth = async () => {
      console.log('Initializing auth...')
      try {
        const result = await window.authAPI.getToken()
        console.log('Get token result:', result)
        
        if (result.success && result.token) {
          // Validate token (check expiration, etc.)
          const isValid = validateToken(result.token)
          console.log('Initial token validation:', isValid)
          
          if (isValid) {
            currentToken = result.token
            setAuthState({
              isLoading: false,
              isAuthenticated: true,
              token: result.token
            })
            authEvents.emitAuthChange(true, result.token)
          } else {
            // Token is expired or invalid, clear it
            await window.authAPI.clearToken()
            setAuthState({
              isLoading: false,
              isAuthenticated: false,
              token: null
            })
          }
        } else {
          setAuthState({
            isLoading: false,
            isAuthenticated: false,
            token: null
          })
        }
      } catch (error) {
        console.error('Failed to initialize auth:', error)
        setAuthState({
          isLoading: false,
          isAuthenticated: false,
          token: null
        })
      }
    }

    initAuth()
  }, [])

  // Listen for token from protocol URL
  useEffect(() => {
    const handleTokenReceived = async (token: string) => {
      console.log('Token received in useElectronAuth:', token)
      try {
        // Validate the received token
        const isValid = validateToken(token)
        console.log('Token validation result:', isValid)
        
        if (isValid) {
          // Store the token
          const storeResult = await window.authAPI.storeToken(token)
          console.log('Token store result:', storeResult)
          
          currentToken = token
          setAuthState({
            isLoading: false,
            isAuthenticated: true,
            token
          })
          authEvents.emitAuthChange(true, token)
        } else {
          console.error('Received invalid token')
        }
      } catch (error) {
        console.error('Failed to handle received token:', error)
      }
    }

    window.authAPI.onTokenReceived(handleTokenReceived)

    return () => {
      window.authAPI.removeTokenListener()
    }
  }, [])

  // Listen for auth changes from other hook instances
  useEffect(() => {
    const unsubscribe = authEvents.onAuthChange((event) => {
      const { authenticated, token } = event.detail
      console.log('Auth change event received:', { authenticated, token })
      
      currentToken = token
      setAuthState({
        isLoading: false,
        isAuthenticated: authenticated,
        token
      })
    })
    
    return unsubscribe
  }, [])

  // Fetch access token for Convex
  const fetchAccessToken = useCallback(
    async ({ forceRefreshToken }: { forceRefreshToken: boolean }) => {
      try {
        if (!currentToken) {
          return null
        }

        // Check if token needs refresh
        if (forceRefreshToken || isTokenExpiringSoon(currentToken)) {
          // In a real implementation, you would refresh the token here
          // For now, we'll just return the existing token
          // You might need to call your webapp's refresh endpoint
          console.log('Token refresh requested, but not implemented yet')
        }

        return currentToken
      } catch (error) {
        console.error('Failed to fetch access token:', error)
        return null
      }
    },
    [] // No dependencies since we use currentToken directly
  )

  // Login function
  const login = useCallback(async () => {
    try {
      setAuthState(prev => ({ ...prev, isLoading: true }))
      await window.authAPI.openLogin()
      // The actual authentication will happen via the protocol URL callback
    } catch (error) {
      console.error('Failed to open login:', error)
      setAuthState(prev => ({ ...prev, isLoading: false }))
    }
  }, [])

  // Logout function
  const logout = useCallback(async () => {
    try {
      await window.authAPI.clearToken()
      currentToken = null
      setAuthState({
        isLoading: false,
        isAuthenticated: false,
        token: null
      })
    } catch (error) {
      console.error('Failed to logout:', error)
    }
  }, [])

  // Return Clerk-compatible API
  // ConvexProviderWithClerk will wrap this and extract what it needs
  const result = {
    isLoaded: !authState.isLoading,
    isSignedIn: authState.isAuthenticated,
    getToken: async (options?: { template?: "convex"; skipCache?: boolean }) => {
      console.log('getToken called with options:', options)
      const token = await fetchAccessToken({ forceRefreshToken: options?.skipCache || false })
      console.log('getToken returning:', token)
      return token
    },
    orgId: undefined,
    orgRole: undefined,
  }
  
  console.log('useElectronAuth returning:', { 
    isLoaded: result.isLoaded, 
    isSignedIn: result.isSignedIn,
    hasToken: !!currentToken 
  })
  
  return result
}

// Helper function to validate JWT token
function validateToken(token: string): boolean {
  try {
    // Decode the JWT token
    const parts = token.split('.')
    if (parts.length !== 3) {
      console.error('Token does not have 3 parts:', parts.length)
      return false
    }

    // Decode the payload
    const payload = JSON.parse(atob(parts[1]))
    console.log('Token payload:', JSON.stringify(payload, null, 2))
    
    // Check expiration
    if (payload.exp) {
      const expirationTime = payload.exp * 1000 // Convert to milliseconds
      const now = Date.now()
      console.log('Token expiration check:', { expirationTime, now, expired: now > expirationTime })
      if (now > expirationTime) {
        return false
      }
    }

    // Add any additional validation here
    return true
  } catch (error) {
    console.error('Token validation failed:', error)
    return false
  }
}

// Helper function to check if token is expiring soon (within 5 minutes)
function isTokenExpiringSoon(token: string): boolean {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) {
      return true
    }

    const payload = JSON.parse(atob(parts[1]))
    
    if (payload.exp) {
      const expirationTime = payload.exp * 1000
      const fiveMinutesFromNow = Date.now() + (5 * 60 * 1000)
      return fiveMinutesFromNow > expirationTime
    }

    return false
  } catch (error) {
    return true
  }
}