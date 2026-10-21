import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { ProjectService } from '@/services/projectService'
import { DocumentRepository } from '@/entities/document/repository'
import { ChunkRepository } from '@/entities/chunk/repository'
import { ProcessingJobRepository } from '@/entities/processingJob/repository'
import { CourseAnalysisRepository } from '@/entities/courseAnalysis/repository'
import { CourseStructureRepository } from '@/entities/courseStructure/repository'
import { CourseContentRepository } from '@/entities/courseContent/repository'
import { buildTopicDependency, chunkFingerprintMap } from '@/entities/courseContent/topicDependency'
import { collapseSameNameTopics, DocumentAnalysisService } from '@/services/documentAnalysisService'
import {
  clearEnsureAnalyzedInFlightForTesting,
  CourseContentService,
  topicScopeFilter,
} from '@/services/courseContentService'
import { ProcessingService } from '@/services/processingService'
import { DocumentService } from '@/services/documentService'
import type { CourseStructureNode } from '@/entities/courseStructure/types'
import type { DocumentChunk } from '@/entities/chunk/types'
import type { AIService } from '@/services/aiService'
import type { PracticeService } from '@/services/practiceService'
import { t } from '@/i18n'

const mocks = vi.hoisted(() => ({
  chatJSON: vi.fn(),
  analyzeProject: vi.fn(),
}))

vi.mock('@/services/aiServices', () => ({
  buildAIServices: vi.fn(async () => ({
    ai: { chatJSON: mocks.chatJSON, maxOutputTokens: 2048 },
    documentAnalysis: { analyzeProject: mocks.analyzeProject },
  })),
}))

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

async function seedProject(db: AppDatabase) {
  const project = await new ProjectService(db).create({ name: 'Calculus', subject: 'calculus' })
  const documents = new DocumentRepository(db)
  const doc = await documents.create({
    projectId: project.id,
    type: 'text',
    name: 'calculus.txt',
    sizeBytes: 0,
  })
  await documents.update(doc.id, { status: 'ready' })
  const stored = await new ChunkRepository(db).addMany([
    {
      documentId: doc.id,
      projectId: project.id,
      contentType: 'paragraph',
      text: 'The derivative measures the rate of change of a function.',
      sourceReference: 'calculus.txt',
      order: 0,
      chapterId: 'ch1',
      sectionId: 's1',
    },
    {
      documentId: doc.id,
      projectId: project.id,
      contentType: 'paragraph',
      text: 'The chain rule composes derivatives of composed functions.',
      sourceReference: 'calculus.txt',
      order: 1,
      chapterId: 'ch2',
      sectionId: 's2',
    },
  ])
  return { project, doc, stored }
}

function chapter(
  id: string,
  projectId: string,
  sourceChunkIds: string[],
  order: number,
): CourseStructureNode {
  return {
    id,
    structureId: 'structure-1',
    projectId,
    type: 'chapter',
    title: id,
    order,
    depth: 0,
    sourceChunkIds,
    confidence: 'high',
  }
}

function fakeAnalysisAI(topics: Array<Record<string, unknown>>, onCall?: () => Promise<void>) {
  const streamJSON = vi.fn(async () => {
    await onCall?.()
    return {
      data: {
        language: 'en',
        topics,
        concepts: [],
        formulas: [],
        symbols: [],
        examples: [],
        exercises: [],
        prerequisites: [],
      },
      raw: { content: '{}', model: 'test' },
    }
  })
  return {
    streamJSON,
    maxOutputTokens: 2048,
    currentProvider: { id: 'custom' },
  } as unknown as AIService
}

function analyzer(db: AppDatabase, ai: AIService) {
  return new DocumentAnalysisService({
    ai,
    projects: new ProjectService(db),
    db,
    documents: new DocumentRepository(db),
    chunks: new ChunkRepository(db),
    analyses: new CourseAnalysisRepository(db),
  })
}

