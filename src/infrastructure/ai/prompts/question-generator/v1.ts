/**
 * v1 question-generator prompt. Alias for the tutor prompt — the question
 * generator and the interactive tutor share the same schema.
 */

export { VERSION, buildSystemPrompt, buildUserPrompt } from '../tutor/v1-question'
export type { GeneratedQuestion } from '../types'
export const PROMPT_KIND = 'question-generator' as const