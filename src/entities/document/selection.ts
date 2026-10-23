import {
  resolveMaterialType,
  type Document,
  type DocumentType,
  type LearningMaterialType,
  type ProcessingStatus,
} from './types'

/**
 * Multi-select over file lists (课程「文件」页, 设置 → 文件管理, 考试工作台
 * 资料). Pure helpers: the selection is a set of document ids; every
 * function returns a new set and never mutates its input.
 */

export type SelectionState = 'none' | 'some' | 'all'

/** Add the id when absent, remove it when present. */
export function toggleSelection(selected: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(selected)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}

/** Select (`on`) or deselect every id in `ids`; other ids are kept. */
export function setSelection(
  selected: ReadonlySet<string>,
  ids: readonly string[],
  on: boolean,
): Set<string> {
  const next = new Set(selected)
  for (const id of ids) {
    if (on) next.add(id)
    else next.delete(id)
  }
  return next
}

/**
 * Shift-click: every row between the anchor and the target (inclusive, in
 * the list's current order) takes the state the target is switched to.
 * Without a usable anchor (none yet, or filtered out) it is a plain toggle.
 */
export function selectRange(
  selected: ReadonlySet<string>,
  orderedIds: readonly string[],
  anchorId: string | null,
  targetId: string,
): Set<string> {
  const from = anchorId === null ? -1 : orderedIds.indexOf(anchorId)
  const to = orderedIds.indexOf(targetId)
  if (from < 0 || to < 0) return toggleSelection(selected, targetId)
  const on = !selected.has(targetId)
  const [start, end] = from <= to ? [from, to] : [to, from]
  return setSelection(selected, orderedIds.slice(start, end + 1), on)
}

/** How many of `ids` are selected, for a header checkbox. */
export function selectionState(
  selected: ReadonlySet<string>,
  ids: readonly string[],
): SelectionState {
  if (ids.length === 0) return 'none'
  let count = 0
  for (const id of ids) if (selected.has(id)) count++
  if (count === 0) return 'none'
  return count === ids.length ? 'all' : 'some'
}

/** Drop ids that no longer exist (a file was deleted elsewhere). */
export function pruneSelection(
  selected: ReadonlySet<string>,
  existingIds: Iterable<string>,
): Set<string> {
  const existing = new Set(existingIds)
  const next = new Set<string>()
  for (const id of selected) if (existing.has(id)) next.add(id)
  return next
}

// ---------------------------------------------------------------------------
// Filters (search + type / material / status) and sorting, shared by every
// file list so 「全选」 always means "every file the current filter shows".
// ---------------------------------------------------------------------------

export type DocumentSortKey = 'newest' | 'oldest' | 'name' | 'size'

export interface DocumentFilters {
  query: string
  type: 'all' | DocumentType
  material: 'all' | LearningMaterialType
  status: 'all' | ProcessingStatus
  sort: DocumentSortKey
}

export const DEFAULT_DOCUMENT_FILTERS: DocumentFilters = {
  query: '',
  type: 'all',
  material: 'all',
  status: 'all',
  sort: 'newest',
}

/** True when any filter narrows the list (sorting does not). */
export function filtersActive(filters: DocumentFilters): boolean {
  return (
    filters.query.trim() !== '' ||
    filters.type !== 'all' ||
    filters.material !== 'all' ||
    filters.status !== 'all'
  )
}

/** The files the filters show, in the chosen order. */
export function filterDocuments<T extends Document>(
  documents: readonly T[],
  filters: DocumentFilters,
): T[] {
  const q = filters.query.trim().toLowerCase()
  const list = documents.filter((d) => {
    if (filters.type !== 'all' && d.type !== filters.type) return false
    if (filters.material !== 'all' && resolveMaterialType(d.materialType) !== filters.material) {
      return false
    }
    if (filters.status !== 'all' && d.status !== filters.status) return false
    if (q && !d.name.toLowerCase().includes(q)) return false
    return true
  })
  return list.sort((a, b) => {
    switch (filters.sort) {
      case 'newest':
        return b.uploadedAt - a.uploadedAt
      case 'oldest':
        return a.uploadedAt - b.uploadedAt
      case 'name':
        return a.name.localeCompare(b.name)
      case 'size':
        return b.sizeBytes - a.sizeBytes
      default:
        return 0
    }
  })
}