function topicResponse(name: string, sourceChunkIds: string[]) {
  return {
    data: {
      language: 'en',
      topic: { name, description: 'regenerated', sourceChunkIds },
      concepts: [],
      formulas: [],
      symbols: [],
      examples: [],
      exercises: [],
      prerequisites: [],
    },
  }
}

// ---------------------------------------------------------------------------
// Incremental execution: scope + hash advance
// ---------------------------------------------------------------------------

describe('incremental scope commits', () => {
  let db: AppDatabase

  beforeEach(() => {
    db = new AppDatabase()
    setDbForTesting(db)
    mocks.chatJSON.mockReset()
    mocks.analyzeProject.mockReset()
  })

  /** Two chapters; `topicsInCh1` topics depend on ch1, one topic on ch2. */
  async function seed(topicsInCh1: number) {
    const base = await seedProject(db)
    const { project, doc } = base
    // A second passage per chapter, so a rewritten chunk leaves a live source
    // (a topic whose every source vanished is escalated, not regenerated).
    const extra = await new ChunkRepository(db).addMany(
      (['ch1', 'ch2'] as const).map((chapterId, i) => ({
        documentId: doc.id,
        projectId: project.id,
        contentType: 'paragraph' as const,
        text: `Second passage of ${chapterId}.`,
        sourceReference: 'calculus.txt',
        order: 2 + i,
        chapterId,
        sectionId: chapterId === 'ch1' ? 's1' : 's2',
      })),
    )
    const stored = [...base.stored, ...extra]
    await new CourseStructureRepository(db).replace(
      {
        id: 'structure-1',
        projectId: project.id,
        sourceDocumentId: doc.id,
        title: 'Calculus',
        confidence: 'high',
        version: 1,
        createdAt: 0,
        updatedAt: 0,
      },
      [
        chapter('ch1', project.id, [stored[0]!.id, stored[2]!.id], 0),
        chapter('ch2', project.id, [stored[1]!.id, stored[3]!.id], 1),
      ],
    )
    const fingerprints = chunkFingerprintMap(stored)
    const dep1 = buildTopicDependency([stored[0]!.id, stored[2]!.id], stored)
    const dep2 = buildTopicDependency([stored[1]!.id, stored[3]!.id], stored)
    const row = (name: string, chapterId: string, dep: typeof dep1) => ({
      name,
      description: '',
      sourceRefs: [],
      chapterId,
      sourceChunkIds: dep.sourceChunkIds,
      sourceChapterIds: dep.sourceChapterIds,
      sourceSectionIds: dep.sourceSectionIds,
      dependencyHash: dep.dependencyHash,
      sourceChunkFingerprints: fingerprints,
    })
    const analyses = new CourseAnalysisRepository(db)
    await analyses.reseedProject(
      project.id,
      {
        topics: [
          ...Array.from({ length: topicsInCh1 }, (_, i) =>
            row(`Chapter One Topic ${i + 1}`, 'ch1', dep1),
          ),
          row('Chapter Two Topic', 'ch2', dep2),
        ],
        concepts: [],
        formulas: [],
        symbols: [],
        examples: [],
        exercises: [],
        prerequisites: [],
        topicsByName: new Map(),
        documentIds: [doc.id],
      },
      'en',
      { sourceHash: 'seed' },
    )
    return { project, doc, stored, analyses }
  }

  async function rewrite(docId: string, projectId: string, chunk: DocumentChunk, text: string) {
    await db.chunks.delete(chunk.id)
    return (
      await new ChunkRepository(db).addMany([
        {
          documentId: docId,
          projectId,
          contentType: 'paragraph',
          text,
          sourceReference: 'calculus.txt',
          order: chunk.order,
          ...(chunk.chapterId ? { chapterId: chunk.chapterId } : {}),
          ...(chunk.sectionId ? { sectionId: chunk.sectionId } : {}),
        },
      ])
    )[0]!
  }

  const service = () => new CourseContentService({ content: new CourseContentRepository({ db }) })

  it('does not advance the source hash when one planned topic failed', async () => {
    const { project, doc, stored, analyses } = await seed(2)
    const replacement = await rewrite(doc.id, project.id, stored[0]!, 'chapter one, revised')

    mocks.chatJSON
      .mockResolvedValueOnce(topicResponse('Chapter One Topic 1', [replacement.id]))
      .mockRejectedValueOnce(new Error('provider unavailable'))

    const result = await service().executeIncrementalScope({
      type: 'chapter',
      projectId: project.id,
      chapterId: 'ch1',
    })

    expect(result.committed).toBe(true)
    expect(result.regeneratedTopicIds).toHaveLength(1)
    expect(result.flaggedForFullReanalysis).toHaveLength(1)
    expect(result.complete).toBe(false)
    // The analysis row keeps its old hash, so it still reads stale.
    expect((await analyses.getByProject(project.id))!.sourceHash).toBe('seed')
    const freshness = await new CourseContentRepository({ db }).isFresh(project.id)
    expect(freshness.fresh).toBe(false)
    expect(freshness.reasons).toContain('source-changed')
  })

  it('re-throws an abort instead of committing a partial run', async () => {
    const { project, doc, stored, analyses } = await seed(1)
    const before = await analyses.listTopics(project.id)
    await rewrite(doc.id, project.id, stored[0]!, 'chapter one, revised')

    const abort = Object.assign(new Error('cancelled'), { name: 'AbortError' })
    mocks.chatJSON.mockRejectedValue(abort)

    await expect(
      service().executeIncrementalScope({
        type: 'chapter',
        projectId: project.id,
        chapterId: 'ch1',
      }),
    ).rejects.toBe(abort)
    expect(await analyses.listTopics(project.id)).toEqual(before)
    expect((await analyses.getByProject(project.id))!.sourceHash).toBe('seed')
  })

  it('regenerates only topics in the requested chapter and keeps the analysis stale while others wait', async () => {
    const { project, doc, stored, analyses } = await seed(1)
    const r1 = await rewrite(doc.id, project.id, stored[0]!, 'chapter one, revised')
    await rewrite(doc.id, project.id, stored[1]!, 'chapter two, revised')
    const chapterTwoBefore = (await analyses.listTopics(project.id)).find(
      (topic) => topic.name === 'Chapter Two Topic',
    )!

    mocks.chatJSON.mockResolvedValue(topicResponse('Chapter One Topic 1', [r1.id]))

    const result = await service().executeIncrementalScope({
      type: 'chapter',
      projectId: project.id,
      chapterId: 'ch1',
    })

    expect(mocks.chatJSON).toHaveBeenCalledTimes(1)
    expect(result.committed).toBe(true)
    expect(result.complete).toBe(false)
    const after = await analyses.listTopics(project.id)
    expect(after.find((topic) => topic.id === chapterTwoBefore.id)).toEqual(chapterTwoBefore)
    expect((await analyses.getByProject(project.id))!.sourceHash).toBe('seed')
  })

  it('advances the hash when every planned topic was in scope and succeeded', async () => {
    const { project, doc, stored, analyses } = await seed(1)
    const r1 = await rewrite(doc.id, project.id, stored[0]!, 'chapter one, revised')
    mocks.chatJSON.mockResolvedValue(topicResponse('Chapter One Topic 1', [r1.id]))

    const result = await service().executeIncrementalScope({
      type: 'chapter',
      projectId: project.id,
      chapterId: 'ch1',
    })

    expect(result.complete).toBe(true)
    const content = new CourseContentRepository({ db })
    expect((await analyses.getByProject(project.id))!.sourceHash).toBe(
      await content.computeSourceHash(project.id),
    )
  })

  it('topicScopeFilter includes descendants of the target node', () => {
    const inScope = topicScopeFilter(
      [{ id: 'ch1' }, { id: 's1', parentId: 'ch1' }, { id: 'ch2' }],
      'ch1',
      [
        { id: 'a', sourceSectionIds: ['s1'] },
        { id: 'b', chapterId: 'ch2', sourceChapterIds: ['ch2'] },
        { id: 'c', chapterId: 'ch2', sourceChapterIds: ['ch1', 'ch2'] },
      ],
    )
    expect(['a', 'b', 'c'].filter(inScope)).toEqual(['a', 'c'])
  })
})

