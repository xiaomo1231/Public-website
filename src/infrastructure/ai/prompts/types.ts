/**
 * Common types shared across prompts. These describe the JSON shape the AI
 * is asked to return; the matching TypeScript shapes (entities/) live next
 * to the repositories that persist them.
 */

import type { TranslationKey } from '@/i18n/types'

export type DifficultyLevel = 'beginner' | 'basic' | 'intermediate' | 'advanced' | 'challenge'

export const DIFFICULTY_LABEL_KEYS: Record<DifficultyLevel, TranslationKey> = {
  beginner: 'difficulty.beginner',
  basic: 'difficulty.basic',
  intermediate: 'difficulty.intermediate',
  advanced: 'difficulty.advanced',
  challenge: 'difficulty.challenge',
}

/** Safe lookup for persisted rows whose `difficulty` is a plain string. */
export function difficultyLabelKey(value: string): TranslationKey {
  return (DIFFICULTY_LABEL_KEYS as Record<string, TranslationKey>)[value] ?? 'common.unknown'
}

export interface SourceReference {
  documentId: string
  documentName: string
  page?: number
  slideNumber?: number
  section?: string
  /** Short snippet quoted from the source. */
  quote?: string
}

export interface DocumentTopic {
  name: string
  description: string
  sourceRefs: SourceReference[]
}

export interface DocumentConcept {
  name: string
  definition: string
  explanation?: string
  topicNames: string[]
  sourceRefs: SourceReference[]
}

export interface DocumentFormula {
  name: string
  latex: string
  description: string
  variables: Array<{ symbol: string; meaning: string }>
  sourceRefs: SourceReference[]
}

export interface DocumentSymbol {
  symbol: string
  meaning: string
  /** Course-specific context 鈥?e.g. "physics: coefficient of friction" */
  context: string
  unit?: string
  sourceRefs: SourceReference[]
}

export interface DocumentExample {
  title: string
  problem: string
  solution?: string
  topicNames: string[]
  sourceRefs: SourceReference[]
}

export interface DocumentExercise {
  prompt: string
  topicNames: string[]
  difficulty: DifficultyLevel
  sourceRefs: SourceReference[]
}

export interface DocumentPrerequisite {
  name: string
  description: string
  topicNames: string[]
}

export interface DocumentAnalysisOutput {
  language: 'zh' | 'en' | 'mixed'
  topics: DocumentTopic[]
  concepts: DocumentConcept[]
  formulas: DocumentFormula[]
  symbols: DocumentSymbol[]
  examples: DocumentExample[]
  exercises: DocumentExercise[]
  prerequisites: DocumentPrerequisite[]
}

export interface TutorQuestion {
  prompt: string
  type: 'multiple_choice' | 'true_false' | 'numeric' | 'math_expr'
  options?: string[]
  expectedAnswer: string
  explanation: string
  knowledgePoint: string
  difficulty: DifficultyLevel
  sourceRefs: SourceReference[]
  hints: string[]
}

export interface TutorEvaluation {
  isCorrect: boolean
  partialCredit?: string
  feedback: string
  /** Detailed breakdown of what was right/wrong. */
  breakdown: string[]
  nextSteps: string
  /** Source-anchored explanation, marked "supplementary" if not from docs. */
  groundedExplanation: string
  /** True when the explanation goes beyond what's in the source documents. */
  isSupplementary: boolean
}

export interface GeneratedQuestion {
  prompt: string
  type: 'multiple_choice' | 'true_false' | 'numeric' | 'math_expr'
  options?: string[]
  expectedAnswer: string
  explanation: string
  knowledgePoint: string
  difficulty: DifficultyLevel
  sourceRefs: SourceReference[]
  hints: string[]
}

export interface TranslationOutput {
  translation: string
  /** Course-aware gloss. */
  contextNote: string
  /** Optional alternative renderings (e.g. bracketed for "moment"). */
  alternatives: string[]
}