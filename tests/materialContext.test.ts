import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { ProjectService } from '@/services/projectService'
import { DocumentRepository } from '@/entities/document/repository'
import { ChunkRepository } from '@/entities/chunk/repository'
import { CourseAnalysisRepository } from '@/entities/courseAnalysis/repository'
import { CourseContextService, classifyNoteRelation } from '@/services/courseContextService'
import {
  computeClassProgress,
  overlapScore,
  type ProgressTopic,
} from '@/services/classProgressService'
import { rankContextChunks } from '@/services/topicSources'
import { computeLessonContentHash } from '@/services/tutorLessonService'
import { resolveMaterialType } from '@/entities/document/types'

const TOPICS: ProgressTopic[] = [
  { id: 't1', name: 'Functions', description: 'definition and notation' },
  { id: 't2', name: 'Domain and Range', description: 'inputs and outputs' },
  { id: 't3', name: 'Inverse Functions', description: 'inverse relationship' },
]

describe('class progress — deterministic and explainable', () => {
  it('derives covered topics and the current topic from a clear transcript', () => {
    const { links, progress } = computeClassProgress({
      topics: TOPICS,
      transcriptChunks: [
        {
          id: 'c1',
          documentId: 'd',
          text: 'Today we start with functions. A function maps an input to an output. Functions and notation.',
        },
        {
          id: 'c2',
          documentId: 'd',
          text: 'Now domain and range. The domain is the set of inputs, the range the set of outputs.',
        },
      ],
      transcriptDocumentIds: ['d'],
    })

    expect(links.length).toBe(2)
    expect(progress.currentTopicId).toBe('t2')
    expect(progress.completedTopicIds).toEqual(['t1'])
    expect(progress.progressPercent).toBe(67)
    expect(progress.lastMatchedTranscriptChunkId).toBe('c2')
  })

  it('does not invent progress from an ambiguous transcript', () => {
    const { links, progress } = computeClassProgress({
      topics: TOPICS,
      transcriptChunks: [
        { id: 'c1', documentId: 'd', text: 'Welcome everyone. It is raining today.' },
      ],
      transcriptDocumentIds: ['d'],
    })

    expect(links).toEqual([])
    expect(progress.progressPercent).toBeUndefined()
    expect(progress.currentTopicId).toBeUndefined()
  })
})

describe('note relations', () => {
  it('classifies learner questions, emphasis, clarifications and examples', () => {
    expect(classifyNoteRelation("I still don't understand why this works.")).toBe('question')
    expect(classifyNoteRelation('Professor said this will be on the exam.')).toBe('emphasis')
    expect(classifyNoteRelation('So basically, it maps every input.')).toBe('clarification')
    expect(classifyNoteRelation('For example, f(2) = 4.')).toBe('example')
    expect(classifyNoteRelation('Additional detail about sets.')).toBe('supplement')
  })

  it('scores token overlap', () => {
    expect(overlapScore('function domain', 'the domain of a function')).toBeGreaterThan(0)
    expect(overlapScore('function domain', 'completely unrelated text')).toBe(0)
  })
})

describe('rankContextChunks', () => {
  it('ranks the chunk most related to the topic first', () => {
    const chunks = [
      {
        id: 'a',
        documentId: 'd',
        projectId: 'p',
        contentType: 'paragraph' as const,
        text: 'Completely unrelated content about weather.',
        sourceReference: 'x',
        order: 0,
        createdAt: 0,
      },
      {
        id: 'b',
        documentId: 'd',
        projectId: 'p',
        contentType: 'paragraph' as const,
        text: 'The derivative measures the instantaneous rate of change.',
        sourceReference: 'x',
        order: 1,
        createdAt: 0,
      },
    ]

    const ranked = rankContextChunks(chunks, 'Derivative', 'rate of change', 1)
    expect(ranked.map((c) => c.id)).toEqual(['b'])
  })
})

