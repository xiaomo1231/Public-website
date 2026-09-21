import type {
  CourseStructureNode,
  CourseStructureNodeType,
  StructureConfidence,
} from '@/entities/courseStructure/types'
import { UNSTRUCTURED_TITLE } from '@/entities/courseStructure/types'

/**
 * Detect the textbook's chapter/section hierarchy from observable signals.
 *
 * Layers, in priority order:
 *   1. explicit chapter/unit/part headings ("Chapter 2: Functions", "Unit I")
 *   2. numbered sections / subsections ("2.1 Sets", "2.1.1 Examples")
 *   3. heading markers the extractor already produced (`contentType: 'heading'`)
 *
 * When none of these fire, we do **not** invent chapters — the document becomes
 * a single "General Course Material" node with `low` confidence.
 */

export interface StructureChunkInput {
  text: string
  contentType: string
  pageNumber?: number
}

export interface DetectedNode {
  type: CourseStructureNodeType
  number?: string
  title: string
  depth: number
  pageStart?: number
  pageEnd?: number
  chunkIndexes: number[]
  confidence: StructureConfidence
}

export interface DetectedStructure {
  nodes: DetectedNode[]
  /** Per chunk index → node index, or -1 when the chunk precedes any heading. */
  assignments: number[]
  confidence: StructureConfidence
}

const CHAPTER_WORD =
  /^\s*(chapter|unit|part|module)\s+([0-9]{1,3}|[ivxlc]{1,6})\b\s*[:.\-–—]?\s*(.*)$/i
const CJK_CHAPTER = /^\s*第\s*([一二三四五六七八九十百千0-9]+)\s*[章单元篇部分]\s*[:：]?\s*(.*)$/
const SUBSECTION = /^\s*([0-9]{1,3}(?:\.[0-9]{1,3}){2})\s*[:.\-–—]?\s+(.+)$/
const SECTION = /^\s*([0-9]{1,3}\.[0-9]{1,3})\s*[:.\-–—]?\s+(.+)$/
/** A bare numbered heading like "2 Functions" (only trusted when marked heading). */
const BARE_NUMBERED = /^\s*([0-9]{1,3})\s*[:.\-–—]?\s+([A-Z\u4e00-\u9fff][^.]*)$/

const MAX_HEADING_CHARS = 120

const DEPTH: Record<CourseStructureNodeType, number> = {
  part: 0,
  unit: 0,
  chapter: 1,
  section: 2,
  subsection: 3,
}

interface Classified {
  type: CourseStructureNodeType
  number?: string
  title: string
}

function cleanTitle(raw: string): string {
  return raw.replace(/\s+/g, ' ').replace(/[.\s]+$/, '').trim()
}

function classifyHeading(text: string, isMarkedHeading: boolean): Classified | null {
  const line = text.trim()
  if (!line || line.length > MAX_HEADING_CHARS) return null

  const subsection = SUBSECTION.exec(line)
  if (subsection) {
    return { type: 'subsection', number: subsection[1]!, title: cleanTitle(subsection[2]!) }
  }

  const section = SECTION.exec(line)
  if (section) {
    return { type: 'section', number: section[1]!, title: cleanTitle(section[2]!) }
  }

  const chapterWord = CHAPTER_WORD.exec(line)
  if (chapterWord) {
    const keyword = chapterWord[1]!.toLowerCase()
    const type: CourseStructureNodeType =
      keyword === 'unit' ? 'unit' : keyword === 'part' ? 'part' : 'chapter'
    const title = cleanTitle(chapterWord[3]!)
    return {
      type,
      number: chapterWord[2]!,
      // "Chapter 2: Functions" → "Functions"; a bare "Chapter 2" keeps a label.
      title: title || `${keyword[0]!.toUpperCase()}${keyword.slice(1)} ${chapterWord[2]!}`,
    }
  }

  const cjk = CJK_CHAPTER.exec(line)
  if (cjk) {
    const title = cleanTitle(cjk[2]!)
    return { type: 'chapter', number: cjk[1]!, title: title || `第${cjk[1]}章` }
  }

  if (isMarkedHeading) {
    const bare = BARE_NUMBERED.exec(line)
    if (bare) return { type: 'chapter', number: bare[1]!, title: cleanTitle(bare[2]!) }
  }

  return null
}

function isHeadingCandidate(chunk: StructureChunkInput, classified: Classified | null): boolean {
  if (chunk.contentType === 'heading') return true
  return classified !== null
}

