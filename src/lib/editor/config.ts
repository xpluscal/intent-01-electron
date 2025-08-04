import { Schema } from 'prosemirror-model'
import { EditorView } from 'prosemirror-view'
import { Transaction } from 'prosemirror-state'
import { textblockTypeInputRule } from 'prosemirror-inputrules'

// Define a schema with markdown-like nodes
export const documentSchema = new Schema({
  nodes: {
    doc: {
      content: 'block+'
    },
    paragraph: {
      content: 'inline*',
      group: 'block',
      parseDOM: [{ tag: 'p' }],
      toDOM() { return ['p', 0] }
    },
    heading: {
      attrs: { level: { default: 1 } },
      content: 'inline*',
      group: 'block',
      defining: true,
      parseDOM: [
        { tag: 'h1', attrs: { level: 1 } },
        { tag: 'h2', attrs: { level: 2 } },
        { tag: 'h3', attrs: { level: 3 } },
        { tag: 'h4', attrs: { level: 4 } },
        { tag: 'h5', attrs: { level: 5 } },
        { tag: 'h6', attrs: { level: 6 } }
      ],
      toDOM(node) { return ['h' + node.attrs.level, 0] }
    },
    code_block: {
      content: 'text*',
      marks: '',
      group: 'block',
      code: true,
      defining: true,
      parseDOM: [{ tag: 'pre', preserveWhitespace: 'full' }],
      toDOM() { return ['pre', ['code', 0]] }
    },
    blockquote: {
      content: 'block+',
      group: 'block',
      defining: true,
      parseDOM: [{ tag: 'blockquote' }],
      toDOM() { return ['blockquote', 0] }
    },
    horizontal_rule: {
      group: 'block',
      parseDOM: [{ tag: 'hr' }],
      toDOM() { return ['hr'] }
    },
    bullet_list: {
      group: 'block',
      content: 'list_item+',
      parseDOM: [{ tag: 'ul' }],
      toDOM() { return ['ul', 0] }
    },
    ordered_list: {
      attrs: { order: { default: 1 } },
      group: 'block',
      content: 'list_item+',
      parseDOM: [{
        tag: 'ol',
        getAttrs(dom) {
          return { order: (dom as HTMLElement).hasAttribute('start') ? +(dom as HTMLElement).getAttribute('start')! : 1 }
        }
      }],
      toDOM(node) {
        return node.attrs.order == 1 ? ['ol', 0] : ['ol', { start: node.attrs.order }, 0]
      }
    },
    list_item: {
      content: 'paragraph block*',
      parseDOM: [{ tag: 'li' }],
      toDOM() { return ['li', 0] },
      defining: true
    },
    text: {
      group: 'inline'
    }
  },
  marks: {
    strong: {
      parseDOM: [
        { tag: 'strong' },
        { tag: 'b' },
        { style: 'font-weight', getAttrs: (value: string) => /^(bold(er)?|[5-9]\d{2,})$/.test(value) && null }
      ],
      toDOM() { return ['strong', 0] }
    },
    em: {
      parseDOM: [{ tag: 'i' }, { tag: 'em' }, { style: 'font-style=italic' }],
      toDOM() { return ['em', 0] }
    },
    code: {
      parseDOM: [{ tag: 'code' }],
      toDOM() { return ['code', 0] }
    },
    link: {
      attrs: {
        href: {},
        title: { default: null }
      },
      inclusive: false,
      parseDOM: [{
        tag: 'a[href]',
        getAttrs(dom) {
          return {
            href: (dom as HTMLElement).getAttribute('href'),
            title: (dom as HTMLElement).getAttribute('title')
          }
        }
      }],
      toDOM(node) { return ['a', node.attrs, 0] }
    }
  }
})

// Create heading input rules
export function headingRule(level: number) {
  return textblockTypeInputRule(
    new RegExp(`^(#{${level}})\\s$`),
    documentSchema.nodes.heading,
    { level }
  )
}

// Handle transactions with debouncing
export function handleTransaction({
  transaction,
  editorRef,
  onSaveContent
}: {
  transaction: Transaction
  editorRef: React.MutableRefObject<EditorView | null>
  onSaveContent: (content: string) => void
}) {
  const view = editorRef.current
  if (!view) return

  const newState = view.state.apply(transaction)
  view.updateState(newState)

  if (transaction.docChanged && !transaction.getMeta('no-save')) {
    // Import buildContentFromDocument to convert to markdown
    import('./functions').then(({ buildContentFromDocument }) => {
      const content = buildContentFromDocument(newState.doc)
      onSaveContent(content)
    })
  }
}