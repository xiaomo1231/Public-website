import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { ProjectService } from '@/services/projectService'
import { HomeworkService } from '@/services/homeworkService'
import { HomeworkRepository } from '@/entities/homework/repository'
import type { AIService } from '@/services/aiService'
import type { HomeworkQuestion, HomeworkSet } from '@/entities/homework/types'
import { OutputTruncatedError } from '@/infrastructure/ai/errors'
import {
  cleanProfessorAnswerText,
  isDeferredProfessorAnswer,
  professorAnswerDeferral,
} from '@/entities/homework/answerMatching'
import { answerSubparts, walkthroughSubparts } from '@/entities/homework/splitQuestion'
import { professorAnswerOf } from '@/entities/homework/walkthrough'
import { validateCompare } from '@/entities/homework/professorCompare'
import * as V3 from '@/infrastructure/ai/prompts/homework-question/v3'
import * as V4 from '@/infrastructure/ai/prompts/homework-question/v4'

// Synthetic fixtures modelled on real answer-key patterns (no copied text).

/** Lettered parts with an out-of-sequence "(l)" printed between (c) and (d). */
const LETTERED_PROMPT = [
  'Let U be the set of all (p, q, r) in R³ with p − 2q + r = 0.',
  '(a) Show that U is a subspace of R³.',
  'Consider u⃗₁ = (1, 0, −1),⃗ u₂ = (2, 1, 0),⃗ u₃ = (3, 1, −1).',
  '(b) Show that {u⃗₁,⃗u₂} is a basis of U.',
  '(c) Show that {u⃗₂,⃗u₃} is a basis of U.',
  '(l) Show that {u⃗₁,⃗u₂,⃗u₃} is not a basis of U.',
  '(d) Write u⃗₃ in the basis {u⃗₁,⃗u₂}.',
].join('\n')

/**
 * The key starts at (b) — no solution for (a) — uses inner "(a)/(b)" for two
 * ways inside (b), refers to a part "(g)" that does not exist, and carries a
 * running page header inside a solution.
 */
const LETTERED_ANSWER = [
  '(b) Show that {u⃗₁,⃗u₂} is a basis of U.',
  'Solution: u⃗₁ and ⃗u₂ are independent since neither is a multiple of the other.',
  'There are two ways to see that they span U:',
  '(a) U is cut out by one equation, so dim U = 3 − 1 = 2.',
  '(b) Directly: solving p = 2q − r gives (p, q, r) = q·u⃗₂ + (r − ...)·u⃗₁.',
  'Worksheet 3 7',
  '(c) Solution: Same as part (g), with u⃗₃ in place of u⃗₁.',
  '(l) Solution: Three vectors in a 2-dimensional space are dependent: u⃗₃ = u⃗₁ + u⃗₂.',
  '(d) Solution: u⃗₃ = 1·u⃗₁ + 1·u⃗₂, so the components are (1, 1).',
].join('\n')

/** Numbered sub-parts; the key leaves the first one to the student. */
const NUMBERED_PROMPT = [
  'Let T : R³ → R³ be T(a, b, c) = (b + c, a − c, a + b).',
  '1. Show that T is linear.',
  '2. Find the standard matrix of T.',
  '3. Find a basis of the range of T.',
].join('\n')

const PARTLY_DEFERRED_ANSWER = [
  'Solution: I leave the first part to you. The standard matrix is',
  'A =',
  '',
  '',
  '0 1 1',
  '1 0 −1',
  '1 1 0',
  '',
  '',
  'Worksheet 3 8',
  'Row reducing [A | y] gives the condition y1 + y2 − y3 = 0, so the range has',
  'basis ⃗w1 = (0, 1, 1) and ⃗w2 = (1, 0, 1).',
].join('\n')

