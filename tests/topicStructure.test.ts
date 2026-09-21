import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { ProjectService } from '@/services/projectService'
import { CourseAnalysisRepository } from '@/entities/courseAnalysis/repository'
import { computeClassProgress, type ProgressTopic } from '@/services/classProgressService'
import { computeLessonContentHash } from '@/services/tutorLessonService'
import { prompts } from '@/infrastructure/ai/prompts'

describe('topics bind to the textbook structure', () => {
  let db: AppDatabase
  let projectId: string
  let analyses: CourseAnalysisRepository

  beforeEach(async () => {
    db = new AppDatabase()
    setDbForTesting(db)
    const project = await new ProjectService(db).create({ name: 'Calculus', subject: 'calculus' })
    projectId = project.id
    analyses = new CourseAnalysisRepository(db)
  })

  it('persists the chapter/section a topic belongs to', async () => {
    await analyses.reseedProject(
      projectId,
      {
        topics: [
          {
            name: 'Derivative Rules',
            description: 'product and chain rules',
            sourceRefs: [],
            chapterId: 'ch3',
            sectionId: 'sec3-2',
            chapterNumber: '3',
            sectionNumber: '3.2',
            chapterTitle: 'Derivatives',
            sectionTitle: 'Derivative Rules',
          },
        ],
        concepts: [],
        formulas: [],
        symbols: [],
        examples: [],
        exercises: [],
        prerequisites: [],
        topicsByName: new Map(),
        documentIds: [],
      },
      'en',
    )

    const topics = await analyses.listTopics(projectId)
    expect(topics[0]).toMatchObject({
      chapterId: 'ch3',
      sectionId: 'sec3-2',
      chapterNumber: '3',
      sectionNumber: '3.2',
      chapterTitle: 'Derivatives',
    })
  })

  it('invalidates the lesson when the topic moves chapter', () => {
    const topic = { name: 'Derivatives', description: 'rate of change', sourceRefs: [] }
    const inCh3 = computeLessonContentHash({ ...topic, chapterId: 'ch3', sectionId: 's1' }, 'v1')
    const inCh4 = computeLessonContentHash({ ...topic, chapterId: 'ch4', sectionId: 's1' }, 'v1')
    expect(inCh3).not.toBe(inCh4)
    // Same structure → stable cache key.
    expect(computeLessonContentHash({ ...topic, chapterId: 'ch3', sectionId: 's1' }, 'v1')).toBe(inCh3)
  })
})

describe('lesson prompt carries the textbook position', () => {
  it('includes the chapter/section and the authoritative-structure rule', () => {
    const prompt = prompts.tutorLesson.buildUserPrompt({
      topicName: 'Derivative Rules',
      topicDescription: 'product and chain rules',
      language: 'en',
      sourceSnippets: ['The product rule states...'],
      chapterLabel: '3 — Derivatives',
      sectionLabel: '3.2 — Derivative Rules',
    })

    expect(prompt).toContain('CURRENT MATERIAL')
    expect(prompt).toContain('3 — Derivatives')
    expect(prompt).toContain('3.2 — Derivative Rules')
    expect(prompts.tutorLesson.buildSystemPrompt()).toMatch(/chapter and section hierarchy is authoritative/i)
  })
})

describe('class progress names the textbook position', () => {
  it('records the current chapter/section from the matched topic', () => {
    const topics: ProgressTopic[] = [
      {
        id: 't1',
        name: 'Derivative Rules',
        description: 'product and chain rules',
        chapterId: 'ch3',
        sectionId: 'sec3-2',
        chapterNumber: '3',
        sectionNumber: '3.2',
        chapterTitle: 'Derivatives',
        sectionTitle: 'Derivative Rules',
      },
    ]

    const { progress } = computeClassProgress({
      topics,
      transcriptChunks: [
        {
          id: 'c1',
          documentId: 'd',
          text: 'Today we cover derivative rules: the product and chain rules.',
        },
      ],
      transcriptDocumentIds: ['d'],
    })

    expect(progress.currentChapterId).toBe('ch3')
    expect(progress.currentSectionId).toBe('sec3-2')
    expect(progress.currentSectionNumber).toBe('3.2')
  })
})
