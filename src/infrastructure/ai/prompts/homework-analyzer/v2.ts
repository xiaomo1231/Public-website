/** Homework extraction with readable mathematical transcription. */
import * as previous from './v1'
import { securityFooter } from '../security'

export const VERSION = 'v2' as const
export const PROMPT_KIND = previous.PROMPT_KIND
export type HomeworkAnalyzerInput = previous.HomeworkAnalyzerInput
export type HomeworkAnalyzerOutput = previous.HomeworkAnalyzerOutput
export const EXPECTED_OUTPUT_TYPE = previous.EXPECTED_OUTPUT_TYPE

export function buildSystemPrompt(): string {
  return [
    previous.buildSystemPrompt(),
    '',
    'TRANSCRIPTION FORMAT:',
    '  - Preserve the document language. Do not translate the problem.',
    '  - Keep the stem and each lettered or numbered subpart as separate lines in the prompt string; use blank lines between subparts.',
    '  - Preserve mathematical meaning and notation. Typeset clear formulas with $...$ or $$...$$ LaTeX; use \\mathbb{R}, superscripts, subscripts, matrices and vectors where the source supports them.',
    '  - Never infer missing symbols, labels, or diagram content. If a figure is referenced, retain that reference in the question text.',
    '  - Keep each question self-contained, including all subparts, without solving it.',
    '',
    securityFooter(),
  ].join('\n')
}

export function buildUserPrompt(input: HomeworkAnalyzerInput): string {
  return previous.buildUserPrompt({ ...input, language: 'mixed' })
}
