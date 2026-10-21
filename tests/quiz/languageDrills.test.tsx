import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { QuizService, offeredQuizTypes } from '@/services/quizService'
import type { AIService } from '@/services/aiService'
import type { QuizGenerationOutput } from '@/infrastructure/ai/prompts/quiz-generator/v7'
import * as QuizV6 from '@/infrastructure/ai/prompts/quiz-generator/v6'
import { prompts } from '@/infrastructure/ai/prompts'
import { evaluateDeterministic } from '@/services/answerEvaluationService'
import {
  defaultQuestionTypes,
  displayAnswer,
  expectedAnswerText,
  questionTypesForSubject,
  type Question,
} from '@/entities/question/types'
import type { ParadigmTable } from '@/entities/question/languageDrills'
import { normalizeForSource } from '@/services/languageDrillValidation'
import { QuestionCard } from '@/widgets/quiz/QuestionCard'
import { ParadigmTableInput } from '@/widgets/quiz/LanguageDrillInputs'
import { articleForKey, keyboardKeysLabel } from '@/widgets/quiz/quizKeyboard'

const FIXTURES = join(__dirname, '..', 'fixtures', 'language')
const DE = readFileSync(join(FIXTURES, 'de_course.txt'), 'utf8')
const HU = readFileSync(join(FIXTURES, 'hu_course.txt'), 'utf8')

const service = () => new QuizService({ ai: {} as AIService })

function generated(questions: unknown[], source: string) {
  try {
    return service().validateGenerated(
      { questions } as unknown as QuizGenerationOutput,
      questions.length,
      { sourceText: source },
    )
  } catch {
    // Nothing survived.
    return []
  }
}

const base = {
  solution: 's',
  knowledgePoint: 'Körperteile',
  difficulty: 'basic',
  hints: ['h'],
}

function article(overrides: Record<string, unknown>) {
  return {
    ...base,
    type: 'article_gender',
    prompt: '选择冠词并写出复数',
    noun: 'Kopf',
    gloss: '头',
    article: 'der',
    plural: 'Köpfe',
    correctAnswer: 'der Kopf, die Köpfe',
    ...overrides,
  }
}

const SEIN_TABLE: {
  title: string
  rows: string[]
  columns: string[]
  cells: Array<Array<Record<string, unknown>>>
} = {
  title: 'sein — Präsens',
  rows: ['ich', 'du', 'er/sie/es', 'wir', 'ihr', 'sie/Sie'],
  columns: ['Präsens'],
  cells: [
    [{ text: 'bin' }],
    [{ answers: ['bist'] }],
    [{ answers: ['ist'] }],
    [{ text: 'sind' }],
    [{ answers: ['seid'] }],
    [{ text: 'sind' }],
  ],
}

function paradigm(table: unknown) {
  return { ...base, type: 'paradigm_table', prompt: '填写 sein 的现在时', table, correctAnswer: '' }
}

describe('article_gender generation', () => {
  it('keeps a noun the course lists with its article and plural', () => {
    const [q] = generated([article({})], DE)
    expect(q).toMatchObject({
      type: 'article_gender',
      gender: { noun: 'Kopf', article: 'der', plural: 'Köpfe', gloss: '头' },
      correctAnswer: 'der Kopf, die Köpfe',
    })
  })

  it('splits an article written into the noun and accepts "die" on the plural', () => {
    const [q] = generated(
      [article({ noun: 'die Hand', article: null, plural: 'die Hände', correctAnswer: '' })],
      DE,
    )
    expect(q?.gender).toEqual({ noun: 'Hand', article: 'die', plural: 'Hände', gloss: '头' })
  })

  it('drops invented nouns, bad articles and contradictions', () => {
    // Not in the course text.
    expect(generated([article({ noun: 'Lunge', plural: 'Lungen' })], DE)).toEqual([])
    // Not der / die / das.
    expect(generated([article({ article: 'dem' })], DE)).toEqual([])
    // The course writes "die Hand, die Hände".
    expect(
      generated(
        [article({ noun: 'Hand', article: 'der', plural: 'Hände', correctAnswer: '' })],
        DE,
      ),
    ).toEqual([])
    // A plural the course does not write.
    expect(generated([article({ plural: 'Kopfe' })], DE)).toEqual([])
    // Not a capitalised noun.
    expect(generated([article({ noun: 'kopf' })], DE)).toEqual([])
    // Answer text disagrees with the fields.
    expect(generated([article({ correctAnswer: 'das Kopf, die Köpfe' })], DE)).toEqual([])
    // Without the source text nothing can be checked.
    expect(
      (() => {
        try {
          return service().validateGenerated(
            { questions: [article({})] } as unknown as QuizGenerationOutput,
            1,
          )
        } catch {
          return []
        }
      })(),
    ).toEqual([])
  })

  it('keeps a noun without a plural as a one-part question', () => {
    const [q] = generated([article({ noun: 'Mund', plural: null, correctAnswer: 'der Mund' })], DE)
    expect(q?.gender).toEqual({ noun: 'Mund', article: 'der', gloss: '头' })
  })
})

