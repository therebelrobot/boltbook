import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'

interface ToastRequest {
  message: string
  actionLabel?: string
  onAction?: () => void
}

interface ToastItem extends ToastRequest {
  id: number
}

const ToastContext = createContext<(request: ToastRequest) => void>(() => {})

export function useToast(): (request: ToastRequest) => void {
  return useContext(ToastContext)
}

/**
 * One toast at a time, above the tab bar. Action toasts (undo) stay longer than
 * plain confirmations — slow where the user is deciding, fast where the system
 * is answering (docs/design-brief.md §5).
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const nextId = useRef(0)

  const push = useCallback((request: ToastRequest) => {
    const id = (nextId.current += 1)
    setItems((current) => [...current, { ...request, id }])
    const lifetime = request.actionLabel ? 7000 : 2600
    window.setTimeout(() => {
      setItems((current) => current.filter((item) => item.id !== id))
    }, lifetime)
  }, [])

  const value = useMemo(() => push, [push])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((item) => (
          <div className="toast" key={item.id}>
            <span>{item.message}</span>
            {item.actionLabel && (
              <button
                type="button"
                onClick={() => {
                  item.onAction?.()
                  setItems((current) => current.filter((entry) => entry.id !== item.id))
                }}
              >
                {item.actionLabel}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
