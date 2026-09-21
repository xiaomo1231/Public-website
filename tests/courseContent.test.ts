import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { ProjectService } from '@/services/projectService'
import { DocumentRepository } from '@/entities/document/repository'
import { ChunkRepository } from '@/entities/chunk/repository'
import { CourseAnalysisRepository } from '@/entities/courseAnalysis/repository'
import { COURSE_ANALYSIS_SCHEMA_VERSION } from '@/entities/courseAnalysis/types'
import { CourseStructureRepository } from '@/entities/courseStructure/repository'
import type { CourseStructure, CourseStructureNode } from '@/entities/courseStructure/types'
import { CourseContentRepository } from '@/entities/courseContent/repository'
import { evaluateFreshness } from '@/entities/courseContent/types'
import { detectAffectedStructure } from '@/entities/courseContent/incremental'
import { DocumentAnalysisService } from '@/services/documentAnalysisService'
import { prompts } from '@/infrastructure/ai/prompts'
import { setUILanguage } from '@/i18n/store'
import type { AIService } from '@/services/aiService'

const PROMPT_VERSION = prompts.documentAnalyzer.VERSION

async function seedProject(db: AppDatabase, name = 'Calculus') {
  const project = await new ProjectService(db).create({ name, subject: 'calculus' })
  const documents = new DocumentRepository(db)
  const chunks = new ChunkRepository(db)
  const analyses = new CourseAnalysisRepository(db)

  const doc = await documents.create({
    projectId: project.id,
    type: 'text',
    name: 'calculus.txt',
    sizeBytes: 0,
  })
  await documents.update(doc.id, { status: 'ready' })
  await chunks.addMany([
    {
      documentId: doc.id,
      projectId: project.id,
      contentType: 'paragraph',
      text: 'Derivatives are rates of change.',
      sourceReference: 'calculus.txt',
      order: 0,
    },
  ])

  return { project, doc, documents, chunks, analyses }
}

