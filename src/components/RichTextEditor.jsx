import { useCreateBlockNote } from '@blocknote/react'
import { BlockNoteView } from '@blocknote/mantine'
import '@blocknote/mantine/style.css'
import { useCallback, useRef, useEffect } from 'react'

export default function RichTextEditor({ value, onChange, placeholder = "Type '/' for commands…", editable = true }) {
  const debounceRef = useRef(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const mountedRef = useRef(true)

  useEffect(() => {
    return () => { mountedRef.current = false }
  }, [])

  const getInitialContent = useCallback(() => {
    if (!value || value.trim() === '') return undefined
    try {
      const parsed = JSON.parse(value)
      if (Array.isArray(parsed)) {
        if (parsed.length === 0) return undefined
        if (parsed.length === 1 && parsed[0].type === 'paragraph' && (!parsed[0].content || parsed[0].content.length === 0)) {
          return undefined
        }
        return parsed
      }
    } catch {}
    const lines = value.split('\n')
    const blocks = lines.map(line => ({
      type: 'paragraph',
      content: line.trim() ? [{ type: 'text', text: line, styles: {} }] : []
    }))
    return blocks.every(b => !b.content.length) ? undefined : blocks
  }, [])

  const editor = useCreateBlockNote({
    initialContent: getInitialContent(),
  })

  const handleChange = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      if (!mountedRef.current) return
      const doc = editor.document
      const isEmpty = doc.length === 1 && doc[0].type === 'paragraph' && (!doc[0].content || doc[0].content.length === 0)
      onChangeRef.current(isEmpty ? '' : JSON.stringify(doc))
    }, 300)
  }, [editor])

  useEffect(() => {
    if (!editor) return
    const v = value || ''
    if (v.trim() === '' || v === '[]') {
      const cur = JSON.stringify(editor.document)
      const emptyDoc = JSON.stringify([{ type: 'paragraph', content: [] }])
      if (cur === emptyDoc) return
      editor.replaceBlocks(editor.document, [{ type: 'paragraph', content: [] }])
      return
    }
    const currentJSON = JSON.stringify(editor.document)
    if (currentJSON === v) return
    try {
      const parsed = JSON.parse(v)
      if (Array.isArray(parsed)) {
        editor.replaceBlocks(editor.document, parsed)
      }
    } catch {
      const lines = v.split('\n')
      const blocks = lines.map(line => ({
        type: 'paragraph',
        content: line.trim() ? [{ type: 'text', text: line, styles: {} }] : []
      }))
      editor.replaceBlocks(editor.document, blocks)
    }
  }, [value, editor])

  return (
    <div className="rich-editor-wrapper" data-placeholder={placeholder}>
      <BlockNoteView
        editor={editor}
        editable={editable}
        onChange={handleChange}
        sideMenu={false}
      />
    </div>
  )
}
