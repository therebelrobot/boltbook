import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { PaperSize } from '../tiling'

interface PrintOverlayProps {
  title: string
  paper: PaperSize
  onClose: () => void
  controls: ReactNode
  children: ReactNode
}

/**
 * A full-screen print surface rendered into <body>, outside the app shell and
 * outside any sheet. That is what lets the print stylesheet hide everything
 * else without also hiding the page being printed.
 *
 * The paper size is a stylesheet, not an inline @page rule: `@page` cannot be
 * set from a class, and a CSS rule that changes `size` per element does not
 * exist. Swapping one same-origin stylesheet is the boring, reliable way.
 */
export function PrintOverlay({ title, paper, onClose, controls, children }: PrintOverlayProps) {
  useEffect(() => {
    const link = document.getElementById('print-page-size') as HTMLLinkElement | null
    if (link) link.href = paper === 'letter' ? '/print-letter.css' : '/print-a4.css'
  }, [paper])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      // The overlay is the modal; take Escape before the sheet underneath sees it.
      event.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [onClose])

  return createPortal(
    <div className="print-overlay" data-paper={paper} role="dialog" aria-modal="true" aria-label={title}>
      <div className="print-controls">
        <div className="print-controls-head">
          <h2>{title}</h2>
          <button type="button" className="button plain" onClick={onClose}>
            Close
          </button>
        </div>
        {controls}
      </div>
      <div className="print-preview">{children}</div>
    </div>,
    document.body,
  )
}