describe('paradigm_table generation', () => {
  it('keeps a table copied from the course', () => {
    const [q] = generated([paradigm(SEIN_TABLE)], DE)
    expect(q?.paradigm?.rows).toHaveLength(6)
    expect(q?.correctAnswer).toBe('du: bist；er/sie/es: ist；ihr: seid')
  })

  it('keeps a Hungarian possessive table', () => {
    const table = {
      title: 'Possessive: my / his',
      rows: ['has', 'fej', 'térd'],
      columns: ['-m', '-a / -e / -ja'],
      cells: [
        [{ answers: ['hasam'] }, { answers: ['hasa'] }],
        [{ text: 'fejem' }, { answers: ['feje'] }],
        [{ answers: ['térdem'] }, { text: 'térde' }],
      ],
    }
    const [q] = generated([paradigm(table)], HU)
    expect(q?.paradigm?.columns).toEqual(['-m', '-a / -e / -ja'])
    expect(q?.correctAnswer).toContain('has × -m: hasam')
  })

  it('drops invented forms and inconsistent shapes', () => {
    const invented = structuredClone(SEIN_TABLE)
    invented.cells[1] = [{ answers: ['seist'] }]
    expect(generated([paradigm(invented)], DE)).toEqual([])

    const ragged = structuredClone(SEIN_TABLE)
    ragged.cells[2] = [{ answers: ['ist'] }, { text: 'war' }]
    expect(generated([paradigm(ragged)], DE)).toEqual([])

    const both = structuredClone(SEIN_TABLE)
    both.cells[1] = [{ text: 'bist', answers: ['bist'] }]
    expect(generated([paradigm(both)], DE)).toEqual([])

    const missingRow = { ...SEIN_TABLE, cells: SEIN_TABLE.cells.slice(0, 5) }
    expect(generated([paradigm(missingRow)], DE)).toEqual([])

    const noBlank = { ...SEIN_TABLE, cells: SEIN_TABLE.cells.map(() => [{ text: 'sind' }]) }
    expect(generated([paradigm(noBlank)], DE)).toEqual([])

    const tooMany = {
      title: 'haben',
      rows: ['ich', 'du', 'er/sie/es', 'wir', 'ihr', 'sie'],
      columns: ['A', 'B', 'C'],
      cells: Array.from({ length: 6 }, () => [
        { answers: ['habe'] },
        { answers: ['hast'] },
        { answers: ['hat'] },
      ]),
    }
    // 18 blanks > 12.
    expect(generated([paradigm(tooMany)], DE)).toEqual([])

    const duplicateRows = { ...SEIN_TABLE, rows: ['ich', 'ich', 'er/sie/es', 'wir', 'ihr', 'sie'] }
    expect(generated([paradigm(duplicateRows)], DE)).toEqual([])
  })

  it('matches forms as whole words, with accents exact', () => {
    const source = normalizeForSource(HU)
    expect(source).toContain('hasam')
    const accentSlip = {
      title: 't',
      rows: ['has', 'fej'],
      columns: ['-m'],
      cells: [[{ answers: ['hásam'] }], [{ text: 'fejem' }]],
    }
    expect(generated([paradigm(accentSlip)], HU)).toEqual([])
    // "has" alone does not count as found inside "hasam".
    const partial = {
      title: 't',
      rows: ['a', 'b'],
      columns: ['x'],
      cells: [[{ answers: ['hasa'] }], [{ answers: ['ham'] }]],
    }
    expect(generated([paradigm(partial)], HU)).toEqual([])
  })
})

