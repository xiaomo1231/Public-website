import { describe, expect, it } from 'vitest'
import {
  buildSystemPrompt,
  buildUserPrompt,
} from '@/infrastructure/ai/prompts/visualization-generator/v1'
import { prompts, PROMPT_VERSIONS } from '@/infrastructure/ai/prompts'
import { hasGraphableMath } from '@/entities/tutorVisualization/graphable'

describe('visualization prompt contract', () => {
  it('is registered', () => {
    expect(PROMPT_VERSIONS.visualizationGenerator).toBe('v1')
    expect(prompts.visualizationGenerator.VERSION).toBe('v1')
  })

  it('is isolated from the course-analysis prompt family', () => {
    expect(prompts.visualizationGenerator.PROMPT_KIND).toBe('visualization-generator')
    expect(prompts.documentAnalyzer).not.toBe(prompts.visualizationGenerator)
    expect(PROMPT_VERSIONS.documentAnalyzer).not.toBe(PROMPT_VERSIONS.visualizationGenerator)
  })

  it('demands structured JSON and forbids executable output', () => {
    const prompt = buildSystemPrompt()
    expect(prompt).toMatch(/valid JSON/)
    expect(prompt).toMatch(/NEVER output SVG, HTML, JavaScript/)
    expect(prompt).toMatch(/structured/i)
  })

  it('states the supported subset and the unsupported examples', () => {
    const prompt = buildSystemPrompt()
    expect(prompt).toContain('y = 2x + 1')
    expect(prompt).toMatch(/NOT supported/)
    expect(prompt).toContain('x^2 + y^2 = 4')
    expect(prompt).toContain('xy = 1')
  })

  it('forbids fabricating points for a function', () => {
    const prompt = buildSystemPrompt()
    expect(prompt).toMatch(/do not fabricate/i)
    expect(prompt).toMatch(/NEVER supply sample points/)
  })

  it('keeps the security footer', () => {
    expect(buildSystemPrompt()).toMatch(/UNTRUSTED CONTENT/)
  })

  it('wraps the lesson as untrusted content in the user prompt', () => {
    const user = buildUserPrompt({
      topicName: 'Linear Functions',
      topicDescription: 'Straight lines.',
      language: 'en',
      lessonContent: 'A line is \\(y = 2x + 1\\).',
    })
    expect(user).toContain('Linear Functions')
    expect(user).toContain('BEGIN LESSON')
    expect(user).toContain('END LESSON')
    expect(user).toContain('y = 2x + 1')
  })
})

describe('hasGraphableMath gate', () => {
  it('detects a relation with x and y inside maths delimiters', () => {
    expect(hasGraphableMath('A line is \\(y = 2x + 1\\).')).toBe(true)
    expect(hasGraphableMath('\\[x + y = 6\\]')).toBe(true)
    expect(hasGraphableMath('So \\(y \\ge 2x - 1\\).')).toBe(true)
  })

  it('detects explicit coordinate pairs', () => {
    expect(hasGraphableMath('The points (-2, 3), (0, 1) and (2, 5) lie on it.')).toBe(true)
  })

  it('ignores set theory and prose', () => {
    expect(hasGraphableMath('The intersection is \\(X \\cap Y = \\{c\\}\\).')).toBe(false)
    expect(hasGraphableMath('A definition with no graph at all.')).toBe(false)
    expect(hasGraphableMath('')).toBe(false)
  })
})

describe('visualization prompt contract — Phase 2 nonlinear', () => {
  it('documents the supported nonlinear families and the expression/domain fields', () => {
    const prompt = buildSystemPrompt()
    expect(prompt).toMatch(/quadratic/i)
    expect(prompt).toMatch(/sine\/cosine/i)
    expect(prompt).toMatch(/exponential/i)
    expect(prompt).toMatch(/logarithm/i)
    expect(prompt).toMatch(/reciprocal/i)
    expect(prompt).toMatch(/square root/i)
    expect(prompt).toContain('expression')
    expect(prompt).toContain('domain')
  })

  it('still forbids implicit curves and executable output', () => {
    const prompt = buildSystemPrompt()
    expect(prompt).toMatch(/implicit curves/)
    expect(prompt).toMatch(/NEVER output SVG, HTML, JavaScript/)
  })
})

describe('hasGraphableMath gate — nonlinear forms', () => {
  it('detects nonlinear function forms of x', () => {
    expect(hasGraphableMath('Graph \\(y = x^2\\).')).toBe(true)
    expect(hasGraphableMath('The curve \\(y = \\sin(x)\\) oscillates.')).toBe(true)
    expect(hasGraphableMath('Consider \\(\\ln(x)\\).')).toBe(true)
    expect(hasGraphableMath('So \\(\\sqrt{2x + 4}\\).')).toBe(true)
  })

  it('does not fire on unrelated maths or prose', () => {
    expect(hasGraphableMath('The matrix \\(A\\) is invertible.')).toBe(false)
    expect(hasGraphableMath('A proof with no variable at all.')).toBe(false)
  })
})
