import type { AppDatabase } from '@/infrastructure/db/database'
import { getDb } from '@/infrastructure/db/database'
import { CourseStructureRepository } from '@/entities/courseStructure/repository'
import type {
  CourseStructure,
  CourseStructureNode,
  CourseStructureNodeType,
} from '@/entities/courseStructure/types'
import {
  detectStructure,
  reconcileNodes,
  structureChanged,
  type StructureChunkInput,
} from '@/infrastructure/files/structureDetection'
import { logger } from '@/infrastructure/logger/logger'

/** Chapter/section reference attached to a chunk, topic or link. */
export interface ChunkStructureRef {
  chapterId?: string
  sectionId?: string
  chapterNumber?: string
  sectionNumber?: string
  chapterTitle?: string
  sectionTitle?: string
}

export interface PreparedStructure {
  structure: CourseStructure
  nodes: CourseStructureNode[]
  /** Per input chunk index → its structure reference. */
  assignments: Array<ChunkStructureRef | undefined>
  /** Per node index → the chunk indexes it owns. */
  nodeChunkIndexes: number[][]
  changed: boolean
}

const CHAPTER_TYPES: CourseStructureNodeType[] = ['part', 'unit', 'chapter']

function parentIndexes(nodes: Array<{ depth: number }>): number[] {
  return nodes.map((node, index) => {
    for (let i = index - 1; i >= 0; i--) {
      if (nodes[i]!.depth < node.depth) return i
    }
    return -1
  })
}

function ancestorOfType(
  nodes: Array<{ type: CourseStructureNodeType }>,
  parents: number[],
  index: number,
  types: CourseStructureNodeType[],
): number {
  let cursor = index
  while (cursor >= 0) {
    if (types.includes(nodes[cursor]!.type)) return cursor
    cursor = parents[cursor]!
  }
  return -1
}

/**
 * Builds and persists the course structure for one textbook document.
 *
 * `prepare` runs before chunks are stored (it needs only their text/layout);
 * `persist` fills in `sourceChunkIds` once the chunk ids exist. Node ids are
 * reconciled with the previous structure so re-analysing does not orphan every
 * note / transcript / practice link.
 */
export class CourseStructureService {
  private db: AppDatabase
  private repo: CourseStructureRepository

  constructor(deps: { db?: AppDatabase; repo?: CourseStructureRepository } = {}) {
    this.db = deps.db ?? getDb()
    this.repo = deps.repo ?? new CourseStructureRepository(this.db)
  }

  getByDocument(documentId: string): Promise<CourseStructure | undefined> {
    return this.repo.getByDocument(documentId)
  }

  listByProject(projectId: string): Promise<CourseStructure[]> {
    return this.repo.listByProject(projectId)
  }

  listNodes(structureId: string): Promise<CourseStructureNode[]> {
    return this.repo.listNodes(structureId)
  }

  async prepare(input: {
    projectId: string
    documentId: string
    documentName: string
    chunks: StructureChunkInput[]
  }): Promise<PreparedStructure> {
    const detected = detectStructure(input.chunks)
    const previous = await this.repo.getByDocument(input.documentId)
    const previousNodes = previous ? await this.repo.listNodes(previous.id) : []
    const structureId = previous?.id ?? crypto.randomUUID()

    const nodes = reconcileNodes(previousNodes, detected.nodes, {
      structureId,
      projectId: input.projectId,
    })
    const changed = structureChanged(previousNodes, nodes)
    // `nodes` is index-parallel to `detected.nodes`, so the detected tree's
    // shape drives parenting while the reconciled nodes supply stable ids.
    const parents = parentIndexes(detected.nodes)

    const nodeChunkIndexes = detected.nodes.map(() => [] as number[])
    detected.assignments.forEach((nodeIndex, chunkIndex) => {
      if (nodeIndex >= 0) nodeChunkIndexes[nodeIndex]!.push(chunkIndex)
    })
    const assignments: Array<ChunkStructureRef | undefined> = detected.assignments.map((nodeIndex) =>
      nodeIndex < 0 ? undefined : this.refFor(nodes, parents, nodeIndex),
    )

    const now = Date.now()
    const structure: CourseStructure = {
      id: structureId,
      projectId: input.projectId,
      sourceDocumentId: input.documentId,
      title: input.documentName,
      confidence: detected.confidence,
      version: changed ? (previous?.version ?? 0) + 1 : (previous?.version ?? 1),
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
    }

    return { structure, nodes, assignments, nodeChunkIndexes, changed }
  }

  /** Fill `sourceChunkIds` and write the structure. */
  async persist(prepared: PreparedStructure, storedChunkIds: string[]): Promise<void> {
    const nodes = prepared.nodes.map((node, index) => ({
      ...node,
      sourceChunkIds: prepared.nodeChunkIndexes[index]!
        .map((chunkIndex) => storedChunkIds[chunkIndex])
        .filter((id): id is string => Boolean(id)),
    }))
    await this.repo.replace(prepared.structure, nodes)
    logger.debug('Course structure stored', {
      documentId: prepared.structure.sourceDocumentId,
      nodes: nodes.length,
      confidence: prepared.structure.confidence,
      changed: prepared.changed,
    })
  }

  async deleteByProject(projectId: string): Promise<number> {
    return this.repo.deleteByProject(projectId)
  }

  private refFor(
    nodes: CourseStructureNode[],
    parents: number[],
    index: number,
  ): ChunkStructureRef {
    const node = nodes[index]!
    const chapterIndex = CHAPTER_TYPES.includes(node.type)
      ? index
      : ancestorOfType(nodes, parents, index, CHAPTER_TYPES)
    const sectionIndex =
      node.type === 'section'
        ? index
        : node.type === 'subsection'
          ? ancestorOfType(nodes, parents, index, ['section'])
          : -1

    const chapter = chapterIndex >= 0 ? nodes[chapterIndex] : undefined
    const section = sectionIndex >= 0 ? nodes[sectionIndex] : undefined

    return {
      ...(chapter ? { chapterId: chapter.id } : {}),
      ...(section ? { sectionId: section.id } : {}),
      ...(chapter?.number ? { chapterNumber: chapter.number } : {}),
      ...(section?.number ? { sectionNumber: section.number } : {}),
      ...(chapter ? { chapterTitle: chapter.title } : {}),
      ...(section ? { sectionTitle: section.title } : {}),
    }
  }
}
