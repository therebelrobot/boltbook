import { useCallback, useEffect, useState } from 'react'
import { api } from './api'

/** List state with a reload, shared by every list screen. */
export function useCollection<T>(path: string) {
  const [items, setItems] = useState<T[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    try {
      setItems(await api<T[]>(path))
      setError(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load.')
    }
  }, [path])

  useEffect(() => {
    void reload()
  }, [reload])

  return { items, error, reload }
}
