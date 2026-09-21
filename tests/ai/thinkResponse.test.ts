import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as AIInfrastructure from '@/infrastructure/ai'
import type { ChatChunk } from '@/infrastructure/ai/types'

/**
 * The AI service is the single choke point every user-visible answer passes
 * through, so `<think>` stripping is verified here rather than in each page.
 */
const providerState = vi.hoisted(() => ({
  chat: vi.fn(),
  streamChat: vi.fn(),
}))

vi.mock('@/infrastructure/ai', async (importOriginal) => {
  const actual = await importOriginal<typeof AIInfrastructure>()
  return {
    ...actual,
    createProvider: () => ({
      id: 'fake',
      label: 'Fake',
      capabilities: { jsonMode: true, streaming: true, tools: false },
      chat: providerState.chat,
      streamChat: providerState.streamChat,
      testConnection: vi.fn(),
    }),
  }
})

const { AIService } = await import('@/services/aiService')
const { ContextualTutorService } = await import('@/services/contextualTutorService')

function service(): InstanceType<typeof AIService> {
  return new AIService({
    config: {
      provider: 'custom',
      baseURL: 'http://localhost',
      apiKey: 'test',
      model: 'test',
      temperature: 0,
      maxTokens: 100,
    },
  })
}

/** Emit the given deltas through a stubbed stream. */
function streamOf(deltas: string[], full: string): void {
  providerState.streamChat.mockImplementation(
    async (_req: unknown, onChunk: (chunk: ChatChunk) => void) => {
      for (const delta of deltas) onChunk({ delta, done: false })
      onChunk({ delta: '', done: true })
      return { content: full, model: 'test' }
    },
  )
}

beforeEach(() => {
  providerState.chat.mockReset()
  providerState.streamChat.mockReset()
})

describe('AIService — hidden reasoning never reaches a caller', () => {
  it('strips <think> from a chat response', async () => {
    providerState.chat.mockResolvedValue({ content: '<think>secret</think>Hello', model: 'test' })
    const res = await service().chat([{ role: 'user', content: 'hi' }])
    expect(res.content).toBe('Hello')
  })

  it('leaves a response without <think> untouched', async () => {
    providerState.chat.mockResolvedValue({ content: '## Result\n\nHello', model: 'test' })
    const res = await service().chat([{ role: 'user', content: 'hi' }])
    expect(res.content).toBe('## Result\n\nHello')
  })

  it('filters streamed deltas across chunk boundaries', async () => {
    streamOf(['<thi', 'nk>reasoning</thi', 'nk>Answer'], '<think>reasoning</think>Answer')
    const deltas: string[] = []
    const res = await service().streamChat([{ role: 'user', content: 'hi' }], (d) => deltas.push(d))

    expect(deltas.join('')).toBe('Answer')
    expect(res.content).toBe('Answer')
  })

  it('emits nothing when the stream ends inside a think block', async () => {
    streamOf(['<think>', 'reasoning'], '<think>reasoning')
    const deltas: string[] = []
    const res = await service().streamChat([{ role: 'user', content: 'hi' }], (d) => deltas.push(d))

    expect(deltas.join('')).toBe('')
    expect(res.content).toBe('')
  })

  it('strips <think> before parsing JSON', async () => {
    providerState.chat.mockResolvedValue({
      content: '<think>hmm</think>{"ok":true}',
      model: 'test',
    })
    const { data } = await service().chatJSON<{ ok: boolean }>([{ role: 'user', content: 'hi' }])
    expect(data.ok).toBe(true)
  })

  it('strips <think> from a streamed JSON response', async () => {
    streamOf(['<think>hmm</think>{"ok":true}'], '<think>hmm</think>{"ok":true}')
    const { data } = await service().streamJSON<{ ok: boolean }>([{ role: 'user', content: 'hi' }])
    expect(data.ok).toBe(true)
  })
})

describe('Contextual Ask AI — answer never contains <think>', () => {
  it('returns only the user-facing answer', async () => {
    providerState.chat.mockResolvedValue({
      content: '<think>weigh the options</think>Here, \\(x \\in A\\) means membership.',
      model: 'test',
    })

    const answer = await new ContextualTutorService({ ai: service() }).ask({
      projectId: 'p1',
      topicId: 't1',
      selectedText: 'x \\in A',
      surroundingContext: 'context',
      question: 'What does this mean?',
      language: 'en',
    })

    expect(answer.answer).not.toContain('<think>')
    expect(answer.answer).toContain('means membership')
  })
})
