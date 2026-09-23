import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { ProjectService } from '@/services/projectService'
import { DocumentRepository } from '@/entities/document/repository'
import { ChunkRepository } from '@/entities/chunk/repository'
import { CourseAnalysisRepository } from '@/entities/courseAnalysis/repository'
import { CourseContextRepository } from '@/entities/courseContext/repository'
import { CourseStructureRepository } from '@/entities/courseStructure/repository'
import { PracticeRepository } from '@/entities/practice/repository'
import { CourseContentRepository } from '@/entities/courseContent/repository'
import { chunkContentFingerprint } from '@/entities/chunk/relink'
import { buildTopicDependency, chunkFingerprintMap } from '@/entities/courseContent/topicDependency'
import { CourseContentService } from '@/services/courseContentService'
import { CourseContextService } from '@/services/courseContextService'
import type { CourseStructure, CourseStructureNode } from '@/entities/courseStructure/types'
import type { PracticeQuestion } from '@/entities/practice/types'
import type { CourseContext } from '@/entities/courseContext/types'

/**
 * The associated references — professor practice, note links, lecture links —
 * are committed in the **same** Dexie transaction as the topic update, so a
 * re-pointed reference can never become visible on its own.
 */

const mocks = vi.hoisted(() => ({ chatJSON: vi.fn() }))

vi.mock('@/services/aiServices', () => ({
  buildAIServices: vi.fn(async () => ({
    ai: { chatJSON: mocks.chatJSON, maxOutputTokens: 2048 },
    documentAnalysis: { analyzeProject: vi.fn() },
  })),
}))

function node(id: string, sourceChunkIds: string[], order = 0): CourseStructureNode {
  return {
    id,
    structureId: 'structure-1',
    projectId: 'p1',
    type: 'chapter',
    title: id,
    order,
    depth: 0,
    sourceChunkIds,
    confidence: 'high',
  }
}

const CHAPTER_ONE_TEXT = 'Derivatives measure the rate of change of a function.'
const CHAPTER_TWO_TEXT = 'Integrals accumulate area under a curve.'

