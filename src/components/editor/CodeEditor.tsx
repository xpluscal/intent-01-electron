import { useEffect, useRef, useCallback } from 'react'
import { EditorView, keymap } from '@codemirror/view'
import { EditorState, Extension } from '@codemirror/state'
import { javascript } from '@codemirror/lang-javascript'
import { python } from '@codemirror/lang-python'
import { markdown } from '@codemirror/lang-markdown'
import { oneDark } from '@codemirror/theme-one-dark'
import { basicSetup } from 'codemirror'

interface CodeEditorProps {
  content: string
  onChange: (content: string) => void
  onSave?: () => void
  language?: string
}

// Get language extension based on file extension or language hint
function getLanguageExtension(language?: string) {
  switch (language) {
    case 'python':
    case 'py':
      return python()
    case 'javascript':
    case 'js':
    case 'jsx':
    case 'typescript':
    case 'ts':
    case 'tsx':
      return javascript({ jsx: true, typescript: language.includes('ts') })
    case 'markdown':
    case 'md':
      return markdown()
    default:
      return javascript() // Default to JavaScript
  }
}

export function CodeEditor({ content, onChange, onSave, language }: CodeEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<EditorView | null>(null)
  const isInternalUpdate = useRef(false)

  const handleChange = useCallback((newContent: string) => {
    if (!isInternalUpdate.current) {
      onChange(newContent)
    }
    isInternalUpdate.current = false
  }, [onChange])

  useEffect(() => {
    if (containerRef.current && !editorRef.current) {
      const extensions: Extension[] = [
        basicSetup,
        getLanguageExtension(language),
        oneDark,
        keymap.of([{
          key: 'Mod-s',
          run: () => {
            onSave?.()
            return true
          }
        }]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            const newContent = update.state.doc.toString()
            handleChange(newContent)
          }
        })
      ]

      const startState = EditorState.create({
        doc: content,
        extensions,
      })

      editorRef.current = new EditorView({
        state: startState,
        parent: containerRef.current,
      })
    }

    return () => {
      if (editorRef.current) {
        editorRef.current.destroy()
        editorRef.current = null
      }
    }
  }, [language]) // Re-create editor if language changes

  // Update editor content when prop changes (but not from our own updates)
  useEffect(() => {
    if (editorRef.current && content !== undefined) {
      const currentContent = editorRef.current.state.doc.toString()
      
      if (currentContent !== content) {
        isInternalUpdate.current = true
        const transaction = editorRef.current.state.update({
          changes: {
            from: 0,
            to: currentContent.length,
            insert: content,
          }
        })

        editorRef.current.dispatch(transaction)
      }
    }
  }, [content])

  // Update handlers when they change
  useEffect(() => {
    if (editorRef.current) {
      const currentState = editorRef.current.state
      const extensions: Extension[] = [
        basicSetup,
        getLanguageExtension(language),
        oneDark,
        keymap.of([{
          key: 'Mod-s',
          run: () => {
            onSave?.()
            return true
          }
        }]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            const newContent = update.state.doc.toString()
            handleChange(newContent)
          }
        })
      ]

      const newState = EditorState.create({
        doc: currentState.doc,
        extensions,
        selection: currentState.selection,
      })

      editorRef.current.setState(newState)
    }
  }, [handleChange, onSave, language])

  return (
    <div
      ref={containerRef}
      className="h-full overflow-auto text-sm"
    />
  )
}