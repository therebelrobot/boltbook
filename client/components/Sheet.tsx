import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'

interface SheetProps {
  title: string
  onClose: () => void
  children: ReactNode
}

/** Past this much drag, releasing dismisses. */
const DISMISS_DISTANCE_PX = 120
/** Or a flick this fast, even a short one — a quick flick should be enough. */
const DISMISS_VELOCITY_PX_PER_MS = 0.5

/**
 * A bottom sheet. Tracking is 1:1 while the finger is down; on release the sheet
 * either snaps back or closes. Dragging is only wired to the grab bar and
 * header, so nothing inside the sheet fights it (docs/design-brief.md §6).
 */
export function Sheet({ title, onClose, children }: SheetProps) {
  const [dragOffset, setDragOffset] = useState(0)
  const [dragging, setDragging] = useState(false)
  const dragState = useRef({ pointerId: -1, startY: 0, startTime: 0, velocity: 0 })

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      // A print overlay is a modal above this sheet; Escape belongs to it.
      if (event.key === 'Escape' && !document.querySelector('.print-overlay')) onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    // The header sits inside the drag surface, and pointer capture retargets the
    // click to this element — which would swallow the Close button. Let real
    // controls start their own gesture.
    if ((event.target as HTMLElement).closest('button, a, input, textarea, select')) return
    dragState.current = { pointerId: event.pointerId, startY: event.clientY, startTime: performance.now(), velocity: 0 }
    event.currentTarget.setPointerCapture(event.pointerId)
    setDragging(true)
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!dragging) return
    const offset = Math.max(0, event.clientY - dragState.current.startY)
    const elapsed = Math.max(1, performance.now() - dragState.current.startTime)
    dragState.current.velocity = offset / elapsed
    setDragOffset(offset)
  }

  const endDrag = (): void => {
    if (!dragging) return
    setDragging(false)
    if (dragOffset > DISMISS_DISTANCE_PX || dragState.current.velocity > DISMISS_VELOCITY_PX_PER_MS) {
      onClose()
      return
    }
    setDragOffset(0)
  }

  return (
    <div
      className="sheet-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{
          transform: `translateY(${dragOffset}px)`,
          transition: dragging ? 'none' : 'transform 220ms var(--ease-out)',
        }}
      >
        <div
          style={{ touchAction: 'none', cursor: 'grab' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <div className="grab" />
          <header>
            <h2>{title}</h2>
            <button type="button" className="button plain" onClick={onClose} aria-label="Close">
              Close
            </button>
          </header>
        </div>
        <div className="content">{children}</div>
      </div>
    </div>
  )
}
