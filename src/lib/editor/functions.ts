import { Node } from 'prosemirror-model'
import { documentSchema } from './config'
import { MarkdownParser, MarkdownSerializer } from 'prosemirror-markdown'
import markdownit from 'markdown-it'

// Create a custom markdown parser with our schema
const markdownParser = new MarkdownParser(
  documentSchema,
  markdownit('commonmark', { html: false }),
  {
    blockquote: { block: "blockquote" },
    paragraph: { block: "paragraph" },
    list_item: { block: "list_item" },
    bullet_list: { block: "bullet_list" },
    ordered_list: { block: "ordered_list", getAttrs: (tok: any) => ({ order: +tok.attrGet("start") || 1 }) },
    heading: { block: "heading", getAttrs: (tok: any) => ({ level: +tok.tag.slice(1) }) },
    code_block: { block: "code_block" },
    fence: { block: "code_block", getAttrs: (tok: any) => ({ params: tok.info || "" }) },
    hr: { node: "horizontal_rule" },
    em: { mark: "em" },
    strong: { mark: "strong" },
    link: {
      mark: "link",
      getAttrs: (tok: any) => ({
        href: tok.attrGet("href"),
        title: tok.attrGet("title") || null
      })
    },
    code_inline: { mark: "code" }
  }
)

// Create a custom markdown serializer
const markdownSerializer = new MarkdownSerializer(
  {
    blockquote(state, node) {
      state.wrapBlock("> ", null, node, () => state.renderContent(node))
    },
    code_block(state, node) {
      state.write("```\n")
      state.text(node.textContent, false)
      state.ensureNewLine()
      state.write("```")
      state.closeBlock(node)
    },
    heading(state, node) {
      state.write(state.repeat("#", node.attrs.level) + " ")
      state.renderInline(node)
      state.closeBlock(node)
    },
    horizontal_rule(state, node) {
      state.write(node.attrs.markup || "---")
      state.closeBlock(node)
    },
    bullet_list(state, node) {
      state.renderList(node, "  ", () => "- ")
    },
    ordered_list(state, node) {
      let start = node.attrs.order || 1
      let maxW = String(start + node.childCount - 1).length
      let space = state.repeat(" ", maxW + 2)
      state.renderList(node, space, (i) => {
        let nStr = String(start + i)
        return state.repeat(" ", maxW - nStr.length) + nStr + ". "
      })
    },
    list_item(state, node) {
      state.renderContent(node)
    },
    paragraph(state, node) {
      state.renderInline(node)
      state.closeBlock(node)
    },
    
    // This is rendered as text, so no wrapper is needed
    text(state, node) {
      state.text(node.text!)
    }
  },
  {
    em: {
      open: "*",
      close: "*",
      mixable: true,
      expelEnclosingWhitespace: true
    },
    strong: {
      open: "**",
      close: "**",
      mixable: true,
      expelEnclosingWhitespace: true
    },
    link: {
      open(_state, mark, parent, index) {
        return isPlainURL(mark, parent, index, 1) ? "<" : "["
      },
      close(state, mark, parent, index) {
        return isPlainURL(mark, parent, index, -1) ? ">"
          : "](" + mark.attrs.href + (mark.attrs.title ? ` "${mark.attrs.title}"` : "") + ")"
      }
    },
    code: {
      open(_state, _mark, parent, index) {
        return backticksFor(parent.child(index), -1)
      },
      close(_state, _mark, parent, index) {
        return backticksFor(parent.child(index - 1), 1)
      },
      escape: false
    }
  }
)

function backticksFor(node: Node, side: number) {
  let ticks = /`+/g
  let m
  let len = 0
  if (node.isText) while ((m = ticks.exec(node.text!))) len = Math.max(len, m[0].length)
  let result = len > 0 && side > 0 ? " `" : "`"
  for (let i = 0; i < len; i++) result += "`"
  if (len > 0 && side < 0) result += " "
  return result
}

function isPlainURL(mark: any, parent: Node, index: number, side: number) {
  if (mark.attrs.title || !/^\w+:/.test(mark.attrs.href)) return false
  let content = parent.child(index + (side < 0 ? -1 : 0))
  if (!content.isText || content.text != mark.attrs.href || content.marks[content.marks.length - 1] != mark) return false
  if (index == (side < 0 ? 1 : parent.childCount - 1)) return true
  let next = parent.child(index + (side < 0 ? -2 : 1))
  return !mark.isInSet(next.marks)
}

// Build ProseMirror document from markdown content
export function buildDocumentFromContent(content: string): Node {
  try {
    // Parse markdown to ProseMirror document
    const doc = markdownParser.parse(content)
    if (doc) return doc
  } catch (error) {
    console.error('Error parsing markdown:', error)
  }
  
  // Fallback to empty document
  return documentSchema.node('doc', null, [
    documentSchema.node('paragraph')
  ])
}

// Convert ProseMirror document back to markdown
export function buildContentFromDocument(doc: Node): string {
  try {
    return markdownSerializer.serialize(doc)
  } catch (error) {
    console.error('Error serializing to markdown:', error)
    return doc.textContent
  }
}