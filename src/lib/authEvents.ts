// Simple event emitter for auth state changes
class AuthEventEmitter extends EventTarget {
  emitAuthChange(authenticated: boolean, token: string | null) {
    this.dispatchEvent(new CustomEvent('authChange', { 
      detail: { authenticated, token } 
    }))
  }
  
  onAuthChange(callback: (event: CustomEvent) => void) {
    this.addEventListener('authChange', callback as EventListener)
    return () => this.removeEventListener('authChange', callback as EventListener)
  }
}

export const authEvents = new AuthEventEmitter()