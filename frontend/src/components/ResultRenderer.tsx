import Markdown from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import remarkGfm from 'remark-gfm'
import { useMemo, useState } from 'react'
import type { RenderMode } from '../api/types'
import { JsonView } from './JsonView'
import { Button, cx } from './ui'

const FENCE_RE = /^\s*```([a-zA-Z0-9_+-]*)\r?\n([\s\S]*?)\r?\n?```\s*$/

/** Modelle verpacken strukturierte Antworten gern in einen einzelnen Code-Block.
 *  Für die Darstellung wollen wir den Inhalt, nicht den Zaun drumherum. */
function unwrapFence(text: string): { language: string | null; body: string } {
  const match = text.match(FENCE_RE)
  if (!match) return { language: null, body: text }
  return { language: match[1] ? match[1].toLowerCase() : null, body: match[2] }
}

function tryParseJson(text: string): unknown | undefined {
  const trimmed = text.trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return undefined
  try {
    return JSON.parse(trimmed)
  } catch {
    return undefined
  }
}

function looksLikeFullHtml(text: string): boolean {
  const head = text.trim().slice(0, 200).toLowerCase()
  return head.startsWith('<!doctype html') || head.startsWith('<html')
}

export type EffectiveMode = Exclude<RenderMode, 'auto'>

export function resolveMode(mode: RenderMode, text: string): EffectiveMode {
  if (mode !== 'auto') return mode
  const { language, body } = unwrapFence(text)
  if (tryParseJson(body) !== undefined) return 'json'
  if (looksLikeFullHtml(body)) return 'html'
  if (language && language !== 'markdown' && language !== 'md') return 'code'
  return 'markdown'
}

function HtmlPreview({ html }: { html: string }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="space-y-2">
      <div className="overflow-hidden rounded-lg border border-ink-700 bg-white">
        {/* sandbox ohne allow-same-origin: das Dokument kommt aus einem fremden Modell
            und darf weder auf die App noch auf deren Storage zugreifen. */}
        <iframe
          title="HTML-Ausgabe"
          srcDoc={html}
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          className={cx('w-full border-0 transition-all', expanded ? 'h-[80vh]' : 'h-96')}
        />
      </div>
      <Button size="sm" variant="ghost" onClick={() => setExpanded((e) => !e)}>
        {expanded ? 'Verkleinern' : 'Vergrößern'}
      </Button>
    </div>
  )
}

export function ResultRenderer({
  text,
  mode,
  codeLanguage,
}: {
  text: string
  mode: RenderMode
  codeLanguage?: string | null
}) {
  const effective = useMemo(() => resolveMode(mode, text), [mode, text])
  const { language, body } = useMemo(() => unwrapFence(text), [text])

  if (effective === 'json') {
    const parsed = tryParseJson(body)
    if (parsed !== undefined) return <JsonView data={parsed} />
    return (
      <div className="space-y-2">
        <p className="text-xs text-amber-400">
          Antwort ist kein gültiges JSON – Rohtext wird angezeigt.
        </p>
        <pre className="overflow-x-auto rounded-lg border border-ink-700 bg-ink-900 p-3 font-mono text-xs whitespace-pre-wrap">
          {text}
        </pre>
      </div>
    )
  }

  if (effective === 'html') {
    return <HtmlPreview html={body} />
  }

  if (effective === 'code') {
    const lang = codeLanguage || language || ''
    return (
      <div className="md">
        <Markdown rehypePlugins={[rehypeHighlight]}>
          {'```' + lang + '\n' + body + '\n```'}
        </Markdown>
      </div>
    )
  }

  if (effective === 'text') {
    return (
      <pre className="overflow-x-auto font-mono text-xs leading-relaxed whitespace-pre-wrap text-ink-100">
        {text}
      </pre>
    )
  }

  return (
    <div className="md">
      <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
        {text}
      </Markdown>
    </div>
  )
}
