import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import * as QuizV7 from '@/infrastructure/ai/prompts/quiz-generator/v7'
import * as QuizV8 from '@/infrastructure/ai/prompts/quiz-generator/v8'
import { prompts } from '@/infrastructure/ai/prompts'
import { securityFooter } from '@/infrastructure/ai/prompts/security'
import { avoidRepeatingList } from '@/services/quizService'
import { QUIZ_SCENARIOS, runQuizScenario } from '../tokenUsage/quizScenario'

const input = {
  topicName: 'Glycolysis',
  topicDescription: 'From glucose to pyruvate',
  knowledgePoints: ['ATP yield'],
  plan: [
    { type: 'multiple_choice' as const, difficulty: 'basic' as const },
    { type: 'short_answer' as const, difficulty: 'basic' as const },
  ],
  language: 'en' as const,
  sourceSnippets: ['[chunk:c1]\nGlycolysis occurs in the cytosol.'],
}

describe('quiz-generator v8 system prompt', () => {
  it('is the registry version and v7 word for word without a type set', () => {
    expect(prompts.quizGenerator.VERSION).toBe('v9')
    expect(QuizV8.buildSystemPrompt()).toBe(QuizV7.buildSystemPrompt())
    expect(QuizV8.buildSystemPrompt({ languageDrills: { targetLanguage: 'de' } })).toBe(
      QuizV7.buildSystemPrompt({ languageDrills: { targetLanguage: 'de' } }),
    )
  })

  it('describes only the planned types', () => {
    const full = QuizV8.buildSystemPrompt()
    const mcq = QuizV8.buildSystemPrompt({ types: ['multiple_choice'] })
    expect(mcq.length).toBeLessThan(full.length * 0.75)
    expect(mcq).toContain('For `multiple_choice`, produce exactly 4 options')
    expect(mcq).toContain('Distractors (the wrong options)')
    expect(mcq).toContain('In a medical course a `multiple_choice` question may be an A2 item')
    for (const gone of ['`code_output`', '`chem_equation`', '`fill_blank`', 'rubric', 'unit'])
      expect(mcq).not.toContain(gone)
    // General rules and the security footer stay.
    expect(mcq).toContain('Every question must cite the snippet it came from')
    expect(mcq).toContain('Each question needs 1–3 progressive hints')
    expect(mcq).toContain(securityFooter())
    expect(mcq).toContain('"type": "multiple_choice"')
    expect(mcq).toContain('"options"')
  })

  it('keeps the multiple-choice rule a multiple-select rule refers to', () => {
    const select = QuizV8.buildSystemPrompt({ types: ['multiple_select'] })
    expect(select).toContain('The distractor rules of rule 4 apply')
    expect(select).toContain('For `multiple_choice`, produce exactly 4 options')
    expect(select).not.toContain('A2 item')
  })

  it('lists the fields of each planned type', () => {
    const system = QuizV8.buildSystemPrompt({ types: ['numeric', 'short_answer', 'matching'] })
    expect(system).toContain('"type": "numeric | short_answer | matching"')
    for (const field of ['"unit"', '"rubric"', '"matchItems"', '"matchAnswers"', '"options"'])
      expect(system).toContain(field)
    expect(system).not.toContain('"blanks"')
    expect(system).not.toContain('"orderItems"')
  })

  it('keeps the language-course drills', () => {
    const system = QuizV8.buildSystemPrompt({
      languageDrills: { targetLanguage: 'de' },
      types: ['article_gender', 'fill_blank'],
    })
    expect(system).toContain('Language-course drills')
    expect(system).toContain('"type": "fill_blank | article_gender"')
    expect(system).toContain('For `fill_blank`')
    expect(system).not.toContain('For `multiple_choice`')
  })
})

describe('quiz-generator v8 user prompt', () => {
  it('puts the stable parts first and the batch parts last', () => {
    const user = QuizV8.buildUserPrompt({
      ...input,
      avoidRepeating: ['An earlier question'],
      professorHabits: '- [types] mostly calculations',
    })
    const at = (text: string) => user.indexOf(text)
    expect(at('Topic: Glycolysis.')).toBe(0)
    expect(at('Respond in: English.')).toBeLessThan(at('PROFESSOR HABITS'))
    expect(at('PROFESSOR HABITS')).toBeLessThan(at('BEGIN SOURCE MATERIAL'))
    expect(at('END SOURCE MATERIAL')).toBeLessThan(at('Focus knowledge points: ATP yield.'))
    expect(at('Focus knowledge points')).toBeLessThan(at('Avoid repeating'))
    expect(at('Avoid repeating')).toBeLessThan(at('Generate exactly 2 question(s)'))
    expect(user).toMatch(/^ {2}1\. type=multiple_choice difficulty=basic$/m)
    expect(user.endsWith('Respond with the JSON object only.')).toBe(true)
  })

  it('gives batches with the same passages the same prefix through the passages', () => {
    const first = QuizV8.buildUserPrompt(input)
    const second = QuizV8.buildUserPrompt({
      ...input,
      knowledgePoints: ['NADH'],
      plan: [{ type: 'multiple_choice', difficulty: 'intermediate' }],
      avoidRepeating: ['Where does glycolysis occur?'],
    })
    const end = first.indexOf('END SOURCE MATERIAL')
    expect(second.slice(0, end)).toBe(first.slice(0, end))
  })
})

describe('avoidRepeatingList', () => {
  it('keeps the latest questions, each cut to its opening words', () => {
    const asked = Array.from({ length: 40 }, (_, i) => `Question ${i}\n\n${'x'.repeat(300)}`)
    const list = avoidRepeatingList(asked)
    expect(list).toHaveLength(30)
    expect(list[0]!.startsWith('Question 10 x')).toBe(true)
    expect(list[0]!.length).toBe(161)
    expect(list.every((q) => !q.includes('\n'))).toBe(true)
    expect(avoidRepeatingList(['Short one'])).toEqual(['Short one'])
  })
})

describe('quiz batches (recorded)', () => {
  let db: AppDatabase
  beforeEach(() => {
    db = new AppDatabase()
    setDbForTesting(db)
  })
  afterEach(() => db.close())

  it('sends one system prompt per quiz and only a share of the passages in a top-up', async () => {
    const recorded = await runQuizScenario(db, QUIZ_SCENARIOS[0]!.config)
    // Three batches of five, then one top-up for the dropped question.
    expect(recorded).toHaveLength(4)
    const systems = new Set(recorded.map((r) => r.messages[0]!.content))
    expect(systems.size).toBe(1)
    const system = [...systems][0]!
    expect(system).toContain('`short_answer`')
    expect(system).not.toContain('`code_output`')
    const passages = recorded.map((r) => (r.messages[1]!.content.match(/\[chunk:/g) ?? []).length)
    expect(passages[3]).toBe(passages[0])
    // The top-up reuses the first batch's passages: the same prefix through them.
    const end = recorded[0]!.messages[1]!.content.indexOf('END SOURCE MATERIAL')
    expect(recorded[3]!.messages[1]!.content.slice(0, end)).toBe(
      recorded[0]!.messages[1]!.content.slice(0, end),
    )
  })
})
