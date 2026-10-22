import { fnv1a } from '@/shared/lib/hash'
import type { QuestionLanguage } from '@/entities/user/types'
import type { SolutionKind } from '@/infrastructure/math/rref'
import type { HomeworkQuestion, HomeworkSet } from './types'
import { isDeferredProfessorAnswer } from './answerMatching'
import type { TextAnchor } from '@/shared/lib/textAnchor'
import type { GuidedStepsCache } from './guided'

/**
 * The full walkthrough of one homework assignment: a readable document that
 * opens with the tools every question needs, works through each question, and
 * ends with a summary and review suggestions.
 *
 * Each section is generated and cached on its own, keyed by a hash of exactly
 * the inputs that shape it, so a changed question or professor answer marks
 * only that section (and the opening / summary, which depend on all of them)
 * out of date. Nothing is regenerated without the learner asking.
 */

export type WalkthroughLanguage = 'zh_terms' | 'zh' | 'en'

/**
 * `other` — content of an imported walkthrough that matched no question
 * (「其它内容」); it exists only when an import produced it.
 */
export type WalkthroughSectionKind = 'overview' | 'question' | 'summary' | 'other'

/** Where a section's text came from: written here, or imported from the student's file. */
export type WalkthroughSectionOrigin = 'generated' | 'imported'

/** The id of the 「其它内容」 section of an imported walkthrough. */
export const IMPORTED_OTHER_SECTION_ID = 'other'

/**
 * A place in an imported walkthrough the model suspects is wrong. Only
 * reported, never applied: the author's calculation stays as written.
 */
export interface WalkthroughImportIssue {
  /** The passage as it appears in the section (or the source). */
  quote: string
  /** Why it may be wrong and what to check. */
  note: string
}

/**
 * `partial` — a long multipart question written one sub-part per request has
 * some sub-parts done (see `draft`); the next run continues from there.
 */
export type WalkthroughSectionStatus = 'ready' | 'failed' | 'insufficient' | 'partial'

/** One linear system the model worked, re-checked locally with exact fractions. */
export interface LinearSystemCheck {
  label: string
  /** The model's RREF agrees with the one computed from its augmented matrix. */
  rrefMatches: boolean
  /** The model's "no / unique / infinitely many solutions" agrees too. */
  kindMatches: boolean
  claimedKind?: SolutionKind
  computedKind: SolutionKind
  /** LaTeX of the locally computed RREF, shown when the model's differs. */
  computedRref: string
}

/** One sub-part of a question written on its own (split mode). */
export interface WalkthroughPart {
  /** `a`, `b`, … */
  label: string
  heading: string
  conclusion: string
  body: string
  checks?: LinearSystemCheck[]
}

/**
 * Sub-parts finished so far for a question being written in split mode. Kept
 * on the section so a pause, a reload or a failure continues with the next
 * unfinished sub-part. On a ready section it is an unfinished rewrite, which
 * never replaces the ready text until every sub-part is done.
 */
export interface WalkthroughDraft {
  /** `generate` — a normal (or "rewrite everything") run; `regenerate` — this section only. */
  mode: 'generate' | 'regenerate'
  /** The student's revision request of a `regenerate` draft. */
  suggestion?: string
  /** The section inputs the draft was written for. */
  inputHash: string
  /** Sub-part labels of the question, in order. */
  labels: string[]
  parts: WalkthroughPart[]
  /** The 题目分析 of the whole question, returned with the first sub-part. */
  analysis?: string
  startedAt: number
}

/**
 * The opening or summary being written one question group at a time (a part
 * too long for one reply). Kept on the section so a pause, a reload or a
 * failure continues with the groups not yet written; on a ready section it is
 * an unfinished rewrite that never replaces the ready text until it is done.
 */
