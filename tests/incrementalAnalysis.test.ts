import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { ProjectService } from '@/services/projectService'
import { DocumentRepository } from '@/entities/document/repository'
import { ChunkRepository } from '@/entities/chunk/repository'
import { CourseAnalysisRepository } from '@/entities/courseAnalysis/repository'
import { CourseContextRepository } from '@/entities/courseContext/repository'
import { CourseStructureRepository } from '@/entities/courseStructure/repository'
import { TutorLessonRepository } from '@/entities/tutorLesson/repository'
import { TutorSessionRepository } from '@/entities/tutorSession/repository'
import { PracticeRepository } from '@/entities/practice/repository'
import { QuestionRepository } from '@/entities/question/repository'
import { QuizRepository } from '@/entities/quiz/repository'
import { CourseContentRepository } from '@/entities/courseContent/repository'
import { matchTopicIdentities, normalizeTopicName } from '@/entities/courseAnalysis/topicIdentity'
import { buildTopicDependency, chunkFingerprintMap, validateTopicSourceChunks } from '@/entities/courseContent/topicDependency'
import { planContentDependencies } from '@/entities/courseContent/dependency'
import { DocumentAnalysisService } from '@/services/documentAnalysisService'
import { CourseContentService } from '@/services/courseContentService'
import type { CourseStructure, CourseStructureNode } from '@/entities/courseStructure/types'
import type { DocumentChunk } from '@/entities/chunk/types'
import type { TutorLesson } from '@/entities/tutorLesson/types'
import type { Topic } from '@/entities/courseAnalysis/types'
import type { AIService } from '@/services/aiService'

// ---------------------------------------------------------------------------
// The AI bundle is mocked so the incremental executor can be driven end to end.
// ---------------------------------------------------------------------------

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

