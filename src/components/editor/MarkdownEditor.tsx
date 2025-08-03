import { useEffect, useRef, useCallback } from 'react'
import { EditorState } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { exampleSetup } from 'prosemirror-example-setup'
import { inputRules, wrappingInputRule, textblockTypeInputRule } from 'prosemirror-inputrules'
import { documentSchema, headingRule, handleTransaction } from '@/lib/editor/config'
import { buildDocumentFromContent, buildContentFromDocument } from '@/lib/editor/functions'

// Additional input rules for markdown shortcuts
const blockQuoteRule = wrappingInputRule(/^\s*>\s$/, documentSchema.nodes.blockquote)
const codeBlockRule = textblockTypeInputRule(/^```$/, documentSchema.nodes.code_block)
const bulletListRule = wrappingInputRule(/^\s*([-+*])\s$/, documentSchema.nodes.bullet_list)
const orderedListRule = wrappingInputRule(/^(\d+)\.\s$/, documentSchema.nodes.ordered_list)
const hrRule = textblockTypeInputRule(/^(---|\*\*\*|___)$/, documentSchema.nodes.horizontal_rule)

interface MarkdownEditorProps {
  content: string
  onChange: (content: string) => void
  onSave?: () => void
}

export function MarkdownEditor({ content, onChange, onSave }: MarkdownEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const isInternalUpdate = useRef(false)

  const handleSaveContent = useCallback((content: string) => {
    if (!isInternalUpdate.current) {
      onChange(content)
    }
    isInternalUpdate.current = false
  }, [onChange])

  useEffect(() => {
    if (editorRef.current && !viewRef.current) {
      // Parse the initial markdown content
      const doc = buildDocumentFromContent(content)

      const state = EditorState.create({
        doc,
        plugins: [
          ...exampleSetup({ schema: documentSchema, menuBar: false }),
          inputRules({
            rules: [
              headingRule(1),
              headingRule(2),
              headingRule(3),
              headingRule(4),
              headingRule(5),
              headingRule(6),
              blockQuoteRule,
              codeBlockRule,
              bulletListRule,
              orderedListRule,
              hrRule,
            ],
          }),
        ],
      })

      viewRef.current = new EditorView(editorRef.current, {
        state,
        dispatchTransaction: (transaction) => {
          handleTransaction({
            transaction,
            editorRef: viewRef as React.MutableRefObject<EditorView>,
            onSaveContent: handleSaveContent
          })
        },
        handleKeyDown(view, event) {
          // Handle Cmd+S / Ctrl+S for save
          if ((event.metaKey || event.ctrlKey) && event.key === 's') {
            event.preventDefault()
            onSave?.()
            return true
          }
          return false
        },
      })
    }

    return () => {
      if (viewRef.current) {
        viewRef.current.destroy()
        viewRef.current = null
      }
    }
  }, []) // Only run once on mount

  // Update editor content when prop changes (but not from our own updates)
  useEffect(() => {
    if (viewRef.current && content !== undefined) {
      const currentContent = buildContentFromDocument(viewRef.current.state.doc)
      
      if (currentContent !== content) {
        isInternalUpdate.current = true
        const doc = buildDocumentFromContent(content)
        
        const transaction = viewRef.current.state.tr.replaceWith(
          0,
          viewRef.current.state.doc.content.size,
          doc.content
        )
        
        transaction.setMeta('no-save', true)
        viewRef.current.dispatch(transaction)
      }
    }
  }, [content])

  return (
    <div className="h-full overflow-auto">
      <div className="prose prose-sm dark:prose-invert max-w-none px-8">
        <div 
          ref={editorRef} 
          className="min-h-full p-4 focus:outline-none ProseMirror"
        />
      </div>
    </div>
  )
}