async function seedStructure(
  db: AppDatabase,
  projectId: string,
  documentId: string,
  version: number,
  nodes: CourseStructureNode[],
) {
  const repo = new CourseStructureRepository(db)
  const structure: CourseStructure = {
    id: 'structure-1',
    projectId,
    sourceDocumentId: documentId,
    title: 'Calculus',
    confidence: 'high',
    version,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
  await repo.replace(structure, nodes)
  return structure
}

/** Minimal valid reseed payload with a single topic. */
function seedPayload(topicName = 'Limits') {
  return {
    topics: [{ name: topicName, description: '', sourceRefs: [] }],
    concepts: [],
    formulas: [],
    symbols: [],
    examples: [],
    exercises: [],
    prerequisites: [],
    topicsByName: new Map<string, string>(),
  }
}

function node(overrides: Partial<CourseStructureNode> & { id: string }): CourseStructureNode {
  return {
    structureId: 'structure-1',
    projectId: 'p',
    type: 'chapter',
    title: 'Chapter',
    order: 0,
    depth: 0,
    sourceChunkIds: [],
    confidence: 'high',
    ...overrides,
  }
}

describe('course content freshness (pure)', () => {
  const current = {
    sourceHash: 'aaaa1111',
    promptVersion: 'v2',
    schemaVersion: '1',
    structureVersion: 3,
    structureHash: 'struct111',
  }

  const saved = {
    sourceHash: 'aaaa1111',
    promptVersion: 'v2',
    schemaVersion: '1',
    derivedFromStructureVersion: 3,
    derivedFromStructureHash: 'struct111',
    status: 'ready' as const,
    staleReason: undefined,
  }

  it('Test 1 — identical versions are fresh (no re-analysis)', () => {
    const result = evaluateFreshness(saved, current)
    expect(result.fresh).toBe(true)
    expect(result.reasons).toEqual([])
  })

  it('Test 2 — a changed source hash is stale', () => {
    const result = evaluateFreshness({ ...saved, sourceHash: 'bbbb2222' }, current)
    expect(result.fresh).toBe(false)
    expect(result.reasons).toContain('source-changed')
  })

  it('Test 3 — a changed prompt version is stale', () => {
    const result = evaluateFreshness({ ...saved, promptVersion: 'v1' }, current)
    expect(result.fresh).toBe(false)
    expect(result.reasons).toContain('prompt-changed')
  })

  it('Test 4 — a changed schema version is stale', () => {
    const result = evaluateFreshness({ ...saved, schemaVersion: '0' }, current)
    expect(result.fresh).toBe(false)
    expect(result.reasons).toContain('schema-changed')
  })

  it('Test 5 — a changed structure hash is stale', () => {
    const result = evaluateFreshness(
      { ...saved, derivedFromStructureHash: 'struct999' },
      current,
    )
    expect(result.fresh).toBe(false)
    expect(result.reasons).toContain('structure-changed')
  })

  it('Test 5b — a revision bump with an identical tree stays fresh', () => {
    // Case A: the revision number moved but the actual chapter/section content
    // did not. Nothing that depends on the structure needs re-analysing.
    const result = evaluateFreshness(
      { ...saved, derivedFromStructureVersion: 2 },
      { ...current, structureVersion: 4 },
    )
    expect(result.fresh).toBe(true)
    expect(result.reasons).toEqual([])
  })

  it('Test 5c — older rows without a structure hash fall back to the revision', () => {
    const legacy = { ...saved }
    delete (legacy as { derivedFromStructureHash?: string }).derivedFromStructureHash
    const result = evaluateFreshness(legacy, { ...current, structureVersion: 4 })
    expect(result.fresh).toBe(false)
    expect(result.reasons).toContain('structure-changed')
  })

  it('a missing analysis is stale', () => {
    const result = evaluateFreshness(undefined, current)
    expect(result.fresh).toBe(false)
    expect(result.reasons).toEqual(['missing'])
  })

  it('a stale annotation alone does not make an analysis stale', () => {
    // `staleReason` is explanatory only; freshness is always derived.
    const result = evaluateFreshness({ ...saved, staleReason: 'document removed' }, current)
    expect(result.fresh).toBe(true)
    expect(result.reasons).toEqual([])
    // ...and the annotation is not surfaced while the result is fresh.
    expect(result.detail).toBeUndefined()
  })

  it('a stale annotation is surfaced as detail when the result is stale', () => {
    const result = evaluateFreshness(
      { ...saved, sourceHash: 'bbbb2222', staleReason: 'document removed' },
      current,
    )
    expect(result.fresh).toBe(false)
    expect(result.reasons).toContain('source-changed')
    expect(result.detail).toBe('document removed')
  })

  it('treats a legacy row without the new fields as stale, not fresh', () => {
    // Rows written before sourceHash / schemaVersion / structure hash existed.
    const legacy = { promptVersion: current.promptVersion, status: 'ready' as const }
    const result = evaluateFreshness(legacy, current)

    expect(result.fresh).toBe(false)
    expect(result.reasons).toContain('source-changed')
    expect(result.reasons).toContain('schema-changed')
    expect(result.reasons).toContain('structure-changed')
  })

  it('an analysis that never finished is stale', () => {
    const result = evaluateFreshness({ ...saved, status: 'analyzing' }, current)
    expect(result.fresh).toBe(false)
    expect(result.reasons).toContain('incomplete')
  })
})

describe('CourseContentRepository', () => {
  let db: AppDatabase
  let projectId: string
  let documentId: string
  let content: CourseContentRepository
  let analyses: CourseAnalysisRepository
  let chunks: ChunkRepository

  beforeEach(async () => {
    db = new AppDatabase()
    setDbForTesting(db)
    const seeded = await seedProject(db)
    projectId = seeded.project.id
    documentId = seeded.doc.id
    analyses = seeded.analyses
    chunks = seeded.chunks
    content = new CourseContentRepository({ db })
  })

  it('reports missing content before anything is analysed', async () => {
    expect(await content.getStatus(projectId)).toBe('missing')
    expect(await content.getManifest(projectId)).toBeNull()
    expect((await content.isFresh(projectId)).reasons).toEqual(['missing'])
  })

  it('is fresh after a matching analysis is persisted', async () => {
    const sourceHash = await content.computeSourceHash(projectId)
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
      { sourceHash },
    )

    const freshness = await content.isFresh(projectId)
    expect(freshness.fresh).toBe(true)
    expect(await content.getStatus(projectId)).toBe('ready')
  })

  it('goes stale when a source chunk is added', async () => {
    const sourceHash = await content.computeSourceHash(projectId)
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
      { sourceHash },
    )
    expect((await content.isFresh(projectId)).fresh).toBe(true)

    await chunks.addMany([
      {
        documentId,
        projectId,
        contentType: 'paragraph',
        text: 'The chain rule composes derivatives.',
        sourceReference: 'calculus.txt',
        order: 1,
      },
    ])

    const freshness = await content.isFresh(projectId)
    expect(freshness.fresh).toBe(false)
    expect(freshness.reasons).toContain('source-changed')
    expect(await content.getStatus(projectId)).toBe('stale')
  })

  it('goes stale when the detected structure changes', async () => {
    const nodes = [node({ id: 'ch1', projectId, title: 'Limits' })]
    await seedStructure(db, projectId, documentId, 3, nodes)
    const sourceHash = await content.computeSourceHash(projectId)
    await analyses.reseedProject(
      projectId,
      {
        topics: [{ name: 'Limits', description: '', sourceRefs: [] }],
        concepts: [],
        formulas: [],
        symbols: [],
        examples: [],
        exercises: [],
        prerequisites: [],
        topicsByName: new Map(),
      },
      'en',
      { sourceHash, derivedFromStructureVersion: 3 },
    )

    expect((await content.isFresh(projectId)).fresh).toBe(true)
    expect(await content.getContentVersion(projectId)).toBe(3)

    await seedStructure(db, projectId, documentId, 4, [
      ...nodes,
      node({ id: 'ch2', projectId, title: 'Derivatives', order: 1 }),
    ])

    const freshness = await content.isFresh(projectId)
    expect(freshness.fresh).toBe(false)
    expect(freshness.reasons).toContain('structure-changed')
  })

  it('exposes a manifest with the persisted versions', async () => {
    const sourceHash = await content.computeSourceHash(projectId)
    await seedStructure(db, projectId, documentId, 2, [node({ id: 'ch1', projectId })])
    await analyses.reseedProject(
      projectId,
      {
        topics: [{ name: 'Limits', description: '', sourceRefs: [] }],
        concepts: [],
        formulas: [],
        symbols: [],
        examples: [],
        exercises: [],
        prerequisites: [],
        topicsByName: new Map(),
      },
      'en',
      { sourceHash, promptVersion: 'v9', derivedFromStructureVersion: 2 },
    )

    const manifest = await content.getManifest(projectId)
    expect(manifest).not.toBeNull()
    expect(manifest?.analysisPromptVersion).toBe('v9')
    expect(manifest?.analysisSchemaVersion).toBe(COURSE_ANALYSIS_SCHEMA_VERSION)
    expect(manifest?.sourceHash).toBe(sourceHash)
    expect(manifest?.structureVersion).toBe(2)
    expect(manifest?.structureHash).toMatch(/^[0-9a-f]{8}$/)
    expect(manifest?.topicCount).toBe(1)
  })

  it('records a stale annotation without overriding derived freshness', async () => {
    const sourceHash = await content.computeSourceHash(projectId)
    await analyses.reseedProject(
      projectId,
      {
        topics: [{ name: 'Limits', description: '', sourceRefs: [] }],
        concepts: [],
        formulas: [],
        symbols: [],
        examples: [],
        exercises: [],
        prerequisites: [],
        topicsByName: new Map(),
      },
      'en',
      { sourceHash },
    )

    await content.markStale(projectId, 'a document was removed')
    const stored = await content.getAnalysis(projectId)
    expect(stored?.staleReason).toBe('a document was removed')
    expect(stored?.staleAt).toBeTypeOf('number')

    // Freshness is derived, so the annotation alone does not flip it.
    const freshness = await content.isFresh(projectId)
    expect(freshness.fresh).toBe(true)
    expect(freshness.reasons).toEqual([])
    expect(freshness.detail).toBeUndefined()

    await content.clearStale(projectId)
    const cleared = await content.getAnalysis(projectId)
    expect(cleared?.staleReason).toBeUndefined()
    expect(cleared?.staleAt).toBeUndefined()
  })

  it('surfaces the stale annotation once the derived result is stale', async () => {
    const sourceHash = await content.computeSourceHash(projectId)
    await analyses.reseedProject(
      projectId,
      {
        topics: [{ name: 'Limits', description: '', sourceRefs: [] }],
        concepts: [],
        formulas: [],
        symbols: [],
        examples: [],
        exercises: [],
        prerequisites: [],
        topicsByName: new Map(),
      },
      'en',
      { sourceHash },
    )
    await content.markStale(projectId, 'source re-uploaded')

    // Change the actual input so the derived check turns stale.
    await chunks.addMany([
      {
        documentId,
        projectId,
        contentType: 'paragraph',
        text: 'A new paragraph.',
        sourceReference: 'calculus.txt',
        order: 1,
      },
    ])

    const freshness = await content.isFresh(projectId)
    expect(freshness.fresh).toBe(false)
    expect(freshness.reasons).toContain('source-changed')
    expect(freshness.detail).toBe('source re-uploaded')
  })

  it('detects a structure change through the hash when the revision does not move', async () => {
    await seedStructure(db, projectId, documentId, 3, [
      node({ id: 'ch1', projectId, title: 'Limits' }),
    ])
    const sourceHash = await content.computeSourceHash(projectId)
    const structureHash = await content.getStructureHash(projectId)
    await analyses.reseedProject(
      projectId,
      {
        topics: [{ name: 'Limits', description: '', sourceRefs: [] }],
        concepts: [],
        formulas: [],
        symbols: [],
        examples: [],
        exercises: [],
        prerequisites: [],
        topicsByName: new Map(),
      },
      'en',
      { sourceHash, derivedFromStructureVersion: 3, derivedFromStructureHash: structureHash },
    )
    expect((await content.isFresh(projectId)).fresh).toBe(true)

    // Same revision number, different tree content.
    await seedStructure(db, projectId, documentId, 3, [
      node({ id: 'ch1', projectId, title: 'Limits and Continuity' }),
    ])

    const freshness = await content.isFresh(projectId)
    expect(freshness.fresh).toBe(false)
    expect(freshness.reasons).toContain('structure-changed')
  })

  it('stays fresh when a document is re-processed with identical content', async () => {
    const sourceHash = await content.computeSourceHash(projectId)
    await analyses.reseedProject(projectId, seedPayload(), 'en', { sourceHash })
    expect((await content.isFresh(projectId)).fresh).toBe(true)

    // Simulate re-processing: chunk ids are regenerated and the processing
    // timestamp moves, but the extracted text is byte-identical.
    const documents = new DocumentRepository(db)
    await chunks.deleteByDocument(documentId)
    await chunks.addMany([
      {
        documentId,
        projectId,
        contentType: 'paragraph',
        text: 'Derivatives are rates of change.',
        sourceReference: 'calculus.txt',
        order: 0,
      },
    ])
    await documents.update(documentId, { processedAt: Date.now() + 60_000 })

    // Neither chunk ids nor `processedAt` participate in the fingerprint.
    expect(await content.computeSourceHash(projectId)).toBe(sourceHash)
    expect((await content.isFresh(projectId)).fresh).toBe(true)
  })

  it('goes stale when the extracted text actually changes', async () => {
    const sourceHash = await content.computeSourceHash(projectId)
    await analyses.reseedProject(projectId, seedPayload(), 'en', { sourceHash })
    expect((await content.isFresh(projectId)).fresh).toBe(true)

    await chunks.deleteByDocument(documentId)
    await chunks.addMany([
      {
        documentId,
        projectId,
        contentType: 'paragraph',
        text: 'Derivatives are rates of change. (revised edition)',
        sourceReference: 'calculus.txt',
        order: 0,
      },
    ])

    expect(await content.computeSourceHash(projectId)).not.toBe(sourceHash)
    const freshness = await content.isFresh(projectId)
    expect(freshness.fresh).toBe(false)
    expect(freshness.reasons).toContain('source-changed')
  })
})

