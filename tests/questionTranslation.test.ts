import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { HomeworkRepository } from '@/entities/homework/repository'
import type { HomeworkQuestion } from '@/entities/homework/types'
import {
  checkTranslation,
  currentTranslation,
  isMainlyChinese,
  subpartLabelsOf,
  translationSourceHash,
} from '@/entities/homework/questionTranslation'
import { prompts } from '@/infrastructure/ai/prompts'
import { QuestionTranslationService } from '@/services/questionTranslationService'
import type { AIService } from '@/services/aiService'

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

describe('question-translate/v1', () => {
  it('asks for a faithful translation with formulas, labels and numbers kept', () => {
    const system = prompts.questionTranslate.buildSystemPrompt()
    expect(system).toMatch(/sentence by sentence/)
    expect(system).toMatch(/Do not summarise/)
    expect(system).toMatch(/\(a\), \(b\)/)
    expect(system).toMatch(/English term in parentheses on its first occurrence/)
    expect(system).toContain('{"translation"')
    const user = prompts.questionTranslate.buildUserPrompt({ question: PROMPT })
    expect(user).toContain(PROMPT)
    expect(user).toContain('QUESTION')
    expect(prompts.questionTranslate.readTranslation({ translation: '  译文 ' })).toBe('译文')
    expect(prompts.questionTranslate.readTranslation({})).toBeNull()
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

  async function setup(): Promise<HomeworkRepository> {
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
      prompt: PROMPT,
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

  function stubAI(reply: () => unknown) {
    const streamJSON = vi.fn(async () => ({ data: reply(), raw: {} }))
    return { streamJSON, ai: { streamJSON, maxOutputTokens: 8192 } as unknown as AIService }
  }

  it('caches the translation until the question text changes', async () => {
    const repo = await setup()
    const { ai, streamJSON } = stubAI(() => ({ translation: FAITHFUL }))
    const service = new QuestionTranslationService({ ai, db })
    const first = await service.translate('q1')
    expect(first).toMatchObject({ language: 'zh', text: FAITHFUL })
    expect(first.sourceHash).toBe(translationSourceHash(PROMPT))
    expect((await repo.getQuestion('q1'))!.translation?.text).toBe(FAITHFUL)
    await service.translate('q1')
    expect(streamJSON).toHaveBeenCalledTimes(1)

    await repo.updateQuestion('q1', { prompt: `${PROMPT}\n(c) One more part.` })
    const changed = (await repo.getQuestion('q1'))!
    expect(currentTranslation(changed)).toBeUndefined()
    await expect(service.translate('q1')).rejects.toMatchObject({ code: 'TRANSLATION_CHANGED' })
    expect(streamJSON).toHaveBeenCalledTimes(2)
  })

  it('does not save a translation that changed the question', async () => {
    const repo = await setup()
    const { ai } = stubAI(() => ({ translation: FAITHFUL.replace('(a) ', '') }))
    await expect(new QuestionTranslationService({ ai, db }).translate('q1')).rejects.toMatchObject({
      code: 'TRANSLATION_CHANGED',
    })
    expect((await repo.getQuestion('q1'))!.translation).toBeUndefined()
  })
})
