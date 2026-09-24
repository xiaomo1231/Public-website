import type { VennOperation, VennSet } from './types'

/**
 * Deterministic local set maths for `venn_2d`.
 *
 * The model supplies the sets and the operation; the region membership, the
 * operation result and which regions to highlight are computed here, so a wrong
 * model answer can never become a wrong diagram.
 */

export type VennRegionKey = 'A' | 'B' | 'C' | 'AB' | 'AC' | 'BC' | 'ABC' | 'outside'

export type VennRegions = Record<VennRegionKey, string[]>

export const VENN_REGION_KEYS: readonly VennRegionKey[] = [
  'A',
  'B',
  'C',
  'AB',
  'AC',
  'BC',
  'ABC',
  'outside',
]

export const VENN_OPERATIONS: readonly VennOperation[] = [
  'union',
  'intersection',
  'difference',
  'symmetric_difference',
  'complement',
  'display',
]

/** Membership bitmask of each region: bit 0 = A, bit 1 = B, bit 2 = C. */
const REGION_MASK: Record<VennRegionKey, number> = {
  A: 0b001,
  B: 0b010,
  C: 0b100,
  AB: 0b011,
  AC: 0b101,
  BC: 0b110,
  ABC: 0b111,
  outside: 0b000,
}

function regionKeyFromMask(mask: number): VennRegionKey | null {
  switch (mask) {
    case 0b000:
      return 'outside'
    case 0b001:
      return 'A'
    case 0b010:
      return 'B'
    case 0b100:
      return 'C'
    case 0b011:
      return 'AB'
    case 0b101:
      return 'AC'
    case 0b110:
      return 'BC'
    case 0b111:
      return 'ABC'
    default:
      return null
  }
}

/** Stable de-duplication preserving first occurrence. */
export function dedupeElements(elements: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const element of elements) {
    if (seen.has(element)) continue
    seen.add(element)
    result.push(element)
  }
  return result
}

/**
 * Split the diagram's elements into disjoint regions. Deterministic: sets are
 * scanned in order, then the universe, and each region keeps that order.
 */
export function computeVennRegions(sets: VennSet[], universe?: string[]): VennRegions {
  const regions: VennRegions = {
    A: [],
    B: [],
    C: [],
    AB: [],
    AC: [],
    BC: [],
    ABC: [],
    outside: [],
  }
  const ordered = dedupeElements([
    ...sets.flatMap((set) => set.elements),
    ...(universe ?? []),
  ])
  for (const element of ordered) {
    let mask = 0
    sets.forEach((set, index) => {
      if (set.elements.includes(element)) mask |= 1 << index
    })
    const key = regionKeyFromMask(mask)
    if (key) regions[key].push(element)
  }
  return regions
}

export interface VennOperationResult {
  result: string[]
  highlight: VennRegionKey[]
}

/** Which regions the operation covers, and the resulting element list. */
export function applyVennOperation(
  operation: VennOperation,
  sets: VennSet[],
  regions: VennRegions,
  operandIds: string[],
): VennOperationResult {
  const indices = operandIds
    .map((id) => sets.findIndex((set) => set.id === id))
    .filter((index) => index >= 0)

  // A region that mentions a set the diagram does not have (e.g. "ABC" in a
  // two-set diagram) can never be part of the result.
  const validMask = (1 << sets.length) - 1

  const included = (key: VennRegionKey): boolean => {
    const mask = REGION_MASK[key]
    if ((mask & ~validMask) !== 0) return false
    switch (operation) {
      case 'display':
        return mask !== 0
      case 'union':
        return indices.length > 0 && indices.some((index) => (mask & (1 << index)) !== 0)
      case 'intersection':
        return indices.length > 0 && indices.every((index) => (mask & (1 << index)) !== 0)
      case 'difference': {
        if (indices.length === 0) return false
        const first = indices[0]!
        if ((mask & (1 << first)) === 0) return false
        return indices.slice(1).every((index) => (mask & (1 << index)) === 0)
      }
      case 'symmetric_difference': {
        if (indices.length === 0) return false
        const count = indices.filter((index) => (mask & (1 << index)) !== 0).length
        return count % 2 === 1
      }
      case 'complement':
        return indices.length > 0 && indices.every((index) => (mask & (1 << index)) === 0)
    }
  }

  const highlight = VENN_REGION_KEYS.filter(included)
  const result: string[] = []
  for (const key of highlight) result.push(...regions[key])
  return { result, highlight }
}
