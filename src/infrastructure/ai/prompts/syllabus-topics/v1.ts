/**
 * v1 syllabus-topics prompt.
 *
 * Used only when the local parser finds fewer than five exam topics in a
 * syllabus / course handbook. The model copies the exam topics it finds,
 * grouped by exam; every topic must be verbatim text of the document. The
 * caller keeps a topic only when its text really occurs in the document
 * (whitespace normalised) — anything else is dropped, never "fixed".
 */

import { securityFooter, untrustedContentWrapper } from '../security'

export const VERSION = 'v1' as const
export const PROMPT_KIND = 'syllabus-topics' as const

export interface SyllabusTopicsInput {
  documentName: string
  /** The document text, with `--- page N ---` lines between pages. */
  text: string
}

export interface SyllabusTopicsOutput {
  scopes?: Array<{ label?: unknown; kind?: unknown; topics?: unknown }>
}

export function buildSystemPrompt(): string {
  return [
    'You read a university course syllabus or handbook and list the topics students will be examined on.',
    'Find the lists of exam topics: topic lists for a midterm, final, semifinal or oral exam, exam questions, theses, 考试题目 / 考点 / 复习提纲.',
    'Copy each topic EXACTLY as it is written in the document: same words, same order, same spelling. Do not translate, shorten, merge, reword or explain.',
    'Leave out list numbers and bullets. Join a topic that wraps onto the next line into one string.',
    'Do NOT list course rules, dates, grading, rooms, required books, or the weekly timetable — only what is examined.',
    'Do NOT invent topics that are not written in the document. If there is no exam-topic list, return an empty list.',
    'Group topics by the exam they belong to. `label` is that list heading as written; `kind` is "midterm", "final" (also semifinal / end-of-term) or "other".',
    '',
    'Output strictly valid JSON only:',
    '{"scopes":[{"label":"TOPICS OF THE FINAL EXAMINATION","kind":"final","topics":["Shoulder joint and its muscles","Brachial plexus"]}]}',
    '',
    securityFooter(),
  ].join('\n')
}

export function buildUserPrompt(input: SyllabusTopicsInput): string {
  return [
    `Document: ${input.documentName}`,
    untrustedContentWrapper('SYLLABUS', input.text),
    'Respond with the JSON object only.',
  ].join('\n')
}
