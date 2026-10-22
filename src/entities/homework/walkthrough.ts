import { fnv1a } from '@/shared/lib/hash'
import { professorMapEditDigest } from './professorMap'
import type { QuestionLanguage } from '@/entities/user/types'
import type { SolutionKind } from '@/infrastructure/math/rref'
import type { HomeworkQuestion, HomeworkSet } from './types'
import { isDeferredProfessorAnswer } from './answerMatching'
import type { TextAnchor } from '@/shared/lib/textAnchor'
import type { GuidedStepsCache } from './guided'
import type { ProfessorCompareReport } from './professorCompare'

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
  /**
   * LaTeX of the system the check worked on — `[A | b]`, or `[A | 0]` for a
   * homogeneous system — shown with a conflict so the student can judge.
   * Absent on checks saved before it was recorded.
   */
  matrix?: string
  /** Read as the homogeneous system `A x = 0` (a coefficient matrix only). */
  homogeneous?: boolean
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
  professorAligned?: ProfessorAlignment
  /**
   * The detailed version that belonged to this version, when a rewrite dropped
   * it (按教授答案修改 rewrites onto the professor's route, so the old detailed
   * version no longer fits the new standard one). `{}` = it had none. Travels
   * with the version on 恢复上一版, so swapping brings back both the standard
   * and the detailed version and swapping again restores the aligned one.
   * Absent on older rows and on rewrites that kept the section's detailed
   * version (then the section's own `variants` stay, as before).
   */
  variants?: { detailed?: WalkthroughVariant }
  inputHash: string
  generatedAt: number
}

/**
 * The section was written following the professor's answer (prompt v6
 * alignment rules); shown as 「已按教授答案」 while that answer is unchanged.
 */
export interface ProfessorAlignment {
  /** `professorAnswerHash` of the answer it followed. */
  answerHash: string
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
  /**
   * Opening / summary: the question sections (ids) that were ready when it was
   * written. A question section that is ready now but was not then makes it
   * out of date. Absent on older sections (never judged by it).
   */
  builtFrom?: string[]
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
  /** Written following the professor's answer (「已按教授答案」). */
  professorAligned?: ProfessorAlignment
  /** 与教授答案对照: the last comparison report (stale once either side changes). */
  professorCompare?: ProfessorCompareReport
  /**
   * The other source of this section (生成的讲解 / 导入的讲解), kept whole —
   * its own previous version, detailed version, level and reports included —
   * while the section's own fields show the active one. Swapped by
   * `switchSectionSource`; never lost by an import or a generation.
   */
  alternate?: WalkthroughSourceVersion
  generatedAt: number
}

/** A whole source of a section kept next to the active one. */
export type WalkthroughSourceVersion = Omit<WalkthroughSection, 'alternate'>

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
  section: Pick<WalkthroughSection, 'level' | 'kind' | 'origin'> | undefined,
  fallback: WalkthroughLevel,
): WalkthroughLevel {
  if (section?.kind && section.kind !== 'question') return 'standard'
  // An imported walkthrough has one level: the author's.
  if (section?.origin === 'imported') return 'standard'
  return section?.level ?? fallback
}

/** Ready question sections without a detailed version (what 全部切到详细版 writes). */
export function missingDetailed(sections: readonly WalkthroughSection[]): WalkthroughSection[] {
  return sections.filter(
    (section) =>
      section.kind === 'question' &&
      section.status === 'ready' &&
      section.origin !== 'imported' &&
      !detailedVariant(section),
  )
}

// --- Sources: 生成的讲解 / 导入的讲解 ----------------------------------------

export type WalkthroughSource = WalkthroughSectionOrigin

/** The source a section (or a kept version) belongs to; absent origin means generated. */
export function sourceOf(section: { origin?: WalkthroughSectionOrigin }): WalkthroughSource {
  return section.origin ?? 'generated'
}

/** A ready section showing `version`, keeping the section's identity. */
export function sectionFromVersion(
  section: Pick<WalkthroughSection, 'id' | 'kind' | 'questionId' | 'title'>,
  version: WalkthroughSectionVersion,
): WalkthroughSection {
  return {
    id: section.id,
    kind: section.kind,
    ...(section.questionId ? { questionId: section.questionId } : {}),
    title: section.title,
    ...(version.analysis ? { analysis: version.analysis } : {}),
    ...(version.conclusion ? { conclusion: version.conclusion } : {}),
    body: version.body,
    ...(version.suggestions ? { suggestions: version.suggestions } : {}),
    status: 'ready',
    inputHash: version.inputHash,
    ...(version.checks ? { checks: version.checks } : {}),
    ...(version.parts ? { parts: version.parts } : {}),
    ...(version.origin ? { origin: version.origin } : {}),
    ...(version.sourceDocumentId ? { sourceDocumentId: version.sourceDocumentId } : {}),
    ...(version.issues ? { issues: version.issues } : {}),
    ...(version.professorAligned ? { professorAligned: version.professorAligned } : {}),
    ...(version.variants?.detailed ? { variants: { detailed: version.variants.detailed } } : {}),
    generatedAt: version.generatedAt,
  }
}

