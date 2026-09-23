/**
 * Schema validation for the topic-scoped analyzer.
 *
 * Reuses the element normalizers from the document analyzer so a topic's
 * concepts / formulas / symbols / examples / exercises / prerequisites are
 * coerced exactly like a full analysis. Only the envelope differs.
 */

import { asEnum, asNormalizedArray, asRecord, asStringArray, asTrimmedString } from '../../validation'
import {
  normalizeConcept,
  normalizeExample,
  normalizeExercise,
  normalizeFormula,
  normalizePrerequisite,
  normalizeSymbol,
} from '../document-analyzer/normalize'
import type { TopicAnalysisOutput } from './v1'

export function normalizeTopicAnalysis(raw: unknown): TopicAnalysisOutput {
  const record = asRecord(raw)
  if (!record) {
    throw new Error('Topic analysis response was not a JSON object')
  }
  const topic = asRecord(record.topic) ?? {}
  const name = asTrimmedString(topic.name)
  if (!name) {
    throw new Error('Topic analysis response had no topic name')
  }

  return {
    language: asEnum(record.language, ['zh', 'en', 'mixed'] as const, 'mixed'),
    topic: {
      name,
      description: asTrimmedString(topic.description),
      // Raw ids only — validated against the candidate set by the caller.
      sourceChunkIds: asStringArray(topic.sourceChunkIds),
    },
    concepts: asNormalizedArray(record.concepts, normalizeConcept),
    formulas: asNormalizedArray(record.formulas, normalizeFormula),
    symbols: asNormalizedArray(record.symbols, normalizeSymbol),
    examples: asNormalizedArray(record.examples, normalizeExample),
    exercises: asNormalizedArray(record.exercises, normalizeExercise),
    prerequisites: asNormalizedArray(record.prerequisites, normalizePrerequisite),
  }
}
