/**
 * v1 tutor prompts. Split into multiple files so each call-site is small
 * and individually unit-testable.
 */

export * as lesson from './v1-lesson'
export * as introduceConcept from './v1-introduce'
export * as generateQuestion from './v1-question'
export * as evaluateAnswer from './v1-evaluate'
export * as translate from '../translator/v1'
export const VERSION = 'v1' as const
export const PROMPT_KIND = 'tutor' as const