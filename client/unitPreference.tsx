import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import type { LengthUnit } from './units'

interface UnitContextValue {
  unit: LengthUnit
  setUnit: (unit: LengthUnit) => void
}

const UnitContext = createContext<UnitContextValue>({ unit: 'metric', setUnit: () => {} })

const STORAGE_KEY = 'boltbook.unit'

/** US locales default to imperial; everyone else to metric. */
function defaultUnit(): LengthUnit {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY)
    if (saved === 'metric' || saved === 'imperial') return saved
  } catch {
    // localStorage can be unavailable; fall through to locale.
  }
  return (navigator.language ?? '').toLowerCase().startsWith('en-us') ? 'imperial' : 'metric'
}

export function UnitProvider({ children }: { children: ReactNode }) {
  const [unit, setUnitState] = useState<LengthUnit>(defaultUnit)

  const setUnit = useCallback((next: LengthUnit) => {
    setUnitState(next)
    try {
      window.localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // Non-fatal: the preference just will not persist.
    }
  }, [])

  const value = useMemo(() => ({ unit, setUnit }), [unit, setUnit])
  return <UnitContext.Provider value={value}>{children}</UnitContext.Provider>
}

export function useUnit(): UnitContextValue {
  return useContext(UnitContext)
}
