export type Subject =
  | 'calculus'
  | 'linear_algebra'
  | 'physics'
  | 'chemistry'
  | 'cs'
  | 'stats'
  | 'other'

import type { TranslationKey } from '@/i18n/types'

export const SUBJECT_LABEL_KEYS: Record<Subject, TranslationKey> = {
  calculus: 'subject.calculus',
  linear_algebra: 'subject.linearAlgebra',
  physics: 'subject.physics',
  chemistry: 'subject.chemistry',
  cs: 'subject.computerScience',
  stats: 'subject.statistics',
  other: 'subject.other',
}

export interface Project {
  id: string
  name: string
  subject: Subject
  description?: string
  createdAt: number
  updatedAt: number
}

export interface CreateProjectInput {
  name: string
  subject: Subject
  description?: string
}

export interface UpdateProjectInput {
  name?: string
  subject?: Subject
  description?: string
}