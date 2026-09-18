/**
 * v1 evaluator prompt. Alias for the tutor's evaluation prompt.
 */

export { VERSION, buildSystemPrompt, buildUserPrompt } from '../tutor/v1-evaluate'
export type { TutorEvaluation } from '../tutor/v1-evaluate'
export const PROMPT_KIND = 'evaluator' as const