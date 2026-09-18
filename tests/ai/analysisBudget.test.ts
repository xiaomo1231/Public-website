import { describe, expect, it } from 'vitest'
import { ANALYSIS_MIN_OUTPUT_TOKENS } from '@/services/documentAnalysisService'

/**
 * Regression guard for "file uploads fine but analysis always fails".
 *
 * The analyzer returns a large structured object. It used to inherit the chat
 * `maxTokens` default (2048), which is smaller than even a minimal analysis, so
 * the provider truncated the JSON and parsing failed every time.
 */

const OLD_CHAT_DEFAULT = 2048

function topic(n: number): Record<string, unknown> {
  return {
    name: `Topic ${n}: Derivatives and Rates of Change`,
    description:
      'Covers the definition of the derivative as a limit, its geometric meaning as the slope of the tangent line, and its interpretation as an instantaneous rate of change in applied problems.',
    sourceRefs: [
      {
        documentName: 'Lecture 01.pdf',
        page: n,
        section: `Chapter ${n}`,
        quote: 'The derivative of f at x is defined as the limit of the difference quotient.',
      },
    ],
  }
}

function concept(n: number): Record<string, unknown> {
  return {
    name: `Concept ${n}`,
    definition:
      'A formal definition of the concept as presented in the course material, stated precisely enough that a student could apply it to a new problem without further help.',
    explanation:
      'An additional explanation that connects this concept to the surrounding material and highlights the common mistakes students make when applying it.',
    topicNames: [`Topic ${n}`],
    sourceRefs: [{ documentName: 'Lecture 01.pdf', page: n, section: `Chapter ${n}` }],
  }
}

function formula(n: number): Record<string, unknown> {
  return {
    name: `Formula ${n}`,
    latex: "f'(x) = \\lim_{h \\to 0} \\frac{f(x+h) - f(x)}{h}",
    description:
      'The limit definition of the derivative, used when differentiating from first principles.',
    variables: [
      { symbol: 'f', meaning: 'the function being differentiated' },
      { symbol: 'x', meaning: 'the point at which the derivative is evaluated' },
      { symbol: 'h', meaning: 'the increment tending to zero' },
    ],
    sourceRefs: [{ documentName: 'Lecture 01.pdf', page: n, section: `Chapter ${n}` }],
  }
}

function symbol(n: number): Record<string, unknown> {
  return {
    symbol: `S${n}`,
    meaning: 'The instantaneous rate of change of the quantity with respect to time.',
    context: 'Used in the kinematics chapter to denote velocity.',
    unit: 'm/s',
    sourceRefs: [{ documentName: 'Lecture 01.pdf', page: n }],
  }
}

function example(n: number): Record<string, unknown> {
  return {
    title: `Worked example ${n}`,
    problem:
      'Differentiate the given function from first principles and interpret the result geometrically.',
    solution:
      'Apply the limit definition, expand the numerator, cancel the common factor of h, then evaluate the limit as h tends to zero to obtain the derivative.',
    topicNames: [`Topic ${n}`],
    sourceRefs: [{ documentName: 'Lecture 01.pdf', page: n }],
  }
}

function exercise(n: number): Record<string, unknown> {
  return {
    prompt:
      'Compute the derivative of the function and state the units of the result in the given applied context.',
    topicNames: [`Topic ${n}`],
    difficulty: 'intermediate',
    sourceRefs: [{ documentName: 'Lecture 01.pdf', page: n }],
  }
}

function prerequisite(n: number): Record<string, unknown> {
  return {
    name: `Prerequisite ${n}`,
    description:
      'Comfort with algebraic manipulation of rational expressions and the notion of a limit.',
    topicNames: [`Topic ${n}`],
  }
}

interface Counts {
  topics: number
  concepts: number
  formulas: number
  symbols: number
  examples: number
  exercises: number
  prerequisites: number
}

function build(counts: Counts): string {
  return JSON.stringify(
    {
      language: 'en',
      topics: Array.from({ length: counts.topics }, (_, i) => topic(i + 1)),
      concepts: Array.from({ length: counts.concepts }, (_, i) => concept(i + 1)),
      formulas: Array.from({ length: counts.formulas }, (_, i) => formula(i + 1)),
      symbols: Array.from({ length: counts.symbols }, (_, i) => symbol(i + 1)),
      examples: Array.from({ length: counts.examples }, (_, i) => example(i + 1)),
      exercises: Array.from({ length: counts.exercises }, (_, i) => exercise(i + 1)),
      prerequisites: Array.from({ length: counts.prerequisites }, (_, i) => prerequisite(i + 1)),
    },
    null,
    2,
  )
}

/** English JSON is roughly 4 characters per token. */
function estimateTokens(json: string): number {
  return Math.round(json.length / 4)
}

describe('document-analyzer output budget', () => {
  it('the minimal useful analysis does not fit in the chat default', () => {
    const minimal = build({
      topics: 3,
      concepts: 3,
      formulas: 3,
      symbols: 3,
      examples: 2,
      exercises: 2,
      prerequisites: 1,
    })
    // This is why every analysis used to be truncated.
    expect(estimateTokens(minimal)).toBeGreaterThan(OLD_CHAT_DEFAULT)
  })

  it('the minimal useful analysis fits in the analysis budget', () => {
    const minimal = build({
      topics: 3,
      concepts: 3,
      formulas: 3,
      symbols: 3,
      examples: 2,
      exercises: 2,
      prerequisites: 1,
    })
    expect(estimateTokens(minimal)).toBeLessThan(ANALYSIS_MIN_OUTPUT_TOKENS)
  })

  it('a typical analysis fits in the analysis budget', () => {
    const typical = build({
      topics: 8,
      concepts: 14,
      formulas: 10,
      symbols: 14,
      examples: 6,
      exercises: 8,
      prerequisites: 4,
    })
    expect(estimateTokens(typical)).toBeLessThan(ANALYSIS_MIN_OUTPUT_TOKENS)
  })

  it('the analysis budget is comfortably above the old chat default', () => {
    expect(ANALYSIS_MIN_OUTPUT_TOKENS).toBeGreaterThan(OLD_CHAT_DEFAULT * 2)
  })
})
