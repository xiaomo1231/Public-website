import { looksLikePastExam } from '@/entities/exam/paper'
import { looksLikeSyllabus } from '@/entities/syllabus/parse'
import { suggestMaterialType } from './folders'
import {
  resolveMaterialType,
  type ChunkContentType,
  type Document,
  type DocumentType,
  type LearningMaterialType,
} from './types'

/**
 * 资料类型按内容自动判断: after processing, the stored text is scored locally
 * for what the file *is* (a question paper, an answer key, a lecture, a
 * syllabus). A suggestion is only ever shown to the student; the role is never
 * changed automatically. Pure functions, no I/O.
 */

/** What the content reads like. */
export type ContentKind = 'questions' | 'answers' | 'lecture' | 'syllabus'

export const CONTENT_KINDS: readonly ContentKind[] = ['questions', 'answers', 'lecture', 'syllabus']

/** Machine-readable evidence behind a score (shown translated). */
export type SuggestionReason =
  | 'numbering'
  | 'subparts'
  | 'marks'
  | 'options'
  | 'taskVerbs'
  | 'examCover'
  | 'solutions'
  | 'answerKey'
  | 'markedOptions'
  | 'slides'
  | 'headings'
  | 'prose'
  | 'fewQuestions'
  | 'teachingWords'
  | 'syllabusWording'
  | 'grading'
  | 'schedule'
  | 'fileName'
  | 'ai'

export type SuggestionConfidence = 'high' | 'medium' | 'low'

/**
 * A suggested role stored on the document (`Document.suggestedMaterialType`).
 * Optional, no Dexie bump; exported with the row.
 */
export interface MaterialSuggestion {
  type: LearningMaterialType
  /** What the content looks like (decides the wording of the notice). */
  kind: ContentKind
  confidence: SuggestionConfidence
  reasons: SuggestionReason[]
  by: 'local' | 'ai'
  at: number
  /**
   * Scores were close: the two candidate roles a light-model check of the
   * first two pages may decide between. Absent once decided.
   */
  candidates?: LearningMaterialType[]
  /** The AI check ran (or was stopped / failed) for this suggestion; not repeated. */
  aiCheckedAt?: number
  /** The student chose 忽略: remembered until the suggested role changes. */
  dismissedAt?: number
}

/** Roles a suggestion may move a file away from (no derived records depend on them). */
export const SUGGESTABLE_FROM: ReadonlySet<LearningMaterialType> = new Set([
  'textbook',
  'user_notes',
  'lecture_transcript',
])

/** Roles a suggestion may propose. */
export const SUGGESTABLE_TO: ReadonlySet<LearningMaterialType> = new Set([
  'homework',
  'past_exam',
  'homework_answer',
  'syllabus',
])

export interface ScoreChunk {
  text: string
  contentType?: ChunkContentType
  pageNumber?: number
}

export interface ScoreInput {
  name: string
  type: DocumentType
  folderPath?: string
  chunks: readonly ScoreChunk[]
}

export interface ContentScores {
  scores: Record<ContentKind, number>
  reasons: Record<ContentKind, SuggestionReason[]>
  /** A question paper that reads like an exam (cover page, exam wording). */
  exam: boolean
  chars: number
}

/** Text read for scoring (characters). Long books are sampled from the start. */
export const SCORE_TEXT_LIMIT = 60_000

const QUESTION_LINE =
  /^\s*(?:(?:Q(?:uestion)?|Problem|Exercise|Task)\s*\.?\s*\d{1,3}\b|\(\s*\d{1,2}\s*\)\s*\S|\d{1,2}\s*[.)．、]\s*(?!\d)\S|第\s*[\d一二三四五六七八九十]+\s*[题問问]|[一二三四五六七八九十]{1,3}\s*[、．.]\s*\S)/i
const SUBPART =
  /(?:^|\s)\(\s*(?:[a-h]|i{1,3}|iv|v|vi{0,3})\s*\)\s|^\s*[a-h]\)\s|（\s*[a-h1-9]\s*）/gim