describe('Test 6 — presentation state never affects freshness', () => {
  let db: AppDatabase
  let projectId: string
  let content: CourseContentRepository
  let analyses: CourseAnalysisRepository

  beforeEach(async () => {
    db = new AppDatabase()
    setDbForTesting(db)
    const seeded = await seedProject(db)
    projectId = seeded.project.id
    content = new CourseContentRepository({ db })
    analyses = seeded.analyses
  })

  it('changing the UI language leaves the stored analysis fresh', async () => {
    const sourceHash = await content.computeSourceHash(projectId)
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
      { sourceHash },
    )

    const before = await content.isFresh(projectId)
    setUILanguage('zh-CN')
    const after = await content.isFresh(projectId)

    expect(before.fresh).toBe(true)
    expect(after.fresh).toBe(true)
    expect(after.reasons).toEqual(before.reasons)
  })
})

describe('Test 7 — a failed re-analysis keeps the previous result', () => {
  let db: AppDatabase

  beforeEach(() => {
    db = new AppDatabase()
    setDbForTesting(db)
  })

  it('leaves the stored analysis and topics untouched when the AI fails', async () => {
    const { project, documents, chunks, analyses } = await seedProject(db)
    const sourceHash = await new CourseContentRepository({ db }).computeSourceHash(project.id)
    await analyses.reseedProject(
      project.id,
      {
        topics: [{ name: 'Derivatives', description: 'rate of change', sourceRefs: [] }],
        concepts: [],
        formulas: [],
        symbols: [],
        examples: [],
        exercises: [],
        prerequisites: [],
        topicsByName: new Map(),
      },
      'en',
      { sourceHash },
    )
    const before = await analyses.getByProject(project.id)
    expect(before?.status).toBe('ready')

    const failingAI = {
      streamJSON: vi.fn().mockRejectedValue(new Error('provider unavailable')),
      maxOutputTokens: 2048,
      currentProvider: { id: 'custom' },
    } as unknown as AIService

    const service = new DocumentAnalysisService({
      ai: failingAI,
      projects: new ProjectService(db),
      db,
      documents,
      chunks,
      analyses,
    })

    await expect(service.analyzeProject(project.id)).rejects.toBeDefined()

    const after = await analyses.getByProject(project.id)
    expect(after?.status).toBe('ready')
    expect(after?.sourceHash).toBe(before?.sourceHash)
    expect(after?.topicCount).toBe(before?.topicCount)
    expect(await analyses.listTopics(project.id)).toHaveLength(1)
  })

  it('records a failure when there was no usable analysis to keep', async () => {
    const { project, documents, chunks, analyses } = await seedProject(db)

    const failingAI = {
      streamJSON: vi.fn().mockRejectedValue(new Error('provider unavailable')),
      maxOutputTokens: 2048,
      currentProvider: { id: 'custom' },
    } as unknown as AIService

    const service = new DocumentAnalysisService({
      ai: failingAI,
      projects: new ProjectService(db),
      db,
      documents,
      chunks,
      analyses,
    })

    await expect(service.analyzeProject(project.id)).rejects.toBeDefined()
    expect((await analyses.getByProject(project.id))?.status).toBe('failed')
  })
})

