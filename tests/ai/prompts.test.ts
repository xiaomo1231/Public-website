import { describe, expect, it } from 'vitest'
import { prompts, PROMPT_VERSIONS } from '@/infrastructure/ai/prompts'

describe('Prompt registry', () => {
  it('exposes versions for every prompt family', () => {
    expect(PROMPT_VERSIONS.documentAnalyzer).toBe('v1')
    expect(PROMPT_VERSIONS.tutorIntroduce).toBe('v1')
    expect(PROMPT_VERSIONS.tutorQuestion).toBe('v1')
    expect(PROMPT_VERSIONS.tutorEvaluate).toBe('v1')
    expect(PROMPT_VERSIONS.translator).toBe('v1')
    expect(PROMPT_VERSIONS.mistakeAnalyzer).toBe('v2')
  })

  it('document-analyzer v1 emits a JSON-shaped prompt', () => {
    const sys = prompts.documentAnalyzer.buildSystemPrompt()
    expect(sys).toMatch(/JSON/)
    const user = prompts.documentAnalyzer.buildUserPrompt({
      documentName: 'doc.pdf',
      documentText: 'hello world',
      language: 'en',
    })
    expect(user).toContain('doc.pdf')
    expect(user).toContain('hello world')
    expect(user).toContain('English')
  })

  it('tutor introduce v1 produces concise system prompt', () => {
    const sys = prompts.tutorIntroduce.buildSystemPrompt()
    expect(sys.length).toBeGreaterThan(50)
    expect(sys).toMatch(/tutor/i)
    const user = prompts.tutorIntroduce.buildUserPrompt({
      topicName: 'Limits',
      topicDescription: '',
      context: 'ctx',
      sourceSnippets: ['s1'],
      language: 'zh',
    })
    expect(user).toContain('Limits')
    expect(user).toMatch(/Simplified Chinese/)
  })

  it('tutor question v1 references difficulty', () => {
    const sys = prompts.tutorQuestion.buildSystemPrompt()
    expect(sys).toMatch(/JSON|hints/)
    const user = prompts.tutorQuestion.buildUserPrompt({
      topicName: 'T',
      topicDescription: '',
      difficulty: 'advanced',
      language: 'en',
      sourceSnippets: ['a'],
      avoidRepeating: ['old'],
      recentContext: 'rc',
    })
    expect(user).toContain('advanced')
    expect(user).toContain('Avoid repeating')
    expect(user).toContain('Recent context')
  })

  it('tutor evaluate v1 supports framing supplementary', () => {
    const sys = prompts.tutorEvaluate.buildSystemPrompt()
    expect(sys).toMatch(/Supplementary/i)
    const user = prompts.tutorEvaluate.buildUserPrompt({
      topicName: 'T',
      question: 'Q?',
      expectedAnswer: 'A',
      studentAnswer: 'wrong',
      language: 'en',
      sourceSnippets: ['s'],
      sourceRefs: [],
    })
    // The student's answer is wrapped as untrusted content.
    expect(user).toContain('BEGIN STUDENT ANSWER')
    expect(user).toContain('END STUDENT ANSWER')
    expect(user).toContain('wrong')
  })

  it('translator v1 carries surrounding context', () => {
    const sys = prompts.translator.buildSystemPrompt()
    expect(sys).toMatch(/JSON|context/)
    const user = prompts.translator.buildUserPrompt({
      selectedText: 'moment',
      surroundingContext: 'torque and moment',
      topic: 'physics',
      sourceLanguage: 'en',
      targetLanguage: 'zh',
    })
    expect(user).toContain('moment')
    expect(user).toContain('torque and moment')
    expect(user).toContain('physics')
  })

  it('mistake analyzer v2 forbids declaring carelessness', () => {
    const sys = prompts.mistakeAnalyzer.buildSystemPrompt()
    expect(sys).toMatch(/NEVER say the student was careless/i)
    expect(sys).toMatch(/possibleCause/)
    expect(sys).toMatch(/conceptual/)
    expect(sys).toMatch(/incomplete_reasoning/)
  })

  it('mistake analyzer v2 builds a user prompt with the answer comparison', () => {
    const user = prompts.mistakeAnalyzer.buildUserPrompt({
      question: 'Q',
      studentAnswer: 'B',
      correctAnswer: 'A',
      language: 'en',
    })
    expect(user).toContain('BEGIN STUDENT ANSWER')
    expect(user).toContain('Correct answer')
  })
})