function question(overrides: Partial<Question>): Question {
  return {
    id: 'q1',
    projectId: 'p1',
    knowledgePoint: 'K',
    type: 'article_gender',
    difficulty: 'basic',
    prompt: '选择冠词并写出复数',
    correctAnswer: 'der Kopf, die Köpfe',
    gender: { noun: 'Kopf', article: 'der', plural: 'Köpfe' },
    hints: [],
    sourceRefs: [],
    promptVersion: 'v7',
    createdAt: 1,
    ...overrides,
  }
}

const TABLE: ParadigmTable = {
  title: 'sein',
  rows: ['ich', 'du', 'ihr'],
  columns: ['Präsens', 'Präteritum'],
  cells: [
    [{ text: 'bin' }, { accepted: ['war'] }],
    [{ accepted: ['bist'] }, { accepted: ['warst'] }],
    [{ accepted: ['seid'] }, { text: 'wart' }],
  ],
}

describe('article_gender grading', () => {
  const q = question({})

  it('gives a point for the article and one for the plural', () => {
    expect(evaluateDeterministic(q, 'der\nKöpfe')).toMatchObject({
      isCorrect: true,
      method: 'article_gender',
      score: { earned: 2, total: 2 },
    })
    // "die Köpfe" typed with its article is the same plural.
    expect(evaluateDeterministic(q, 'der\ndie Köpfe').isCorrect).toBe(true)
    expect(evaluateDeterministic(q, 'die\nKöpfe')).toMatchObject({
      isCorrect: false,
      score: { earned: 1, total: 2 },
    })
  })

  it('gives half the plural for an umlaut or capital slip', () => {
    const umlaut = evaluateDeterministic(q, 'der\nKopfe')
    expect(umlaut).toMatchObject({ isCorrect: false, score: { earned: 1.5, total: 2 } })
    expect(umlaut.blanks?.[1]).toMatchObject({ spelling: 'accent', expectedForm: 'Köpfe' })
    expect(evaluateDeterministic(q, 'der\nkoepfe').blanks?.[1]?.spelling).toBe('variant')
    expect(evaluateDeterministic(q, 'der\nköpfe').blanks?.[1]?.spelling).toBe('case')
    expect(evaluateDeterministic(q, 'das\nKöpfe2').score).toEqual({ earned: 0, total: 2 })
  })

  it('grades a noun without a plural on the article alone', () => {
    const mund = question({ gender: { noun: 'Mund', article: 'der' }, correctAnswer: 'der Mund' })
    expect(evaluateDeterministic(mund, 'der\n')).toMatchObject({
      isCorrect: true,
      score: { earned: 1, total: 1 },
    })
  })

  it('shows answers in dictionary form', () => {
    expect(expectedAnswerText(q)).toBe('der Kopf, die Köpfe')
    expect(displayAnswer(q, 'die\nKöpfe')).toBe('die Kopf, Köpfe')
    expect(displayAnswer(q, 'der\n')).toBe('der Kopf, —')
  })
})

