import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { HomeworkRepository } from '@/entities/homework/repository'
import type { HomeworkQuestion } from '@/entities/homework/types'
import {
  checkTranslation,
  currentTranslation,
  isMainlyChinese,
  joinTranslationBlocks,
  splitTranslationBlocks,
  subpartLabelsOf,
  translationSourceHash,
} from '@/entities/homework/questionTranslation'
import { prompts } from '@/infrastructure/ai/prompts'
import { QuestionTranslationService } from '@/services/questionTranslationService'
import type { AIService } from '@/services/aiService'
import { friendlyAIError } from '@/shared/lib/aiErrors'

const PROMPT = [
  'Let $A = \\begin{bmatrix} 1 & 2 \\\\ 3 & 4 \\end{bmatrix}$ and $\\vec{v}_1 = (1, 0)$.',
  '(a) Find the reduced row echelon form of $A$.',
  '(b) Is $\\vec{v}_1$ in the span of the columns? Use 2 decimal places.',
].join('\n')

const FAITHFUL = [
  '设 $A = \\begin{bmatrix} 1 & 2 \\\\ 3 & 4 \\end{bmatrix}$，$\\vec{v}_1 = (1, 0)$。',
  '(a) 求 $A$ 的行最简形（reduced row echelon form）。',
  '(b) $\\vec{v}_1$ 是否在列向量的张成（span）中？保留 2 位小数。',
].join('\n')

/** Problem 2 of a linear-algebra set: a stem and six sub-parts, (l) included. */
const LONG_BLOCKS = [
  {
    source: String.raw`Consider the real vector space $\mathbb{R}^4$, and let $W$ be the subset of $\mathbb{R}^4$ consisting of all 4-tuples $(x, y, z, w)$ of real numbers for which
$$W = \{(x, y, z, w) \in \mathbb{R}^4 \mid x + y + z - w = 0 \text{ and } y - z = 0\}.$$`,
    zh: String.raw`考虑实向量空间（real vector space）$\mathbb{R}^4$，设 $W$ 为 $\mathbb{R}^4$ 中满足下式的所有实数 4 元组 $(x, y, z, w)$ 构成的子集：
$$W = \{(x, y, z, w) \in \mathbb{R}^4 \mid x + y + z - w = 0 \text{ and } y - z = 0\}.$$`,
  },
  {
    source: String.raw`(a) Show that $W$ is a vector subspace of $\mathbb{R}^4$. Consider now the vectors $v_1 = (1, 0, 0, 1)$, $v_2 = (0, 1, 1, 2)$, $v_3 = (1, 1, 1, 3)$, $v_4 = (1, -1, -1, -1)$ in $W$.`,
    zh: String.raw`(a) 证明 $W$ 是 $\mathbb{R}^4$ 的向量子空间（vector subspace）。现在考虑 $W$ 中的向量 $v_1 = (1, 0, 0, 1)$、$v_2 = (0, 1, 1, 2)$、$v_3 = (1, 1, 1, 3)$、$v_4 = (1, -1, -1, -1)$。`,
  },
  {
    source: String.raw`(b) Show that $B_1 = \{v_1, v_2\}$ is a basis of $W$.`,
    zh: String.raw`(b) 证明 $B_1 = \{v_1, v_2\}$ 是 $W$ 的一组基（basis）。`,
  },
  {
    source: String.raw`(c) Show that $B_2 = \{v_1, v_3\}$ is a basis of $W$.`,
    zh: String.raw`(c) 证明 $B_2 = \{v_1, v_3\}$ 是 $W$ 的一组基。`,
  },
  {
    source: String.raw`(d) Show that $B_3 = \{v_3, v_1\}$ is a basis of $W$.`,
    zh: String.raw`(d) 证明 $B_3 = \{v_3, v_1\}$ 是 $W$ 的一组基。`,
  },
  {
    source: String.raw`(l) Show that $\{v_1, v_2, v_4\}$ is not a basis of $W$.`,
    zh: String.raw`(l) 证明 $\{v_1, v_2, v_4\}$ 不是 $W$ 的一组基。`,
  },
  {
    source: String.raw`(e) Compute the components of the vector $v_4$ in the basis $B_1 = \{v_1, v_2\}$.`,
    zh: String.raw`(e) 求向量 $v_4$ 在基 $B_1 = \{v_1, v_2\}$ 下的分量（components）。`,
  },
]
const LONG = LONG_BLOCKS.map((b) => b.source).join('\n')

