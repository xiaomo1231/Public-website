/**
 * Algorithm figures for computer-science lessons: step-by-step sorting and
 * binary-search-tree insertion with its traversals.
 *
 * The model supplies only the input the lesson uses (the array, the keys in
 * insertion order); every comparison, swap, tree shape and traversal is
 * produced here by running the algorithm.
 */

export type SortAlgorithm = 'bubble' | 'insertion' | 'selection' | 'merge' | 'quick'
export const SORT_ALGORITHMS: readonly SortAlgorithm[] = ['bubble', 'insertion', 'selection', 'merge', 'quick']
export const MAX_SORT_VALUES = 12

export type SortAction = 'start' | 'compare' | 'swap' | 'write' | 'pivot' | 'done'

export interface SortFrame {
  values: number[]
  action: SortAction
  /** Indices the step looks at. */
  active: number[]
  /** Indices known to be in their final place. */
  sorted: number[]
  comparisons: number
  writes: number
}

/** Every step of the algorithm on `input` (ascending). */
export function sortFrames(algorithm: SortAlgorithm, input: number[]): SortFrame[] {
  const a = [...input]
  const frames: SortFrame[] = []
  const sorted = new Set<number>()
  let comparisons = 0
  let writes = 0
  const push = (action: SortAction, active: number[]) =>
    frames.push({ values: [...a], action, active, sorted: [...sorted].sort((x, y) => x - y), comparisons, writes })
  const less = (i: number, j: number) => {
    comparisons++
    push('compare', [i, j])
    return a[i]! < a[j]!
  }
  const swap = (i: number, j: number) => {
    if (i === j) return
    ;[a[i], a[j]] = [a[j]!, a[i]!]
    writes += 2
    push('swap', [i, j])
  }
  push('start', [])
  const n = a.length

  switch (algorithm) {
    case 'bubble':
      for (let end = n - 1; end > 0; end--) {
        let swapped = false
        for (let i = 0; i < end; i++) {
          if (less(i + 1, i)) {
            swap(i, i + 1)
            swapped = true
          }
        }
        sorted.add(end)
        if (!swapped) for (let k = 0; k < end; k++) sorted.add(k)
        if (!swapped) break
      }
      break
    case 'insertion':
      for (let i = 1; i < n; i++) {
        for (let j = i; j > 0 && less(j, j - 1); j--) swap(j, j - 1)
      }
      break
    case 'selection':
      for (let i = 0; i < n - 1; i++) {
        let min = i
        for (let j = i + 1; j < n; j++) if (less(j, min)) min = j
        swap(i, min)
        sorted.add(i)
      }
      break
    case 'merge': {
      const mergeSort = (lo: number, hi: number) => {
        if (hi - lo < 1) return
        const mid = Math.floor((lo + hi) / 2)
        mergeSort(lo, mid)
        mergeSort(mid + 1, hi)
        const merged: number[] = []
        let i = lo
        let j = mid + 1
        while (i <= mid && j <= hi) merged.push(less(j, i) ? a[j++]! : a[i++]!)
        while (i <= mid) merged.push(a[i++]!)
        while (j <= hi) merged.push(a[j++]!)
        for (let k = 0; k < merged.length; k++) {
          a[lo + k] = merged[k]!
          writes++
        }
        push('write', Array.from({ length: hi - lo + 1 }, (_, k) => lo + k))
      }
      mergeSort(0, n - 1)
      break
    }
    case 'quick': {
      // Lomuto partition with the last element as the pivot.
      const quick = (lo: number, hi: number) => {
        if (lo > hi) return
        if (lo === hi) {
          sorted.add(lo)
          return
        }
        push('pivot', [hi])
        let store = lo
        for (let i = lo; i < hi; i++) {
          if (less(i, hi)) {
            swap(i, store)
            store++
          }
        }
        swap(store, hi)
        sorted.add(store)
        quick(lo, store - 1)
        quick(store + 1, hi)
      }
      quick(0, n - 1)
      break
    }
  }
  for (let k = 0; k < n; k++) sorted.add(k)
  push('done', [])
  return frames
}

// --- binary search trees -----------------------------------------------------

export const MAX_BST_KEYS = 15

export interface BstNode {
  key: number
  left?: BstNode
  right?: BstNode
}

export interface BstResult {
  root?: BstNode
  /** Keys skipped because they were already in the tree. */
  duplicates: number[]
  height: number
  inorder: number[]
  preorder: number[]
  postorder: number[]
  levelOrder: number[]
  /** Path of keys visited while inserting the last key. */
  lastPath: number[]
}

export function buildBst(keys: number[]): BstResult {
  let root: BstNode | undefined
  const duplicates: number[] = []
  let lastPath: number[] = []
  for (const key of keys) {
    const path: number[] = []
    if (!root) {
      root = { key }
      lastPath = [key]
      continue
    }
    let node = root
    for (;;) {
      path.push(node.key)
      if (key === node.key) {
        duplicates.push(key)
        break
      }
      const side = key < node.key ? 'left' : 'right'
      const next = node[side]
      if (!next) {
        node[side] = { key }
        path.push(key)
        break
      }
      node = next
    }
    lastPath = path
  }
  const inorder: number[] = []
  const preorder: number[] = []
  const postorder: number[] = []
  const walk = (node?: BstNode) => {
    if (!node) return
    preorder.push(node.key)
    walk(node.left)
    inorder.push(node.key)
    walk(node.right)
    postorder.push(node.key)
  }
  walk(root)
  const levelOrder: number[] = []
  const queue = root ? [root] : []
  while (queue.length) {
    const node = queue.shift()!
    levelOrder.push(node.key)
    if (node.left) queue.push(node.left)
    if (node.right) queue.push(node.right)
  }
  const height = (node?: BstNode): number => (node ? 1 + Math.max(height(node.left), height(node.right)) : 0)
  return { ...(root ? { root } : {}), duplicates, height: Math.max(0, height(root) - 1), inorder, preorder, postorder, levelOrder, lastPath }
}

/** Node positions: x by in-order rank, y by depth. */
export function bstLayout(root?: BstNode): Array<{ key: number; x: number; depth: number; parent?: number }> {
  const out: Array<{ key: number; x: number; depth: number; parent?: number }> = []
  let rank = 0
  const walk = (node: BstNode | undefined, depth: number, parent?: number) => {
    if (!node) return
    walk(node.left, depth + 1, node.key)
    out.push({ key: node.key, x: rank++, depth, ...(parent !== undefined ? { parent } : {}) })
    walk(node.right, depth + 1, node.key)
  }
  walk(root, 0)
  return out
}