describe('Test 8 — reseed is atomic', () => {
  let db: AppDatabase

  beforeEach(() => {
    db = new AppDatabase()
    setDbForTesting(db)
  })

  it('rolls back every write when one table fails mid-replace', async () => {
    const { project, analyses } = await seedProject(db)

    await analyses.reseedProject(
      project.id,
      {
        topics: [{ name: 'Old Topic', description: '', sourceRefs: [] }],
        concepts: [{ name: 'Old Concept', definition: 'kept', topicNames: [], sourceRefs: [] }],
        formulas: [],
        symbols: [],
        examples: [],
        exercises: [],
        prerequisites: [],
        topicsByName: new Map(),
      },
      'en',
      { sourceHash: 'old-hash' },
    )
    const before = await analyses.getByProject(project.id)

    // Fail one of the writes half way through the replacement.
    const conceptsTable = db.table('concepts')
    const spy = vi
      .spyOn(conceptsTable, 'bulkPut')
      .mockRejectedValueOnce(new Error('simulated write failure'))

    await expect(
      analyses.reseedProject(
        project.id,
        {
          topics: [{ name: 'New Topic', description: '', sourceRefs: [] }],
          concepts: [{ name: 'New Concept', definition: 'boom', topicNames: [], sourceRefs: [] }],
          formulas: [],
          symbols: [],
          examples: [],
          exercises: [],
          prerequisites: [],
          topicsByName: new Map(),
        },
        'en',
        { sourceHash: 'new-hash' },
      ),
    ).rejects.toBeDefined()
    spy.mockRestore()

    // The half-written state must not survive: the old analysis is intact.
    const topics = await analyses.listTopics(project.id)
    expect(topics.map((topic) => topic.name)).toEqual(['Old Topic'])
    expect(await analyses.listConcepts(project.id)).toHaveLength(1)
    const after = await analyses.getByProject(project.id)
    expect(after?.sourceHash).toBe(before?.sourceHash)
    expect(after?.status).toBe('ready')
  })
})