describe('question-translate/v2', () => {
  it('asks for a faithful plain-text translation with formulas, labels and numbers kept', () => {
    const system = prompts.questionTranslate.buildSystemPrompt()
    expect(prompts.questionTranslate.VERSION).toBe('v2')
    expect(system).toMatch(/sentence by sentence/)
    expect(system).toMatch(/Do not summarise/)
    expect(system).toMatch(/\(a\), \(b\)/)
    expect(system).toMatch(/English term in parentheses on its first occurrence/)
    expect(system).toMatch(/this is not JSON/)
    expect(system).not.toContain('{"translation"')
    const user = prompts.questionTranslate.buildUserPrompt({ question: PROMPT })
    expect(user).toContain(PROMPT)
    expect(user).toContain('QUESTION')
    expect(user).not.toMatch(/part \d+ of/)
    expect(
      prompts.questionTranslate.buildUserPrompt({ question: PROMPT, part: { index: 2, total: 3 } }),
    ).toMatch(/part 2 of 3/)
  })

  it('reads the text between the markers, single backslashes intact', () => {
    const read = prompts.questionTranslate.readTranslation
    expect(read('<<<TRANSLATION\n设 $\\vec{v}_1$。\nTRANSLATION>>>')).toBe('设 $\\vec{v}_1$。')
    expect(read('<<<TRANSLATION\n未写完的')).toBe('未写完的')
    expect(read('{"translation":"  译文 "}')).toBe('译文')
    expect(read('  译文 ')).toBe('译文')
    expect(read('<<<TRANSLATION\nTRANSLATION>>>')).toBeNull()
  })
})

describe('checking a translation', () => {
  it('accepts a faithful translation', () => {
    expect(checkTranslation(PROMPT, FAITHFUL)).toMatchObject({ ok: true })
  })

  it('rejects a changed formula, a lost sub-part label or a changed number', () => {
    const formula = checkTranslation(PROMPT, FAITHFUL.replace('3 & 4', '3 & 5'))
    expect(formula.ok).toBe(false)
    expect(formula.missingFormulas).toHaveLength(1)
    const label = checkTranslation(PROMPT, FAITHFUL.replace('(b) ', ''))
    expect(label).toMatchObject({ ok: false, missingLabels: ['(b)'] })
    const number = checkTranslation(PROMPT, FAITHFUL.replace('保留 2 位', '保留两位'))
    expect(number).toMatchObject({ ok: false, missingNumbers: ['2'] })
    // Full-width parentheses read as the same label.
    expect(checkTranslation(PROMPT, FAITHFUL.replace('(a)', '（a）')).ok).toBe(true)
  })

  it('reads sub-part labels outside formulas only, and spots Chinese questions', () => {
    expect(subpartLabelsOf('f(x) = 1. (a) one (iv) four $(b)$')).toEqual(['(a)', '(iv)'])
    expect(isMainlyChinese('求矩阵 $A$ 的秩，并说明理由。')).toBe(true)
    expect(isMainlyChinese(PROMPT)).toBe(false)
  })
})