describe('paradigm_table grading', () => {
  const q = question({
    type: 'paradigm_table',
    gender: undefined,
    paradigm: TABLE,
    correctAnswer: 'x',
  })

  it('grades each cell: exact 1, accent / case / variant ½, wrong 0', () => {
    const exact = evaluateDeterministic(q, 'war\nbist\nwarst\nseid', { targetLanguage: 'de' })
    expect(exact).toMatchObject({
      isCorrect: true,
      method: 'paradigm_cells',
      score: { earned: 4, total: 4 },
    })
    const mixed = evaluateDeterministic(q, 'War\nbist\nwärst\nsind', { targetLanguage: 'de' })
    expect(mixed.isCorrect).toBe(false)
    expect(mixed.score).toEqual({ earned: 2, total: 4 })
    expect(mixed.blanks?.map((cell) => [cell.label, cell.correct, cell.spelling])).toEqual([
      ['ich × Präteritum', false, 'case'],
      ['du × Präsens', true, undefined],
      ['du × Präteritum', false, 'accent'],
      ['ihr × Präsens', false, undefined],
    ])
  })

  it('knows the German ß / ss variant and Hungarian accents', () => {
    const ss: ParadigmTable = {
      title: 'heißen',
      rows: ['ich', 'du'],
      columns: ['Präsens'],
      cells: [[{ text: 'heiße' }], [{ accepted: ['heißt'] }]],
    }
    const de = question({ type: 'paradigm_table', gender: undefined, paradigm: ss })
    expect(evaluateDeterministic(de, 'heisst', { targetLanguage: 'de' }).blanks?.[0]).toMatchObject(
      { spelling: 'variant', correct: false },
    )
    const hu = question({
      type: 'paradigm_table',
      gender: undefined,
      paradigm: {
        title: 'birtokos',
        rows: ['térd', 'has'],
        columns: ['-m'],
        cells: [[{ accepted: ['térdem'] }], [{ text: 'hasam' }]],
      },
    })
    expect(evaluateDeterministic(hu, 'terdem', { targetLanguage: 'hu' }).score).toEqual({
      earned: 0.5,
      total: 1,
    })
  })

  it('labels the expected forms by cell', () => {
    expect(expectedAnswerText(q)).toBe(
      'ich × Präteritum: war；du × Präsens: bist；du × Präteritum: warst；ihr × Präsens: seid',
    )
    expect(displayAnswer(q, 'war\n\nwarst')).toContain('du × Präsens: —')
  })
})

describe('which courses get the drills', () => {
  it('offers paradigm tables to language courses and articles only for German', () => {
    expect(questionTypesForSubject('language', 'de')).toEqual(
      expect.arrayContaining(['article_gender', 'paradigm_table']),
    )
    expect(questionTypesForSubject('language', 'hu')).toContain('paradigm_table')
    expect(questionTypesForSubject('language', 'hu')).not.toContain('article_gender')
    expect(questionTypesForSubject('medicine')).not.toContain('paradigm_table')
    expect(questionTypesForSubject(undefined)).not.toContain('article_gender')
  })

  it('ticks the drills by default for a language course', () => {
    expect(defaultQuestionTypes('language', 'de')).toEqual([
      'article_gender',
      'paradigm_table',
      'fill_blank',
      'matching',
      'multiple_choice',
    ])
    expect(defaultQuestionTypes('language', 'hu')).not.toContain('article_gender')
    expect(defaultQuestionTypes('physics')).toEqual(['multiple_choice'])
  })

  it('removes drills a course does not offer from a quiz request', () => {
    expect(offeredQuizTypes(['article_gender', 'numeric'], 'physics')).toEqual(['numeric'])
    expect(
      offeredQuizTypes(['article_gender'], { subject: 'language', targetLanguage: 'hu' }),
    ).toEqual(['multiple_choice'])
    expect(
      offeredQuizTypes(['article_gender', 'paradigm_table'], {
        subject: 'language',
        targetLanguage: 'de',
      }),
    ).toEqual(['article_gender', 'paradigm_table'])
    // Other types are left as they were.
    expect(offeredQuizTypes(['code_output'], 'physics')).toEqual(['code_output'])
  })
})

describe('quiz-generator v7', () => {
  it('is v6 word for word outside a language course', () => {
    expect(prompts.quizGenerator.VERSION).toBe('v7')
    expect(prompts.quizGenerator.buildSystemPrompt()).toBe(QuizV6.buildSystemPrompt())
  })

  it('describes the drills for a language course (articles for German only)', () => {
    const german = prompts.quizGenerator.buildSystemPrompt({
      languageDrills: { targetLanguage: 'de' },
    })
    expect(german).toContain('`article_gender`')
    expect(german).toContain('`paradigm_table`')
    expect(german).toContain('| fill_blank | article_gender | paradigm_table')
    expect(german.indexOf('Language-course drills')).toBeLessThan(german.indexOf('Security rules'))
    const hungarian = prompts.quizGenerator.buildSystemPrompt({
      languageDrills: { targetLanguage: 'hu' },
    })
    expect(hungarian).toContain('`paradigm_table`')
    expect(hungarian).not.toContain('For `article_gender`')
  })

  it('sends the drill rules only for a language course', async () => {
    const chatJSON = vi.fn(async () => ({
      data: { questions: [article({})] },
    }))
    const quiz = new QuizService({ ai: { chatJSON } as unknown as AIService })
    const run = (
      quiz as unknown as {
        generateWithRetry: (input: unknown, subject: unknown) => Promise<unknown[]>
      }
    ).generateWithRetry.bind(quiz)
    const input = {
      topicName: 'Körper',
      topicDescription: 'd',
      knowledgePoints: [],
      plan: [{ type: 'article_gender', difficulty: 'basic' }],
      language: 'zh_terms',
      sourceSnippets: [`[chunk:c1]\n${DE}`],
    }
    const questions = await run(input, { subject: 'language', targetLanguage: 'de' })
    expect(questions).toHaveLength(1)
    const calls = chatJSON.mock.calls as unknown as Array<[Array<{ content: string }>]>
    expect(calls[0]![0][0]!.content).toContain('Language-course drills')
  })
})

