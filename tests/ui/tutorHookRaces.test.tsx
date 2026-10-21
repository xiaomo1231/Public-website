import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { buildAIServices, buildReferenceImageService } from '@/services/aiServices'
import { useTutorLesson } from '@/features/tutor/useTutorLesson'
import { useReferenceImages } from '@/features/tutor/useReferenceImages'
import type { TutorLesson } from '@/entities/tutorLesson/types'

vi.mock('@/services/aiServices', () => ({
  buildAIServices: vi.fn(),
  buildReferenceImageService: vi.fn(),
}))

function lesson(topicId: string, content = `Lesson ${topicId}`): TutorLesson {
  return {
    id: `lesson-${topicId}`,
    projectId: 'p1',
    topicId,
    language: 'en',
    content,
    symbols: [],
    sourceChunkIds: [],
    contentHash: topicId,
    promptVersion: 'v1',
    generatedAt: 1,
    updatedAt: 1,
    version: 1,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

beforeEach(() => {
  vi.mocked(buildAIServices).mockReset()
  vi.mocked(buildReferenceImageService).mockReset()
})

describe('useTutorLesson regenerate', () => {
  it('drops a regenerate result for the previous topic', async () => {
    const slow = deferred<{ lesson: TutorLesson }>()
    const tutorLesson = {
      load: vi.fn(async ({ topicId }: { topicId: string }) => lesson(topicId)),
      getOrGenerate: vi.fn(async ({ topicId }: { topicId: string }) => ({
        lesson: lesson(topicId),
        fromCache: true,
      })),
      regenerate: vi.fn(() => slow.promise),
    }
    vi.mocked(buildAIServices).mockResolvedValue({ tutorLesson } as never)

    const { result, rerender } = renderHook(
      (props: { topicId: string }) =>
        useTutorLesson({
          projectId: 'p1',
          topicId: props.topicId,
          topicName: props.topicId,
          topicDescription: '',
          language: 'en',
        }),
      { initialProps: { topicId: 'A' } },
    )
    await waitFor(() => expect(result.current.lesson?.topicId).toBe('A'))

    let pending!: Promise<void>
    act(() => {
      pending = result.current.regenerate()
    })
    expect(result.current.regenerating).toBe(true)

    rerender({ topicId: 'B' })
    await waitFor(() => expect(result.current.lesson?.topicId).toBe('B'))
    expect(result.current.regenerating).toBe(false)

    await act(async () => {
      slow.resolve({ lesson: lesson('A', 'Regenerated A') })
      await pending
    })
    expect(result.current.lesson?.topicId).toBe('B')
    expect(result.current.regenerating).toBe(false)
  })
})

describe('useReferenceImages', () => {
  it('resets searching and availability when the topic changes mid-search', async () => {
    const search = vi.fn(
      ({ signal }: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))),
        ),
    )
    const availableFor = vi.fn(async () => true)
    const enabledFor = new Map([
      ['A', true],
      ['B', false],
    ])
    let current = 'A'
    vi.mocked(buildReferenceImageService).mockImplementation(
      async () =>
        ({
          enabled: enabledFor.get(current),
          list: vi.fn(async () => []),
          availableFor,
          search,
        }) as never,
    )

    const { result, rerender } = renderHook(
      (props: { topicId: string }) =>
        useReferenceImages(lesson(props.topicId), { name: props.topicId }),
      { initialProps: { topicId: 'A' } },
    )
    await waitFor(() => expect(result.current.available).toBe(true))

    act(() => {
      void result.current.search()
    })
    expect(result.current.searching).toBe(true)

    // Topic B's service is unavailable: the stale `available` must not carry over.
    let releaseB!: () => void
    const gate = new Promise<void>((r) => (releaseB = r))
    vi.mocked(buildReferenceImageService).mockImplementation(async () => {
      await gate
      return { enabled: false, list: vi.fn(async () => []), availableFor, search } as never
    })
    current = 'B'
    rerender({ topicId: 'B' })
    expect(result.current.searching).toBe(false)
    expect(result.current.available).toBe(false)
    await act(async () => {
      releaseB()
    })
    await waitFor(() => expect(result.current.available).toBe(false))
    expect(result.current.searching).toBe(false)
  })
})