// ---------------------------------------------------------------------------
// Full analysis: same-name topics, identity by source overlap, ready row
// ---------------------------------------------------------------------------

describe('full analysis integrity', () => {
  let db: AppDatabase

  beforeEach(() => {
    db = new AppDatabase()
    setDbForTesting(db)
  })

  it('keeps two same-name topics from different chapters as two rows', async () => {
    const { project, stored } = await seedProject(db)
    await analyzer(
      db,
      fakeAnalysisAI([
        { name: 'Summary', description: 'one', sourceChunkIds: [stored[0]!.id], sourceRefs: [] },
        { name: 'Summary', description: 'two', sourceChunkIds: [stored[1]!.id], sourceRefs: [] },
      ]),
    ).analyzeProject(project.id)

    const topics = await new CourseAnalysisRepository(db).listTopics(project.id)
    expect(topics).toHaveLength(2)
    expect(new Set(topics.map((topic) => topic.id)).size).toBe(2)
    expect(topics[0]!.name).toBe('Summary')
    expect(topics[1]!.name).not.toBe('Summary')
    expect(topics[1]!.chapterId).toBe('ch2')
  })

  it('collapses a topic reported twice in the same chapter, unioning its sources', () => {
    const { drafts, aliases } = collapseSameNameTopics([
      {
        name: 'Limits',
        description: 'a',
        order: 0,
        sourceRefs: [],
        rawSourceChunkIds: ['c1'],
        chapterId: 'ch1',
      },
      {
        name: 'limits',
        description: 'b',
        order: 1,
        sourceRefs: [],
        rawSourceChunkIds: ['c2'],
        chapterId: 'ch1',
      },
      {
        name: 'Series',
        description: 'c',
        order: 2,
        sourceRefs: [],
        rawSourceChunkIds: ['c3'],
        chapterId: 'ch1',
      },
    ])
    expect(drafts.map((draft) => draft.name)).toEqual(['Limits', 'Series'])
    expect(drafts[0]!.rawSourceChunkIds).toEqual(['c1', 'c2'])
    expect(drafts.map((draft) => draft.order)).toEqual([0, 1])
    expect(aliases.get('limits')).toBe(0)
  })

  it('reuses a stored id through source overlap when the topic was renamed', async () => {
    const { project, stored } = await seedProject(db)
    const analyses = new CourseAnalysisRepository(db)
    await analyzer(
      db,
      fakeAnalysisAI([
        { name: 'Derivatives', description: '', sourceChunkIds: [stored[0]!.id], sourceRefs: [] },
      ]),
    ).analyzeProject(project.id)
    const id = (await analyses.listTopics(project.id))[0]!.id

    await analyzer(
      db,
      fakeAnalysisAI([
        {
          name: 'Rates of Change',
          description: '',
          sourceChunkIds: [stored[0]!.id],
          sourceRefs: [],
        },
      ]),
    ).analyzeProject(project.id)
    const after = await analyses.listTopics(project.id)
    expect(after).toHaveLength(1)
    expect(after[0]!.name).toBe('Rates of Change')
    expect(after[0]!.id).toBe(id)
  })

  it('keeps the ready analysis row intact while a re-analysis runs, and after it fails', async () => {
    const { project, stored } = await seedProject(db)
    const analyses = new CourseAnalysisRepository(db)
    await analyzer(
      db,
      fakeAnalysisAI([
        { name: 'Derivatives', description: '', sourceChunkIds: [stored[0]!.id], sourceRefs: [] },
      ]),
    ).analyzeProject(project.id)
    const ready = (await analyses.getByProject(project.id))!
    expect(ready.status).toBe('ready')

    let seenDuringRun: unknown
    const failing = fakeAnalysisAI([], async () => {
      seenDuringRun = await analyses.getByProject(project.id)
      throw new Error('tab closed')
    })
    await expect(analyzer(db, failing).analyzeProject(project.id)).rejects.toThrow('tab closed')

    expect(seenDuringRun).toEqual(ready)
    expect(await analyses.getByProject(project.id)).toEqual(ready)
  })
})