describe('CourseContextService', () => {
  let db: AppDatabase
  let projectId: string
  let documents: DocumentRepository
  let chunks: ChunkRepository
  let analyses: CourseAnalysisRepository

  beforeEach(async () => {
    db = new AppDatabase()
    setDbForTesting(db)
    const project = await new ProjectService(db).create({ name: 'Calculus', subject: 'calculus' })
    projectId = project.id
    documents = new DocumentRepository(db)
    chunks = new ChunkRepository(db)
    analyses = new CourseAnalysisRepository(db)

    const textbook = await documents.create({
      projectId,
      type: 'text',
      materialType: 'textbook',
      name: 'book.txt',
      sizeBytes: 0,
    })
    await documents.update(textbook.id, { status: 'ready' })
    await chunks.addMany([
      {
        documentId: textbook.id,
        projectId,
        materialType: 'textbook',
        contentType: 'paragraph',
        text: 'A function maps every input to exactly one output.',
        sourceReference: 'book.txt',
        order: 0,
      },
    ])

    const notes = await documents.create({
      projectId,
      type: 'text',
      materialType: 'user_notes',
      name: 'notes.txt',
      sizeBytes: 0,
    })
    await documents.update(notes.id, { status: 'ready' })
    await chunks.addMany([
      {
        documentId: notes.id,
        projectId,
        materialType: 'user_notes',
        contentType: 'paragraph',
        text: "I don't understand why a function maps every input to exactly one output.",
        sourceReference: 'notes.txt',
        order: 0,
      },
    ])

    const transcript = await documents.create({
      projectId,
      type: 'text',
      materialType: 'lecture_transcript',
      name: 'lec1.txt',
      sizeBytes: 0,
    })
    await documents.update(transcript.id, { status: 'ready' })
    await chunks.addMany([
      {
        documentId: transcript.id,
        projectId,
        materialType: 'lecture_transcript',
        contentType: 'paragraph',
        text: 'Today we cover Functions. A function maps every input to exactly one output.',
        sourceReference: 'lec1.txt',
        order: 0,
      },
    ])

    await analyses.reseedProject(
      projectId,
      {
        topics: [
          {
            name: 'Functions',
            description: 'map every input to exactly one output',
            sourceRefs: [],
          },
        ],
        concepts: [],
        formulas: [],
        symbols: [],
        examples: [],
        exercises: [],
        prerequisites: [],
        topicsByName: new Map(),
        documentIds: [textbook.id],
      },
      'en',
    )
  })

  it('separates the three material types and links notes to the textbook', async () => {
    const context = await new CourseContextService({ db }).syncDerived(projectId)

    // Transcript → class progress.
    expect(context.classProgress).toBeDefined()
    expect(context.classProgress?.currentTopicName).toBe('Functions')
    expect(context.lectureLinks.length).toBeGreaterThan(0)

    // Notes → linked to the textbook, marked as a learner question.
    expect(context.noteLinks.length).toBeGreaterThan(0)
    expect(context.noteLinks[0]!.relation).toBe('question')
    expect(context.noteLinks[0]!.textbookChunkId).toBeTruthy()
  })

  it('keeps class progress out of the tutor lesson cache', async () => {
    const topic = { name: 'Functions', description: 'map every input', sourceRefs: [] }
    const a = computeLessonContentHash(topic, 'v1', 'notes-a')
    const b = computeLessonContentHash(topic, 'v1', 'notes-b')
    // Context change invalidates; a progress change (not part of the hash) does not.
    expect(a).not.toBe(b)
    expect(computeLessonContentHash(topic, 'v1', 'notes-a')).toBe(a)
  })
})

describe('material type resolution', () => {
  it('defaults missing or unknown values to textbook', () => {
    expect(resolveMaterialType(undefined)).toBe('textbook')
    expect(resolveMaterialType('nonsense')).toBe('textbook')
    expect(resolveMaterialType('user_notes')).toBe('user_notes')
  })
})
