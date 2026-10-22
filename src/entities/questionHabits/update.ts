import { fnv1a } from '@/shared/lib/hash'
import {
  isQuestionHabitCategory,
  normalizeEvidenceText,
  quoteFoundIn,
  type QuestionHabitEvidence,
  type QuestionHabitItem,
  type QuestionHabitCategory,
  type QuestionHabitSource,
  type QuestionHabitSourceKind,
  type QuestionHabitsProfile,
} from './types'

/**
 * Pure planning and merging for the professor question-habit profile:
 * which documents are new / changed / gone, how their questions are sampled
 * and batched for the AI, and how a reply is merged into the profile with
 * every evidence quote checked against the text that was actually sent.
 */

/** One question (or question-like passage) as sent to the model. */
export interface HabitUnit {
  /** Closed label in the prompt (`U1`…). */
  label: string
  documentId: string
  documentName: string
  kind: QuestionHabitSourceKind
  questionId?: string
  setId?: string
  chunkId?: string
  /** Number / position for the prompt, e.g. "question 3". */
  position?: string
  text: string
}

/** All questions of one document. */
export interface HabitDocument {
  documentId: string
  documentName: string
  kind: QuestionHabitSourceKind
  /** Fingerprint of every question text (`habitSourceHash`). */
  hash: string
  units: Omit<HabitUnit, 'label'>[]
}

/** Per-unit and per-document caps (characters / units sent). */
export const UNIT_MAX_CHARS = 600
export const UNITS_PER_DOCUMENT = 20
/** One request stays under this many characters of questions. */
export const BATCH_MAX_CHARS = 14_000
export const MAX_ITEMS = 40
const MAX_EVIDENCE = 5
const MAX_QUOTE = 300
const STATEMENT_MAX = 240

export function habitSourceHash(texts: readonly string[]): string {
  return fnv1a(texts.map((text) => text.trim()).join('\u0001'))
}

/**
 * A passage of a past exam / syllabus that reads like a question: a question
 * mark, a numbered task, or a task verb.
 */
export function looksLikeQuestion(text: string): boolean {
  const value = text.trim()
  if (value.length < 12) return false
  if (/[?？]/.test(value)) return true
  if (
    /^\s*(?:\d{1,2}\s*[.)、:]|\(?[a-h]\)|[一二三四五六七八九十]+[、.]|(?:q|problem|question|exercise|task|aufgabe|feladat)\s*\d)/i.test(
      value,
    )
  )
    return true
  return /\b(?:compute|calculate|prove|show that|find|determine|derive|explain|describe|evaluate|solve|sketch|list|define)\b|求|证明|计算|解释|简述|论述|试述|说明|写出|判断/i.test(
    value,
  )
}

export interface HabitSourcePlan {
  /** Documents to send (new or changed; all of them when forced). */
  changed: HabitDocument[]
  /** Analysed documents that no longer exist / have no questions. */
  removed: string[]
}

export function planHabitSources(
  profile: QuestionHabitsProfile | undefined,
  documents: readonly HabitDocument[],
  options: { force?: boolean } = {},
): HabitSourcePlan {
  const known = new Map((profile?.sources ?? []).map((source) => [source.documentId, source]))
  const present = new Set(documents.map((doc) => doc.documentId))
  const changed = documents.filter(
    (doc) =>
      doc.units.length > 0 && (options.force || known.get(doc.documentId)?.hash !== doc.hash),
  )
  const removed = [...known.keys()].filter(
    (id) => !present.has(id) || documents.find((doc) => doc.documentId === id)!.units.length === 0,
  )
  return { changed, removed }
}

/** Up to `max` units spread evenly over the document, each clipped. */
export function sampleUnits<T extends { text: string }>(units: readonly T[], max: number): T[] {
  const picked =
    units.length <= max
      ? [...units]
      : Array.from({ length: max }, (_, i) => units[Math.floor((i * units.length) / max)]!)
  return picked.map((unit) => ({ ...unit, text: clip(unit.text, UNIT_MAX_CHARS) }))
}

/**
 * Whole documents per request (≤ `BATCH_MAX_CHARS`), each sampled first, so a
 * finished request can mark its documents as analysed.
 */
export function batchHabitDocuments(documents: readonly HabitDocument[]): HabitDocument[][] {
  const batches: HabitDocument[][] = []
  let current: HabitDocument[] = []
  let size = 0
  for (const doc of documents) {
    const sampled = { ...doc, units: sampleUnits(doc.units, UNITS_PER_DOCUMENT) }
    const chars = sampled.units.reduce((sum, unit) => sum + unit.text.length + 40, 0)
    if (current.length > 0 && size + chars > BATCH_MAX_CHARS) {
      batches.push(current)
      current = []
      size = 0
    }
    current.push(sampled)
    size += chars
  }
  if (current.length > 0) batches.push(current)
  return batches
}

/** Label the units of one batch `U1`, `U2`… */
export function labelUnits(batch: readonly HabitDocument[]): HabitUnit[] {
  let n = 0
  return batch.flatMap((doc) => doc.units.map((unit) => ({ ...unit, label: `U${++n}` })))
}

/**
 * Evidence from documents that were removed is dropped from AI items; an AI
 * item left without evidence is removed. Student items stay as they are.
 */
export function dropRemovedSources(
  profile: QuestionHabitsProfile,
  removed: readonly string[],
  now: number,
): QuestionHabitsProfile {
  if (removed.length === 0) return profile
  const gone = new Set(removed)
  const items: QuestionHabitItem[] = []
  for (const item of profile.items) {
    if (item.userEdited) {
      items.push(item)
      continue
    }
    const evidence = item.evidence.filter((each) => !gone.has(each.documentId))
    if (evidence.length === 0) continue
    items.push(
      evidence.length === item.evidence.length ? item : { ...item, evidence, updatedAt: now },
    )
  }
  return {
    ...profile,
    items,
    sources: profile.sources.filter((source) => !gone.has(source.documentId)),
    updatedAt: now,
  }
}