const MARKS =
  /[([（]\s*\d{1,3}\s*(?:marks?|pts?\.?|points?|分)\s*[)\]）]|\[\s*\d{1,2}\s*\]|\b\d{1,3}\s*(?:marks|points)\b|\d{1,3}\s*分(?:\s*[)）]|$)/gim
const OPTION_LINE = /^\s*(?:\(\s*[A-Ea-e]\s*\)|[A-E]\s*[.)．、])\s*\S/
const TASK_VERB =
  /\b(?:show\s+that|prove\s+that|calculate|compute|determine|explain\s+(?:why|how|what)|evaluate|derive|sketch|solve|find\s+the|draw\s+a|illustrate|what\s+is\s+the)\b|试求|求出|证明|计算|说明理由|画出/gi
const EXAM_COVER =
  /time\s*allowed|duration\s*[:：]|student\s*(?:id|number|name)|candidate|do\s+not\s+(?:open|turn)|instructions\s+to\s+candidates|answer\s+all\s+(?:the\s+)?questions|total\s+(?:marks|points)|midterm|mid-term|final\s+exam(?:ination)?|examination|考试时间|学号|姓名|考生|试卷|期中|期末|半期/gi
const SOLUTION_LINE =
  /^\s*(?:solutions?|answers?|sol\.|ans\.|参考答案|答案|解答|解\s*[:：])\s*(?:\d{1,3}\s*)?[:：.)\-–]?/i
const ANSWER_KEY =
  /answer\s*key|mark(?:ing)?\s*scheme|solutions?\s+to|answers?\s+to|model\s+answers?|参考答案|评分标准|答案解析/gi
const MARKED_ANSWER = /^Answer\s+\d{1,3}:\s*\([a-f]\)/
const HEADING_WORD =
  /^\s*(?:chapter|section|lecture|unit|module|part|week|topic|lesson)\s*\d|^\s*第\s*[\d一二三四五六七八九十]+\s*[章节讲课]|^\s*(?:learning\s+objectives|outline|summary|overview|introduction|recap)\b/i
const TEACHING_WORD =
  /\b(?:definition|theorem|example|for\s+example|in\s+summary|key\s+concepts?|learning\s+objectives?|recall|note\s+that|lemma|corollary)\b|定义|定理|例如|本章|小结/gi
const GRADING =
  /\d{1,3}\s*%.{0,60}(?:grade|grading|assessment|final|midterm|exam|homework|assignment|participation|quiz|project|成绩|平时|期末|期中|作业|考勤)|(?:grade|grading|assessment|final|midterm|exam|homework|assignment|participation|quiz|project|成绩|平时|期末|期中|作业|考勤).{0,60}\d{1,3}\s*%/gi
const SCHEDULE =
  /\bweek\s*\d{1,2}\b|第\s*\d{1,2}\s*周|office\s*hours?|instructor|prerequisites?|required\s+text(?:book)?|course\s+(?:objectives|description|schedule|policies)|academic\s+(?:integrity|honesty)|late\s+(?:policy|submission)|教学目标|课程安排|任课教师|考核方式/gi

/** Lines of `text` that start like a numbered question. */
function countQuestionLines(text: string): number {
  return text.split(/\r?\n/).filter((line) => QUESTION_LINE.test(line)).length
}

function count(pattern: RegExp, text: string): number {
  pattern.lastIndex = 0
  return text.match(pattern)?.length ?? 0
}

function add(
  scores: Record<ContentKind, number>,
  reasons: Record<ContentKind, SuggestionReason[]>,
  kind: ContentKind,
  points: number,
  reason: SuggestionReason,
): void {
  if (points <= 0) return
  scores[kind] += points
  if (!reasons[kind].includes(reason)) reasons[kind].push(reason)
}

