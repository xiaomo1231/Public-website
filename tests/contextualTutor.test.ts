import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { ContextualTutorService, type ContextualTutorInput } from '@/services/contextualTutorService'
import { prompts } from '@/infrastructure/ai/prompts'
import type { AIService } from '@/services/aiService'

function stubAI(content = 'Here, \\(x \\in A\\) means that x is an element of the set A.') {
  const chat = vi.fn().mockResolvedValue({ content, model: 'fake' })
  return { chat, ai: { chat, currentProvider: { id: 'fake' } } as unknown as AIService }
}

function input(overrides: Partial<ContextualTutorInput> = {}): ContextualTutorInput {
  return {
    projectId: 'p1',
    topicId: 't1',
    topicTitle: 'Sets',
    sectionHeading: 'Element Notation',
    selectedText: 'x \\in A',
    surroundingContext: 'If an object x belongs to a set A, we write \\(x \\in A\\).',
    question: 'What does this mean?',
    language: 'en',
    ...overrides,
  }
}

describe('ContextualTutorService', () => {
  let db: AppDatabase

  beforeEach(() => {
    db = new AppDatabase()
    setDbForTesting(db)
  })

  it('answers a question about the selected passage', async () => {
    const { ai, chat } = stubAI()
    const answer = await new ContextualTutorService({ ai }).ask(input())

    expect(chat).toHaveBeenCalledTimes(1)
    expect(answer.answer).toContain('x \\in A')
    expect(answer.question).toBe('What does this mean?')
  })

  it('sends the selected passage, section and question to the model', async () => {
    const { ai, chat } = stubAI()
    await new ContextualTutorService({ ai }).ask(input())

    const messages = chat.mock.calls[0]![0] as Array<{ role: string; content: string }>
    const userPrompt = messages.find((m) => m.role === 'user')!.content

    expect(userPrompt).toContain('x \\in A')
    expect(userPrompt).toContain('Element Notation')
    expect(userPrompt).toContain('What does this mean?')
    expect(userPrompt).toContain('SELECTED PASSAGE')
  })

  it('coalesces two identical concurrent questions into one request', async () => {
    const { ai, chat } = stubAI()
    const service = new ContextualTutorService({ ai })

    const [a, b] = await Promise.all([service.ask(input()), service.ask(input())])

    expect(chat).toHaveBeenCalledTimes(1)
    expect(a.answer).toBe(b.answer)
  })

  it('does not coalesce different questions', async () => {
    const { ai, chat } = stubAI()
    const service = new ContextualTutorService({ ai })

    await service.ask(input({ question: 'First?' }))
    await service.ask(input({ question: 'Second?' }))

    expect(chat).toHaveBeenCalledTimes(2)
  })

  it('canonicalises maths in the answer', async () => {
    const { ai } = stubAI('The union \uF0C8 is the set of all elements.')
    const answer = await new ContextualTutorService({ ai }).ask(input())

    expect(answer.answer).not.toMatch(/[\uE000-\uF8FF]/)
    expect(answer.answer).toContain('\\cup')
  })

  it('rejects an empty answer instead of showing nothing', async () => {
    const { ai } = stubAI('   ')
    await expect(new ContextualTutorService({ ai }).ask(input())).rejects.toMatchObject({
      code: 'EMPTY_CONTEXTUAL_ANSWER',
    })
  })

  it('persists nothing — not to the lesson cache, not to translation history', async () => {
    const { ai } = stubAI()
    await new ContextualTutorService({ ai }).ask(input())

    expect(await db.table('tutorLessons').count()).toBe(0)
    expect(await db.table('translations').count()).toBe(0)
  })
})

describe('contextual tutor prompt contract', () => {
  it('forbids regenerating the lesson and requires LaTeX', () => {
    const prompt = prompts.contextualTutor.buildSystemPrompt()
    expect(prompt).toMatch(/Do not regenerate the lesson/i)
    expect(prompt).toMatch(/Do not modify the lesson/i)
    expect(prompt).toMatch(/Do not translate unless/i)
    expect(prompt).toMatch(/LaTeX/)
    expect(prompt).toMatch(/Do not invent source citations/i)
  })
})