function chapter(id: string, sourceChunkIds: string[], overrides: Partial<CourseStructureNode> = {}): CourseStructureNode {
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

function chunk(id: string, overrides: Partial<DocumentChunk> = {}): DocumentChunk {
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

function topic(overrides: Partial<Topic> & { id: string }): Topic {
  return {
    projectId: 'p1',
    name: 'Topic',
    description: '',
    order: 0,
    sourceRefs: [],
    createdAt: 0,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// 1 & 2 �?stable topic identity
// ---------------------------------------------------------------------------

describe('stable topic identity', () => {
  it('1 �?reuses the stored id for the same section + name', () => {
    const result = matchTopicIdentities(
      [{ id: 'old-1', name: 'Derivative Rules', chapterId: 'ch3', sectionId: 'sec3-2' }],
      [{ name: 'derivative   rules', chapterId: 'ch3', sectionId: 'sec3-2' }],
    )
    expect(result.ids[0]).toBe('old-1')
    expect(result.diagnostics[0]!.reason).toBe('section-name')
  })

  it('1 �?falls back to chapter + name when the section id moved', () => {
    const result = matchTopicIdentities(
      [{ id: 'old-1', name: 'Limits', chapterId: 'ch1', sectionId: 'sec-old' }],
      [{ name: 'Limits', chapterId: 'ch1', sectionId: 'sec-new' }],
    )
    expect(result.ids[0]).toBe('old-1')
    expect(result.diagnostics[0]!.reason).toBe('chapter-name')
  })

  it('1 �?uses source-chunk overlap when both sides have trusted dependencies', () => {
    const result = matchTopicIdentities(
      [{ id: 'old-1', name: 'Renamed Topic', sourceChunkIds: ['c1', 'c2', 'c3'] }],
      [{ name: 'Totally Different Name', sourceChunkIds: ['c1', 'c2', 'c3'] }],
    )
    expect(result.ids[0]).toBe('old-1')
    expect(result.diagnostics[0]!.reason).toBe('source-overlap')
  })

  it('2 �?a same-name topic in an unclear position is ambiguous, not reused', () => {
    const result = matchTopicIdentities(
      [{ id: 'old-1', name: 'Limits', chapterId: 'chA', sourceChunkIds: ['c1'] }],
      [{ name: 'Limits', chapterId: 'chB' }],
    )
    expect(result.ids[0]).toBeUndefined()
    expect(result.diagnostics[0]!.reason).toBe('ambiguous')
  })

  it('2 �?one stored id is never handed to two new topics', () => {
    const result = matchTopicIdentities(
      [{ id: 'old-1', name: 'Limits', chapterId: 'ch1' }],
      [
        { name: 'Limits', chapterId: 'ch1' },
        { name: 'Limits', chapterId: 'ch1' },
      ],
    )
    expect(result.ids[0]).toBe('old-1')
    expect(result.ids[1]).toBeUndefined()
    expect(result.diagnostics[1]!.reason).toBe('ambiguous')
  })

  it('2 �?a genuinely new topic gets no id', () => {
    const result = matchTopicIdentities(
      [{ id: 'old-1', name: 'Limits', chapterId: 'ch1' }],
      [{ name: 'Integrals', chapterId: 'ch2' }],
    )
    expect(result.ids[0]).toBeUndefined()
    expect(result.diagnostics[0]!.reason).toBe('new')
  })

  it('normalises names without treating them as identity', () => {
    expect(normalizeTopicName('  Derivative  Rules! ')).toBe('derivative rules')
  })
})

// ---------------------------------------------------------------------------
// 3 �?dependency validation
// ---------------------------------------------------------------------------

describe('topic dependency validation', () => {
  const chunks = [
    chunk('c1', { chapterId: 'ch1', sectionId: 's1' }),
    chunk('c2', { chapterId: 'ch2', sectionId: 's2' }),
  ]

  it('3 �?keeps only ids that were in the candidate set, sorted and de-duplicated', () => {
    const dependency = validateTopicSourceChunks(['c2', 'c1', 'c2', 'invented'], chunks)
    expect(dependency?.sourceChunkIds).toEqual(['c1', 'c2'])
  })

  it('3 �?derives chapter and section ids locally from the chunks', () => {
    const dependency = validateTopicSourceChunks(['c1', 'c2'], chunks)
    expect(dependency?.sourceChapterIds).toEqual(['ch1', 'ch2'])
    expect(dependency?.sourceSectionIds).toEqual(['s1', 's2'])
  })

  it('3 �?returns null when nothing valid remains (no guessing)', () => {
    expect(validateTopicSourceChunks(['invented'], chunks)).toBeNull()
    expect(validateTopicSourceChunks([], chunks)).toBeNull()
    expect(validateTopicSourceChunks(undefined, chunks)).toBeNull()
  })

  it('3 �?the dependency hash changes when the chunk content changes', () => {
    const before = buildTopicDependency(['c1'], chunks)
    const after = buildTopicDependency(['c1'], [chunk('c1', { chapterId: 'ch1', text: 'edited' })])
    expect(before.dependencyHash).not.toBe(after.dependencyHash)
  })
})

// ---------------------------------------------------------------------------
// 4 & 6 �?planner tiers
// ---------------------------------------------------------------------------

describe('tiered incremental plan', () => {
  const nodes = [chapter('ch1', ['c1']), chapter('ch2', ['c2'], { order: 1 })]
  const liveChunks = [chunk('c2', { chapterId: 'ch2' })]

  it('4 �?a spanning topic is regenerated from ALL still-valid sources', () => {
    const dependency = buildTopicDependency(['c1', 'c2'], [
      chunk('c1', { chapterId: 'ch1' }),
      chunk('c2', { chapterId: 'ch2' }),
    ])
    const report = planContentDependencies({
      nodes,
      chunks: liveChunks,
      topics: [
        topic({
          id: 'spanning',
          name: 'Derivative Rules',
          chapterId: 'ch2',
          sourceChunkIds: dependency.sourceChunkIds,
          sourceChapterIds: dependency.sourceChapterIds,
          dependencyHash: dependency.dependencyHash,
        }),
      ],
    })

    const op = report.ops.find((entry) => entry.id === 'spanning')!
    expect(op.kind).toBe('regenerateTopic')
    // c1 is gone; c2 is still valid and MUST be part of the regeneration input.
    expect(op.inputChunkIds).toEqual(['c2'])
    expect(report.topicIds).toContain('spanning')
  })

  it('6 �?a topic without a persisted dependency is escalated, never regenerated', () => {
    const report = planContentDependencies({
      nodes,
      chunks: liveChunks,
      topics: [topic({ id: 'legacy', name: 'Legacy', chapterId: 'ch1' })],
    })
    const op = report.ops.find((entry) => entry.id === 'legacy')!
    expect(op.kind).toBe('needsFullReanalysis')
    expect(op.reason).toBe('dependency-not-persisted')
    expect(report.topicIds).toContain('legacy')
  })

  it('5 �?an unrelated topic is planned as unchanged', () => {
    const dependency = buildTopicDependency(['c2'], liveChunks)
    const report = planContentDependencies({
      nodes,
      chunks: liveChunks,
      topics: [
        topic({
          id: 'untouched',
          name: 'Untouched',
          chapterId: 'ch2',
          sourceChunkIds: dependency.sourceChunkIds,
          dependencyHash: dependency.dependencyHash,
        }),
      ],
    })
    const op = report.ops.find((entry) => entry.id === 'untouched')!
    expect(op.kind).toBe('unchanged')
    expect(report.topicIds).not.toContain('untouched')
  })

  it('preserves a topic whose source chapter disappeared', () => {
    const dependency = buildTopicDependency(['c2'], liveChunks)
    const report = planContentDependencies({
      nodes,
      chunks: liveChunks,
      topics: [
        topic({
          id: 'orphan',
          name: 'Orphan',
          chapterId: 'ch2',
          sourceChunkIds: dependency.sourceChunkIds,
          sourceChapterIds: ['ch-gone'],
          dependencyHash: dependency.dependencyHash,
        }),
      ],
    })
    const op = report.ops.find((entry) => entry.id === 'orphan')!
    expect(op.kind).toBe('preserveTopic')
    expect(op.reason).toBe('source-chapter-missing')
  })
})

// ---------------------------------------------------------------------------
// Integration fixtures
// ---------------------------------------------------------------------------

async function seedProject(db: AppDatabase) {
  const project = await new ProjectService(db).create({ name: 'Calculus', subject: 'calculus' })
  const documents = new DocumentRepository(db)
  const chunks = new ChunkRepository(db)
  const doc = await documents.create({
    projectId: project.id,
    type: 'text',
    name: 'calculus.txt',
    sizeBytes: 0,
  })
  await documents.update(doc.id, { status: 'ready' })
  const stored = await chunks.addMany([
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
  return { project, doc, chunks, stored }
}

function fakeAnalysisAI(topics: Array<Record<string, unknown>>) {
  const streamJSON = vi.fn().mockResolvedValue({
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
  })
  return {
    streamJSON,
    maxOutputTokens: 2048,
    currentProvider: { id: 'custom' },
  } as unknown as AIService
}

// ---------------------------------------------------------------------------
// 1, 3, 10 �?the analyzer persists stable ids and dependencies
// ---------------------------------------------------------------------------

describe('analyzer writes stable ids and validated dependencies', () => {
  let db: AppDatabase

  beforeEach(() => {
    db = new AppDatabase()
    setDbForTesting(db)
  })

  it('1 — a re-analysis does not orphan the rows that reference a topic by id', async () => {
    const { project, stored } = await seedProject(db)
    const analyses = new CourseAnalysisRepository(db)

    const run = () =>
      new DocumentAnalysisService({
        ai: fakeAnalysisAI([
          {
            name: 'Derivatives',
            description: 'rate of change',
            sourceChunkIds: [stored[0]!.id],
            sourceRefs: [],
          },
        ]),
        projects: new ProjectService(db),
        db,
        documents: new DocumentRepository(db),
        chunks: new ChunkRepository(db),
        analyses,
      }).analyzeProject(project.id)

    await run()
    const topicId = (await analyses.listTopics(project.id))[0]!.id

    // Everything that hangs off a topic id.
    const sessions = new TutorSessionRepository(db)
    await sessions.upsert({
      id: 's1',
      projectId: project.id,
      topicId,
      topicName: 'Derivatives',
      language: 'en',
      messages: [],
      turns: [],
      streakCorrect: 0,
      streakWrong: 0,
      currentDifficulty: 'basic',
      hintsRevealed: 0,
      mastery: 0,
      status: 'active',
      startedAt: 0,
      updatedAt: 0,
    })

    const practice = new PracticeRepository(db)
    await practice.addQuestions([
      {
        id: 'pq1',
        projectId: project.id,
        setId: 'set1',
        documentId: 'doc-1',
        documentName: 'Professor Practice.pdf',
        order: 0,
        type: 'single_choice',
        prompt: 'Find the derivative.',
        options: [],
        answerSource: 'professor',
        topicId,
        confidence: 0.9,
        status: 'verified',
        createdAt: 0,
      },
    ])

    const questions = new QuestionRepository(db)
    await questions.addMany([
      {
        projectId: project.id,
        topicId,
        knowledgePoint: 'derivative-definition',
        type: 'multiple_choice',
        difficulty: 'basic',
        prompt: 'What is a derivative?',
        correctAnswer: 'opt-1',
        hints: [],
        sourceRefs: [],
      },
    ])
    const question = (await questions.listByProject(project.id))[0]!

    const quizzes = new QuizRepository(db)
    await quizzes.upsert({
      id: 'qz1',
      projectId: project.id,
      title: 'Derivatives',
      config: {
        mode: 'topic',
        topicId,
        topicName: 'Derivatives',
        count: 1,
        difficulty: 'adaptive',
        types: ['multiple_choice'],
      },
      questionIds: [question.id],
      status: 'in_progress',
      difficultyPlan: ['basic'],
      startedAt: 0,
      promptVersion: 'v1',
    })

    const contexts = new CourseContextRepository(db)
    await contexts.upsert({
      id: project.id,
      projectId: project.id,
      noteLinks: [],
      lectureLinks: [
        { transcriptChunkId: 't1', textbookChunkId: stored[0]!.id, topicId, confidence: 0.5 },
      ],
      sourceHash: 'seed',
      updatedAt: 0,
    })

    // Re-analyse: same topic, same sources.
    await run()
    expect((await analyses.listTopics(project.id))[0]!.id).toBe(topicId)

    // Every reference still resolves to an existing topic.
    expect((await sessions.listByProject(project.id))[0]!.topicId).toBe(topicId)
    expect((await practice.listQuestionsByProject(project.id))[0]!.topicId).toBe(topicId)
    expect((await questions.listByProject(project.id))[0]!.topicId).toBe(topicId)
    expect((await quizzes.get('qz1'))!.config.topicId).toBe(topicId)
    expect((await contexts.get(project.id))!.lectureLinks[0]!.topicId).toBe(topicId)
  })


  it('1 �?a second analysis keeps the id of a topic that matched', async () => {
    const { project, stored } = await seedProject(db)
    const analyses = new CourseAnalysisRepository(db)

    const run = (ai: AIService) =>
      new DocumentAnalysisService({
        ai,
        projects: new ProjectService(db),
        db,
        documents: new DocumentRepository(db),
        chunks: new ChunkRepository(db),
        analyses,
      }).analyzeProject(project.id)

    const topicPayload = {
      name: 'Derivatives',
      description: 'rate of change',
      sourceChunkIds: [stored[0]!.id],
      sourceRefs: [],
    }

    await run(fakeAnalysisAI([topicPayload]))
    const first = (await analyses.listTopics(project.id))[0]!

    await run(fakeAnalysisAI([{ ...topicPayload }]))
    const second = (await analyses.listTopics(project.id))[0]!

    expect(second.id).toBe(first.id)
  })

  it('3 �?a topic spanning two chapters records both, with a dependency hash', async () => {
    const { project, stored } = await seedProject(db)
    const analyses = new CourseAnalysisRepository(db)

    await new DocumentAnalysisService({
      ai: fakeAnalysisAI([
        {
          name: 'Derivatives and the Chain Rule',
          description: 'spans two chapters',
          sourceChunkIds: [stored[0]!.id, stored[1]!.id],
          sourceRefs: [],
        },
      ]),
      projects: new ProjectService(db),
      db,
      documents: new DocumentRepository(db),
      chunks: new ChunkRepository(db),
      analyses,
    }).analyzeProject(project.id)

    const saved = (await analyses.listTopics(project.id))[0]!
    expect(saved.sourceChunkIds).toEqual([stored[0]!.id, stored[1]!.id].sort())
    expect(saved.sourceChapterIds).toEqual(['ch1', 'ch2'])
    expect(saved.sourceSectionIds).toEqual(['s1', 's2'])
    expect(saved.dependencyHash).toMatch(/^[0-9a-f]{8}$/)
    expect(saved.needsFullReanalysis).toBeUndefined()
    expect(saved.promptVersion).toBe('v2')
  })

  it('6 �?a topic with no valid source ids is flagged instead of guessed', async () => {
    const { project } = await seedProject(db)
    const analyses = new CourseAnalysisRepository(db)

    await new DocumentAnalysisService({
      ai: fakeAnalysisAI([
        { name: 'Ungrounded', description: '', sourceChunkIds: ['invented-id'], sourceRefs: [] },
      ]),
      projects: new ProjectService(db),
      db,
      documents: new DocumentRepository(db),
      chunks: new ChunkRepository(db),
      analyses,
    }).analyzeProject(project.id)

    const saved = (await analyses.listTopics(project.id))[0]!
    expect(saved.needsFullReanalysis).toBe(true)
    expect(saved.sourceChunkIds).toBeUndefined()
  })

  it('10 �?dependencies survive a storage restart', async () => {
    const { project, stored } = await seedProject(db)
    const analyses = new CourseAnalysisRepository(db)

    await new DocumentAnalysisService({
      ai: fakeAnalysisAI([
        {
          name: 'Derivatives',
          description: '',
          sourceChunkIds: [stored[0]!.id],
          sourceRefs: [],
        },
      ]),
      projects: new ProjectService(db),
      db,
      documents: new DocumentRepository(db),
      chunks: new ChunkRepository(db),
      analyses,
    }).analyzeProject(project.id)

    const before = (await analyses.listTopics(project.id))[0]!

    // Simulate a reload: a brand-new database handle on the same IndexedDB.
    const reopened = new AppDatabase()
    const after = (await new CourseAnalysisRepository(reopened).listTopics(project.id))[0]!

    expect(after.id).toBe(before.id)
    expect(after.sourceChunkIds).toEqual(before.sourceChunkIds)
    expect(after.dependencyHash).toBe(before.dependencyHash)
    expect(after.promptVersion).toBe('v2')
  })
})

// ---------------------------------------------------------------------------
// 4, 5, 8, 9 �?the incremental executor
// ---------------------------------------------------------------------------

describe('incremental scope execution', () => {
  let db: AppDatabase

  beforeEach(() => {
    db = new AppDatabase()
    setDbForTesting(db)
    mocks.chatJSON.mockReset()
    mocks.analyzeProject.mockReset()
    mocks.analyzeProject.mockResolvedValue(undefined)
  })

  /** Project with a two-chapter structure, one spanning topic, one untouched. */
  async function seedIncremental() {
    const { project, doc, chunks, stored } = await seedProject(db)
    const structures = new CourseStructureRepository(db)
    const structure: CourseStructure = {
      id: 'structure-1',
      projectId: project.id,
      sourceDocumentId: doc.id,
      title: 'Calculus',
      confidence: 'high',
      version: 1,
      createdAt: 0,
      updatedAt: 0,
    }
    await structures.replace(structure, [
      chapter('ch1', [stored[0]!.id], { projectId: project.id, structureId: 'structure-1' }),
      chapter('ch2', [stored[1]!.id], {
        projectId: project.id,
        structureId: 'structure-1',
        order: 1,
      }),
    ])

    const analyses = new CourseAnalysisRepository(db)
    const spanning = buildTopicDependency([stored[0]!.id, stored[1]!.id], stored)
    const untouched = buildTopicDependency([stored[1]!.id], stored)
    const fingerprints = chunkFingerprintMap(stored)

    await analyses.reseedProject(
      project.id,
      {
        topics: [
          {
            name: 'Spanning Topic',
            description: '',
            sourceRefs: [],
            chapterId: 'ch2',
            sectionId: 's2',
            sourceChunkIds: spanning.sourceChunkIds,
            sourceChapterIds: spanning.sourceChapterIds,
            sourceSectionIds: spanning.sourceSectionIds,
            dependencyHash: spanning.dependencyHash,
            sourceChunkFingerprints: fingerprints,
            promptVersion: 'v2',
          },
          {
            name: 'Untouched Topic',
            description: '',
            sourceRefs: [],
            chapterId: 'ch2',
            sectionId: 's2',
            sourceChunkIds: untouched.sourceChunkIds,
            sourceChapterIds: untouched.sourceChapterIds,
            sourceSectionIds: untouched.sourceSectionIds,
            dependencyHash: untouched.dependencyHash,
            sourceChunkFingerprints: fingerprints,
            promptVersion: 'v2',
          },
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

    const topics = await analyses.listTopics(project.id)
    const spanningTopic = topics.find((entry) => entry.name === 'Spanning Topic')!
    const untouchedTopic = topics.find((entry) => entry.name === 'Untouched Topic')!

    // Store a tutor lesson for each topic so invalidation can be observed.
    const lessons = new TutorLessonRepository(db)
    const lesson = (topicId: string, content: string): TutorLesson => ({
      id: `lesson-${topicId}`,
      projectId: project.id,
      topicId,
      language: 'en',
      content,
      symbols: [],
      sourceChunkIds: [],
      contentHash: `hash-${topicId}`,
      promptVersion: 'v1',
      generatedAt: 0,
      updatedAt: 0,
      version: 2,
    })
    await lessons.upsert(lesson(spanningTopic.id, 'spanning lesson'))
    await lessons.upsert(lesson(untouchedTopic.id, 'untouched lesson'))

    return { project, doc, chunks, stored, analyses, lessons, spanningTopic, untouchedTopic }
  }

  it('7 — a re-processed dependency is re-pointed by content, with no AI call', async () => {
    const { project, doc, stored, analyses, spanningTopic } = await seedIncremental()

    // Re-processing regenerates every chunk id but the text is identical.
    await db.chunks.delete(stored[0]!.id)
    const replacement = (
      await new ChunkRepository(db).addMany([
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
      ])
    )[0]!

    const service = new CourseContentService({ content: new CourseContentRepository({ db }) })
    const result = await service.executeIncrementalScope({
      type: 'chapter',
      projectId: project.id,
      chapterId: 'ch1',
    })

    expect(result.committed).toBe(true)
    // Content proved identical → no regeneration, only a re-pointed dependency.
    expect(result.regeneratedTopicIds).toEqual([])
    expect(mocks.chatJSON).not.toHaveBeenCalled()

    const after = (await analyses.listTopics(project.id)).find(
      (entry) => entry.id === spanningTopic.id,
    )!
    expect(after.sourceChunkIds).toContain(replacement.id)
    expect(after.sourceChunkIds).not.toContain(stored[0]!.id)
    expect(after.sourceChapterIds).toEqual(['ch1', 'ch2'])
  })


  it('9 �?an unsupported scope is refused and never triggers a full analysis', async () => {
    const { project } = await seedIncremental()
    const service = new CourseContentService({ content: new CourseContentRepository({ db }) })

    await expect(
      service.analyzeScope({ type: 'chapter', projectId: project.id, chapterId: 'missing' }),
    ).rejects.toMatchObject({ code: 'ANALYSIS_SCOPE_UNSUPPORTED', reason: 'structure-ambiguous' })
    expect(mocks.analyzeProject).not.toHaveBeenCalled()
  })

  it('6 �?a legacy topic without dependencies blocks the scoped run', async () => {
    const { project, analyses } = await seedIncremental()
    // Strip the dependency from one topic, as an older row would be.
    const stored = await analyses.listTopics(project.id)
    const target = stored.find((entry) => entry.name === 'Spanning Topic')!
    await analyses.applyTopicUpdates(project.id, [
      {
        topic: {
          ...target,
          sourceChunkIds: undefined,
          sourceChapterIds: undefined,
          dependencyHash: undefined,
        },
        concepts: [],
        formulas: [],
        symbols: [],
        examples: [],
        exercises: [],
        prerequisites: [],
      },
    ])

    // Make the project stale so planning runs.
    await analyses.upsert({
      ...(await analyses.getByProject(project.id))!,
      sourceHash: 'stale',
    })

    const service = new CourseContentService({ content: new CourseContentRepository({ db }) })
    await expect(
      service.analyzeScope({ type: 'chapter', projectId: project.id, chapterId: 'ch1' }),
    ).rejects.toMatchObject({
      code: 'ANALYSIS_SCOPE_UNSUPPORTED',
      reason: 'dependencies-missing',
    })
    expect(mocks.analyzeProject).not.toHaveBeenCalled()
  })

  it('4 & 5 �?regenerates only the affected topic, from all valid sources', async () => {
    const { project, doc, stored, analyses, lessons, spanningTopic, untouchedTopic } =
      await seedIncremental()

    // Re-process chapter 1: only its chunk id is regenerated.
    await db.chunks.delete(stored[0]!.id)
    const replacement = await new ChunkRepository(db).addMany([
      {
        documentId: doc.id,
        projectId: project.id,
        contentType: 'paragraph',
        text: 'The derivative measures the rate of change of a function. (revised)',
        sourceReference: 'calculus.txt',
        order: 0,
        chapterId: 'ch1',
        sectionId: 's1',
      },
    ])

    const beforeUntouched = (await analyses.listTopics(project.id)).find(
      (entry) => entry.id === untouchedTopic.id,
    )!
    const beforeLesson = await lessons.find({ projectId: project.id, topicId: untouchedTopic.id, language: 'en' })

    mocks.chatJSON.mockResolvedValue({
      data: {
        language: 'en',
        topic: {
          name: 'Spanning Topic',
          description: 'regenerated',
          sourceChunkIds: [replacement[0]!.id, stored[1]!.id],
        },
        concepts: [{ name: 'Derivative', definition: 'rate of change', topicNames: ['Spanning Topic'] }],
        formulas: [],
        symbols: [],
        examples: [],
        exercises: [],
        prerequisites: [],
      },
    })

    const service = new CourseContentService({ content: new CourseContentRepository({ db }) })
    const result = await service.executeIncrementalScope({
      type: 'chapter',
      projectId: project.id,
      chapterId: 'ch1',
    })

    expect(result.committed).toBe(true)
    expect(result.regeneratedTopicIds).toEqual([spanningTopic.id])

    // The regeneration input carried the still-valid source (c2 / ch2).
    const prompt = mocks.chatJSON.mock.calls[0]![0] as Array<{ role: string; content: string }>
    const user = prompt.find((message) => message.role === 'user')!.content
    expect(user).toContain(stored[1]!.id)

    // The regenerated topic keeps its id and now carries both chapters.
    const after = (await analyses.listTopics(project.id)).find(
      (entry) => entry.id === spanningTopic.id,
    )!
    expect(after.sourceChapterIds).toEqual(['ch1', 'ch2'])
    expect(after.description).toBe('regenerated')

    // 5 �?the untouched topic and its cached lesson are byte-identical.
    const afterUntouched = (await analyses.listTopics(project.id)).find(
      (entry) => entry.id === untouchedTopic.id,
    )!
    expect(afterUntouched).toEqual(beforeUntouched)
    expect(
      await lessons.find({ projectId: project.id, topicId: untouchedTopic.id, language: 'en' }),
    ).toEqual(beforeLesson)
  })

  it('8 �?an AI failure leaves the stored topic untouched', async () => {
    const { project, doc, stored, analyses, spanningTopic } = await seedIncremental()
    const before = (await analyses.listTopics(project.id)).find(
      (entry) => entry.id === spanningTopic.id,
    )!

    await db.chunks.delete(stored[0]!.id)
    await new ChunkRepository(db).addMany([
      {
        documentId: doc.id,
        projectId: project.id,
        contentType: 'paragraph',
        text: 'rewritten material',
        sourceReference: 'calculus.txt',
        order: 0,
        chapterId: 'ch1',
      },
    ])

    mocks.chatJSON.mockRejectedValue(new Error('provider unavailable'))

    const service = new CourseContentService({ content: new CourseContentRepository({ db }) })
    const result = await service.executeIncrementalScope({
      type: 'chapter',
      projectId: project.id,
      chapterId: 'ch1',
    })

    expect(result.committed).toBe(false)
    expect(result.flaggedForFullReanalysis).toEqual([spanningTopic.id])
    const after = (await analyses.listTopics(project.id)).find(
      (entry) => entry.id === spanningTopic.id,
    )!
    expect(after).toEqual(before)
  })

  it('8 �?a change during generation aborts the commit', async () => {
    const { project, doc, stored, analyses, spanningTopic } = await seedIncremental()
    const before = (await analyses.listTopics(project.id)).find(
      (entry) => entry.id === spanningTopic.id,
    )!

    await db.chunks.delete(stored[0]!.id)
    const replacement = await new ChunkRepository(db).addMany([
      {
        documentId: doc.id,
        projectId: project.id,
        contentType: 'paragraph',
        text: 'chapter one rewritten',
        sourceReference: 'calculus.txt',
        order: 0,
        chapterId: 'ch1',
        sectionId: 's1',
      },
    ])

    // The AI call mutates the material mid-flight �?exactly the race the
    // pre-commit revalidation exists to catch.
    mocks.chatJSON.mockImplementation(async () => {
      await new ChunkRepository(db).addMany([
        {
          documentId: doc.id,
          projectId: project.id,
          contentType: 'paragraph',
          text: 'a late arrival',
          sourceReference: 'calculus.txt',
          order: 9,
          chapterId: 'ch1',
          sectionId: 's1',
        },
      ])
      return {
        data: {
          language: 'en',
          topic: {
            name: 'Spanning Topic',
            description: 'regenerated',
            sourceChunkIds: [replacement[0]!.id],
          },
          concepts: [],
          formulas: [],
          symbols: [],
          examples: [],
          exercises: [],
          prerequisites: [],
        },
      }
    })

    const service = new CourseContentService({ content: new CourseContentRepository({ db }) })
    await expect(
      service.executeIncrementalScope({ type: 'chapter', projectId: project.id, chapterId: 'ch1' }),
    ).rejects.toMatchObject({ code: 'CONCURRENT_MODIFICATION' })

    const after = (await analyses.listTopics(project.id)).find(
      (entry) => entry.id === spanningTopic.id,
    )!
    expect(after).toEqual(before)
  })
})

// ---------------------------------------------------------------------------
// 7 �?note / lecture relink
// ---------------------------------------------------------------------------

describe('note and lecture link relink', () => {
  let db: AppDatabase

  beforeEach(() => {
    db = new AppDatabase()
    setDbForTesting(db)
  })

  it('7 �?a link whose target vanished is preserved and flagged, not dropped', async () => {
    const { project, stored } = await seedProject(db)
    const contexts = new CourseContextRepository(db)
    const documents = new DocumentRepository(db)
    const chunks = new ChunkRepository(db)

    // A real note document, so `syncDerived` actually sees the note chunk.
    const noteDoc = await documents.create({
      projectId: project.id,
      type: 'text',
      materialType: 'user_notes',
      name: 'notes.txt',
      sizeBytes: 0,
    })
    await documents.update(noteDoc.id, { status: 'ready' })
    const noteChunk = (
      await chunks.addMany([
        {
          documentId: noteDoc.id,
          projectId: project.id,
          materialType: 'user_notes',
          contentType: 'paragraph',
          text: 'zzz qqq unrelated jottings',
          sourceReference: 'notes.txt',
          order: 0,
        },
      ])
    )[0]!

    // The stored link points at a chunk that no longer exists.
    await contexts.upsert({
      id: project.id,
      projectId: project.id,
      noteLinks: [
        {
          noteChunkId: noteChunk.id,
          textbookChunkId: 'dead-chunk',
          confidence: 0.5,
          relation: 'supplement',
        },
      ],
      lectureLinks: [],
      sourceHash: 'old',
      updatedAt: 0,
    })

    const { CourseContextService } = await import('@/services/courseContextService')
    const synced = await new CourseContextService({ db }).syncDerived(project.id)

    const kept = synced.noteLinks.find((link) => link.noteChunkId === noteChunk.id)
    expect(kept).toBeDefined()
    // Either it was relinked to a live chunk, or it is flagged for review.
    const liveIds = new Set((await chunks.listByProject(project.id)).map((entry) => entry.id))
    if (liveIds.has(kept!.textbookChunkId)) {
      expect(kept!.needsRelink).toBeFalsy()
    } else {
      expect(kept!.needsRelink).toBe(true)
      // No stored fingerprint on this legacy link, so the honest reason is
      // "the chunk is gone", not "it was replaced without a match".
      expect(kept!.relinkReason).toBe('source-chunk-missing')
    }
    void stored
  })

  it('7 �?the context fingerprint covers the textbook chunks', async () => {
    const { project, doc } = await seedProject(db)
    const { CourseContextService } = await import('@/services/courseContextService')
    const service = new CourseContextService({ db })

    const first = await service.syncDerived(project.id)
    expect(first.linkFingerprint).toBeTruthy()

    // Re-processing the textbook regenerates chunk ids; the stored context must
    // notice, even though the notes/transcript chunks did not change.
    const chunks = new ChunkRepository(db)
    await chunks.deleteByDocument(doc.id)
    await chunks.addMany([
      {
        documentId: doc.id,
        projectId: project.id,
        contentType: 'paragraph',
        text: 're-processed text',
        sourceReference: 'calculus.txt',
        order: 0,
      },
    ])

    const second = await service.syncDerived(project.id)
    expect(second.sourceHash).not.toBe(first.sourceHash)
  })
})
