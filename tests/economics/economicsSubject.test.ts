import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { prompts } from '@/infrastructure/ai/prompts'
import { SUBJECT_LABEL_KEYS, type Subject } from '@/entities/project/types'
import { inferCourse, inferSubject } from '@/entities/project/subjectInference'
import { symbolGroupsFor } from '@/shared/lib/mathInput'
import { allowedBlankKinds } from '@/entities/homework/guidedSteps'
import { blankQuickItems } from '@/services/quickInputs'
import { questionTypesForSubject } from '@/entities/question/types'
import { scienceFiguresFor } from '@/infrastructure/ai/prompts/visualization-generator/v10'
import { t } from '@/i18n'

const { buildSubjectBlock, subjectPromptVersion } = prompts.subjectProfile

describe('economics subject', () => {
  it('is a subject with labels in both languages', () => {
    expect(Object.keys(SUBJECT_LABEL_KEYS)).toContain('economics')
    expect(t(SUBJECT_LABEL_KEYS.economics)).toBeTruthy()
  })

  it('is inferred from economics course names and codes', () => {
    for (const name of [
      'ECON 110',
      'ECON110 Introductory Microeconomics',
      'Econ-101',
      'Principles of Economics',
      'Introduction to Macroeconomics',
      'Intermediate Microeconomics',
      'Econometrics I',
      'Health Economics',
      '经济学原理',
      '微观经济学',
      '宏观经济学',
      '计量经济学',
      '微观',
    ])
      expect(inferSubject(name), name).toBe('economics')
  })

  it('leaves existing inferences alone', () => {
    expect(inferSubject('Business Statistics')).toBe('stats')
    expect(inferSubject('Statistics for Economics')).toBe('stats')
    expect(inferSubject('概率论与数理统计')).toBe('stats')
    expect(inferSubject('Linear Algebra')).toBe('linear_algebra')
    expect(inferSubject('Organic Chemistry')).toBe('chemistry')
    expect(inferSubject('Human Anatomy')).toBe('medicine')
    expect(inferSubject('经济法')).toBeNull()
    expect(inferCourse('Business English')).toEqual({ subject: 'language', targetLanguage: 'en' })
    expect(inferSubject('Data Structures')).toBe('cs')
  })

  it('has a profile with the market-diagram conventions', () => {
    const block = buildSubjectBlock('economics', { forLesson: true })
    expect(block).toMatch(/^COURSE SUBJECT: Economics/)
    for (const text of [
      'price P on the vertical axis and quantity Q on the horizontal axis',
      'straight lines unless',
      '(Q*, P*)',
      'D1 → D2',
      'change in quantity demanded',
      'change in demand',
      'midpoint method',
      'absolute value',
      'flatter',
      'total revenue test',
      'deadweight loss',
      'less elastic side',
      'price ceiling binds only below',
      'positive statements',
      'thousands',
      'Qd = 100 − 2P',
      'In this lesson:',
    ])
      expect(block, text).toContain(text)
    expect(subjectPromptVersion('x', 'economics')).toBe('x+subject-profile/v1:economics')
  })

  it('keeps every other subject profile byte-identical', () => {
    // sha256 (first 16 hex) of v0.9.6's blocks, without and with lesson guidance.
    const expected: Record<string, [string, string]> = {
      calculus: ['714d8fd66ebe42ef', 'b258d8caf3697f2e'],
      linear_algebra: ['833a05ad7c6bb582', '833a05ad7c6bb582'],
      discrete_math: ['20ecacceacf7a0ef', '20ecacceacf7a0ef'],
      physics: ['2ae8183c8555e53e', 'b5718c901666e06b'],
      chemistry: ['1657303aebef3c46', '0cc5b4a613400f31'],
      biology: ['9b56b4e78e972fb5', '95757fcbe09388d2'],
      cs: ['f5d1e7670f80ffdd', '78ea7bcfb756a063'],
      stats: ['52c2ef59a713bb5a', '20af9cedb423fef8'],
      medicine: ['b0cb83ef23beffa5', '0bebb236d4dac000'],
    }
    const hash = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 16)
    for (const [subject, [plain, lesson]] of Object.entries(expected)) {
      expect(hash(buildSubjectBlock(subject as Subject)), subject).toBe(plain)
      expect(hash(buildSubjectBlock(subject as Subject, { forLesson: true })), subject).toBe(lesson)
    }
    expect(subjectPromptVersion('x', 'chemistry')).toBe('x+subject-profile/v1:chemistry.r4')
    expect(subjectPromptVersion('x', 'stats')).toBe('x+subject-profile/v1:stats.r2')
  })

  it('has economics symbols, number buttons and quick inputs', () => {
    const text = symbolGroupsFor('text', 'economics')
    expect(text[0]!.id).toBe('economics')
    const glyphs = text[0]!.items.map((item) => item.glyph)
    for (const glyph of ['$', '%', '↑', '↓', 'Q*', 'P*', 'Δ', 'ε']) expect(glyphs).toContain(glyph)
    expect(symbolGroupsFor('number', 'economics')[0]!.id).toBe('economics')
    // Other subjects' number fields are unchanged.
    expect(symbolGroupsFor('number', 'physics')).toEqual(symbolGroupsFor('number'))
    const blank = { id: 'b1', answer: '1800', kind: 'number' as const }
    expect(blankQuickItems(blank, 'economics').map((item) => item.glyph)).toContain('$')
    expect(blankQuickItems(blank, 'physics').map((item) => item.glyph)).not.toContain('$')
    const textBlank = { id: 'b2', answer: 'shift right', kind: 'text' as const }
    expect(blankQuickItems(textBlank, 'economics').map((item) => item.glyph)).toContain('Q*')
  })

  it('offers number blanks, the usual quiz types and the market figure family', () => {
    expect(allowedBlankKinds('economics')).toEqual(['number', 'expression', 'text'])
    const types = questionTypesForSubject('economics')
    expect(types).toContain('numeric')
    expect(types).toContain('multiple_choice')
    expect(types).not.toContain('chem_equation')
    expect(scienceFiguresFor('economics').market).toBe(true)
    expect(scienceFiguresFor('economics').chemistry).toBe(false)
    expect(scienceFiguresFor('physics').market).toBe(false)
  })
})
