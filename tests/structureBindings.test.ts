import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { ProjectService } from '@/services/projectService'
import { DocumentRepository } from '@/entities/document/repository'
import { ChunkRepository } from '@/entities/chunk/repository'
import { CourseAnalysisRepository } from '@/entities/courseAnalysis/repository'
import { CourseContextService } from '@/services/courseContextService'
import { PracticeService } from '@/services/practiceService'
import { scopeSnippetsByStructure, type SourceSnippet } from '@/services/sourceContext'

const TEXTBOOK_TEXT = 'The derivative measures the instantaneous rate of change of a function.'

describe('structure bindings', () => {
  let db: AppDatabase
  let projectId: string
  let chunks: ChunkRepository

  beforeEach(async () => {
    db = new AppDatabase()
    setDbForTesting(db)
    const project = await new ProjectService(db).create({ name: 'Calculus', subject: 'calculus' })
    projectId = project.id
    const documents = new DocumentRepository(db)
    chunks = new ChunkRepository(db)

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
        text: TEXTBOOK_TEXT,
        sourceReference: 'book.txt · Chapter 3 · 3.2',
        order: 0,
        chapterId: 'ch3',
        sectionId: 'sec3-2',
        chapterNumber: '3',
        sectionNumber: '3.2',
        chapterTitle: 'Derivatives',
        sectionTitle: 'Derivative Rules',
      },
    ])

    await new CourseAnalysisRepository(db).reseedProject(
      projectId,
      {
        topics: [
          {
            name: 'Derivatives',
            description: 'instantaneous rate of change of a function',
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

  async function addMaterial(
    materialType: 'user_notes' | 'lecture_transcript' | 'professor_practice',
    name: string,
    text: string,
  ): Promise<string> {
    const documents = new DocumentRepository(db)
    const doc = await documents.create({
      projectId,
      type: 'text',
      materialType,
      name,
      sizeBytes: 0,
    })
    await documents.update(doc.id, { status: 'ready' })
    await chunks.addMany([
      {
        documentId: doc.id,
        projectId,
        materialType,
        contentType: 'paragraph',
        text,
        sourceReference: name,
        order: 0,
      },
    ])
    return doc.id
  }

  it('Test 4 — a note maps to the chapter/section of the textbook passage it matches', async () => {
    await addMaterial(
      'user_notes',
      'notes.txt',
      'I do not understand the derivative, the instantaneous rate of change of a function.',
    )

    const context = await new CourseContextService({ db }).syncDerived(projectId)
    expect(context.noteLinks.length).toBeGreaterThan(0)
    expect(context.noteLinks[0]!.chapterId).toBe('ch3')
    expect(context.noteLinks[0]!.sectionId).toBe('sec3-2')
  })

  it('Test 5 — a transcript chunk maps to a chapter through its matched topic', async () => {
    await addMaterial(
      'lecture_transcript',
      'lec3.txt',
      'Today we cover derivatives, the instantaneous rate of change of a function.',
    )

    const context = await new CourseContextService({ db }).syncDerived(projectId)
    expect(context.lectureLinks.length).toBeGreaterThan(0)
    expect(context.lectureLinks[0]!.chapterId).toBe('ch3')
  })

  it('Test 6 — a practice question maps to a chapter through the textbook', async () => {
    await addMaterial(
      'professor_practice',
      'practice.txt',
      ['1. Find the derivative, the instantaneous rate of change, of the function.', 'A. 2x', 'B. x', 'Answer Key', '1. A'].join('\n'),
    )
    const documentId = (await new DocumentRepository(db).listByProject(projectId)).find(
      (d) => d.name === 'practice.txt',
    )!.id

    const set = await new PracticeService({ db }).importDocument(documentId)
    const questions = await new PracticeService({ db }).listQuestions(set.id)
    expect(questions[0]!.chapterId).toBe('ch3')
  })

  it('Test 7 — quiz retrieval is scoped to the requested chapter', () => {
    const snippets: SourceSnippet[] = [
      { chunkId: 'a', documentId: 'd', documentName: 'book', chapterId: 'ch1', sectionId: 's1', text: 'chapter one' },
      { chunkId: 'b', documentId: 'd', documentName: 'book', chapterId: 'ch3', sectionId: 'sec3-2', text: 'chapter three' },
      { chunkId: 'c', documentId: 'd', documentName: 'book', chapterId: 'ch3', sectionId: 'sec3-3', text: 'chapter three b' },
    ]

    expect(scopeSnippetsByStructure(snippets, { chapterId: 'ch3' }).map((s) => s.chunkId)).toEqual([
      'b',
      'c',
    ])
    expect(
      scopeSnippetsByStructure(snippets, { chapterId: 'ch3', sectionId: 'sec3-2' }).map(
        (s) => s.chunkId,
      ),
    ).toEqual(['b'])
    expect(scopeSnippetsByStructure(snippets, {}).map((s) => s.chunkId)).toEqual(['a', 'b', 'c'])
  })
})