/**
 * Sections saved before sources existed kept the other source in `previous`
 * (an import put the generated version there, and 恢复上一版 swapped them).
 * Read that as the alternate source, so both stay reachable by the switch.
 */
export function normalizeSectionSources(section: WalkthroughSection): WalkthroughSection {
  const previous = section.previous
  if (
    section.alternate ||
    !previous ||
    previous.level === 'detailed' ||
    sourceOf(previous) === sourceOf(section)
  )
    return section
  const { previous: _moved, ...rest } = section
  return { ...rest, alternate: sectionFromVersion(section, previous) }
}

/** The ready sources of a section, the active one first. */
export function sectionSources(section: WalkthroughSection | undefined): WalkthroughSource[] {
  if (!section) return []
  const normalized = normalizeSectionSources(section)
  const sources: WalkthroughSource[] = []
  if (normalized.status === 'ready') sources.push(sourceOf(normalized))
  const other = normalized.alternate
  if (other?.status === 'ready' && !sources.includes(sourceOf(other))) sources.push(sourceOf(other))
  return sources
}

/**
 * The generated source of a section as a section of its own (what writing and
 * rewriting work on): the section itself when it shows the generated one, the
 * kept alternate when it shows an import, undefined when it was only imported.
 */
export function generatedSource(
  section: WalkthroughSection | undefined,
): WalkthroughSection | undefined {
  if (!section) return undefined
  const normalized = normalizeSectionSources(section)
  if (sourceOf(normalized) === 'generated') return normalized
  const other = normalized.alternate
  return other && sourceOf(other) === 'generated' ? { ...other } : undefined
}

/** The section showing `source` instead, or null when it has no ready version of it. */
export function switchSectionSource(
  section: WalkthroughSection,
  source: WalkthroughSource,
): WalkthroughSection | null {
  const normalized = normalizeSectionSources(section)
  if (sourceOf(normalized) === source) return null
  const other = normalized.alternate
  if (!other || other.status !== 'ready' || sourceOf(other) !== source) return null
  const { alternate: _swapped, ...shown } = normalized
  return { ...other, alternate: shown }
}

/** A section has nothing unfinished: no draft of any kind. */
function isFinished(section: WalkthroughSection): boolean {
  return (
    section.status === 'ready' && !section.draft && !section.frameDraft && !section.variantDraft
  )
}

/**
 * Write `incoming` over the stored section without losing the other source.
 *
 * - The same source as the one shown: it replaces it; the alternate stays.
 * - The other source, finished (ready, no draft): it is shown from now on and
 *   the one shown before is kept as the alternate — so an import keeps the
 *   generated walkthrough and a generation keeps the import.
 * - The other source, unfinished (a draft, a failure): kept as the alternate
 *   while the ready section stays shown.
 *
 * A `previous` that belongs to another source is dropped: each source keeps
 * only its own earlier version.
 */