/** The first two pages' text (or the first ~4000 characters when there are no pages). */
export function firstPagesText(chunks: readonly ScoreChunk[], pages = 2): string {
  const numbered = chunks.filter((chunk) => chunk.pageNumber !== undefined)
  if (numbered.length > 0) {
    const first = Math.min(...numbered.map((chunk) => chunk.pageNumber!))
    return chunks
      .filter((chunk) => chunk.pageNumber === undefined || chunk.pageNumber < first + pages)
      .map((chunk) => chunk.text)
      .join('\n')
      .slice(0, 8000)
  }
  return chunks
    .map((chunk) => chunk.text)
    .join('\n')
    .slice(0, 4000)
}

/** Local content scores for each kind (higher = more like it). */
export function scoreMaterialContent(input: ScoreInput): ContentScores {
  const scores: Record<ContentKind, number> = { questions: 0, answers: 0, lecture: 0, syllabus: 0 }
  const reasons: Record<ContentKind, SuggestionReason[]> = {
    questions: [],
    answers: [],
    lecture: [],
    syllabus: [],
  }
  let text = ''
  for (const chunk of input.chunks) {
    if (text.length >= SCORE_TEXT_LIMIT) break
    text += `${chunk.text}\n`
  }
  text = text.slice(0, SCORE_TEXT_LIMIT)
  const chars = text.replace(/\s+/g, '').length
  const kilo = Math.max(1, chars / 1000)
  const lines = text.split(/\n+/).filter((line) => line.trim())
  const head = firstPagesText(input.chunks)

  // ---- questions ---------------------------------------------------------
  const numbered = lines.filter((line) => QUESTION_LINE.test(line)).length
  const density = numbered / kilo
  if (numbered >= 3 && density >= 0.5) add(scores, reasons, 'questions', 2, 'numbering')
  if (numbered >= 3 && density >= 1.2) add(scores, reasons, 'questions', 1, 'numbering')
  const subparts = count(SUBPART, text)
  if (subparts >= 3 && subparts / kilo >= 0.3) add(scores, reasons, 'questions', 1.5, 'subparts')
  const marks = count(MARKS, text)
  if (marks >= 2) add(scores, reasons, 'questions', 2, 'marks')
  else if (marks === 1) add(scores, reasons, 'questions', 1, 'marks')
  const options = lines.filter((line) => OPTION_LINE.test(line)).length
  if (options >= 6) add(scores, reasons, 'questions', 1.5, 'options')
  const verbs = count(TASK_VERB, text)
  if (verbs >= 3 && verbs / kilo >= 0.25) add(scores, reasons, 'questions', 1.5, 'taskVerbs')
  else if (verbs >= 1 && verbs / kilo >= 0.25) add(scores, reasons, 'questions', 0.5, 'taskVerbs')
  const cover = count(EXAM_COVER, head)
  if (cover >= 1) add(scores, reasons, 'questions', 1.5, 'examCover')
  if (cover >= 2) add(scores, reasons, 'questions', 1, 'examCover')

  // ---- answers -----------------------------------------------------------
  const solutionLines = lines.filter((line) => SOLUTION_LINE.test(line)).length
  if (solutionLines >= 3) add(scores, reasons, 'answers', 3, 'solutions')
  else if (solutionLines >= 1) add(scores, reasons, 'answers', 1.5, 'solutions')
  if (count(ANSWER_KEY, head) >= 1) add(scores, reasons, 'answers', 3, 'answerKey')
  const marked = lines.filter((line) => MARKED_ANSWER.test(line)).length
  if (marked >= 1) add(scores, reasons, 'answers', 5, 'markedOptions')
  // An answer key reprints its questions: lend it the question evidence too.
  if (scores.answers >= 3) scores.answers += Math.min(3, scores.questions * 0.5)

  // ---- lecture -----------------------------------------------------------
  if (input.type === 'pptx') add(scores, reasons, 'lecture', 3, 'slides')
  // Short heading lines ("Chapter 4: …", "Learning objectives"), wherever chunked.
  const headings = lines.filter((line) => line.trim().length < 80 && HEADING_WORD.test(line)).length
  if (headings >= 1) add(scores, reasons, 'lecture', 1.5, 'headings')
  if (headings >= 3) add(scores, reasons, 'lecture', 1, 'headings')
  // Paragraph chunks of running explanation: several sentences, at most one
  // question number (PDF lines are short, so whole chunks are judged).
  const proseChars = input.chunks
    .filter((chunk) => {
      const body = chunk.text
      if (body.length < 200 || chunk.contentType === 'heading') return false
      const sentences = body.match(/[a-z)\]][.!?](?:\s|$)|[。！？]/gi)?.length ?? 0
      const questions = countQuestionLines(body)
      return sentences >= 3 && questions <= 1 && count(MARKS, body) === 0
    })
    .reduce((sum, chunk) => sum + chunk.text.replace(/\s+/g, '').length, 0)
  const proseRatio = chars > 0 ? proseChars / chars : 0
  if (proseRatio >= 0.4) add(scores, reasons, 'lecture', 2, 'prose')
  else if (proseRatio >= 0.2) add(scores, reasons, 'lecture', 1, 'prose')
  if (chars >= 1500 && density < 0.3 && marks === 0)
    add(scores, reasons, 'lecture', 1.5, 'fewQuestions')
  if (count(TEACHING_WORD, text) >= 3) add(scores, reasons, 'lecture', 1, 'teachingWords')

  // ---- syllabus ----------------------------------------------------------
  if (looksLikeSyllabus(input.name, head)) add(scores, reasons, 'syllabus', 4, 'syllabusWording')
  const grading = count(GRADING, text)
  if (grading >= 2) add(scores, reasons, 'syllabus', 3, 'grading')
  else if (grading === 1) add(scores, reasons, 'syllabus', 1.5, 'grading')
  const schedule = count(SCHEDULE, text)
  if (schedule >= 3) add(scores, reasons, 'syllabus', 2, 'schedule')
  if (schedule >= 6) add(scores, reasons, 'syllabus', 1, 'schedule')

  // ---- the file name agrees ---------------------------------------------
  const byName = suggestMaterialType(input.name, input.folderPath ?? '')
  const nameKind = kindOfRole(byName)
  if (nameKind && byName !== 'textbook' && scores[nameKind] > 0)
    add(scores, reasons, nameKind, 2, 'fileName')

  // An answer key often reprints its paper (the answers may be drawings): a
  // file named as answers with question content reads as an answer key.
  if (byName === 'homework_answer' && scores.questions >= MIN_SUGGEST_SCORE) {
    scores.answers = Math.max(scores.answers, scores.questions + 1)
    if (!reasons.answers.includes('fileName')) reasons.answers.push('fileName')
  }

  const exam = cover >= 1 || looksLikePastExam(input.name) || byName === 'past_exam'
  return { scores, reasons, exam, chars }
}

