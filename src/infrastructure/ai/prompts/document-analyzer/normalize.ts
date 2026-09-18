/**
 * Schema validation + sanitisation for the document-analyzer output.
 *
 * The model's JSON is never written to the database directly: it is coerced
 * into the expected shape first, and entries that cannot be salvaged are
 * dropped rather than persisted as malformed rows.
 */

import type {
  DocumentAnalysisOutput,
  DocumentConcept,
  DocumentExample,
  DocumentExercise,
  DocumentFormula,
  DocumentPrerequisite,
  DocumentSymbol,
  DocumentTopic,
  DifficultyLevel,
  SourceReference,
} from '../types'
import { asEnum, asNormalizedArray, asRecord, asString, asTrimmedString } from '../../validation'

const DIFFICULTIES: readonly DifficultyLevel[] = [
  'beginner',
  'basic',
  'intermediate',
  'advanced',
  'challenge',
]

function normalizeSourceRefs(value: unknown): SourceReference[] {
  return asNormalizedArray(value, (raw) => {
    const documentName = asTrimmedString(raw.documentName)
    if (!documentName) return null
    const ref: SourceReference = {
      documentId: asString(raw.documentId),
      documentName,
    }
    const page = raw.page
    if (typeof page === 'number' && Number.isFinite(page)) ref.page = page
    const slide = raw.slideNumber
    if (typeof slide === 'number' && Number.isFinite(slide)) ref.slideNumber = slide
    const section = asTrimmedString(raw.section)
    if (section) ref.section = section
    const quote = asTrimmedString(raw.quote)
    if (quote) ref.quote = quote
    return ref
  }, 20)
}

function normalizeTopic(raw: Record<string, unknown>): DocumentTopic | null {
  const name = asTrimmedString(raw.name)
  if (!name) return null
  return {
    name,
    description: asTrimmedString(raw.description),
    sourceRefs: normalizeSourceRefs(raw.sourceRefs),
  }
}

function normalizeConcept(raw: Record<string, unknown>): DocumentConcept | null {
  const name = asTrimmedString(raw.name)
  const definition = asTrimmedString(raw.definition)
  if (!name || !definition) return null
  const concept: DocumentConcept = {
    name,
    definition,
    topicNames: asStringArraySafe(raw.topicNames),
    sourceRefs: normalizeSourceRefs(raw.sourceRefs),
  }
  const explanation = asTrimmedString(raw.explanation)
  if (explanation) concept.explanation = explanation
  return concept
}

function normalizeFormula(raw: Record<string, unknown>): DocumentFormula | null {
  const name = asTrimmedString(raw.name)
  const latex = asTrimmedString(raw.latex)
  if (!name || !latex) return null
  return {
    name,
    latex,
    description: asTrimmedString(raw.description),
    variables: asNormalizedArray(
      raw.variables,
      (v) => {
        const symbol = asTrimmedString(v.symbol)
        if (!symbol) return null
        return { symbol, meaning: asTrimmedString(v.meaning) }
      },
      40,
    ),
    sourceRefs: normalizeSourceRefs(raw.sourceRefs),
  }
}

function normalizeSymbol(raw: Record<string, unknown>): DocumentSymbol | null {
  const symbol = asTrimmedString(raw.symbol)
  const meaning = asTrimmedString(raw.meaning)
  if (!symbol || !meaning) return null
  const entry: DocumentSymbol = {
    symbol,
    meaning,
    context: asTrimmedString(raw.context, 'general'),
    sourceRefs: normalizeSourceRefs(raw.sourceRefs),
  }
  const unit = asTrimmedString(raw.unit)
  if (unit) entry.unit = unit
  return entry
}

function normalizeExample(raw: Record<string, unknown>): DocumentExample | null {
  const title = asTrimmedString(raw.title)
  const problem = asTrimmedString(raw.problem)
  if (!title || !problem) return null
  const example: DocumentExample = {
    title,
    problem,
    topicNames: asStringArraySafe(raw.topicNames),
    sourceRefs: normalizeSourceRefs(raw.sourceRefs),
  }
  const solution = asTrimmedString(raw.solution)
  if (solution) example.solution = solution
  return example
}

function normalizeExercise(raw: Record<string, unknown>): DocumentExercise | null {
  const prompt = asTrimmedString(raw.prompt)
  if (!prompt) return null
  return {
    prompt,
    topicNames: asStringArraySafe(raw.topicNames),
    difficulty: asEnum(raw.difficulty, DIFFICULTIES, 'basic'),
    sourceRefs: normalizeSourceRefs(raw.sourceRefs),
  }
}

function normalizePrerequisite(raw: Record<string, unknown>): DocumentPrerequisite | null {
  const name = asTrimmedString(raw.name)
  if (!name) return null
  return {
    name,
    description: asTrimmedString(raw.description),
    topicNames: asStringArraySafe(raw.topicNames),
  }
}

function asStringArraySafe(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    : []
}

/**
 * Coerce arbitrary model output into a `DocumentAnalysisOutput`.
 * Throws only when the response is not an object at all — an empty-but-valid
 * analysis is preferable to persisting garbage.
 */
export function normalizeDocumentAnalysis(raw: unknown): DocumentAnalysisOutput {
  const record = asRecord(raw)
  if (!record) {
    throw new Error('Document analysis response was not a JSON object')
  }
  return {
    language: asEnum(record.language, ['zh', 'en', 'mixed'] as const, 'mixed'),
    topics: asNormalizedArray(record.topics, normalizeTopic),
    concepts: asNormalizedArray(record.concepts, normalizeConcept),
    formulas: asNormalizedArray(record.formulas, normalizeFormula),
    symbols: asNormalizedArray(record.symbols, normalizeSymbol),
    examples: asNormalizedArray(record.examples, normalizeExample),
    exercises: asNormalizedArray(record.exercises, normalizeExercise),
    prerequisites: asNormalizedArray(record.prerequisites, normalizePrerequisite),
  }
}
