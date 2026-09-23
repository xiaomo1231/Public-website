import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { ProjectService } from '@/services/projectService'
import { TutorLessonService } from '@/services/tutorLessonService'
import { TutorVisualizationService } from '@/services/tutorVisualizationService'
import { CourseAnalysisRepository } from '@/entities/courseAnalysis/repository'
import { DocumentRepository } from '@/entities/document/repository'
import { ChunkRepository } from '@/entities/chunk/repository'
import type { AIService } from '@/services/aiService'

const GRAPH_LESSON = [
  '## Overview',
  '',
  'A straight line can be written \\(y = 2x + 1\\).',
  '',
  '\\[',
  'y = 2x + 1',
  '\\]',
].join('\n')

const PROSE_LESSON = [
  '## Definition',
  '',
  'The intersection of two sets is \\(X \\cap Y = \\{c\\}\\).',
].join('\n')

const FUNCTION_DRAFT = {
  visualizations: [
    { type: 'function_2d', caption: 'The line', expressions: [{ latex: 'y = 2x + 1' }] },
  ],
}

describe('TutorVisualizationService', () => {
  it('normalizes valid structured output', async () => {
    const chatJSON = vi.fn().mockResolvedValue({
      data: FUNCTION_DRAFT,
      raw: { content: '{}', model: 'fake' },
    })
    const service = new TutorVisualizationService({
      ai: { chatJSON } as unknown as AIService,
    })

    const visualizations = await service.generate({
      topicName: 'Lines',
      topicDescription: 'Straight lines.',
      language: 'en',
      lessonContent: GRAPH_LESSON,
    })

    expect(visualizations).toHaveLength(1)
    expect(visualizations[0]!.type).toBe('function_2d')
  })

  it('returns an empty list when the provider fails', async () => {
    const chatJSON = vi.fn().mockRejectedValue(new Error('rate limited'))
    const service = new TutorVisualizationService({
      ai: { chatJSON } as unknown as AIService,
    })

    await expect(
      service.generate({
        topicName: 'Lines',
        topicDescription: '',
        language: 'en',
        lessonContent: GRAPH_LESSON,
      }),
    ).resolves.toEqual([])
  })

  it('returns an empty list when the AI stub has no JSON helper', async () => {
    const service = new TutorVisualizationService({ ai: {} as unknown as AIService })
    await expect(
      service.generate({
        topicName: 'Lines',
        topicDescription: '',
        language: 'en',
        lessonContent: GRAPH_LESSON,
      }),
    ).resolves.toEqual([])
  })
})

