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
  'The fundamental theorem of arithmetic states that every integer has a unique prime factorisation.',
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

describe('TutorVisualizationService — vectors & graphs (Phase 3.0)', () => {
  function serviceWith(data: unknown) {
    const chatJSON = vi.fn().mockResolvedValue({ data, raw: { content: '{}', model: 'fake' } })
    return new TutorVisualizationService({ ai: { chatJSON } as unknown as AIService })
  }

  const generate = (service: TutorVisualizationService) =>
    service.generate({
      topicName: 'Graphs and vectors',
      topicDescription: '',
      language: 'en',
      lessonContent: 'A graph has vertices and edges. A vector has components.',
    })

  it('normalizes a vectors_2d draft', async () => {
    const visualizations = await generate(
      serviceWith({
        visualizations: [
          { type: 'vectors_2d', operation: 'display', vectors: [{ x: 1, y: 2, label: 'v' }] },
        ],
      }),
    )
    expect(visualizations).toHaveLength(1)
    expect(visualizations[0]?.type).toBe('vectors_2d')
  })

  it('normalizes a graph_2d draft', async () => {
    const visualizations = await generate(
      serviceWith({
        visualizations: [
          {
            type: 'graph_2d',
            graphKind: 'directed',
            nodes: [{ id: 'a', label: 'A' }],
            edges: [],
          },
        ],
      }),
    )
    expect(visualizations).toHaveLength(1)
    expect(visualizations[0]?.type).toBe('graph_2d')
  })

  it('keeps the valid diagram and drops the invalid one', async () => {
    const visualizations = await generate(
      serviceWith({
        visualizations: [
          { type: 'graph_2d', nodes: [{ id: 'a', label: 'A' }], edges: [] },
          { type: 'vectors_2d', vectors: [] },
        ],
      }),
    )
    expect(visualizations).toHaveLength(1)
    expect(visualizations[0]?.type).toBe('graph_2d')
  })

  it('returns an empty list when every diagram is invalid', async () => {
    const visualizations = await generate(
      serviceWith({ visualizations: [{ type: 'vectors_2d', vectors: [] }] }),
    )
    expect(visualizations).toEqual([])
  })
})

describe('TutorVisualizationService — transforms & sets (Phase 3.1)', () => {
  function serviceWith(data: unknown) {
    const chatJSON = vi.fn().mockResolvedValue({ data, raw: { content: '{}', model: 'fake' } })
    return new TutorVisualizationService({ ai: { chatJSON } as unknown as AIService })
  }

  const generate = (service: TutorVisualizationService) =>
    service.generate({
      topicName: 'Linear transformations and sets',
      topicDescription: '',
      language: 'en',
      lessonContent: 'Let A = [[2,0],[0,1]] and v = (1,1). A = {1,2,3}, B = {3,4,5}.',
    })

  it('normalizes a transform_2d draft', async () => {
    const visualizations = await generate(
      serviceWith({
        visualizations: [
          { type: 'transform_2d', matrix: { a: 2, b: 0, c: 0, d: 1 }, vectors: [{ x: 1, y: 1 }] },
        ],
      }),
    )
    expect(visualizations).toHaveLength(1)
    expect(visualizations[0]?.type).toBe('transform_2d')
  })

  it('normalizes a venn_2d draft', async () => {
    const visualizations = await generate(
      serviceWith({
        visualizations: [
          {
            type: 'venn_2d',
            operation: 'intersection',
            operands: ['a', 'b'],
            sets: [
              { id: 'a', label: 'A', elements: ['1', '2', '3'] },
              { id: 'b', label: 'B', elements: ['3', '4', '5'] },
            ],
          },
        ],
      }),
    )
    expect(visualizations).toHaveLength(1)
    expect(visualizations[0]?.type).toBe('venn_2d')
  })

  it('keeps the valid diagram and drops the invalid one', async () => {
    const visualizations = await generate(
      serviceWith({
        visualizations: [
          { type: 'transform_2d', matrix: { a: 1, b: 0, c: 0, d: 1 } },
          { type: 'venn_2d', operation: 'union', sets: [{ id: 'a', label: 'A', elements: [] }] },
        ],
      }),
    )
    expect(visualizations).toHaveLength(1)
    expect(visualizations[0]?.type).toBe('transform_2d')
  })

  it('returns an empty list when every diagram is invalid', async () => {
    const visualizations = await generate(
      serviceWith({ visualizations: [{ type: 'transform_2d' }] }),
    )
    expect(visualizations).toEqual([])
  })
})

describe('TutorVisualizationService — eigenvectors (Phase 3.2)', () => {
  function serviceWith(data: unknown) {
    const chatJSON = vi.fn().mockResolvedValue({ data, raw: { content: '{}', model: 'fake' } })
    return new TutorVisualizationService({ ai: { chatJSON } as unknown as AIService })
  }

  const generate = (service: TutorVisualizationService) =>
    service.generate({
      topicName: 'Eigenvalues and eigenvectors',
      topicDescription: '',
      language: 'en',
      lessonContent: 'Let A = [[2, 1], [1, 2]] with eigenvalues 3 and 1 and eigenvector (1, 1).',
    })

  it('normalizes an eigen_2d draft', async () => {
    const visualizations = await generate(
      serviceWith({
        visualizations: [
          {
            type: 'eigen_2d',
            matrix: { a: 2, b: 1, c: 1, d: 2 },
            eigenpairs: [{ value: 3, vector: { x: 1, y: 1 }, label: 'v1' }],
          },
        ],
      }),
    )
    expect(visualizations).toHaveLength(1)
    expect(visualizations[0]?.type).toBe('eigen_2d')
  })

  it('drops an eigen_2d draft whose matrix has complex eigenvalues', async () => {
    const visualizations = await generate(
      serviceWith({
        visualizations: [{ type: 'eigen_2d', matrix: { a: 0, b: -1, c: 1, d: 0 } }],
      }),
    )
    expect(visualizations).toEqual([])
  })
})
