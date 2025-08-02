import { useEffect, useCallback } from 'react'

interface UseDialogKeyboardProps {
  isOpen: boolean
  onSubmit: () => void
  onCancel: () => void
  isSubmitDisabled?: boolean
}

export function useDialogKeyboard({
  isOpen,
  onSubmit,
  onCancel,
  isSubmitDisabled = false
}: UseDialogKeyboardProps) {
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!isOpen) return
    
    // Submit on Cmd/Ctrl + Enter
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && !isSubmitDisabled) {
      e.preventDefault()
      onSubmit()
    }
    
    // Cancel on Escape (this is handled by Radix Dialog by default)
    // but we can add additional logic here if needed
  }, [isOpen, onSubmit, isSubmitDisabled])
  
  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])
}