describe('professor answer deferral', () => {
  it('tells a fully deferred answer from a partly deferred one', () => {
    expect(
      professorAnswerDeferral('Solution: This is similar to the last problem and is left to you.'),
    ).toBe('full')
    expect(professorAnswerDeferral('This part is left to you.')).toBe('full')
    expect(professorAnswerDeferral(PARTLY_DEFERRED_ANSWER)).toBe('partial')
    expect(
      professorAnswerDeferral('Solution: (a) is left as an exercise. (b) x = 2 and y = 3.'),
    ).toBe('partial')
    // Worked content besides the deferral is usable evidence.
    expect(
      professorAnswerDeferral(
        'Solution: Checking linearity is left for you. The matrix is A = [1 2; 3 4], det A = 4 − 6 = −2 ≠ 0.',
      ),
    ).toBe('partial')
    // Flattened diagram labels after a deferral are not worked content.
    expect(professorAnswerDeferral('Solution: Left to you. R1 R2 10 Ω 20 Ω 5 V')).toBe('full')
    expect(professorAnswerDeferral(LETTERED_ANSWER)).toBe('none')
    expect(isDeferredProfessorAnswer(PARTLY_DEFERRED_ANSWER)).toBe(false)
  })

  it('cleans page headers and detached vector arrows but keeps matrix rows', () => {
    const cleaned = cleanProfessorAnswerText(`${LETTERED_ANSWER}\n${PARTLY_DEFERRED_ANSWER}`)
    expect(cleaned).not.toMatch(/Worksheet 3 [78]/)
    expect(cleaned).not.toContain('⃗')
    expect(cleaned).toContain('vec(u)₁ and vec(u)₂ are independent')
    expect(cleaned).toContain('{vec(u)₁,vec(u)₂}')
    expect(cleaned).toContain('0 1 1\n1 0 −1\n1 1 0')
    expect(cleaned).not.toMatch(/\n{3,}/)
  })

  it('splits lettered parts out of sequence and numbered parts', () => {
    expect(answerSubparts(LETTERED_PROMPT).map((part) => part.label)).toEqual([
      'a',
      'b',
      'c',
      'l',
      'd',
    ])
    expect(answerSubparts(NUMBERED_PROMPT).map((part) => part.label)).toEqual(['1', '2', '3'])
    expect(answerSubparts('Find x when 2x = 4.')).toEqual([])
  })

  it('walkthrough and comparison use the same deferral rule and accept these labels', () => {
    const base = {
      id: 'q',
      prompt: LETTERED_PROMPT,
      answerStatus: 'matched',
    } as unknown as HomeworkQuestion
    expect(professorAnswerOf({ ...base, answerText: PARTLY_DEFERRED_ANSWER })).toBe(
      PARTLY_DEFERRED_ANSWER,
    )
    expect(
      professorAnswerOf({ ...base, answerText: 'Solution: This is left to you.' }),
    ).toBeUndefined()
    const compared = validateCompare(
      {
        items: [
          { label: '(a)', status: 'not_in_professor', note: '' },
          { label: '(l)', status: 'same', note: '' },
          { label: '(c)', status: 'same', note: 'typo: part (g) means (b)' },
        ],
        recommendation: 'keep',
        suggestion: '',
      },
      {
        questionParts: walkthroughSubparts(LETTERED_PROMPT).map((part) => part.label),
        professorAnswer: LETTERED_ANSWER,
      },
    )
    expect(compared?.items.map((item) => item.label)).toEqual(['a', 'c', 'l'])
    expect(compared?.droppedLabels).toBe(0)
  })

  it('v4 prompts are byte-identical to v3 without a professor answer', () => {
    for (const mode of ['combined', 'hints', 'solution'] as const) {
      expect(V4.buildSystemPrompt(mode, false, false)).toBe(
        V3.buildSystemPrompt(mode, false, false),
      )
      expect(V4.buildSystemPrompt(mode, true, false)).toBe(V3.buildSystemPrompt(mode, true, false))
    }
    const input = { question: 'Q', sourceText: 'S', language: 'zh' as const }
    expect(V4.buildUserPrompt(input)).toBe(V3.buildUserPrompt(input))
    expect(V4.buildUserPrompt({ ...input, professorAnswer: 'A' })).toBe(
      V3.buildUserPrompt({ ...input, professorAnswer: 'A' }),
    )
    const system = V4.buildSystemPrompt('combined', false, true)
    expect(system).toContain('map its content to the sub-parts of the question by meaning')
    expect(system).toContain('教授答案未给出此小题的解答')
    expect(system).not.toContain("If the professor's answer is incomplete")
  })
})

