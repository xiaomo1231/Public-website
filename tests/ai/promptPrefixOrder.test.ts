import { describe, expect, it } from 'vitest'
import { prompts } from '@/infrastructure/ai/prompts'
import * as TutorQuestionV2 from '@/infrastructure/ai/prompts/tutor/v2-question'
import * as TutorEvaluateV1 from '@/infrastructure/ai/prompts/tutor/v1-evaluate'
import * as WalkthroughV6 from '@/infrastructure/ai/prompts/homework-walkthrough/v6'
import { SOURCE_IS_QUESTION_NOTE, promptSourceText } from '@/services/homeworkService'

/** Length of the common prefix of two strings. */
function shared(a: string, b: string): number {
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  return i
}

describe('tutor prompts: stable parts first', () => {
  const snippets = [
    'Glycolysis occurs in the cytosol.',
    'The citric acid cycle runs in the matrix.',
  ]

  it('question v3 keeps v2’s system prompt and puts the sources before the per-question parts', () => {
    expect(prompts.tutorQuestion.VERSION).toBe('v3')
    expect(prompts.tutorQuestion.buildSystemPrompt()).toBe(TutorQuestionV2.buildSystemPrompt())
    const base = {
      topicName: 'Respiration',
      topicDescription: 'ATP',
      language: 'en' as const,
      sourceSnippets: snippets,
    }
    const first = prompts.tutorQuestion.buildUserPrompt({ ...base, difficulty: 'basic' })
    const next = prompts.tutorQuestion.buildUserPrompt({
      ...base,
      difficulty: 'advanced',
      avoidRepeating: ['Where does glycolysis occur?'],
      recentContext: 'correct',
    })
    expect(next.indexOf('END SOURCE MATERIAL')).toBeLessThan(next.indexOf('Difficulty: advanced'))
    expect(next.indexOf('Difficulty')).toBeLessThan(next.indexOf('Avoid repeating'))
    expect(next.indexOf('Avoid repeating')).toBeLessThan(next.indexOf('Recent context: correct'))
    expect(next.endsWith('Produce the JSON for the next question.')).toBe(true)
    // Successive questions share everything through the source material.
    expect(shared(first, next)).toBeGreaterThan(first.indexOf('END SOURCE MATERIAL'))
  })

  it('evaluate v2 keeps v1’s system prompt and puts the student answer last', () => {
    expect(prompts.tutorEvaluate.VERSION).toBe('v2')
    expect(prompts.tutorEvaluate.buildSystemPrompt()).toBe(TutorEvaluateV1.buildSystemPrompt())
    const user = prompts.tutorEvaluate.buildUserPrompt({
      topicName: 'Respiration',
      question: 'Where?',
      expectedAnswer: 'cytosol',
      studentAnswer: 'matrix',
      language: 'en',
      sourceSnippets: snippets,
      sourceRefs: [],
    })
    const old = TutorEvaluateV1.buildUserPrompt({
      topicName: 'Respiration',
      question: 'Where?',
      expectedAnswer: 'cytosol',
      studentAnswer: 'matrix',
      language: 'en',
      sourceSnippets: snippets,
      sourceRefs: [],
    })
    expect(user.indexOf('END SOURCE MATERIAL')).toBeLessThan(user.indexOf('Question: Where?'))
    expect(user.indexOf('Expected answer')).toBeLessThan(user.indexOf('BEGIN STUDENT ANSWER'))
    expect(user.trim().endsWith('=== END STUDENT ANSWER ===')).toBe(true)
    // Same lines, new order.
    expect(user.split('\n').sort()).toEqual(old.split('\n').sort())
  })
})

describe('homework-walkthrough v7: sub-part line after the shared blocks', () => {
  const input = {
    label: '2',
    question: '(a) Is it independent? (b) Find a basis.',
    sourceText: '[c:p1]\nProblem 2. (a) Is it independent? (b) Find a basis.',
    language: 'en' as const,
    professorAnswer: 'Yes; basis {v1, v2}.',
    previousSolution: 'Row reduce.',
    parts: ['a', 'b'],
  }

  it('keeps every v6 line, the cache version and the other prompts', () => {
    expect(prompts.homeworkWalkthrough.VERSION).toBe('v7')
    expect(prompts.homeworkWalkthrough.CACHE_VERSION).toBe('v1')
    expect(prompts.homeworkWalkthrough.buildPartSystemPrompt({ linearSystems: true })).toBe(
      WalkthroughV6.buildPartSystemPrompt({ linearSystems: true }),
    )
    const part = { ...input, part: 'b', earlier: [], analysis: true }
    const v7 = prompts.homeworkWalkthrough.buildPartUserPrompt(part)
    const v6 = WalkthroughV6.buildPartUserPrompt(part)
    expect(v7.split('\n').sort()).toEqual(v6.split('\n').sort())
    expect(v7).not.toBe(v6)
  })

  it('lets sibling sub-parts share the question, source, professor answer and previous solution', () => {
    const a = prompts.homeworkWalkthrough.buildPartUserPrompt({ ...input, part: 'a', earlier: [] })
    const b = prompts.homeworkWalkthrough.buildPartUserPrompt({
      ...input,
      part: 'b',
      earlier: [{ label: 'a', conclusion: 'Yes', body: 'Work.' }],
    })
    const end = '=== END PREVIOUS AI WORKED SOLUTION (UNVERIFIED) ==='
    expect(shared(a, b)).toBeGreaterThanOrEqual(a.indexOf(end) + end.length)
    expect(b.indexOf(end)).toBeLessThan(b.indexOf('sub-part (b) only'))
    expect(b.indexOf('sub-part (b) only')).toBeLessThan(b.indexOf('ALREADY WRITTEN (a)'))
  })

  it('does the same for the detailed version of a sub-part, and leaves a whole question alone', () => {
    const variant = {
      label: '2',
      question: input.question,
      sourceText: input.sourceText,
      language: 'en' as const,
      level: 'detailed' as const,
      existing: { conclusion: 'C', body: 'B' },
      professorAnswer: input.professorAnswer,
    }
    const a = prompts.homeworkWalkthrough.buildVariantUserPrompt({ ...variant, part: 'a' })
    const b = prompts.homeworkWalkthrough.buildVariantUserPrompt({
      ...variant,
      part: 'b',
      heading: 'Basis',
    })
    const end = '=== END CONFIRMED PROFESSOR ANSWER FOR THIS QUESTION ==='
    expect(shared(a, b)).toBeGreaterThanOrEqual(a.indexOf(end) + end.length)
    expect(b).toContain('sub-part (b) "Basis" only.')
    expect(prompts.homeworkWalkthrough.buildVariantUserPrompt(variant)).toBe(
      WalkthroughV6.buildVariantUserPrompt(variant),
    )
  })
})

describe('promptSourceText', () => {
  it('drops a source that only repeats the question', () => {
    expect(promptSourceText('Solve x+1=2.', 'Solve x+1=2.')).toBe('')
    expect(promptSourceText('Solve  x+1=2.', 'Solve x+1=2.\n')).toBe('')
    expect(promptSourceText('Solve x+1=2.', 'Solve x+1=2.', { keepBlock: true })).toBe(
      SOURCE_IS_QUESTION_NOTE,
    )
  })

  it('keeps grounded passages and an empty source as they are', () => {
    const page = '[c:p1]\nHomework 1\nSolve x+1=2.'
    expect(promptSourceText('Solve x+1=2.', page)).toBe(page)
    expect(promptSourceText('Solve x+1=2.', '', { keepBlock: true })).toBe('')
  })
})
