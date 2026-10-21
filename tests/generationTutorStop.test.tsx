import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { ProjectService } from '@/services/projectService'
import { TutorLessonService } from '@/services/tutorLessonService'
import { MistakeService } from '@/services/mistakeService'
import { MistakeAnalysisService } from '@/services/mistakeAnalysisService'
import { CourseAnalysisRepository } from '@/entities/courseAnalysis/repository'
import { DocumentRepository } from '@/entities/document/repository'
import { ChunkRepository } from '@/entities/chunk/repository'
import { TutorLessonRepository } from '@/entities/tutorLesson/repository'
import { AbortedError } from '@/infrastructure/ai/errors'
import type { AIService } from '@/services/aiService'
import { setUILanguage } from '@/i18n'

/** A chat that waits until its signal aborts (then rejects as ABORTED), or a release. */
function pendingChat() {
  const calls: Array<{ signal?: AbortSignal; release: (content: string) => void }> = []
  const chat = vi.fn(
    (_messages: unknown, options?: { signal?: AbortSignal }) =>
      new Promise<{ content: string; model: string }>((resolve, reject) => {
        const signal = options?.signal
        calls.push({ signal, release: (content) => resolve({ content, model: 'fake' }) })
        if (signal?.aborted) reject(new AbortedError())
        signal?.addEventListener('abort', () => reject(new AbortedError()))
      }),
  )
  return { chat, calls }
}

describe('tutor lesson — stop', () => {
  let db: AppDatabase
  let projectId: string
  const topicId = 'topic-sets'
  let analyses: CourseAnalysisRepository
  let chunks: ChunkRepository

  beforeEach(async () => {
    db = new AppDatabase()
    setDbForTesting(db)
    const project = await new ProjectService(db).create({ name: 'Sets', subject: 'calculus' })
    projectId = project.id
    const docs = new DocumentRepository(db)
    const doc = await docs.create({ projectId, type: 'text', name: 'sets.txt', sizeBytes: 0 })
    await docs.update(doc.id, { status: 'ready' })
    chunks = new ChunkRepository(db)
    await chunks.addMany([
      {
        documentId: doc.id,
        projectId,
        contentType: 'paragraph',
        text: 'The union of two sets contains the elements of either.',
        sourceReference: 'sets.txt',
        order: 0,
      },
    ])
    analyses = new CourseAnalysisRepository(db)
    await analyses.reseedProject(
      projectId,
      {
        topics: [{ name: 'Union', description: 'Union of sets.', sourceRefs: [] }],
        concepts: [],
        formulas: [],
        symbols: [],
        examples: [],
        exercises: [],
        prerequisites: [],
        topicsByName: new Map([['Union', topicId]]),
        documentIds: [doc.id],
      },
      'en',
    )
  })

  const input = (signal?: AbortSignal) => ({
    projectId,
    topicId,
    topicName: 'Union',
    topicDescription: 'Union of sets.',
    language: 'en' as const,
    ...(signal ? { signal } : {}),
  })

  it('a stopped regeneration keeps the stored lesson and writes nothing', async () => {
    const first = { chat: vi.fn().mockResolvedValue({ content: '## Old lesson', model: 'm' }) }
    const service1 = new TutorLessonService({
      ai: first as unknown as AIService,
      db,
      analyses,
      chunks,
    })
    await service1.getOrGenerate(input())

    const { chat, calls } = pendingChat()
    const service = new TutorLessonService({
      ai: { chat } as unknown as AIService,
      db,
      analyses,
      chunks,
    })
    const controller = new AbortController()
    const running = service.regenerate(input(controller.signal))
    await waitFor(() => expect(calls).toHaveLength(1))
    controller.abort()
    await expect(running).rejects.toBeInstanceOf(AbortedError)

    const stored = await new TutorLessonRepository(db).find(input())
    expect(stored?.content).toBe('## Old lesson')
  })

  it('a viewer joining a request someone else stopped gets its own request', async () => {
    const { chat, calls } = pendingChat()
    const service = new TutorLessonService({
      ai: { chat } as unknown as AIService,
      db,
      analyses,
      chunks,
    })
    const controller = new AbortController()
    const first = service.getOrGenerate(input(controller.signal))
    await waitFor(() => expect(calls).toHaveLength(1))
    const joined = service.getOrGenerate(input())
    controller.abort()
    await expect(first).rejects.toBeInstanceOf(AbortedError)
    // The joiner did not stop: a fresh request is started for it.
    await waitFor(() => expect(calls).toHaveLength(2))
    calls[1]!.release('## Fresh lesson')
    const result = await joined
    expect(result.lesson.content).toBe('## Fresh lesson')
  })
})

describe('mistake analysis — stop', () => {
  beforeEach(() => {
    setDbForTesting(new AppDatabase())
  })

  it('restores the previous status instead of marking it failed', async () => {
    const mistakes = new MistakeService()
    const project = await new ProjectService().create({ name: 'P', subject: 'calculus' })
    const mistake = await mistakes.addManual({
      projectId: project.id,
      question: 'Differentiate sin(2x)',
      studentAnswer: 'cos(2x)',
      correctAnswer: '2cos(2x)',
      knowledgePoint: 'Chain Rule',
    })
    let started!: () => void
    const begun = new Promise<void>((resolve) => (started = resolve))
    const chatJSON = vi.fn(
      (_m: unknown, options?: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          started()
          options?.signal?.addEventListener('abort', () => reject(new AbortedError()))
        }),
    )
    const service = new MistakeAnalysisService({
      ai: { chatJSON } as unknown as AIService,
      mistakes,
    })
    const controller = new AbortController()
    const running = service.analyze(mistake.id, { signal: controller.signal })
    await begun
    expect((await mistakes.get(mistake.id))!.analysisStatus).toBe('analyzing')
    controller.abort()
    await expect(running).rejects.toBeInstanceOf(AbortedError)
    const after = await mistakes.get(mistake.id)
    expect(after!.analysisStatus).toBe('pending')
    expect(after!.analysisError).toBeUndefined()
  })
})

describe('contextual tutor popup — stop', () => {
  it('shows Stop while answering, aborts the request and gives the question back', async () => {
    setUILanguage('zh-CN')
    const seen: AbortSignal[] = []
    vi.resetModules()
    vi.doMock('@/services/aiServices', () => ({
      buildAIServices: async () => ({
        contextualTutor: {
          ask: (input: { signal?: AbortSignal }) =>
            new Promise((_resolve, reject) => {
              if (input.signal) seen.push(input.signal)
              input.signal?.addEventListener('abort', () => reject(new AbortedError()))
            }),
        },
      }),
    }))
    const { ContextualTutorPopup } = await import('@/widgets/tutor/ContextualTutorPopup')
    const i18n = await import('@/i18n')
    i18n.setUILanguage('zh-CN')
    render(
      <ContextualTutorPopup
        mode="ask"
        context={{
          projectId: 'p',
          selectedText: 'A ∪ B',
          surroundingContext: 'The union of sets.',
          language: 'zh',
        }}
        onClose={() => undefined}
      />,
    )
    const box = screen.getByRole('textbox')
    fireEvent.change(box, { target: { value: '什么是并集？' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    const stop = await screen.findByRole('button', { name: '停止' })
    fireEvent.click(stop)
    await waitFor(() => expect(seen[0]?.aborted).toBe(true))
    await waitFor(() => expect(screen.queryByRole('button', { name: '停止' })).toBeNull())
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('什么是并集？')
    // A stop is not a failure.
    expect(screen.queryByText(/失败/)).toBeNull()
    vi.doUnmock('@/services/aiServices')
  })
})
