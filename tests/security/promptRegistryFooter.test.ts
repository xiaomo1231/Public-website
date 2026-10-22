import { describe, expect, it } from 'vitest'
import { prompts } from '@/infrastructure/ai/prompts'

/**
 * Every registered prompt embeds untrusted course material, answers or
 * notes, so every system prompt it exports must end with the security footer.
 * Builders that need options are called with the smallest valid input.
 */
const OPTION_ARGS: Record<string, unknown> = {
  'homeworkWalkthrough.buildFramePartSystemPrompt': { part: 'overview' },
  'walkthroughImport.buildSystemPrompt': { checkIssues: true },
  'referenceImageQuery.buildSystemPrompt': { allowPubChem: true },
  'vocabListSplit.buildSystemPrompt': { targetLanguage: 'de' },
  'phraseExtract.buildSystemPrompt': { targetLanguage: 'de' },
  'interviewScenario.buildSystemPrompt': { targetLanguage: 'hu', mode: 'extract' },
  'interviewPatient.buildSystemPrompt': { targetLanguage: 'hu' },
  'interviewSummaryCheck.buildSystemPrompt': { targetLanguage: 'hu' },
}

describe('prompt registry security footer', () => {
  it('every registered system prompt carries the security footer', () => {
    const missing: string[] = []
    let checked = 0
    for (const [name, mod] of Object.entries(prompts)) {
      if (name === 'subjectProfile') continue // appended to other prompts
      for (const [fn, build] of Object.entries(mod as Record<string, unknown>)) {
        if (typeof build !== 'function' || !/^build\w*SystemPrompt$/.test(fn)) continue
        const key = `${name}.${fn}`
        const arg = key in OPTION_ARGS ? OPTION_ARGS[key] : {}
        const text = (build as (a: unknown) => unknown)(arg)
        expect(typeof text, key).toBe('string')
        checked++
        if (!(text as string).includes('Security rules')) missing.push(key)
      }
    }
    expect(checked).toBeGreaterThan(40)
    expect(missing).toEqual([])
  })
})