export interface WalkthroughFrameDraft {
  mode: 'generate' | 'regenerate'
  suggestion?: string
  /** The section inputs the draft was written for. */
  inputHash: string
  /** Question section ids by group, in reading order. */
  groups: string[][]
  /** Finished groups' replies (normalized), by `groups[i].join(',')`. */
  pieces: Record<string, unknown>
  startedAt: number
}

/**
 * 普通版 / 详细版. The standard version is the section's own fields; the
 * detailed one is stored next to it (`variants.detailed`). Both share the
 * section's input hash: a variant written for other inputs is not shown.
 */
export type WalkthroughLevel = 'standard' | 'detailed'

export const DEFAULT_WALKTHROUGH_LEVEL: WalkthroughLevel = 'standard'

/** One level of a question section other than the standard one. */
export interface WalkthroughVariant {
  conclusion?: string
  body: string
  checks?: LinearSystemCheck[]
  /** Split question: the sub-parts at this level. */
  parts?: WalkthroughPart[]
  /** The section inputs it was written for (the section's `inputHash`). */
  inputHash: string
  generatedAt: number
}

/**
 * Sub-parts of a split question finished so far at another level, so a pause
 * continues with the next sub-part.
 */
export interface WalkthroughVariantDraft {
  level: Exclude<WalkthroughLevel, 'standard'>
  mode: 'generate' | 'regenerate'
  suggestion?: string
  inputHash: string
  labels: string[]
  parts: WalkthroughPart[]
  startedAt: number
}

/** The version a regeneration replaced (one level, for 恢复上一版). */
export interface WalkthroughSectionVersion {
  /** Set when the replaced version was the detailed one. */
  level?: Exclude<WalkthroughLevel, 'standard'>
  analysis?: string
  conclusion?: string
  body: string
  checks?: LinearSystemCheck[]
  suggestions?: string[]
  parts?: WalkthroughPart[]
  origin?: WalkthroughSectionOrigin
  sourceDocumentId?: string
  issues?: WalkthroughImportIssue[]
  inputHash: string
  generatedAt: number
}

export interface WalkthroughSection {
  /** `overview`, `summary`, or `q:<questionId>`. */
  id: string
  kind: WalkthroughSectionKind
  questionId?: string
  title: string
  /**
   * Question sections: the 题目分析 (what is asked, what is given, each
   * sub-part's task, the knowledge used, the form of the answer), shown
   * collapsed before the conclusion. Sections written before prompt v3 have
   * none until the student asks for it (补充题目分析).
   */
  analysis?: string
  /** Question sections: the answer in one or two lines, shown first. */
  conclusion?: string
  /** Markdown + LaTeX. */
  body: string
  /** Summary section: concrete review actions. */
  suggestions?: string[]
  status: WalkthroughSectionStatus
  /** Why the section is missing (failed / insufficient). */
  error?: string
  inputHash: string
  checks?: LinearSystemCheck[]
  /** Split question: the sub-parts the body was joined from. */
  parts?: WalkthroughPart[]
  /** Split question in progress (see `WalkthroughDraft`). */
  draft?: WalkthroughDraft
  /** Opening / summary written in question groups, in progress (see `WalkthroughFrameDraft`). */
  frameDraft?: WalkthroughFrameDraft
  /** The ready version a section regeneration replaced. */
  previous?: WalkthroughSectionVersion
  /** Absent means generated here; `imported` shows 「来自导入」. */
  origin?: WalkthroughSectionOrigin
  /** Imported sections: the uploaded file the text came from. */
  sourceDocumentId?: string
  /** Imported sections: suspected mistakes, shown as 「这里可能有误」 (never applied). */
  issues?: WalkthroughImportIssue[]
  /** Question sections: the other levels of detail (详细版). */
  variants?: { detailed?: WalkthroughVariant }
  /** A detailed version of a split question in progress. */
  variantDraft?: WalkthroughVariantDraft
  /** The level the student chose for this section (else the default setting). */
  level?: WalkthroughLevel
  /** 引导练习 steps converted from this section (non-matrix questions), reused while its text is unchanged. */
  guided?: GuidedStepsCache
  generatedAt: number
}