describe('HomeworkService — professor answers with partial / misaligned sub-parts', () => {
  let db: AppDatabase
  let repo: HomeworkRepository
  let projectId: string

  beforeEach(async () => {
    db = new AppDatabase()
    setDbForTesting(db)
    projectId = (await new ProjectService(db).create({ name: 'Linear', subject: 'linear_algebra' }))
      .id
    repo = new HomeworkRepository(db)
    const set: HomeworkSet = {
      id: 's',
      projectId,
      documentId: 'd',
      documentName: 'hw.pdf',
      title: 'hw',
      status: 'ready',
      language: 'en',
      questionCount: 1,
      promptVersion: 'v1',
      createdAt: 1,
      updatedAt: 1,
    }
    await repo.upsertSet(set)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  async function addQuestion(prompt: string, answerText: string): Promise<void> {
    await repo.upsertQuestion({
      id: 'q',
      projectId,
      setId: 's',
      documentId: 'd',
      documentName: 'hw.pdf',
      order: 0,
      number: '2',
      prompt,
      sourceRefs: [],
      hints: ['old hint'],
      solution: 'old solution',
      generationStatus: 'ready',
      promptVersion: 'v1',
      draftText: 'my draft',
      revealedHints: 0,
      solutionRevealed: false,
      messages: [],
      createdAt: 1,
      updatedAt: 1,
      answerText,
      answerStatus: 'matched',
    })
  }

  type Messages = Array<{ content: string }>
  function fakeAI(
    reply: (
      system: string,
      user: string,
      options: { maxTokens?: number; signal?: AbortSignal },
    ) => unknown,
  ) {
    const streamJSON = vi.fn(
      async (
        messages: Messages,
        _onDelta?: unknown,
        options: { maxTokens?: number; signal?: AbortSignal } = {},
      ) => ({
        data: await reply(messages[0]!.content, messages[1]!.content, options),
        raw: {},
      }),
    )
    return {
      streamJSON,
      ai: { streamJSON, maxOutputTokens: 4096 } as unknown as AIService,
    }
  }
  const partOf = (user: string) => /SUB-PART \(([^)]+)\)/.exec(user)?.[1]

  it('generates a partly deferred answer, labelling the parts the professor left out', async () => {
    await addQuestion(NUMBERED_PROMPT, PARTLY_DEFERRED_ANSWER)
    const { ai, streamJSON } = fakeAI(() => ({
      hints: ['Check additivity first.', 'Row reduce the augmented matrix.'],
      solution:
        '1. 教授答案未给出此小题的解答，以下为讲解。T(u+v) = T(u) + T(v) …\n2. $A=\\begin{pmatrix}0&1&1\\\\1&0&-1\\\\1&1&0\\end{pmatrix}$\n3. …',
    }))
    const result = await new HomeworkService({ ai, db }).generateAnswerContent('s', ['q'])
    expect(result).toMatchObject({ generated: 1, failed: 0, skipped: 0, failures: [] })
    const saved = (await repo.getQuestion('q'))!
    expect(saved.answerBased).toBe(true)
    expect(saved.solution).toContain('教授答案未给出此小题的解答')
    expect(saved.draftText).toBe('my draft')
    const [messages] = streamJSON.mock.calls[0]!
    const user = messages[1]!.content
    expect(user).toContain('leaves part of this question to the student')
    // Extraction artifacts are cleaned before sending.
    expect(user).not.toContain('Worksheet 3 8')
    expect(user).not.toContain('⃗')
    expect(user).toContain('vec(w)1 = (0, 1, 1)')
    // The full professor answer is still stored unchanged.
    expect(saved.answerText).toBe(PARTLY_DEFERRED_ANSWER)
  })

  it('splits a long answer per sub-part when cut at the output cap (missing (a), inner ways, extra (l), typo)', async () => {
    await addQuestion(LETTERED_PROMPT, LETTERED_ANSWER)
    const { ai, streamJSON } = fakeAI((_system, user, options) => {
      const part = partOf(user)
      if (!part) throw new OutputTruncatedError(options.maxTokens, { limit: 4096, by: 'setting' })
      return { hints: [`Idea for ${part}`], solution: `Worked ${part}` }
    })
    const result = await new HomeworkService({ ai, db }).generateAnswerContent('s', ['q'])
    expect(result).toMatchObject({ generated: 1, failed: 0 })
    const calls = streamJSON.mock.calls.map(([messages]) => messages[1]!.content)
    // One whole-question request (no compact rewrite at the cap), then one per part.
    expect(calls.filter((user) => !partOf(user))).toHaveLength(1)
    expect(calls.map(partOf).filter(Boolean)).toEqual(['a', 'b', 'c', 'l', 'd'])
    // Every part request carries the whole (cleaned) professor answer.
    for (const user of calls.filter((user) => partOf(user))) {
      expect(user).toContain('(l) Solution: Three vectors')
      expect(user).toContain('Same as part (g)')
      expect(user).not.toContain('Worksheet 3 7')
    }
    const saved = (await repo.getQuestion('q'))!
    expect(saved.solution).toMatch(
      /### \(a\)\n\nWorked a[\s\S]*### \(l\)\n\nWorked l[\s\S]*### \(d\)/,
    )
    expect(saved.hints.join('\n')).toContain('(l) Idea for l')
  })

  it('stores a specific reason naming the failed sub-part and keeps the previous help', async () => {
    await addQuestion(LETTERED_PROMPT, LETTERED_ANSWER)
    const { ai } = fakeAI((system, user, options) => {
      const part = partOf(user)
      if (!part) throw new OutputTruncatedError(options.maxTokens, { limit: 4096, by: 'setting' })
      if (part !== 'c') return { hints: ['h'], solution: 's' }
      // (c): the model never returns a solution.
      return system.includes('one field: {"hints"') ? { hints: ['h'] } : { hints: ['h'] }
    })
    const result = await new HomeworkService({ ai, db }).generateAnswerContent('s', ['q'])
    expect(result).toMatchObject({ generated: 0, failed: 1 })
    const saved = (await repo.getQuestion('q'))!
    expect(saved.generationStatus).toBe('failed')
    expect(saved.generationError).toMatch(/^Part \(c\): .*no worked solution/)
    expect(result.failures).toEqual([
      { questionId: 'q', number: '2', reason: saved.generationError },
    ])
    expect(saved.hints).toEqual(['old hint'])
    expect(saved.solution).toBe('old solution')
    expect(saved.draftText).toBe('my draft')
  })

  it('falls back to sub-parts when the whole reply outlasts the deadline', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    await addQuestion(LETTERED_PROMPT, LETTERED_ANSWER)
    let wholeAborted = false
    const { ai } = fakeAI((_system, user, options) => {
      const part = partOf(user)
      if (part) return { hints: [`h${part}`], solution: `s${part}` }
      // A whole-question reply that is still streaming after six minutes.
      return new Promise((_resolve, reject) => {
        options.signal?.addEventListener('abort', () => {
          wholeAborted = true
          reject(new DOMException('aborted', 'AbortError'))
        })
      })
    })
    let done = false
    const run = new HomeworkService({ ai, db }).generateAnswerContent('s', ['q']).finally(() => {
      done = true
    })
    while (!done) await vi.advanceTimersByTimeAsync(30_000)
    expect(await run).toMatchObject({ generated: 1, failed: 0 })
    expect(wholeAborted).toBe(true)
    expect((await repo.getQuestion('q'))!.solution).toContain('### (l)')
  })

  it('still skips a fully deferred answer without calling the AI', async () => {
    await addQuestion(NUMBERED_PROMPT, 'Solution: This problem is left to you.')
    const { ai, streamJSON } = fakeAI(() => ({ hints: ['x'], solution: 'y' }))
    const result = await new HomeworkService({ ai, db }).generateAnswerContent('s', ['q'])
    expect(result).toMatchObject({ generated: 0, failed: 0, skipped: 1 })
    expect(streamJSON).not.toHaveBeenCalled()
  })
})