describe('atomic associated-reference commit', () => {
  let db: AppDatabase

  beforeEach(() => {
    db = new AppDatabase()
    setDbForTesting(db)
    mocks.chatJSON.mockReset()
  })

  /**
   * Every reference family points at chapter 1's chunk, so re-processing that
   * one chunk exercises all four relink paths at once.
   */
  async function seedAtomic() {
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
    const textbook = await chunks.addMany([
      {
        documentId: doc.id,
        projectId: project.id,
        contentType: 'paragraph',
        text: CHAPTER_ONE_TEXT,
        sourceReference: 'calculus.txt',
        order: 0,
        chapterId: 'ch1',
        sectionId: 's1',
      },
      {
        documentId: doc.id,
        projectId: project.id,
        contentType: 'paragraph',
        text: CHAPTER_TWO_TEXT,
        sourceReference: 'calculus.txt',
        order: 1,
        chapterId: 'ch2',
        sectionId: 's2',
      },
    ])

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
      node('ch1', [textbook[0]!.id]),
      node('ch2', [textbook[1]!.id], 1),
    ])

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
          text: CHAPTER_ONE_TEXT,
          sourceReference: 'notes.txt',
          order: 0,
        },
      ])
    )[0]!

    const transcriptDoc = await documents.create({
      projectId: project.id,
      type: 'text',
      materialType: 'lecture_transcript',
      name: 'lecture.txt',
      sizeBytes: 0,
    })
    await documents.update(transcriptDoc.id, { status: 'ready' })
    const transcriptChunk = (
      await chunks.addMany([
        {
          documentId: transcriptDoc.id,
          projectId: project.id,
          materialType: 'lecture_transcript',
          contentType: 'paragraph',
          text: 'Derivatives: today we cover how derivatives measure the rate of change.',
          sourceReference: 'lecture.txt',
          order: 0,
        },
      ])
    )[0]!

    const analyses = new CourseAnalysisRepository(db)
    const dependency = buildTopicDependency([textbook[0]!.id, textbook[1]!.id], textbook)
    await analyses.reseedProject(
      project.id,
      {
        topics: [
          {
            name: 'Derivatives',
            description: 'rate of change',
            sourceRefs: [],
            chapterId: 'ch2',
            sectionId: 's2',
            sourceChunkIds: dependency.sourceChunkIds,
            sourceChapterIds: dependency.sourceChapterIds,
            sourceSectionIds: dependency.sourceSectionIds,
            dependencyHash: dependency.dependencyHash,
            sourceChunkFingerprints: chunkFingerprintMap(textbook),
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
    const topic = (await analyses.listTopics(project.id))[0]!

    const practice = new PracticeRepository(db)
    const practiceQuestion: PracticeQuestion = {
      id: 'pq1',
      projectId: project.id,
      setId: 'set1',
      documentId: doc.id,
      documentName: 'Professor Practice.pdf',
      order: 0,
      type: 'single_choice',
      prompt: 'Find the derivative of the function.',
      options: [],
      answerSource: 'professor',
      chunkId: textbook[0]!.id,
      chunkFingerprint: chunkContentFingerprint(textbook[0]!),
      confidence: 0.9,
      status: 'verified',
      createdAt: 0,
    }
    await practice.addQuestions([practiceQuestion])

    const contexts = new CourseContextRepository(db)
    const context: CourseContext = {
      id: project.id,
      projectId: project.id,
      noteLinks: [
        {
          noteChunkId: noteChunk.id,
          textbookChunkId: textbook[0]!.id,
          textbookChunkFingerprint: chunkContentFingerprint(textbook[0]!),
          confidence: 0.6,
          relation: 'supplement',
        },
      ],
      lectureLinks: [
        {
          transcriptChunkId: transcriptChunk.id,
          textbookChunkId: textbook[0]!.id,
          textbookChunkFingerprint: chunkContentFingerprint(textbook[0]!),
          topicId: topic.id,
          confidence: 0.5,
        },
      ],
      sourceHash: 'seed',
      updatedAt: 0,
    }
    await contexts.upsert(context)

    return {
      project,
      doc,
      textbook,
      noteChunk,
      transcriptChunk,
      topic,
      practice,
      contexts,
      analyses,
    }
  }

  /** Re-process chapter 1's chunk, returning the replacement row. */
  async function reprocessChapterOne(
    seeded: Awaited<ReturnType<typeof seedAtomic>>,
    text = CHAPTER_ONE_TEXT,
  ) {
    await db.chunks.delete(seeded.textbook[0]!.id)
    return (
      await new ChunkRepository(db).addMany([
        {
          documentId: seeded.doc.id,
          projectId: seeded.project.id,
          contentType: 'paragraph',
          text,
          sourceReference: 'calculus.txt',
          order: 0,
          chapterId: 'ch1',
          sectionId: 's1',
        },
      ])
    )[0]!
  }

  function makeService() {
    return new CourseContentService({ content: new CourseContentRepository({ db }) })
  }

  it('1 — Topic, PracticeQuestion, NoteLink and LectureLink relink in one commit', async () => {
    const seeded = await seedAtomic()
    const replacement = await reprocessChapterOne(seeded)

    const result = await makeService().executeIncrementalScope({
      type: 'chapter',
      projectId: seeded.project.id,
      chapterId: 'ch1',
    })

    expect(result.committed).toBe(true)
    // Identical content proved by fingerprint → no AI call at all.
    expect(mocks.chatJSON).not.toHaveBeenCalled()

    const topic = (await seeded.analyses.getTopic(seeded.topic.id))!
    expect(topic.sourceChunkIds).toContain(replacement.id)
    expect(topic.sourceChunkIds).not.toContain(seeded.textbook[0]!.id)

    const question = (await seeded.practice.getQuestion('pq1'))!
    expect(question.chunkId).toBe(replacement.id)
    expect(question.needsRelink).toBe(false)

    const context = (await seeded.contexts.get(seeded.project.id))!
    expect(context.noteLinks[0]!.textbookChunkId).toBe(replacement.id)
    expect(context.lectureLinks[0]!.textbookChunkId).toBe(replacement.id)
  })

  it('2 — a failing transaction leaves every table byte-identical', async () => {
    const seeded = await seedAtomic()
    const replacement = await reprocessChapterOne(seeded)

    const beforeTopic = (await seeded.analyses.getTopic(seeded.topic.id))!
    const beforeQuestion = (await seeded.practice.getQuestion('pq1'))!
    const beforeContext = (await seeded.contexts.get(seeded.project.id))!

    const spy = vi
      .spyOn(db.table('practiceQuestions'), 'put')
      .mockRejectedValueOnce(new Error('simulated write failure'))

    await expect(
      makeService().executeIncrementalScope({
        type: 'chapter',
        projectId: seeded.project.id,
        chapterId: 'ch1',
      }),
    ).rejects.toBeDefined()
    spy.mockRestore()

    expect(await seeded.analyses.getTopic(seeded.topic.id)).toEqual(beforeTopic)
    expect(await seeded.practice.getQuestion('pq1')).toEqual(beforeQuestion)
    expect(await seeded.contexts.get(seeded.project.id)).toEqual(beforeContext)
    void replacement
  })

  it('3 — an AI failure writes no practice or context row', async () => {
    const seeded = await seedAtomic()
    // Different text → the topic must be regenerated, so the AI is involved.
    await reprocessChapterOne(seeded, 'completely rewritten material')

    const beforeQuestion = (await seeded.practice.getQuestion('pq1'))!
    const beforeContext = (await seeded.contexts.get(seeded.project.id))!

    mocks.chatJSON.mockRejectedValue(new Error('provider unavailable'))

    const result = await makeService().executeIncrementalScope({
      type: 'chapter',
      projectId: seeded.project.id,
      chapterId: 'ch1',
    })

    expect(result.committed).toBe(false)
    expect(await seeded.practice.getQuestion('pq1')).toEqual(beforeQuestion)
    expect(await seeded.contexts.get(seeded.project.id)).toEqual(beforeContext)
  })

  it('3 — a concurrent change aborts before anything is staged', async () => {
    const seeded = await seedAtomic()
    const replacement = await reprocessChapterOne(seeded, 'completely rewritten material')

    const beforeQuestion = (await seeded.practice.getQuestion('pq1'))!
    const beforeContext = (await seeded.contexts.get(seeded.project.id))!

    // The material moves while the model is generating.
    mocks.chatJSON.mockImplementation(async () => {
      await new ChunkRepository(db).addMany([
        {
          documentId: seeded.doc.id,
          projectId: seeded.project.id,
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
            name: 'Derivatives',
            description: 'regenerated',
            sourceChunkIds: [replacement.id],
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

    await expect(
      makeService().executeIncrementalScope({
        type: 'chapter',
        projectId: seeded.project.id,
        chapterId: 'ch1',
      }),
    ).rejects.toMatchObject({ code: 'CONCURRENT_MODIFICATION' })

    expect(await seeded.practice.getQuestion('pq1')).toEqual(beforeQuestion)
    expect(await seeded.contexts.get(seeded.project.id)).toEqual(beforeContext)
  })

  it('4 — unmatched practice, note and lecture references keep their ids and are flagged', async () => {
    const seeded = await seedAtomic()
    const replacement = await reprocessChapterOne(seeded, 'unrelated replacement passage')

    mocks.chatJSON.mockResolvedValue({
      data: {
        language: 'en',
        topic: {
          name: 'Derivatives',
          description: 'regenerated',
          sourceChunkIds: [replacement.id],
        },
        concepts: [],
        formulas: [],
        symbols: [],
        examples: [],
        exercises: [],
        prerequisites: [],
      },
    })

    await makeService().executeIncrementalScope({
      type: 'chapter',
      projectId: seeded.project.id,
      chapterId: 'ch1',
    })

    const question = (await seeded.practice.getQuestion('pq1'))!
    expect(question.chunkId).toBe(seeded.textbook[0]!.id)
    expect(question.needsRelink).toBe(true)
    expect(question.relinkReason).toBe('source-chunk-replaced-without-match')

    const context = (await seeded.contexts.get(seeded.project.id))!
    const noteLink = context.noteLinks.find((link) => link.noteChunkId === seeded.noteChunk.id)
    expect(noteLink).toBeDefined()
    if (noteLink!.textbookChunkId !== replacement.id) {
      expect(noteLink!.needsRelink).toBe(true)
      expect(noteLink!.relinkReason).toBeTruthy()
    }

    const lectureLink = context.lectureLinks.find(
      (link) => link.transcriptChunkId === seeded.transcriptChunk.id,
    )
    expect(lectureLink).toBeDefined()
    if (lectureLink!.textbookChunkId !== replacement.id) {
      expect(lectureLink!.needsRelink).toBe(true)
      expect(lectureLink!.relinkReason).toBeTruthy()
    }
  })

  it('5 — an unaffected practice row is not rewritten', async () => {
    const seeded = await seedAtomic()
    await seeded.practice.addQuestions([
      {
        id: 'pq-live',
        projectId: seeded.project.id,
        setId: 'set1',
        documentId: seeded.doc.id,
        documentName: 'Professor Practice.pdf',
        order: 1,
        type: 'single_choice',
        prompt: 'Integrate the function.',
        options: [],
        answerSource: 'professor',
        chunkId: seeded.textbook[1]!.id,
        chunkFingerprint: chunkContentFingerprint(seeded.textbook[1]!),
        confidence: 0.9,
        status: 'verified',
        createdAt: 0,
      },
    ])
    const beforeLive = (await seeded.practice.getQuestion('pq-live'))!

    await reprocessChapterOne(seeded)
    const result = await makeService().executeIncrementalScope({
      type: 'chapter',
      projectId: seeded.project.id,
      chapterId: 'ch1',
    })
    expect(result.committed).toBe(true)

    // Already live → no fingerprint churn, no timestamp bump.
    expect(await seeded.practice.getQuestion('pq-live')).toEqual(beforeLive)
  })

  it('6 — the committed state is consistent after a storage restart', async () => {
    const seeded = await seedAtomic()
    const replacement = await reprocessChapterOne(seeded)

    await makeService().executeIncrementalScope({
      type: 'chapter',
      projectId: seeded.project.id,
      chapterId: 'ch1',
    })

    // Reopen the database, as a page reload would.
    const reopened = new AppDatabase()
    const topic = (await new CourseAnalysisRepository(reopened).getTopic(seeded.topic.id))!
    const question = (await new PracticeRepository(reopened).getQuestion('pq1'))!
    const context = (await new CourseContextRepository(reopened).get(seeded.project.id))!

    expect(topic.sourceChunkIds).toContain(replacement.id)
    expect(question.chunkId).toBe(replacement.id)
    expect(context.noteLinks[0]!.textbookChunkId).toBe(replacement.id)
    expect(context.lectureLinks[0]!.textbookChunkId).toBe(replacement.id)
  })

  it('7 — the tutor-page context sync still works on its own', async () => {
    const seeded = await seedAtomic()
    const service = new CourseContextService({ db })

    // Bring the stored context in sync first.
    const synced = await service.syncDerived(seeded.project.id)
    expect(synced.sourceHash).not.toBe('seed')

    // Staging is side-effect free: nothing left to change.
    const staged = await service.stageDerived(seeded.project.id)
    expect(staged.changed).toBe(false)
    expect(staged.context).toEqual(synced)

    // The public sync persists again once the material really changed.
    await reprocessChapterOne(seeded, 're-processed textbook text')
    const after = await service.syncDerived(seeded.project.id)
    expect(after.sourceHash).not.toBe(synced.sourceHash)
    expect(await seeded.contexts.get(seeded.project.id)).toEqual(after)
  })
})
