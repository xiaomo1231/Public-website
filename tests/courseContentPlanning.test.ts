import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { ProjectService } from '@/services/projectService'
import { DocumentRepository } from '@/entities/document/repository'
import { ChunkRepository } from '@/entities/chunk/repository'
import { CourseAnalysisRepository } from '@/entities/courseAnalysis/repository'
import { CourseContextRepository } from '@/entities/courseContext/repository'
import { CourseStructureRepository } from '@/entities/courseStructure/repository'
import { CourseContentRepository } from '@/entities/courseContent/repository'
import { planContentDependencies } from '@/entities/courseContent/dependency'
import {
  CourseContentService,
  clearEnsureAnalyzedInFlightForTesting,
} from '@/services/courseContentService'
import type { CourseStructure, CourseStructureNode } from '@/entities/courseStructure/types'
import type { DocumentChunk } from '@/entities/chunk/types'

const mocks = vi.hoisted(() => ({
  analyzeProject: vi.fn(),
  buildAIServices: vi.fn(),
}))

vi.mock('@/services/aiServices', () => ({
  buildAIServices: mocks.buildAIServices,
}))

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function chapter(
  id: string,
  sourceChunkIds: string[],
  overrides: Partial<CourseStructureNode> = {},
): CourseStructureNode {
  return {
    id,
    structureId: 'structure-1',
    projectId: 'p1',
    type: 'chapter',
    title: id,
    order: 0,
    depth: 0,
    sourceChunkIds,
    confidence: 'high',
    ...overrides,
  }
}

function section(
  id: string,
  sourceChunkIds: string[],
  overrides: Partial<CourseStructureNode> = {},
): CourseStructureNode {
  return chapter(id, sourceChunkIds, { type: 'section', depth: 1, order: 1, ...overrides })
}