/** The content kind a role stands for (`undefined` for roles with no kind). */
export function kindOfRole(type: LearningMaterialType): ContentKind | undefined {
  switch (type) {
    case 'homework':
    case 'past_exam':
    case 'professor_practice':
      return 'questions'
    case 'homework_answer':
      return 'answers'
    case 'syllabus':
      return 'syllabus'
    case 'textbook':
    case 'user_notes':
    case 'lecture_transcript':
      return 'lecture'
    default:
      return undefined
  }
}

/** The role a content kind suggests. */
export function roleOfKind(kind: ContentKind, exam: boolean): LearningMaterialType {
  switch (kind) {
    case 'questions':
      return exam ? 'past_exam' : 'homework'
    case 'answers':
      return 'homework_answer'
    case 'syllabus':
      return 'syllabus'
    case 'lecture':
      return 'textbook'
  }
}

/** Below this the content says too little to suggest anything. */
export const MIN_SUGGEST_SCORE = 4
/** A lead below this over the runner-up counts as close (AI check candidate). */
export const CLOSE_MARGIN = 1.5

export interface ContentVerdict {
  kind: ContentKind
  type: LearningMaterialType
  confidence: SuggestionConfidence
  reasons: SuggestionReason[]
  /** Close call: the two candidate roles (top first). */
  candidates?: LearningMaterialType[]
}