export function mergeSectionWrite(
  stored: WalkthroughSection | undefined,
  incoming: WalkthroughSection,
): WalkthroughSection {
  const { alternate: _ignored, ...written } = incoming
  const next: WalkthroughSection =
    written.previous && sourceOf(written.previous) !== sourceOf(written)
      ? (({ previous: _dropped, ...rest }) => rest)(written)
      : written
  if (!stored) return next
  const current = normalizeSectionSources(stored)
  if (sourceOf(next) === sourceOf(current))
    return current.alternate ? { ...next, alternate: current.alternate } : next
  if (isFinished(next) || current.status !== 'ready') {
    const { alternate: older, ...shown } = current
    if (current.status === 'ready') return { ...next, alternate: shown }
    // An unfinished write of the other source with finished sub-parts (a
    // split question's draft) is kept too, so 继续生成 does not start over.
    if (isFinished(next) && (shown.draft || shown.frameDraft || shown.variantDraft))
      return { ...next, alternate: shown }
    // Nothing shown worth keeping: only an alternate of the other source stays.
    return older && sourceOf(older) !== sourceOf(next) ? { ...next, alternate: older } : next
  }
  return { ...current, alternate: next }
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

/**
 * The professor's answer a question's walkthrough follows: matched, not
 * 「留给学生」, not empty. Undefined otherwise.
 */
export function professorAnswerOf(question: HomeworkQuestion): string | undefined {
  if (question.answerStatus !== 'matched') return undefined
  const text = question.answerText ?? ''
  if (!text.trim() || isDeferredProfessorAnswer(text)) return undefined
  return text
}

/**
 * Bumped with the professor-alignment rules (homework-walkthrough prompt v6;
 * `align-v2`: v9 reads a nested sub-part label in the professor answer as
 * that sub-part's misplaced solution and follows the checked 小题 ⇄ 教授答案
 * map). Only sections of questions WITH a professor answer carry it in their
 * hash, so those are offered for an update and every other section keeps its
 * hash.
 */
export const PROFESSOR_ALIGN_VERSION = 'align-v2'

/** Inputs that change what a question's section says. */
export function questionSectionHash(
  question: HomeworkQuestion,
  language: WalkthroughLanguage,
  promptVersion: string,
  /** `false`: the hash without the alignment version (what the opening / summary depend on). */
  options: { align?: boolean } = {},
): string {
  const matched = question.answerStatus === 'matched'
  const deferred = matched && isDeferredProfessorAnswer(question.answerText ?? '')
  const align = options.align !== false && professorAnswerOf(question) !== undefined
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
      // Only questions with a professor answer; absent keys keep other hashes.
      alignProfessor: align ? PROFESSOR_ALIGN_VERSION : undefined,
      // The student's changes to the 小题 ⇄ 教授答案 map (only with them). The
      // AI map itself follows from the answer + question already hashed here.
      professorMapEdits: align ? professorMapEditDigest(question) : undefined,
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
  /** The section as shown (its active source). */
  section?: WalkthroughSection
  /** Its generated source (what writing and rewriting work on), when there is one. */
  generated?: WalkthroughSection
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
    const stored = byId.get(id)
    const section = stored ? normalizeSectionSources(stored) : undefined
    // Freshness follows the generated source; a section that was only
    // imported is judged by the import (its hash is the one it was saved with).
    const generated = generatedSource(section)
    const basis = generated ?? section
    const settled = basis?.status === 'ready' || basis?.status === 'insufficient'
    const outdated = Boolean(basis && settled && basis.inputHash !== inputHash)
    return {
      id,
      kind,
      inputHash,
      // "Not enough information" for unchanged inputs is an answer, not a
      // failure: asking again would only fail the same way.
      needsWork: !basis || !settled || basis.inputHash !== inputHash,
      outdated,
      ...(question ? { question } : {}),
      ...(section ? { section } : {}),
      ...(generated ? { generated } : {}),
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
  // The opening and the summary do not change with the alignment rules: they
  // are rewritten whenever a question is, so they need not be offered again.
  const frameHash = frameSectionHash(
    questions.map((question) =>
      questionSectionHash(question, language, promptVersion, { align: false }),
    ),
    language,
    promptVersion,
  )
  const other = byId.get(IMPORTED_OTHER_SECTION_ID)
  // A question that became ready after the opening / summary were written
  // (it failed then, or a pause stopped the run before they were redone) is
  // missing from them: they need writing again.
  const readyQuestions = questionEntries
    .filter((item) => item.section?.status === 'ready')
    .map((item) => item.id)
  const withMissing = (frame: WalkthroughPlanEntry): WalkthroughPlanEntry => {
    const built = frame.generated?.builtFrom
    if (!built || frame.needsWork) return frame
    const known = new Set(built)
    return readyQuestions.some((id) => !known.has(id))
      ? { ...frame, needsWork: true, outdated: true }
      : frame
  }
  return [
    withMissing(entry('overview', 'overview', frameHash)),
    ...questionEntries,
    withMissing(entry('summary', 'summary', frameHash)),
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
  /**
   * How the note was shown when the page was left, so it comes back the same
   * way (absent: closed — opened from 我的问答 / its chip / its mark).
   */
  display?: NoteDisplay
  /**
   * 从原文中移除标记: the passage is not marked (the note stays in 我的问答).
   * Showing the note again (window / card / tucked) clears it.
   */
  markHidden?: boolean
  createdAt: number
  updatedAt: number
}

/** A note kept on the page: as a window, a card, tucked into the text or in the dock. */
export interface NoteDisplay {
  mode: 'full' | 'compact' | 'tucked' | 'minimized'
  /**
   * The card (mode `compact`): pinned → viewport coordinates; otherwise
   * coordinates in the walkthrough's card layer (it scrolls with the text).
   */
  card?: {
    x: number
    y: number
    pinned: boolean
    width?: number
    height?: number
    manual?: boolean
  }
}

export const MAX_NOTE_TURNS = 30
export const MAX_NOTE_TITLE = 80

export function defaultNoteTitle(note: Pick<WalkthroughNote, 'turns' | 'quote'>): string {
  const first = note.turns[0]?.question.trim() || note.quote.trim()
  const flat = first.replace(/\s+/g, ' ')
  return flat.length > MAX_NOTE_TITLE ? `${flat.slice(0, MAX_NOTE_TITLE - 1)}…` : flat
}
