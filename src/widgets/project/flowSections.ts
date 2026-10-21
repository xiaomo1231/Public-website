import type { ProjectFlowSection } from './ProjectFlowNav'

/** Course sections that only make sense for a language course. */
const LANGUAGE_ONLY: ReadonlySet<ProjectFlowSection> = new Set(['interview'])

const ORDER: ProjectFlowSection[] = [
  'home',
  'files',
  'homework',
  'tutor',
  'quiz',
  'interview',
  'mistakes',
  'cards',
  'mastery',
  'history',
]

/** Whether a course of `subject` shows the section in its navigation. */
export function isFlowSectionShown(
  section: ProjectFlowSection,
  subject: string | undefined,
): boolean {
  return !LANGUAGE_ONLY.has(section) || subject === 'language'
}

/** The sections shown for a course, in navigation order. */
export function flowItemsFor(subject: string | undefined): ProjectFlowSection[] {
  return ORDER.filter((section) => isFlowSectionShown(section, subject))
}