describe('prompt version is never hardcoded', () => {
  let db: AppDatabase

  beforeEach(() => {
    db = new AppDatabase()
    setDbForTesting(db)
  })

  it('persists the prompt version the caller supplied', async () => {
    const { project, analyses } = await seedProject(db)
    await analyses.reseedProject(
      project.id,
      {
        topics: [{ name: 'Limits', description: '', sourceRefs: [] }],
        concepts: [],
        formulas: [],
        symbols: [],
        examples: [],
        exercises: [],
        prerequisites: [],
        topicsByName: new Map(),
      },
      'en',
      { promptVersion: 'v42' },
    )
    expect((await analyses.getByProject(project.id))?.promptVersion).toBe('v42')
  })

  it('falls back to the registered analyzer version, not a literal', async () => {
    const { project, analyses } = await seedProject(db)
    await analyses.reseedProject(
      project.id,
      {
        topics: [{ name: 'Limits', description: '', sourceRefs: [] }],
        concepts: [],
        formulas: [],
        symbols: [],
        examples: [],
        exercises: [],
        prerequisites: [],
        topicsByName: new Map(),
      },
      'en',
    )
    expect((await analyses.getByProject(project.id))?.promptVersion).toBe(PROMPT_VERSION)
  })
})

describe('incremental planning', () => {
  it('maps changed chunks onto their chapter and section', () => {
    const nodes: CourseStructureNode[] = [
      node({ id: 'ch1', type: 'chapter', title: 'Limits', sourceChunkIds: ['c1', 'c2'] }),
      node({
        id: 'sec1',
        type: 'section',
        title: 'Continuity',
        order: 1,
        depth: 1,
        sourceChunkIds: ['c2'],
      }),
      node({
        id: 'ch2',
        type: 'chapter',
        title: 'Derivatives',
        order: 2,
        depth: 0,
        sourceChunkIds: ['c3'],
      }),
    ]

    const affected = detectAffectedStructure(nodes, [
      // Chapter 1's chunks are gone (document re-processed) → affected.
      {
        id: 'c3',
        documentId: 'doc-1',
        projectId: 'p',
        contentType: 'paragraph',
        text: 'derivatives',
        sourceReference: 'x',
        order: 0,
        chapterId: 'ch2',
        sectionId: 'sec2',
        createdAt: 0,
      },
    ])

    expect(affected.chapterIds).toContain('ch1')
    expect(affected.sectionIds).toContain('sec1')
    // `ch2`'s only chunk is still present, so the chapter itself is intact...
    expect(affected.chapterIds).not.toContain('ch2')
    // ...but the brand-new section under it is affected.
    expect(affected.sectionIds).toContain('sec2')
    expect(affected.documentIds).toEqual(['doc-1'])
  })

  it('reports nothing affected when every chunk is still present', () => {
    const nodes = [node({ id: 'ch1', sourceChunkIds: ['c1'] })]
    const affected = detectAffectedStructure(nodes, [
      {
        id: 'c1',
        documentId: 'doc-1',
        projectId: 'p',
        contentType: 'paragraph',
        text: 'limits',
        sourceReference: 'x',
        order: 0,
        chapterId: 'ch1',
        createdAt: 0,
      },
    ])
    expect(affected.chapterIds).toEqual([])
    expect(affected.sectionIds).toEqual([])
    expect(affected.documentIds).toEqual([])
  })
})
