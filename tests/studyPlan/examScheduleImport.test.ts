import { describe, expect, it, vi } from 'vitest'
import { ExamScheduleImportService } from '@/services/examScheduleImportService'
import type { ChatMessage } from '@/infrastructure/ai/types'

vi.mock('@/infrastructure/files/imageDownscale', () => ({
  prepareAnswerImage: async (blob: Blob) => ({
    bytes: await blob.arrayBuffer(),
    mimeType: 'image/png',
    width: 10,
    height: 10,
  }),
}))

const NOW = new Date(2026, 9, 23, 10).getTime()
const COURSES = [{ id: 'math', name: 'MATH 101 Calculus I' }]

function fakeAI(reply: unknown | ((messages: ChatMessage[]) => unknown)) {
  const calls: ChatMessage[][] = []
  return {
    calls,
    ai: {
      async chatJSON<T>(messages: ChatMessage[]) {
        calls.push(messages)
        const data =
          typeof reply === 'function' ? (reply as (m: ChatMessage[]) => unknown)(messages) : reply
        if (data instanceof Error) throw data
        return { data: data as T, raw: { content: '' } as never }
      },
    },
  }
}

describe('粘贴识别 service', () => {
  it('does not call the AI when the local parser is sure', async () => {
    const { ai, calls } = fakeAI({ exams: [] })
    const service = new ExamScheduleImportService(ai)
    const result = await service.readText('MATH 101 Midterm: Nov 3, 2pm', {
      now: NOW,
      courses: COURSES,
    })
    expect(calls).toHaveLength(0)
    expect(result.via).toBe('local')
    expect(result.exams[0]).toMatchObject({ projectId: 'math', date: '2026-11-03', time: '14:00' })
  })

  it('asks the AI when unsure and keeps only verbatim-sourced exams', async () => {
    const text = 'Heads up: our big test is the Wednesday after reading week, at ten in the morning'
    const { ai, calls } = fakeAI({
      exams: [
        {
          course: 'MATH 101',
          name: 'Test',
          date: '2026-11-04',
          time: '10:00',
          sourceText: 'our big test is the Wednesday after reading week, at ten in the morning',
        },
        { name: 'Final', date: '2026-12-01', time: '', sourceText: 'Final exam on Dec 1' },
      ],
    })
    const service = new ExamScheduleImportService(ai)
    const result = await service.readText(text, { now: NOW, courses: COURSES })
    expect(calls).toHaveLength(1)
    // The pasted text goes in the untrusted block, with the courses and today.
    const user = calls[0]![1]!.content
    expect(user).toContain('UNTRUSTED CONTENT')
    expect(user).toContain('Today is 2026-10-23')
    expect(calls[0]![0]!.content).toContain('Security rules')
    expect(result.via).toBe('ai')
    expect(result.dropped).toBe(1)
    expect(result.exams).toHaveLength(1)
    expect(result.exams[0]).toMatchObject({ date: '2026-11-04', time: '10:00', projectId: 'math' })
  })

  it('falls back to the local reading when the AI fails, with the reason', async () => {
    const { ai } = fakeAI(Object.assign(new Error('boom'), { code: 'PROVIDER_UNAVAILABLE' }))
    const service = new ExamScheduleImportService(ai)
    const result = await service.readText('2026/10/27 09:00', { now: NOW, courses: COURSES })
    expect(result.via).toBe('local')
    expect(result.exams).toHaveLength(1)
    expect(result.aiError).toBeTruthy()
  })

  it('says the AI is needed when unsure and none is configured', async () => {
    const service = new ExamScheduleImportService(null)
    const result = await service.readText('see you all next week', { now: NOW })
    expect(result.exams).toEqual([])
    expect(result.needsAI).toBe(true)
  })

  it('reads a screenshot with the vision model (image attached to the user turn)', async () => {
    const { ai, calls } = fakeAI({
      exams: [
        {
          name: 'Final exam',
          date: '2026-12-12',
          time: '09:00',
          sourceText: 'Final exam Dec 12 9:00',
        },
      ],
    })
    const service = new ExamScheduleImportService(ai)
    const image = new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' })
    const result = await service.readImages([image], { now: NOW, courses: COURSES })
    expect(calls[0]![1]!.images?.[0]).toMatch(/^data:image\/png;base64,/)
    expect(calls[0]![1]!.content).toContain('attached image')
    expect(result.exams[0]).toMatchObject({ date: '2026-12-12', time: '09:00', origin: 'ai' })
  })

  it('explains when the model cannot read images', async () => {
    const { ai } = fakeAI(
      Object.assign(new Error('image_url is not supported by this model'), {
        code: 'INVALID_REQUEST',
      }),
    )
    const service = new ExamScheduleImportService(ai)
    const image = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' })
    await expect(service.readImages([image], { now: NOW })).rejects.toMatchObject({
      code: 'VISION_UNSUPPORTED',
    })
  })
})