describe('translating and caching', () => {
  let db: AppDatabase
  afterEach(() => db?.close())

  async function setup(prompt = PROMPT): Promise<HomeworkRepository> {
    db = new AppDatabase()
    setDbForTesting(db)
    const repo = new HomeworkRepository(db)
    const question: HomeworkQuestion = {
      id: 'q1',
      projectId: 'p1',
      setId: 's1',
      documentId: 'd1',
      documentName: 'hw.pdf',
      order: 0,
      prompt,
      sourceRefs: [],
      hints: [],
      generationStatus: 'ready',
      promptVersion: 'v1',
      draftText: '',
      revealedHints: 0,
      solutionRevealed: false,
      messages: [],
      createdAt: 1,
      updatedAt: 1,
    }
    await repo.upsertQuestion(question)
    return repo
  }

  type Reply = { content: string; finishReason?: string }
  const wrap = (text: string): string => `<<<TRANSLATION\n${text}\nTRANSLATION>>>`

  function stubAI(
    reply: (user: string, maxTokens: number | undefined) => Reply,
    extra: Record<string, unknown> = {},
  ) {
    const chat = vi.fn(
      async (messages: { content: string }[], options: { maxTokens?: number } = {}) =>
        reply(messages[1]!.content, options.maxTokens),
    )
    return {
      chat,
      ai: { chat, maxOutputTokens: 8192, ...extra } as unknown as AIService,
    }
  }

  it('caches the translation until the question text changes', async () => {
    const repo = await setup()
    const { ai, chat } = stubAI(() => ({ content: wrap(FAITHFUL), finishReason: 'stop' }))
    const service = new QuestionTranslationService({ ai, db })
    const first = await service.translate('q1')
    expect(first).toMatchObject({
      language: 'zh',
      text: FAITHFUL,
      promptVersion: 'question-translate/v2',
    })
    expect(first.sourceHash).toBe(translationSourceHash(PROMPT))
    expect((await repo.getQuestion('q1'))!.translation?.text).toBe(FAITHFUL)
    await service.translate('q1')
    expect(chat).toHaveBeenCalledTimes(1)

    await repo.updateQuestion('q1', { prompt: `${PROMPT}\n(c) One more part.` })
    const changed = (await repo.getQuestion('q1'))!
    expect(currentTranslation(changed)).toBeUndefined()
    await expect(service.translate('q1')).rejects.toMatchObject({ code: 'TRANSLATION_CHANGED' })
    expect(chat).toHaveBeenCalledTimes(2)
  })

  it('does not save a translation that changed the question', async () => {
    const repo = await setup()
    const { ai } = stubAI(() => ({ content: wrap(FAITHFUL.replace('(a) ', '')) }))
    await expect(new QuestionTranslationService({ ai, db }).translate('q1')).rejects.toMatchObject({
      code: 'TRANSLATION_CHANGED',
    })
    expect((await repo.getQuestion('q1'))!.translation).toBeUndefined()
  })

  it('never asks the same request again with a larger budget when the reply is cut off', async () => {
    await setup('Compute $x^2$ for $x = 3$ and explain each step.')
    const budgets: Array<number | undefined> = []
    const { ai } = stubAI((_user, maxTokens) => {
      budgets.push(maxTokens)
      return { content: '<<<TRANSLATION\n设', finishReason: 'length' }
    })
    const err = await new QuestionTranslationService({ ai, db }).translate('q1').catch((e) => e)
    expect(err).toMatchObject({ code: 'TRANSLATION_TRUNCATED' })
    // One request at the cap (AIService sends it; no per-call budget), no retry.
    expect(budgets).toEqual([undefined])
    expect(friendlyAIError(err)).toMatch(/8192/)
  })

  it('translates the stem and each sub-part separately when still cut off, then checks the joined text', async () => {
    const repo = await setup(LONG)
    const users: string[] = []
    const { ai } = stubAI((user) => {
      users.push(user)
      const block = LONG_BLOCKS.find((b) => user.includes(b.source))
      // The whole question never fits; each block does.
      if (!block || /part \d+ of/.test(user) === false)
        return { content: '<<<TRANSLATION\n考虑', finishReason: 'length' }
      return { content: wrap(block.zh), finishReason: 'stop' }
    })
    const result = await new QuestionTranslationService({ ai, db }).translate('q1')
    // Whole (once, at the cap), then 7 blocks: stem + (a)(b)(c)(d)(l)(e).
    expect(users).toHaveLength(1 + LONG_BLOCKS.length)
    expect(users.filter((u) => /part \d+ of 7/.test(u))).toHaveLength(7)
    expect(result.text).toBe(LONG_BLOCKS.map((b) => b.zh).join('\n'))
    expect(checkTranslation(LONG, result.text).ok).toBe(true)
    expect((await repo.getQuestion('q1'))!.translation?.text).toBe(result.text)
  })

  it('discards joined blocks that lost a label', async () => {
    await setup(LONG)
    const { ai } = stubAI((user) => {
      const block = LONG_BLOCKS.find((b) => user.includes(b.source))
      if (!block || !/part \d+ of/.test(user))
        return { content: '<<<TRANSLATION\n考虑', finishReason: 'length' }
      return { content: wrap(block.zh.replace('(l) ', '')), finishReason: 'stop' }
    })
    await expect(new QuestionTranslationService({ ai, db }).translate('q1')).rejects.toMatchObject({
      code: 'TRANSLATION_CHANGED',
    })
  })

  it('falls back to the main model when the light model is cut off', async () => {
    await setup()
    const light = stubAI(() => ({ content: '<<<TRANSLATION\n设', finishReason: 'length' }), {
      maxOutputTokens: 4096,
    })
    const main = stubAI(() => ({ content: wrap(FAITHFUL), finishReason: 'stop' }), {
      light: () => light.ai,
    })
    const result = await new QuestionTranslationService({ ai: main.ai, db }).translate('q1')
    expect(result.text).toBe(FAITHFUL)
    // Cut off at the light model's cap: no larger retry; its blocks are cut
    // off too, so the main model translates the question.
    expect(light.chat.mock.calls[0]![1]?.maxTokens).toBeUndefined()
    expect(main.chat).toHaveBeenCalledTimes(1)
  })

  it('reports a cut-off translation in its own words', async () => {
    await setup()
    const { ai } = stubAI(() => ({ content: '<<<TRANSLATION\n设', finishReason: 'length' }), {
      maxOutputTokens: 4096,
      modelMaxOutputTokens: 4096,
    })
    const err = await new QuestionTranslationService({ ai, db }).translate('q1').catch((e) => e)
    expect(err).toMatchObject({ code: 'TRANSLATION_TRUNCATED' })
    expect(friendlyAIError(err)).toMatch(/cut off while translating this question.*4096 tokens/)
    expect(friendlyAIError(err)).toMatch(/longer output/)
  })
})

describe('translation blocks', () => {
  it('splits at sub-part lines (not inside formulas) and joins in the original layout', () => {
    const blocks = splitTranslationBlocks(LONG)
    expect(blocks.map((b) => b.text)).toEqual(LONG_BLOCKS.map((b) => b.source))
    expect(
      joinTranslationBlocks(
        blocks,
        blocks.map((b) => b.text),
      ),
    ).toBe(LONG)
    expect(splitTranslationBlocks('$$\n(a) x\n(b) y\n$$')).toHaveLength(1)
    expect(splitTranslationBlocks('Only a stem (a) inline.')).toHaveLength(1)
  })
})
