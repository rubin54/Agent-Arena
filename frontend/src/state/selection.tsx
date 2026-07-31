import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

const STORAGE_KEY = 'arena.selectedModels'

interface SelectionValue {
  selected: string[]
  isSelected: (id: string) => boolean
  toggle: (id: string) => void
  add: (ids: string[]) => void
  remove: (id: string) => void
  clear: () => void
  set: (ids: string[]) => void
}

const SelectionContext = createContext<SelectionValue | null>(null)

/** The model selection survives navigation and reloads -- you pick in the catalog
 *  and start the run from somewhere else. */
export function SelectionProvider({ children }: { children: ReactNode }) {
  const [selected, setSelected] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      const parsed = raw ? JSON.parse(raw) : []
      return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : []
    } catch {
      return []
    }
  })

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(selected))
  }, [selected])

  const toggle = useCallback((id: string) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }, [])

  const add = useCallback((ids: string[]) => {
    setSelected((prev) => [...prev, ...ids.filter((id) => !prev.includes(id))])
  }, [])

  const remove = useCallback((id: string) => {
    setSelected((prev) => prev.filter((x) => x !== id))
  }, [])

  const clear = useCallback(() => setSelected([]), [])

  const value = useMemo<SelectionValue>(
    () => ({
      selected,
      isSelected: (id) => selected.includes(id),
      toggle,
      add,
      remove,
      clear,
      set: setSelected,
    }),
    [selected, toggle, add, remove, clear],
  )

  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>
}

export function useSelection(): SelectionValue {
  const ctx = useContext(SelectionContext)
  if (!ctx) throw new Error('useSelection must be used inside a SelectionProvider')
  return ctx
}