/** What a question section shows at one level. */
export interface WalkthroughContent {
  conclusion?: string
  body: string
  checks?: LinearSystemCheck[]
  parts?: WalkthroughPart[]
}

/** The detailed version of a section, when one exists for its current inputs. */
export function detailedVariant(section: WalkthroughSection): WalkthroughVariant | undefined {
  const variant = section.variants?.detailed
  return variant && variant.inputHash === section.inputHash ? variant : undefined
}

/** The section's content at `level`; undefined when that level is not written yet. */
export function sectionContent(
  section: WalkthroughSection,
  level: WalkthroughLevel,
): WalkthroughContent | undefined {
  if (level === 'standard')
    return {
      ...(section.conclusion ? { conclusion: section.conclusion } : {}),
      body: section.body,
      ...(section.checks ? { checks: section.checks } : {}),
      ...(section.parts ? { parts: section.parts } : {}),
    }
  return detailedVariant(section)
}

/** The level a section is shown at: the student's choice, else the default. */
export function sectionLevel(
  section: Pick<WalkthroughSection, 'level' | 'kind'> | undefined,
  fallback: WalkthroughLevel,
): WalkthroughLevel {
  if (section?.kind && section.kind !== 'question') return 'standard'
  return section?.level ?? fallback
}

/** Ready question sections without a detailed version (what 全部切到详细版 writes). */
export function missingDetailed(sections: readonly WalkthroughSection[]): WalkthroughSection[] {
  return sections.filter(
    (section) =>
      section.kind === 'question' && section.status === 'ready' && !detailedVariant(section),
  )
}

export interface HomeworkWalkthrough {
  /** `<setId>:<language>`. */
  id: string
  projectId: string
  setId: string
  language: WalkthroughLanguage
  sections: WalkthroughSection[]
  createdAt: number
  updatedAt: number
}

export const walkthroughId = (setId: string, language: WalkthroughLanguage) =>
  `${setId}:${language}`
export const questionSectionId = (questionId: string) => `q:${questionId}`

/** The question-language preference, applied to a whole assignment. */
export function walkthroughLanguage(
  preference: QuestionLanguage | undefined,
  setLanguage: HomeworkSet['language'],
): WalkthroughLanguage {
  if (preference === 'en') return 'en'
  if (preference === 'source')
    return setLanguage === 'en' ? 'en' : setLanguage === 'zh' ? 'zh' : 'zh_terms'
  return 'zh_terms'
}

/** Inputs that change what a question's section says. */
export function questionSectionHash(
  question: HomeworkQuestion,
  language: WalkthroughLanguage,
  promptVersion: string,
): string {
  const matched = question.answerStatus === 'matched'
  const deferred = matched && isDeferredProfessorAnswer(question.answerText ?? '')
  return fnv1a(
    JSON.stringify({
      promptVersion,
      language,
      number: question.number,
      prompt: question.prompt,
      contentFingerprint: question.contentFingerprint,
      sourceRefs: question.sourceRefs.map((ref) => ref.chunkId),
      answerStatus: question.answerStatus,
      answerText: matched ? question.answerText : undefined,
      // The prompt also shows the question's existing worked solution (unless
      // the professor's answer is left to the student); undefined keys drop out
      // of the JSON, so questions without one keep their hash.
      previousSolution: !deferred && question.solution ? question.solution : undefined,
    }),
  )
}

/** The opening and the summary depend on every question, in order. */
export function frameSectionHash(
  questionHashes: readonly string[],
  language: WalkthroughLanguage,
  promptVersion: string,
): string {
  return fnv1a(JSON.stringify({ promptVersion, language, questions: questionHashes }))
}