function confidenceFor(nodes: DetectedNode[]): StructureConfidence {
  const topLevel = nodes.filter((node) => node.depth <= 1)
  const numbered = topLevel.filter((node) => node.number !== undefined)
  if (numbered.length >= 2) return 'high'
  if (topLevel.length >= 1 || nodes.filter((node) => node.depth === 2).length >= 2) return 'medium'
  return 'low'
}

export function detectStructure(chunks: StructureChunkInput[]): DetectedStructure {
  const nodes: DetectedNode[] = []
  const assignments: number[] = new Array(chunks.length).fill(-1)
  let current = -1

  chunks.forEach((chunk, index) => {
    const classified = classifyHeading(chunk.text, chunk.contentType === 'heading')
    if (classified && isHeadingCandidate(chunk, classified)) {
      const depth = DEPTH[classified.type]
      const node: DetectedNode = {
        type: classified.type,
        ...(classified.number !== undefined ? { number: classified.number } : {}),
        title: classified.title,
        depth,
        chunkIndexes: [index],
        confidence: 'high',
      }
      if (chunk.pageNumber !== undefined) node.pageStart = chunk.pageNumber
      nodes.push(node)
      current = nodes.length - 1
      assignments[index] = current
      return
    }

    if (current >= 0) {
      const node = nodes[current]!
      node.chunkIndexes.push(index)
      if (chunk.pageNumber !== undefined) node.pageEnd = chunk.pageNumber
      assignments[index] = current
    }
  })

  // Fill missing page ranges so a node spans from its first to its last chunk.
  for (const node of nodes) {
    if (node.pageStart === undefined) {
      const first = chunks[node.chunkIndexes[0]!]
      if (first?.pageNumber !== undefined) node.pageStart = first.pageNumber
    }
    if (node.pageEnd === undefined) node.pageEnd = node.pageStart
  }

  if (nodes.length === 0) {
    return {
      nodes: [
        {
          type: 'chapter',
          title: UNSTRUCTURED_TITLE,
          depth: 0,
          chunkIndexes: chunks.map((_, index) => index),
          confidence: 'low',
        },
      ],
      assignments: chunks.map(() => 0),
      confidence: 'low',
    }
  }

  const confidence = confidenceFor(nodes)
  for (const node of nodes) node.confidence = confidence
  return { nodes, assignments, confidence }
}

function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, ' ').trim()
}

/**
 * Merge a freshly detected tree with the stored one, reusing node ids wherever
 * the node is recognisably the same. Re-analysing a textbook must not hand out
 * new ids for chapters that did not actually change, or every note / transcript
 * / practice link would be lost.
 */
export function reconcileNodes(
  previous: CourseStructureNode[],
  detected: DetectedNode[],
  ids: { structureId: string; projectId: string },
): CourseStructureNode[] {
  const pool = previous.slice()
  const take = (predicate: (node: CourseStructureNode) => boolean): CourseStructureNode | undefined => {
    const index = pool.findIndex(predicate)
    if (index === -1) return undefined
    return pool.splice(index, 1)[0]
  }

  return detected.map((node, order) => {
    const matched =
      (node.number !== undefined
        ? take((prev) => prev.type === node.type && prev.number === node.number)
        : undefined) ??
      take((prev) => prev.type === node.type && normalizeTitle(prev.title) === normalizeTitle(node.title)) ??
      take((prev) => prev.type === node.type)

    return {
      id: matched?.id ?? crypto.randomUUID(),
      structureId: ids.structureId,
      projectId: ids.projectId,
      type: node.type,
      ...(node.number !== undefined ? { number: node.number } : {}),
      title: node.title,
      order,
      depth: node.depth,
      ...(node.pageStart !== undefined ? { sourcePageStart: node.pageStart } : {}),
      ...(node.pageEnd !== undefined ? { sourcePageEnd: node.pageEnd } : {}),
      sourceChunkIds: [],
      confidence: node.confidence,
    }
  })
}

/** True when the detected tree differs from the stored one. */
export function structureChanged(
  previous: CourseStructureNode[],
  next: CourseStructureNode[],
): boolean {
  if (previous.length !== next.length) return true
  return next.some((node, index) => {
    const before = previous[index]
    return (
      !before ||
      before.id !== node.id ||
      before.title !== node.title ||
      before.number !== node.number ||
      before.type !== node.type ||
      before.depth !== node.depth
    )
  })
}