function chunk(
  id: string,
  overrides: Partial<DocumentChunk> = {},
): DocumentChunk {
  return {
    id,
    documentId: 'doc-1',
    projectId: 'p1',
    contentType: 'paragraph',
    text: `text-${id}`,
    sourceReference: 'x',
    order: 0,
    createdAt: 0,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Case 1–5: dependency planning
// ---------------------------------------------------------------------------

describe('dependency planning (Cases 1–5)', () => {
  // Chapter 1's only chunk disappeared; Chapter 2 is untouched.
  const nodes = [chapter('ch1', ['c1']), chapter('ch2', ['c2'], { order: 1 })]
  const chunks = [chunk('c2', { chapterId: 'ch2' })]

  /**
   * A structure where `ch1` / `sec1` changed (their chunk is gone) and `ch2`
   * is untouched and still live. Used by Cases 3–5 so the control item really
   * is unaffected.
   */
  const sectionFixtures = {
    nodes: [
      chapter('ch1', ['c1']),
      section('sec1', ['c1'], { order: 1 }),
      chapter('ch2', ['c-live'], { order: 2 }),
    ],
    chunks: [chunk('c-live', { chapterId: 'ch2' })],
  }

  it('Case 1 — a changed chapter is affected, an unrelated one is not', () => {
    const report = planContentDependencies({
      nodes,
      chunks,
      topics: [
        { id: 'topic-ch1', chapterId: 'ch1', sourceRefs: [] },
        { id: 'topic-ch2', chapterId: 'ch2', sourceRefs: [{ chunkId: 'c2' }] },
      ],
    })

    expect(report.affected.chapterIds).toEqual(['ch1'])
    expect(report.topicIds).toContain('topic-ch1')
    expect(report.topicIds).not.toContain('topic-ch2')
  })

  it('Case 2 — a topic spanning a changed chapter is affected even when its primary chapter is elsewhere', () => {
    const report = planContentDependencies({
      nodes,
      chunks,
      topics: [
        // Primary chapter is Chapter 2, but it also cites a Chapter 1 chunk.
        {
          id: 'spanning',
          chapterId: 'ch2',
          sourceRefs: [{ chunkId: 'c1' }, { chunkId: 'c2' }],
        },
        // Control: only cites the untouched chapter.
        { id: 'local', chapterId: 'ch2', sourceRefs: [{ chunkId: 'c2' }] },
      ],
    })

    expect(report.topicIds).toContain('spanning')
    expect(report.topicIds).not.toContain('local')
  })

  it('Case 3 — a note linked to a changed section is affected', () => {
    const report = planContentDependencies({
      nodes: sectionFixtures.nodes,
      chunks: sectionFixtures.chunks,
      topics: [],
      noteLinks: [
        { noteChunkId: 'n1', textbookChunkId: 'c1', chapterId: 'ch1', sectionId: 'sec1' },
        { noteChunkId: 'n2', textbookChunkId: 'c-live', chapterId: 'ch2' },
      ],
    })

    expect(report.affected.sectionIds).toContain('sec1')
    expect(report.noteChunkIds).toEqual(['n1'])
  })

  it('Case 4 — a lecture transcript linked to a changed section is affected', () => {
    const report = planContentDependencies({
      nodes: sectionFixtures.nodes,
      chunks: sectionFixtures.chunks,
      topics: [],
      lectureLinks: [
        {
          transcriptChunkId: 't1',
          textbookChunkId: 'c1',
          chapterId: 'ch1',
          sectionId: 'sec1',
        },
        { transcriptChunkId: 't2', textbookChunkId: 'c-live', chapterId: 'ch2' },
      ],
    })

    expect(report.lectureChunkIds).toEqual(['t1'])
  })

  it('Case 5 — a practice question in a changed section needs its mapping re-evaluated', () => {
    const report = planContentDependencies({
      nodes: sectionFixtures.nodes,
      chunks: sectionFixtures.chunks,
      topics: [],
      practiceQuestions: [
        { id: 'q1', chunkId: 'c1', chapterId: 'ch1', sectionId: 'sec1' },
        { id: 'q2', chunkId: 'c-live', chapterId: 'ch2' },
      ],
    })

    expect(report.practiceQuestionIds).toEqual(['q1'])
  })

  it('reports nothing affected when every chunk is still present', () => {
    const report = planContentDependencies({
      nodes: [chapter('ch1', ['c1'])],
      chunks: [chunk('c1', { chapterId: 'ch1' })],
      topics: [{ id: 't1', chapterId: 'ch1', sourceRefs: [{ chunkId: 'c1' }] }],
      noteLinks: [{ noteChunkId: 'n1', textbookChunkId: 'c1', chapterId: 'ch1' }],
      lectureLinks: [{ transcriptChunkId: 't1', textbookChunkId: 'c1', chapterId: 'ch1' }],
      practiceQuestions: [{ id: 'q1', chunkId: 'c1', chapterId: 'ch1' }],
    })

    expect(report.affected.chapterIds).toEqual([])
    expect(report.topicIds).toEqual([])
    expect(report.noteChunkIds).toEqual([])
    expect(report.lectureChunkIds).toEqual([])
    expect(report.practiceQuestionIds).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// ensureAnalyzed: dedup, no-provider, scope boundary
// ---------------------------------------------------------------------------

describe('CourseContentService.ensureAnalyzed', () => {
  let db: AppDatabase
  let projectId: string
  let content: CourseContentRepository

  beforeEach(async () => {
    db = new AppDatabase()
    setDbForTesting(db)
    const project = await new ProjectService(db).create({ name: 'Calc', subject: 'calculus' })
    projectId = project.id

    const documents = new DocumentRepository(db)
    const chunks = new ChunkRepository(db)
    const doc = await documents.create({
      projectId,
      type: 'text',
      name: 'calculus.txt',
      sizeBytes: 0,
    })
    await documents.update(doc.id, { status: 'ready' })
    await chunks.addMany([
      {
        documentId: doc.id,
        projectId,
        contentType: 'paragraph',
        text: 'Derivatives are rates of change.',
        sourceReference: 'calculus.txt',
        order: 0,
      },
    ])

    content = new CourseContentRepository({ db })

    clearEnsureAnalyzedInFlightForTesting()
    mocks.analyzeProject.mockReset()
    mocks.analyzeProject.mockResolvedValue(undefined)
    mocks.buildAIServices.mockReset()
    mocks.buildAIServices.mockResolvedValue({
      documentAnalysis: { analyzeProject: mocks.analyzeProject },
    })
  })

  it('coalesces concurrent calls for the same project into one analysis', async () => {
    const service = new CourseContentService({ content })
    const [first, second] = await Promise.all([
      service.ensureAnalyzed(projectId),
      service.ensureAnalyzed(projectId),
    ])

    expect(mocks.analyzeProject).toHaveBeenCalledTimes(1)
    expect(first).toEqual(second)
    expect(first).toEqual({ analyzed: true, reason: 'analyzed' })
  })

  it('returns the same in-flight promise to concurrent callers', () => {
    const service = new CourseContentService({ content })
    const first = service.ensureAnalyzed(projectId)
    const second = service.ensureAnalyzed(projectId)
    expect(first).toBe(second)
  })

  it('does not coalesce different projects', async () => {
    const other = await new ProjectService(db).create({ name: 'Physics', subject: 'physics' })
    const service = new CourseContentService({ content })

    await Promise.all([
      service.ensureAnalyzed(projectId),
      service.ensureAnalyzed(other.id),
    ])

    expect(mocks.analyzeProject).toHaveBeenCalledTimes(2)
  })

  it('skips the AI entirely when the content is already fresh', async () => {
    const analyses = new CourseAnalysisRepository(db)
    await analyses.reseedProject(
      projectId,
      {
        topics: [{ name: 'Derivatives', description: '', sourceRefs: [] }],
        concepts: [],
        formulas: [],
        symbols: [],
        examples: [],
        exercises: [],
        prerequisites: [],
        topicsByName: new Map(),
      },
      'en',
      { sourceHash: await content.computeSourceHash(projectId) },
    )

    const service = new CourseContentService({ content })
    const result = await service.ensureAnalyzed(projectId)

    expect(result).toEqual({ analyzed: false, reason: 'fresh' })
    expect(mocks.buildAIServices).not.toHaveBeenCalled()
    expect(mocks.analyzeProject).not.toHaveBeenCalled()
  })

  it('treats "no provider configured" as a no-op, never as a failure', async () => {
    mocks.buildAIServices.mockResolvedValue(null)
    const service = new CourseContentService({ content })

    const result = await service.ensureAnalyzed(projectId)

    expect(result).toEqual({ analyzed: false, reason: 'no-provider' })
    expect(mocks.analyzeProject).not.toHaveBeenCalled()
    expect(await content.getStatus(projectId)).toBe('missing')
  })

  it('refuses a chapter-scoped analysis instead of analysing the whole project', async () => {
    const service = new CourseContentService({ content })

    await expect(
      service.analyzeScope({ type: 'chapter', projectId, chapterId: 'ch1' }),
    ).rejects.toMatchObject({ code: 'ANALYSIS_SCOPE_UNSUPPORTED' })
    expect(mocks.analyzeProject).not.toHaveBeenCalled()
  })

  it('accepts an explicit project scope', async () => {
    const service = new CourseContentService({ content })
    const result = await service.analyzeScope({ type: 'project', projectId })
    expect(result).toEqual({ analyzed: true, reason: 'analyzed' })
  })

  it('keeps class progress out of the freshness inputs', async () => {
    const analyses = new CourseAnalysisRepository(db)
    await analyses.reseedProject(
      projectId,
      {
        topics: [{ name: 'Derivatives', description: '', sourceRefs: [] }],
        concepts: [],
        formulas: [],
        symbols: [],
        examples: [],
        exercises: [],
        prerequisites: [],
        topicsByName: new Map(),
      },
      'en',
      { sourceHash: await content.computeSourceHash(projectId) },
    )
    expect((await content.isFresh(projectId)).fresh).toBe(true)

    await new CourseContextRepository(db).upsert({
      id: projectId,
      projectId,
      noteLinks: [],
      lectureLinks: [],
      sourceHash: 'a-completely-different-hash',
      updatedAt: Date.now(),
      classProgress: {
        transcriptDocumentIds: [],
        currentTopicId: 'topic-1',
        completedTopicIds: ['topic-0'],
        progressPercent: 42,
        updatedAt: Date.now(),
      },
    })

    expect((await content.isFresh(projectId)).fresh).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Structure remains the only chapter hierarchy
// ---------------------------------------------------------------------------

describe('structure ownership', () => {
  it('exposes only the existing CourseStructure nodes, with no parallel chapter table', async () => {
    const db = new AppDatabase()
    setDbForTesting(db)
    const project = await new ProjectService(db).create({ name: 'Calc', subject: 'calculus' })

    const structures = new CourseStructureRepository(db)
    const structure: CourseStructure = {
      id: 's1',
      projectId: project.id,
      sourceDocumentId: 'doc-1',
      title: 'Calculus',
      confidence: 'high',
      version: 1,
      createdAt: 0,
      updatedAt: 0,
    }
    await structures.replace(structure, [
      chapter('ch1', [], { projectId: project.id, structureId: 's1' }),
    ])

    const content = new CourseContentRepository({ db })
    expect((await content.listAllNodes(project.id)).map((n) => n.id)).toEqual(['ch1'])
    expect(await content.getStructure(project.id)).toMatchObject({ id: 's1' })

    // The chapter/section hierarchy has exactly one home in Dexie.
    const tableNames = db.tables.map((table) => table.name)
    expect(tableNames.filter((name) => /chapter/i.test(name))).toEqual([])
  })
})
