import { describe, expect, it } from 'vitest'
import { prompts } from '@/infrastructure/ai/prompts'

describe('contextual tutor prompt', () => {
  it('keeps homework selections as guided questions', () => {
    const prompt = prompts.contextualTutor.buildSystemPrompt('homework')
    expect(prompt).toContain('small next step or hint')
    expect(prompt).toContain('do not reveal the final answer')
  })

  it('keeps lesson selections in the lesson context', () => {
    expect(prompts.contextualTutor.buildSystemPrompt()).toContain('selected lesson content')
  })
})