export interface WalkthroughPlanEntry {
  id: string
  kind: WalkthroughSectionKind
  question?: HomeworkQuestion
  inputHash: string
  section?: WalkthroughSection
  /** No section yet, a failed one, or one built from different inputs. */
  needsWork: boolean
  /** A ready section whose inputs have since changed. */
  outdated: boolean
}

/** The sections the assignment needs now, in reading order, with their cached state. */
export function planWalkthrough(
  questions: readonly HomeworkQuestion[],
  stored: HomeworkWalkthrough | undefined,
  language: WalkthroughLanguage,
  promptVersion: string,
): WalkthroughPlanEntry[] {
  const byId = new Map((stored?.sections ?? []).map((section) => [section.id, section]))
  const entry = (
    id: string,
    kind: WalkthroughSectionKind,
    inputHash: string,
    question?: HomeworkQuestion,
  ): WalkthroughPlanEntry => {
    const section = byId.get(id)
    const settled = section?.status === 'ready' || section?.status === 'insufficient'
    const outdated = Boolean(section && settled && section.inputHash !== inputHash)
    return {
      id,
      kind,
      inputHash,
      // "Not enough information" for unchanged inputs is an answer, not a
      // failure: asking again would only fail the same way.
      needsWork: !section || !settled || section.inputHash !== inputHash,
      outdated,
      ...(question ? { question } : {}),
      ...(section ? { section } : {}),
    }
  }
  const questionEntries = questions.map((question) =>
    entry(
      questionSectionId(question.id),
      'question',
      questionSectionHash(question, language, promptVersion),
      question,
    ),
  )
  const frameHash = frameSectionHash(
    questionEntries.map((item) => item.inputHash),
    language,
    promptVersion,
  )
  const other = byId.get(IMPORTED_OTHER_SECTION_ID)
  return [
    entry('overview', 'overview', frameHash),
    ...questionEntries,
    entry('summary', 'summary', frameHash),
    // Unmatched imported content: kept as imported, never written or redone here.
    ...(other?.status === 'ready'
      ? [
          {
            id: IMPORTED_OTHER_SECTION_ID,
            kind: 'other' as const,
            inputHash: other.inputHash,
            section: other,
            needsWork: false,
            outdated: false,
          },
        ]
      : []),
  ]
}

// --- Saved questions about the walkthrough ----------------------------------

export interface WalkthroughNoteTurn {
  question: string
  answer: string
  at: number
}

/** Where a floating window sat, so a reopened note comes back in place. */
export interface NoteWindowRect {
  x: number
  y: number
  width: number
  height: number
}

/** The size the learner gave the note's small card (缩成小卡片). */
export interface NoteCardSize {
  width: number
  height: number
}

/**
 * A question the learner asked about a passage of the walkthrough and chose to
 * keep. The passage is found again by its text (with a little context either
 * side), not by position, so it survives a regenerated walkthrough when the
 * wording stays; otherwise the note is kept and shown as "passage changed".
 */
export interface WalkthroughNote {
  id: string
  projectId: string
  setId: string
  sectionId: string
  sectionTitle: string
  /** The passage as the learner saw it (shown in the window). */
  quote: string
  /** Original LaTeX when the passage was a formula. */
  latex?: string
  /** How to find the passage again in the section's text. */
  anchor: TextAnchor
  surrounding: string
  title: string
  turns: WalkthroughNoteTurn[]
  rect?: NoteWindowRect
  /** Hand-set card size; absent means the card fits its content. */
  cardSize?: NoteCardSize
  createdAt: number
  updatedAt: number
}

export const MAX_NOTE_TURNS = 30
export const MAX_NOTE_TITLE = 80

export function defaultNoteTitle(note: Pick<WalkthroughNote, 'turns' | 'quote'>): string {
  const first = note.turns[0]?.question.trim() || note.quote.trim()
  const flat = first.replace(/\s+/g, ' ')
  return flat.length > MAX_NOTE_TITLE ? `${flat.slice(0, MAX_NOTE_TITLE - 1)}…` : flat
}