// ---------------------------------------------------------------------------
// Manual re-analysis goes through CourseContentService
// ---------------------------------------------------------------------------

describe('forced ensureAnalyzed', () => {
  beforeEach(() => {
    clearEnsureAnalyzedInFlightForTesting()
    mocks.analyzeProject.mockReset()
  })

  function stubbedService(planned: unknown[] = []) {
    return new CourseContentService({
      content: {
        isFresh: async () => ({ fresh: true, reasons: [] }),
      } as unknown as CourseContentRepository,
      practice: { planChunkRelink: async () => planned } as unknown as PracticeService,
    })
  }

  it('re-analyses a fresh project when forced, with practice relinks in the same commit', async () => {
    mocks.analyzeProject.mockResolvedValue(undefined)
    const planned = [{ id: 'pq1' }]
    expect(await stubbedService(planned).ensureAnalyzed('p1')).toEqual({
      analyzed: false,
      reason: 'fresh',
    })
    expect(mocks.analyzeProject).not.toHaveBeenCalled()

    const result = await stubbedService(planned).ensureAnalyzed('p1', { force: true })
    expect(result).toEqual({ analyzed: true, reason: 'analyzed' })
    expect(mocks.analyzeProject).toHaveBeenCalledWith(
      'p1',
      expect.objectContaining({ sideWrites: { practiceQuestions: planned } }),
    )
  })

  it('coalesces concurrent forced runs and surfaces the original error', async () => {
    const error = Object.assign(new Error('rate limited'), { code: 'RATE_LIMITED' })
    let release!: () => void
    mocks.analyzeProject.mockImplementation(
      () => new Promise((_, reject) => (release = () => reject(error))),
    )
    const first = stubbedService().ensureAnalyzed('p1', { force: true })
    const second = stubbedService().ensureAnalyzed('p1', { force: true })
    await vi.waitFor(() => expect(mocks.analyzeProject).toHaveBeenCalled())
    release()
    const [a, b] = await Promise.all([first, second])
    expect(mocks.analyzeProject).toHaveBeenCalledTimes(1)
    expect(a).toBe(b)
    expect(a.reason).toBe('failed')
    expect(a.cause).toBe(error)
  })
})

