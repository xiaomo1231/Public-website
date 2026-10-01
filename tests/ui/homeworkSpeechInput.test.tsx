import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HomeworkQuestionView } from '@/widgets/homework/HomeworkQuestionView'
import type { HomeworkQuestion } from '@/entities/homework/types'
import type { HomeworkService } from '@/services/homeworkService'
import { appendSpeechText } from '@/features/homework/useSpeechInput'
import { resetUILanguageForTesting, setUILanguage } from '@/i18n'

const question: HomeworkQuestion = {
  id: 'q1', projectId: 'p1', setId: 's1', documentId: 'd1', documentName: 'hw.txt',
  order: 0, number: '1', prompt: 'Solve the equation.', sourceRefs: [],
  hints: [], solution: '', generationStatus: 'ready', promptVersion: 'v1',
  draftText: 'saved working', revealedHints: 0, solutionRevealed: false,
  messages: [], createdAt: 1, updatedAt: 1,
}

class FakeRecognition {
  static instances: FakeRecognition[] = []
  lang = ''
  continuous = false
  interimResults = false
  onstart: (() => void) | null = null
  onresult: ((event: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null = null
  onerror: ((event: { error: string }) => void) | null = null
  onend: (() => void) | null = null
  start = vi.fn(() => { this.onstart?.() })
  stop = vi.fn()
  abort = vi.fn()

  constructor() { FakeRecognition.instances.push(this) }

  result(index: number, transcript: string, isFinal = true): void {
    const results = Array.from({ length: index + 1 }, (_, i) => ({
      isFinal: i === index ? isFinal : true,
      0: { transcript: i === index ? transcript : 'earlier' },
    }))
    this.onresult?.({ resultIndex: index, results })
  }
}

function stubService(): HomeworkService {
  return {
    loadQuestionSourcePages: vi.fn(async () => []),
    resolveQuestionSources: vi.fn(async () => []),
    ask: vi.fn(async () => ({ id: 'a1', role: 'assistant', content: 'Try this step.', createdAt: 2 })),
  } as unknown as HomeworkService
}

beforeEach(() => {
  FakeRecognition.instances = []
  Object.defineProperty(window, 'webkitSpeechRecognition', { configurable: true, value: FakeRecognition })
})

afterEach(() => {
  delete (window as Window & { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition
  resetUILanguageForTesting()
})

describe('homework speech input', () => {
  it('keeps punctuation and existing text when appending transcription', () => {
    expect(appendSpeechText('How do I', 'start?')).toBe('How do I start?')
    expect(appendSpeechText('请解释', '，为什么')).toBe('请解释，为什么')
    expect(appendSpeechText('请解释', '为什么')).toBe('请解释为什么')
    expect(appendSpeechText('Hello ', 'there')).toBe('Hello there')
  })

  it('adds final segments once, retains manual edits, and sends only after stopping', async () => {
    const user = userEvent.setup()
    const service = stubService()
    render(<HomeworkQuestionView question={question} service={service} />)
    const input = screen.getByLabelText('Ask about this question')
    await user.type(input, 'Please explain')
    await user.click(screen.getByRole('button', { name: 'Speak question' }))
    const recognition = FakeRecognition.instances[0]!
    expect(recognition.lang).toBe('en-US')
    expect(recognition.continuous).toBe(true)
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
    act(() => recognition.result(0, 'interim words', false))
    expect(input).toHaveValue('Please explain')
    act(() => {
      recognition.result(0, 'step one')
      recognition.result(0, 'step one')
    })
    expect(input).toHaveValue('Please explain step one')
    await user.type(input, ' carefully')
    act(() => recognition.result(1, 'and step two'))
    expect(input).toHaveValue('Please explain step one carefully and step two')
    expect(service.ask).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Stop listening' }))
    expect(recognition.stop).toHaveBeenCalledOnce()
    act(() => recognition.onend?.())
    await user.click(screen.getByRole('button', { name: 'Send' }))
    expect(service.ask).toHaveBeenCalledWith('q1', 'Please explain step one carefully and step two')
    expect(screen.getByLabelText('Your working')).toHaveValue('saved working')
  })

  it('uses the chosen language and drops late results when changing question', async () => {
    const user = userEvent.setup()
    setUILanguage('zh-CN')
    const service = stubService()
    const { rerender } = render(<HomeworkQuestionView key="q1" question={question} service={service} />)
    await user.click(screen.getByRole('button', { name: '语音提问' }))
    const first = FakeRecognition.instances[0]!
    expect(first.lang).toBe('zh-CN')
    const lateResult = first.onresult
    rerender(<HomeworkQuestionView key="q2" question={{ ...question, id: 'q2' }} service={service} />)
    expect(first.abort).toHaveBeenCalledOnce()
    lateResult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: 'old question' } }] })
    expect(screen.getByLabelText('就该题提问')).toHaveValue('')
    await user.selectOptions(screen.getByLabelText('语音识别语言'), 'en-US')
    await user.click(screen.getByRole('button', { name: '语音提问' }))
    expect(FakeRecognition.instances[1]?.lang).toBe('en-US')
  })

  it('explains permission failure and remains usable for typing', async () => {
    const user = userEvent.setup()
    render(<HomeworkQuestionView question={question} service={stubService()} />)
    await user.click(screen.getByRole('button', { name: 'Speak question' }))
    const recognition = FakeRecognition.instances[0]!
    act(() => {
      recognition.onerror?.({ error: 'not-allowed' })
      recognition.onend?.()
    })
    expect(await screen.findByRole('status')).toHaveTextContent('Microphone access was denied')
    expect(screen.getByRole('button', { name: 'Speak question' })).toBeEnabled()
    await user.type(screen.getByLabelText('Ask about this question'), 'I can still type')
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled()
  })

  it('preserves typing when speech recognition is unavailable', async () => {
    delete (window as Window & { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition
    render(<HomeworkQuestionView question={question} service={stubService()} />)
    expect(screen.getByText(/Voice input is not available/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Speak question' })).toBeDisabled()
    await userEvent.setup().type(screen.getByLabelText('Ask about this question'), 'Typed instead')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled())
  })
})
