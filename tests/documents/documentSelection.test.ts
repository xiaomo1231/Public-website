import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DOCUMENT_FILTERS,
  filterDocuments,
  filtersActive,
  pruneSelection,
  selectRange,
  selectionState,
  setSelection,
  toggleSelection,
} from '@/entities/document/selection'
import type { Document, LearningMaterialType } from '@/entities/document/types'

function doc(id: string, name: string, materialType: LearningMaterialType, at = 1): Document {
  return {
    id,
    projectId: 'p1',
    type: 'pdf',
    materialType,
    name,
    sizeBytes: 10,
    hasBlob: true,
    status: 'ready',
    warnings: [],
    metadata: {},
    uploadedAt: at,
  }
}

describe('document multi-select (2o)', () => {
  const ids = ['a', 'b', 'c', 'd', 'e']

  it('toggles one id without mutating the input', () => {
    const start = new Set(['a'])
    const next = toggleSelection(start, 'b')
    expect([...next].sort()).toEqual(['a', 'b'])
    expect([...start]).toEqual(['a'])
    expect([...toggleSelection(next, 'a')]).toEqual(['b'])
  })

  it('Shift-selects the range between the anchor and the target, in list order', () => {
    expect([...selectRange(new Set(['b']), ids, 'b', 'd')].sort()).toEqual(['b', 'c', 'd'])
    // Upwards works too.
    expect([...selectRange(new Set(['d']), ids, 'd', 'a')].sort()).toEqual(['a', 'b', 'c', 'd'])
  })

  it('a Shift range on a selected target deselects the range', () => {
    const all = new Set(ids)
    expect([...selectRange(all, ids, 'b', 'd')].sort()).toEqual(['a', 'e'])
  })

  it('falls back to a plain toggle without a usable anchor', () => {
    expect([...selectRange(new Set(), ids, null, 'c')]).toEqual(['c'])
    expect([...selectRange(new Set(), ids, 'gone', 'c')]).toEqual(['c'])
  })

  it('select-all covers only the filtered rows and keeps other selections', () => {
    const docs = [
      doc('a', 'Chapter 1.pdf', 'textbook'),
      doc('b', 'HW1.pdf', 'homework'),
      doc('c', 'HW2.pdf', 'homework'),
      doc('d', 'Final 2023.pdf', 'past_exam'),
    ]
    const filters = { ...DEFAULT_DOCUMENT_FILTERS, query: 'hw' }
    expect(filtersActive(filters)).toBe(true)
    const shown = filterDocuments(docs, filters).map((d) => d.id)
    expect(shown.sort()).toEqual(['b', 'c'])
    const selected = setSelection(new Set(['d']), shown, true)
    expect([...selected].sort()).toEqual(['b', 'c', 'd'])
    expect(selectionState(selected, shown)).toBe('all')
    expect(selectionState(selected, ['a', 'b'])).toBe('some')
    expect(selectionState(new Set(), shown)).toBe('none')
    // Clearing the filtered rows leaves the hidden selection alone.
    expect([...setSelection(selected, shown, false)]).toEqual(['d'])
  })

  it('filters by material type and sorts', () => {
    const docs = [
      doc('a', 'b.pdf', 'homework', 1),
      doc('b', 'a.pdf', 'homework', 2),
      doc('c', 'c.pdf', 'textbook', 3),
    ]
    const byName = filterDocuments(docs, {
      ...DEFAULT_DOCUMENT_FILTERS,
      material: 'homework',
      sort: 'name',
    })
    expect(byName.map((d) => d.name)).toEqual(['a.pdf', 'b.pdf'])
    expect(filtersActive(DEFAULT_DOCUMENT_FILTERS)).toBe(false)
  })

  it('prunes ids of files that no longer exist', () => {
    expect([...pruneSelection(new Set(['a', 'x']), ['a', 'b'])]).toEqual(['a'])
  })
})