function KeyboardHarness({ q, onSubmit }: { q: Question; onSubmit: () => void }) {
  const [value, setValue] = useState('')
  return (
    <>
      <QuestionCard
        question={q}
        index={0}
        total={1}
        difficulty="basic"
        value={value}
        onChange={setValue}
        onSubmit={onSubmit}
        onNext={() => undefined}
        isLast
      />
      <output data-testid="value">{value}</output>
    </>
  )
}

describe('article keyboard', () => {
  it('maps 1–3 to der / die / das and keeps the plural', () => {
    expect(articleForKey('1', '')).toBe('der\n')
    expect(articleForKey('3', 'die\nKöpfe')).toBe('das\nKöpfe')
    expect(articleForKey('4', '')).toBeNull()
    expect(articleForKey('a', '')).toBeNull()
    expect(keyboardKeysLabel(question({}))).toBe('1–3')
  })

  it('picks an article with 1–3 and submits with Enter', () => {
    const onSubmit = vi.fn()
    render(<KeyboardHarness q={question({})} onSubmit={onSubmit} />)
    fireEvent.keyDown(window, { key: '2' })
    expect(screen.getByTestId('value').textContent).toBe('die\n')
    expect(screen.getByRole('radio', { name: /die/ })).toHaveAttribute('aria-checked', 'true')
    fireEvent.keyDown(window, { key: '1' })
    expect(screen.getByTestId('value').textContent).toBe('der\n')
    // Typing digits in the plural field never changes the article.
    const plural = screen.getByPlaceholderText(/Plural|复数/)
    fireEvent.keyDown(plural, { key: '3' })
    expect(screen.getByTestId('value').textContent).toBe('der\n')
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })
})

describe('paradigm table input', () => {
  const q = question({ type: 'paradigm_table', gender: undefined, paradigm: TABLE })

  function TableHarness({ onSubmit }: { onSubmit: () => void }) {
    const [value, setValue] = useState('')
    return (
      <ParadigmTableInput
        question={q}
        value={value}
        onChange={setValue}
        onSubmit={onSubmit}
        language="de"
      />
    )
  }

  it('is a real table with fields named by row and column', () => {
    render(<TableHarness onSubmit={() => undefined} />)
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      'Präsens',
      'Präteritum',
    ])
    expect(screen.getByRole('textbox', { name: 'du × Präsens' })).toBeInTheDocument()
    expect(screen.getAllByRole('textbox')).toHaveLength(4)
  })

  it('moves to the next blank on Enter and submits on Ctrl+Enter', () => {
    const onSubmit = vi.fn()
    render(<TableHarness onSubmit={onSubmit} />)
    const first = screen.getByRole('textbox', { name: 'ich × Präteritum' })
    first.focus()
    fireEvent.change(first, { target: { value: 'war' } })
    fireEvent.keyDown(first, { key: 'Enter' })
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'du × Präsens' }))
    expect(onSubmit).not.toHaveBeenCalled()
    fireEvent.keyDown(document.activeElement!, { key: 'Enter', ctrlKey: true })
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('marks each blank after grading', () => {
    render(
      <ParadigmTableInput
        question={q}
        value={'war\nbst\nWarst\nseid'}
        onChange={() => undefined}
        revealed
        disabled
        language="de"
      />,
    )
    expect(screen.getByText('Expected: bist', { exact: false })).toBeInTheDocument()
    expect(screen.getAllByText(/correct|正确/).length).toBeGreaterThanOrEqual(2)
  })
})