/** The best-scoring kind with a confidence, or `null` when the content says too little. */
export function judgeContent(scores: ContentScores): ContentVerdict | null {
  const ranked = [...CONTENT_KINDS].sort((a, b) => scores.scores[b] - scores.scores[a])
  const top = ranked[0]!
  const second = ranked[1]!
  const best = scores.scores[top]
  if (best < MIN_SUGGEST_SCORE) return null
  const margin = best - scores.scores[second]
  const type = roleOfKind(top, scores.exam)
  const confidence: SuggestionConfidence =
    margin >= 3 && best >= 6 ? 'high' : margin >= CLOSE_MARGIN ? 'medium' : 'low'
  const verdict: ContentVerdict = { kind: top, type, confidence, reasons: scores.reasons[top] }
  if (confidence === 'low') {
    const other = roleOfKind(second, scores.exam)
    if (other !== type) verdict.candidates = [type, other]
  }
  return verdict
}

/**
 * The suggestion to store for a processed document, or `null` when the
 * content agrees with (or cannot argue against) the current role. A previous
 * dismissal / AI check of the same suggested role is kept, so re-processing
 * does not bring a dismissed notice back.
 */
export function buildSuggestion(
  document: Pick<
    Document,
    'name' | 'type' | 'materialType' | 'folderPath' | 'suggestedMaterialType'
  >,
  chunks: readonly ScoreChunk[],
  now: number = Date.now(),
): MaterialSuggestion | null {
  const current = resolveMaterialType(document.materialType)
  if (!SUGGESTABLE_FROM.has(current)) return null
  const verdict = judgeContent(
    scoreMaterialContent({
      name: document.name,
      type: document.type,
      ...(document.folderPath ? { folderPath: document.folderPath } : {}),
      chunks,
    }),
  )
  if (!verdict) return null
  // Lecture-like content keeps the file's own lecture-like role (notes stay notes).
  if (verdict.kind === 'lecture') verdict.type = current
  const candidates = verdict.candidates
    ?.map((type) => (kindOfRole(type) === 'lecture' ? current : type))
    .filter((type) => type === current || SUGGESTABLE_TO.has(type))
  const close =
    verdict.confidence === 'low' &&
    !!candidates &&
    candidates.length === 2 &&
    candidates[0] !== candidates[1]
  // A close call between two lecture-like roles, or a clear lecture: nothing to suggest.
  if (!SUGGESTABLE_TO.has(verdict.type) && !close) return null
  if (verdict.type === current && !close) return null
  if (verdict.confidence === 'low' && !close) return null
  const previous = document.suggestedMaterialType
  const suggestion: MaterialSuggestion = {
    type: verdict.type,
    kind: verdict.kind,
    confidence: verdict.confidence,
    reasons: verdict.reasons,
    by: 'local',
    at: now,
    ...(close ? { candidates } : {}),
  }
  // The AI already decided this call (same verdict, or one of the same candidates).
  if (
    previous?.by === 'ai' &&
    (close ? candidates!.includes(previous.type) : previous.type === suggestion.type)
  )
    return { ...previous, at: now }
  if (previous && previous.type === suggestion.type) {
    if (previous.dismissedAt) suggestion.dismissedAt = previous.dismissedAt
    if (previous.aiCheckedAt) suggestion.aiCheckedAt = previous.aiCheckedAt
  }
  return suggestion
}

/**
 * The notice to show in the file list: a ready file of a re-labellable role
 * whose suggestion differs from its role, is not dismissed and is not a close
 * call still waiting for (or lost by) the AI check.
 */
