/**
 * v1 oral-exam prompt.
 *
 * Writes ONE oral exam item for a drawn topic, the way an examiner at an oral
 * or practical exam would ask it (anatomy: "Describe the shoulder joint and
 * the muscles acting upon it"): the question, a model answer outline, 6–10
 * scoring points that follow the structure a full description of this kind
 * of topic needs, and two short follow-up questions with 1–3 points each.
 *
 * The app grades the student's (spoken or typed) answer with the short-answer
 * grader: point by point, with verbatim evidence checked locally. Sources are
 * cited by chunk id and resolved against local chunks; ids that were not
 * offered are discarded. A topic the course material does not cover (the
 * student opted in) is written without sources and labelled as such.
 */

import { securityFooter, untrustedContentWrapper } from '../security'
import { professorStyleSection } from '../question-style/v1'
import { examLanguageInstruction, examLanguageOf, type ExamLanguageKey } from '../exam-language/v1'

export const VERSION = 'v1' as const
export const PROMPT_KIND = 'oral-exam' as const

export interface OralExamInput {
  /** The drawn topic as the syllabus or course names it. */
  topic: string
  /** Matched course topic names (context only). */
  courseTopics: string[]
  knowledgePoints: string[]
  /** Formatted source passages (`[chunk:<id> · …]\n<text>`); empty = no course material. */
  sourceSnippets: string[]
  /** `exam:<code>`: 跟随考试语言 (any other value: the prompt is unchanged). */
  language: 'zh' | 'en' | 'mixed' | 'zh_terms' | ExamLanguageKey
  /**
   * 教授出题习惯 (`buildHabitsBlock`), when the profile is on and not empty.
   * Absent: the prompt is byte-identical to before (no version change).
   */
  professorHabits?: string
}

export interface OralExamOutput {
  question?: unknown
  knowledgePoint?: unknown
  outline?: unknown
  rubric?: unknown
  followUps?: unknown
  sources?: unknown
}

export function buildSystemPrompt(): string {
  return [
    'You are the examiner at a university oral exam. The student has drawn ONE topic and must give a full spoken description of it; afterwards you ask short follow-up questions.',
    '',
    'Write:',
    '  1. `question`: the topic as you would ask it aloud, e.g. "Describe the shoulder joint and the muscles acting upon it." One or two sentences, no answer and no hints in it.',
    '  2. `outline`: a model answer outline in Markdown (headed bullet points), the full description a well-prepared student gives. Concise: facts, not prose.',
    '  3. `rubric`: 6–10 scoring points. Each point is ONE checkable idea of the full description, written as the actual claim (e.g. "Innervation: the deltoid is supplied by the axillary nerve (C5–C6)"), starting with its category and a colon.',
    '     Follow the structure that a full description of THIS kind of topic needs and skip categories that do not apply. For a gross-anatomy topic: parts / components, position and relations, movements or function, muscles acting on it, innervation, blood supply, venous and lymphatic drainage, development, clinical relevance. For a process or mechanism: definition, steps in order, regulation, function, typical disorder. For other subjects use the equivalent structure (definition, key properties, derivation or mechanism, conditions, example, application).',
    '     Points must not overlap, and every point must be stated in the outline.',
    '  4. `followUps`: exactly 2 follow-up questions an examiner asks after the description, each answerable in one to three sentences, each probing something different from the other and not a repeat of the main question. For each: `question`, `answer` (the short model answer) and `rubric` with 1–3 scoring points taken from that answer.',
    '  5. `knowledgePoint`: the topic as a short name (2–6 words).',
    '  6. `sources`: up to 3 source passages the outline is based on, each `{"chunkId":"<id from a [chunk:…] label>","quote":"<a short passage copied verbatim from that chunk>"}`. Use ONLY ids that appear in the SOURCE MATERIAL labels. When no source material is given, return an empty list.',
    '',
    'Base the content on the SOURCE MATERIAL. When a needed fact is not in it, you may add standard textbook knowledge, but never contradict the material. When no source material is given, write from standard university textbook knowledge for this course.',
    '',
    'Output strictly valid JSON only, no prose and no markdown fence:',
    '{"question":"...","knowledgePoint":"...","outline":"...","rubric":["Parts: ...","Innervation: ..."],"followUps":[{"question":"...","answer":"...","rubric":["..."]},{"question":"...","answer":"...","rubric":["..."]}],"sources":[{"chunkId":"...","quote":"..."}]}',
    '',
    securityFooter(),
  ].join('\n')
}

function languageInstruction(language: OralExamInput['language']): string {
  const exam = examLanguageOf(language)
  if (exam) return examLanguageInstruction(exam)
  if (language === 'zh_terms')
    return 'Simplified Chinese. At the first mention of each key term, give the English (or Latin anatomical) term in parentheses. Quotes stay verbatim in the source language'
  if (language === 'zh') return 'Simplified Chinese'
  if (language === 'en') return 'English'
  return 'the language of the source material'
}

export function buildUserPrompt(input: OralExamInput): string {
  const sources =
    input.sourceSnippets.length > 0
      ? untrustedContentWrapper('SOURCE MATERIAL', input.sourceSnippets.join('\n\n'))
      : 'NO SOURCE MATERIAL: the course material does not cover this topic. Write from standard university textbook knowledge and return "sources": [].'
  return [
    `Write the question, outline, scoring points and follow-ups in ${languageInstruction(input.language)}.`,
    untrustedContentWrapper('DRAWN TOPIC', input.topic),
    ...(input.courseTopics.length > 0
      ? [untrustedContentWrapper('MATCHING COURSE TOPICS', input.courseTopics.join('\n'))]
      : []),
    ...(input.knowledgePoints.length > 0
      ? [untrustedContentWrapper('KNOWLEDGE POINTS', input.knowledgePoints.join('\n'))]
      : []),
    sources,
    ...(input.professorHabits ? [professorStyleSection(input.professorHabits)] : []),
    'Respond with the JSON object only.',
  ].join('\n')
}