describe('TutorLessonService — visualization integration', () => {
  let db: AppDatabase
  let projectId: string
  let topicId: string
  let analyses: CourseAnalysisRepository
  let chunks: ChunkRepository

  beforeEach(async () => {
    db = new AppDatabase()
    setDbForTesting(db)
    const project = await new ProjectService(db).create({ name: 'Lines', subject: 'calculus' })
    projectId = project.id

    const docs = new DocumentRepository(db)
    const doc = await docs.create({ projectId, type: 'text', name: 'lines.txt', sizeBytes: 0 })
    await docs.update(doc.id, { status: 'ready' })
    chunks = new ChunkRepository(db)
    await chunks.addMany([
      {
        documentId: doc.id,
        projectId,
        contentType: 'paragraph',
        text: 'A linear function has the form y = mx + b.',
        sourceReference: 'lines.txt',
        order: 0,
      },
    ])

    analyses = new CourseAnalysisRepository(db)
    topicId = 'topic-lines'
    await analyses.reseedProject(
      projectId,
      {
        topics: [
          {
            name: 'Linear Functions',
            description: 'Straight lines.',
            sourceRefs: [{ documentId: doc.id, documentName: 'lines.txt', quote: 'y = mx + b' }],
          },
        ],
        concepts: [],
        formulas: [],
        symbols: [],
        examples: [],
        exercises: [],
        prerequisites: [],
        topicsByName: new Map([['Linear Functions', topicId]]),
        documentIds: [doc.id],
      },
      'en',
    )
  })

  function service(ai: AIService) {
    return new TutorLessonService({ ai, db, analyses, chunks })
  }

  const input = () => ({
    projectId,
    topicId,
    topicName: 'Linear Functions',
    topicDescription: 'Straight lines.',
    language: 'en' as const,
  })

  function stubAI(options: { lesson?: string; data?: unknown; error?: Error; withJSON?: boolean }) {
    const lesson = options.lesson ?? GRAPH_LESSON
    const chat = vi.fn().mockResolvedValue({ content: lesson, model: 'fake' })
    const chatJSON = vi.fn().mockImplementation(async () => {
      if (options.error) throw options.error
      return { data: options.data ?? { visualizations: [] }, raw: { content: '{}', model: 'fake' } }
    })
    const ai = (options.withJSON === false
      ? { chat, currentProvider: { id: 'fake' } }
      : { chat, chatJSON, currentProvider: { id: 'fake' } }) as unknown as AIService
    return { ai, chat, chatJSON }
  }

  it('stores visualizations with the lesson and caches them', async () => {
    const { ai, chat, chatJSON } = stubAI({ data: FUNCTION_DRAFT })
    const tutor = service(ai)

    const first = await tutor.getOrGenerate(input())
    expect(chat).toHaveBeenCalledTimes(1)
    expect(chatJSON).toHaveBeenCalledTimes(1)
    expect(first.lesson.visualizations).toHaveLength(1)

    const second = await tutor.getOrGenerate(input())
    expect(second.fromCache).toBe(true)
    // A cache hit must never regenerate the graph.
    expect(chatJSON).toHaveBeenCalledTimes(1)
    expect(second.lesson.visualizations).toHaveLength(1)
  })

  it('skips the visualization call when nothing is plottable', async () => {
    const { ai, chatJSON } = stubAI({ lesson: PROSE_LESSON })
    const result = await service(ai).getOrGenerate(input())

    expect(chatJSON).not.toHaveBeenCalled()
    expect(result.lesson.visualizations).toBeUndefined()
  })

  it('still stores the lesson when visualization generation fails', async () => {
    const { ai } = stubAI({ error: new Error('provider down') })
    const result = await service(ai).getOrGenerate(input())

    expect(result.lesson.content).toContain('y = 2x + 1')
    expect(result.lesson.visualizations).toBeUndefined()
  })

  it('does not trust malformed visualization data', async () => {
    const { ai } = stubAI({
      data: { visualizations: [{ type: 'function_2d', expressions: [{ latex: 'y = x^2' }] }] },
    })
    const result = await service(ai).getOrGenerate(input())
    expect(result.lesson.visualizations).toBeUndefined()
  })

  it('works when the AI has no JSON helper at all', async () => {
    const { ai } = stubAI({ withJSON: false })
    const result = await service(ai).getOrGenerate(input())
    expect(result.lesson.content).toContain('y = 2x + 1')
    expect(result.lesson.visualizations).toBeUndefined()
  })
})

describe('TutorVisualizationService — nonlinear (Phase 2)', () => {
  function serviceWith(data: unknown) {
    const chatJSON = vi.fn().mockResolvedValue({ data, raw: { content: '{}', model: 'fake' } })
    return new TutorVisualizationService({ ai: { chatJSON } as unknown as AIService })
  }

  const generate = (service: TutorVisualizationService) =>
    service.generate({
      topicName: 'Quadratics',
      topicDescription: '',
      language: 'en',
      lessonContent: 'y = x^2',
    })

  it('normalizes a nonlinear function draft', async () => {
    const visualizations = await generate(
      serviceWith({
        visualizations: [
          {
            type: 'function_2d',
            caption: 'A parabola',
            expressions: [{ latex: 'y = x^2 - 4', expression: 'x^2 - 4' }],
          },
        ],
      }),
    )
    const viz = visualizations[0]
    if (viz?.type !== 'function_2d') throw new Error('expected function_2d')
    expect(viz.expressions[0]?.expression).toBe('x^2 - 4')
  })

  it('keeps the valid graph and drops the unsupported one', async () => {
    const visualizations = await generate(
      serviceWith({
        visualizations: [
          { type: 'function_2d', expressions: [{ latex: 'y = sin(x)', expression: 'sin(x)' }] },
          { type: 'function_2d', expressions: [{ latex: 'y = tan(x)', expression: 'tan(x)' }] },
        ],
      }),
    )
    expect(visualizations).toHaveLength(1)
    expect(visualizations[0]?.type).toBe('function_2d')
  })

  it('returns an empty list when every graph is unsupported', async () => {
    const visualizations = await generate(
      serviceWith({
        visualizations: [
          { type: 'function_2d', expressions: [{ latex: 'y = tan(x)', expression: 'tan(x)' }] },
        ],
      }),
    )
    expect(visualizations).toEqual([])
  })
})