/** The model's reply, normalised (`question-style/v1`). */
export interface HabitsReply {
  items: Array<{
    /** Short id of an existing item (`h1`), or null for a new one. */
    id: string | null
    category: string
    statement: string
    evidence: Array<{ unit: string; quote: string }>
  }>
  remove: string[]
}

export interface HabitsMergeResult {
  profile: QuestionHabitsProfile
  added: number
  updated: number
  removed: number
  /** New items dropped because none of their quotes was found in the questions sent. */
  dropped: number
}

/**
 * Merge one reply into the profile.
 *
 * - Quotes are checked against the unit they name, then any unit of the batch;
 *   a quote found nowhere is discarded.
 * - New items need ≥ 1 checked quote; otherwise they are dropped.
 * - Existing items (by their short id) get the refined statement and the new
 *   quotes added to their old ones; `remove` deletes them.
 * - Items the student wrote or edited are never changed or removed.
 * - The batch's documents are recorded as analysed.
 */
export function mergeHabitsReply(input: {
  profile: QuestionHabitsProfile
  reply: HabitsReply
  units: readonly HabitUnit[]
  /** Short id → item id, as listed in the prompt. */
  shortIds: ReadonlyMap<string, string>
  batch: readonly HabitDocument[]
  now: number
  newId: () => string
  promptVersion: string
}): HabitsMergeResult {
  const { profile, reply, units, shortIds, now } = input
  const byLabel = new Map(units.map((unit) => [unit.label, unit]))
  const verify = (claims: HabitsReply['items'][number]['evidence']): QuestionHabitEvidence[] => {
    const out: QuestionHabitEvidence[] = []
    for (const claim of claims) {
      const quote = claim.quote.trim().slice(0, MAX_QUOTE)
      if (!quote) continue
      const named = byLabel.get(claim.unit)
      const unit =
        named && quoteFoundIn(quote, named.text)
          ? named
          : units.find((each) => quoteFoundIn(quote, each.text))
      if (!unit) continue
      out.push({
        documentId: unit.documentId,
        kind: unit.kind,
        ...(unit.questionId ? { questionId: unit.questionId } : {}),
        ...(unit.setId ? { setId: unit.setId } : {}),
        ...(unit.chunkId ? { chunkId: unit.chunkId } : {}),
        quote,
      })
    }
    return out
  }

  let items = profile.items.map((item) => ({ ...item }))
  const editable = (id: string | undefined): QuestionHabitItem | undefined => {
    const item = id ? items.find((each) => each.id === id) : undefined
    return item && !item.userEdited ? item : undefined
  }

  let removed = 0
  const removeIds = new Set(
    reply.remove.map((short) => editable(shortIds.get(short))?.id).filter(Boolean) as string[],
  )
  if (removeIds.size > 0) {
    removed = removeIds.size
    items = items.filter((item) => !removeIds.has(item.id))
  }

  let added = 0
  let updated = 0
  let dropped = 0
  for (const entry of reply.items) {
    const statement = entry.statement.replace(/\s+/g, ' ').trim().slice(0, STATEMENT_MAX)
    const evidence = verify(entry.evidence)
    const existingId = entry.id ? shortIds.get(entry.id) : undefined
    if (existingId) {
      const target = editable(existingId)
      if (!target || removeIds.has(existingId)) continue
      target.statement = statement || target.statement
      if (isQuestionHabitCategory(entry.category)) target.category = entry.category
      target.evidence = mergeEvidence(target.evidence, evidence)
      target.updatedAt = now
      updated++
      continue
    }
    if (!statement || !isQuestionHabitCategory(entry.category) || evidence.length === 0) {
      dropped++
      continue
    }
    // The same habit stated again: add its quotes to the existing AI item.
    const twin = items.find(
      (item) =>
        !item.userEdited &&
        normalizeEvidenceText(item.statement) === normalizeEvidenceText(statement),
    )
    if (twin) {
      twin.evidence = mergeEvidence(twin.evidence, evidence)
      twin.updatedAt = now
      updated++
      continue
    }
    if (items.length >= MAX_ITEMS) {
      dropped++
      continue
    }
    items.push({
      id: input.newId(),
      category: entry.category as QuestionHabitCategory,
      statement,
      evidence: mergeEvidence([], evidence),
      createdAt: now,
      updatedAt: now,
    })
    added++
  }

  const analysed = new Map(profile.sources.map((source) => [source.documentId, source]))
  for (const doc of input.batch) {
    const source: QuestionHabitSource = {
      documentId: doc.documentId,
      kind: doc.kind,
      hash: doc.hash,
      analyzedAt: now,
    }
    analysed.set(doc.documentId, source)
  }
  return {
    profile: {
      ...profile,
      items,
      sources: [...analysed.values()],
      promptVersion: input.promptVersion,
      updatedAt: now,
    },
    added,
    updated,
    removed,
    dropped,
  }
}

function mergeEvidence(
  old: readonly QuestionHabitEvidence[],
  fresh: readonly QuestionHabitEvidence[],
): QuestionHabitEvidence[] {
  const out: QuestionHabitEvidence[] = []
  const seen = new Set<string>()
  for (const each of [...fresh, ...old]) {
    const key = `${each.documentId}|${normalizeEvidenceText(each.quote)}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(each)
    if (out.length >= MAX_EVIDENCE) break
  }
  return out
}

function clip(text: string, max: number): string {
  const value = text.trim()
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`
}
