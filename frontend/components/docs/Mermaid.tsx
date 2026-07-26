'use client'

import { useEffect, useId, useRef, useState } from 'react'

/**
 * Ledger-palette Mermaid theme. Every COLOR is a literal hex — mermaid's khroma
 * darken/lighten cannot parse `var(--x)`, and mermaid's measurement node lives on
 * <body>, outside the `.docs` scope, so CSS vars would not resolve anyway. Only the
 * font family is read dynamically (the resolved next/font hash) in loadMermaid().
 *
 * Covers flowchart, stateDiagram-v2, sequenceDiagram and erDiagram so none of them
 * fall back to the default mermaid purple.
 */
const LEDGER_THEME_VARIABLES = {
  darkMode: true,
  background: '#101012', // --d-elevated (the card the figure sits on)
  fontSize: '14px',

  // primary / nodes (flowchart, state, class, er entity)
  primaryColor: '#17171a', // --d-overlay -> node fill
  primaryTextColor: '#ececea', // --d-text
  primaryBorderColor: '#ccff00', // --d-accent (lime) -> node border
  secondaryColor: '#1c1c20',
  tertiaryColor: '#101012',
  mainBkg: '#17171a',
  secondBkg: '#1c1c20',
  nodeBorder: '#ccff00',
  nodeTextColor: '#ececea',

  // edges / lines
  lineColor: '#6a6a64', // --d-faint (muted edges, not lime)
  defaultLinkColor: '#6a6a64',
  arrowheadColor: '#9a9a94', // --d-muted
  edgeLabelBackground: '#101012',
  titleColor: '#ececea',
  textColor: '#ececea',

  // clusters / subgraphs
  clusterBkg: '#0d0d0f',
  clusterBorder: '#26262a',

  // notes (flow + sequence)
  noteBkgColor: '#1c1c20',
  noteTextColor: '#ececea',
  noteBorderColor: '#3a3a3e',

  // stateDiagram
  labelColor: '#ececea',
  labelBackgroundColor: '#101012',
  stateBkg: '#17171a',
  stateLabelColor: '#ececea',
  altBackground: '#0d0d0f',
  compositeBackground: '#0d0d0f',
  compositeTitleBackground: '#17171a',
  compositeBorder: '#3a3a3e',
  transitionColor: '#6a6a64',
  transitionLabelColor: '#9a9a94',
  specialStateColor: '#ccff00',
  innerEndBackground: '#ccff00', // final-state ring
  errorBkgColor: '#3a1416',
  errorTextColor: '#ececea',

  // sequenceDiagram
  actorBkg: '#17171a',
  actorBorder: '#ccff00',
  actorTextColor: '#ececea',
  actorLineColor: '#3a3a3e',
  signalColor: '#9a9a94',
  signalTextColor: '#ececea',
  labelBoxBkgColor: '#17171a',
  labelBoxBorderColor: '#3a3a3e',
  labelTextColor: '#ececea',
  loopTextColor: '#9a9a94',
  activationBkgColor: '#1c1c20',
  activationBorderColor: '#ccff00',
  sequenceNumberColor: '#0a0a0b',

  // erDiagram (attribute row striping defaults to WHITE — must override)
  attributeBackgroundColorOdd: '#101012',
  attributeBackgroundColorEven: '#141416',
} as const

type MermaidApi = typeof import('mermaid').default

// Shared across every <Mermaid> on the page: import + initialize mermaid exactly once.
let mermaidReady: Promise<MermaidApi> | null = null

function loadMermaid(): Promise<MermaidApi> {
  if (!mermaidReady) {
    mermaidReady = import('mermaid').then((mod) => {
      const mermaid = mod.default
      // Resolve the REAL next/font family (hashed name) so mermaid's off-scope
      // measurement node on <body> uses the same font as the in-scope SVG.
      const monoVar =
        getComputedStyle(document.body).getPropertyValue('--font-mono').trim() || 'ui-monospace'
      mermaid.initialize({
        startOnLoad: false,
        theme: 'base',
        securityLevel: 'strict',
        fontFamily: `${monoVar}, ui-monospace, SFMono-Regular, monospace`,
        flowchart: { htmlLabels: true, curve: 'basis', useMaxWidth: true },
        sequence: { useMaxWidth: true },
        er: { useMaxWidth: true },
        themeVariables: LEDGER_THEME_VARIABLES,
      })
      return mermaid
    })
  }
  return mermaidReady
}

// Monotonic nonce so every render() call (incl. StrictMode double-invoke) is unique.
let renderNonce = 0

export default function Mermaid({ chart, caption }: { chart: string; caption?: string }) {
  const rawId = useId()
  const baseId = 'mmd-' + rawId.replace(/[^a-zA-Z0-9]/g, '')
  const [svg, setSvg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [zoom, setZoom] = useState(false)
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    let active = true
    const id = `${baseId}-${renderNonce++}`
    loadMermaid()
      .then((mermaid) => mermaid.render(id, chart))
      .then(({ svg: out }) => {
        if (active) {
          setSvg(out)
          setError(null)
        }
      })
      .catch((err: unknown) => {
        if (active) setError(err instanceof Error ? err.message : String(err))
        // mermaid leaves a stray measurement/error node in <body> on failure.
        document.getElementById(id)?.remove()
        document.getElementById('d' + id)?.remove()
      })
    return () => {
      active = false
    }
  }, [chart, baseId])

  useEffect(() => {
    const dlg = dialogRef.current
    if (!dlg) return
    if (zoom && !dlg.open) dlg.showModal()
    if (!zoom && dlg.open) dlg.close()
  }, [zoom])

  // Graceful degradation: parse error -> show the raw source, never a broken SVG.
  if (error) {
    return (
      <figure className="mmd-figure mmd-error">
        <figcaption className="mmd-caption">diagram failed to render — showing source</figcaption>
        <pre className="mmd-source">{chart}</pre>
      </figure>
    )
  }

  return (
    <figure className="mmd-figure">
      {svg == null ? (
        <div className="mmd-skeleton" aria-hidden="true" />
      ) : (
        <>
          <button
            type="button"
            className="mmd-zoom-btn"
            onClick={() => setZoom(true)}
            aria-label="Увеличить диаграмму"
          >
            ⤢
          </button>
          <div
            className="mmd-canvas"
            role="img"
            aria-label={caption ?? 'diagram'}
            dangerouslySetInnerHTML={{ __html: svg }}
          />
          <dialog ref={dialogRef} className="mmd-dialog" onClose={() => setZoom(false)}>
            <button
              type="button"
              className="mmd-dialog-close"
              onClick={() => setZoom(false)}
              aria-label="Закрыть"
            >
              ✕
            </button>
            <div className="mmd-dialog-canvas" dangerouslySetInnerHTML={{ __html: svg }} />
          </dialog>
        </>
      )}
      {caption && <figcaption className="mmd-caption">{caption}</figcaption>}
    </figure>
  )
}