export function pendingSuggestion(
  document: Pick<Document, 'status' | 'materialType' | 'suggestedMaterialType'>,
): MaterialSuggestion | null {
  const suggestion = document.suggestedMaterialType
  if (!suggestion || document.status !== 'ready') return null
  const current = resolveMaterialType(document.materialType)
  if (!SUGGESTABLE_FROM.has(current) || !SUGGESTABLE_TO.has(suggestion.type)) return null
  if (suggestion.type === current || suggestion.dismissedAt) return null
  if (suggestion.candidates && suggestion.by === 'local') return null
  return suggestion
}

/** A close call the light model may decide (once, only when AI is configured). */
export function needsAiCheck(
  document: Pick<Document, 'status' | 'materialType' | 'suggestedMaterialType'>,
): boolean {
  const suggestion = document.suggestedMaterialType
  return (
    document.status === 'ready' &&
    SUGGESTABLE_FROM.has(resolveMaterialType(document.materialType)) &&
    !!suggestion &&
    suggestion.by === 'local' &&
    !!suggestion.candidates &&
    suggestion.candidates.length >= 2 &&
    !suggestion.aiCheckedAt &&
    !suggestion.dismissedAt
  )
}

/**
 * Apply the light model's answer to a close call. The answer must be one of
 * the candidate roles (closed set); anything else leaves the suggestion
 * undecided (marked checked, so it is not asked again and not shown).
 */
export function applyAiVerdict(
  suggestion: MaterialSuggestion,
  answer: unknown,
  now: number = Date.now(),
): MaterialSuggestion {
  const candidates = suggestion.candidates ?? []
  const type =
    answer && typeof answer === 'object' ? (answer as { type?: unknown }).type : undefined
  const chosen = candidates.find((candidate) => candidate === type)
  if (!chosen) return { ...suggestion, aiCheckedAt: now }
  const kind = kindOfRole(chosen) ?? suggestion.kind
  const { candidates: _candidates, ...rest } = suggestion
  return {
    ...rest,
    type: chosen,
    kind,
    confidence: 'medium',
    reasons: chosen === suggestion.type ? [...suggestion.reasons, 'ai'] : ['ai'],
    by: 'ai',
    at: now,
    aiCheckedAt: now,
  }
}

/** Roles the upload dialog suggests from a file name / folder. */
const NAME_SUGGESTED: ReadonlySet<LearningMaterialType> = new Set([
  'syllabus',
  'past_exam',
  'homework',
  'homework_answer',
  'professor_practice',
])
const LECTURE_LIKE: ReadonlySet<LearningMaterialType> = new Set([
  'textbook',
  'user_notes',
  'lecture_transcript',
])

/**
 * Queued upload items whose name / folder (`suggestMaterialType`) reads like another
 * role, grouped by that role. Lecture-like files may get any suggested role;
 * homework / practice files only 往年试卷 (a past paper uploaded as homework).
 */
export function groupNameSuggestions(
  items: ReadonlyArray<{
    id: string
    name: string
    status: string
    materialType?: LearningMaterialType
    folderPath?: string
  }>,
): Array<{ type: LearningMaterialType; ids: string[] }> {
  const groups = new Map<LearningMaterialType, string[]>()
  for (const item of items) {
    if (item.status !== 'queued' || !item.name) continue
    const current = item.materialType ?? 'textbook'
    const suggested = suggestMaterialType(item.name, item.folderPath ?? '')
    if (suggested === current || !NAME_SUGGESTED.has(suggested)) continue
    const allowed =
      LECTURE_LIKE.has(current) ||
      ((current === 'homework' || current === 'professor_practice') && suggested === 'past_exam')
    if (!allowed) continue
    groups.set(suggested, [...(groups.get(suggested) ?? []), item.id])
  }
  return [...groups.entries()].map(([type, ids]) => ({ type, ids }))
}
