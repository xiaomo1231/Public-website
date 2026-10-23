import { useCallback, useMemo, useRef, useState } from 'react'
import {
  pruneSelection,
  selectRange,
  setSelection,
  toggleSelection,
} from '@/entities/document/selection'

/**
 * Selection state for one or more `DocumentList`s (the ids may span courses).
 * Pass the same object to every list that shares it and to
 * `DocumentBatchBar`.
 */
export interface DocumentSelection {
  selected: ReadonlySet<string>
  count: number
  isSelected: (id: string) => boolean
  /**
   * Toggle one row. With `range` (Shift held) every row between the last
   * toggled row and this one, in `orderedIds` order, takes this row's new state.
   */
  toggle: (id: string, options?: { range?: boolean; orderedIds?: readonly string[] }) => void
  /** Select / deselect many (header 全选 over the filtered rows). */
  setMany: (ids: readonly string[], on: boolean) => void
  clear: () => void
  /** Forget ids that are no longer in `existing` (deleted files). */
  prune: (existing: Iterable<string>) => void
}

export function useDocumentSelection(): DocumentSelection {
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set())
  const anchor = useRef<string | null>(null)

  const toggle = useCallback<DocumentSelection['toggle']>((id, options = {}) => {
    setSelected((current) =>
      options.range && options.orderedIds
        ? selectRange(current, options.orderedIds, anchor.current, id)
        : toggleSelection(current, id),
    )
    anchor.current = id
  }, [])
  const setMany = useCallback<DocumentSelection['setMany']>((ids, on) => {
    setSelected((current) => setSelection(current, ids, on))
  }, [])
  const clear = useCallback(() => {
    anchor.current = null
    setSelected((current) => (current.size === 0 ? current : new Set()))
  }, [])
  const prune = useCallback<DocumentSelection['prune']>((existing) => {
    setSelected((current) => {
      const next = pruneSelection(current, existing)
      return next.size === current.size ? current : next
    })
  }, [])

  return useMemo(
    () => ({
      selected,
      count: selected.size,
      isSelected: (id: string) => selected.has(id),
      toggle,
      setMany,
      clear,
      prune,
    }),
    [selected, toggle, setMany, clear, prune],
  )
}