// ---------------------------------------------------------------------------
// Processing: a full quota is an actionable message
// ---------------------------------------------------------------------------

describe('processing quota', () => {
  it('turns a QuotaExceededError on commit into the storage-full message', async () => {
    const db = new AppDatabase()
    setDbForTesting(db)
    const projects = new ProjectService(db)
    const project = await projects.create({ name: 'Calculus', subject: 'calculus' })
    const documents = new DocumentRepository(db)
    class FullChunks extends ChunkRepository {
      override async addPrepared(): Promise<never> {
        throw Object.assign(new Error('The quota has been exceeded.'), {
          name: 'QuotaExceededError',
        })
      }
    }
    const processing = new ProcessingService({
      documents,
      chunks: new FullChunks(db),
      jobs: new ProcessingJobRepository(db),
      projects,
    })
    const blob = new Blob(['Limits describe the value a function approaches. '.repeat(5)], {
      type: 'text/plain',
    })
    const doc = await new DocumentService({ documents, projects }).create({
      projectId: project.id,
      type: 'text',
      name: 'notes.txt',
      sizeBytes: blob.size,
      blob,
    })

    await expect(processing.process(doc.id)).rejects.toMatchObject({
      message: t('errors.storageFullProcessing'),
    })
    expect((await documents.get(doc.id)).errorMessage).toBe(t('errors.storageFullProcessing'))
  })
})
