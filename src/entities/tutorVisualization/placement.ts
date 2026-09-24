import type { LessonSection } from '@/shared/lib/lessonDocument'
import type { TutorVisualization } from './types'

/**
 * Bind each visualization to the lesson section it belongs next to.
 *
 * A section placement names a teaching block kind and a 0-based occurrence
 * (e.g. the second `Example`). Both are validated here against the lesson's
 * real sections — the model never controls a React key. Anything that does not
 * resolve falls back to the trailing lesson-level list, so an old or
 * mismatched anchor never hides a figure.
 */
export interface AnchoredVisualizations {
  /** Keyed by index into the parsed `LessonSection[]`. */
  bySection: Map<number, TutorVisualization[]>
  /** Lesson-level figures, or figures whose anchor did not resolve. */
  trailing: TutorVisualization[]
}

export function anchorVisualizations(
  visualizations: TutorVisualization[] | undefined,
  sections: LessonSection[],
): AnchoredVisualizations {
  const bySection = new Map<number, TutorVisualization[]>()
  const trailing: TutorVisualization[] = []
  if (!visualizations || visualizations.length === 0) return { bySection, trailing }

  const sectionByAnchor = new Map<string, number>()
  const counts = new Map<string, number>()
  sections.forEach((section, index) => {
    const kind = section.spec?.kind
    if (!kind) return
    const occurrence = counts.get(kind) ?? 0
    counts.set(kind, occurrence + 1)
    sectionByAnchor.set(`${kind}:${occurrence}`, index)
  })

  for (const visualization of visualizations) {
    const placement = visualization.placement
    if (placement.scope === 'section') {
      const index = sectionByAnchor.get(`${placement.block}:${placement.index}`)
      if (index !== undefined) {
        const list = bySection.get(index) ?? []
        list.push(visualization)
        bySection.set(index, list)
        continue
      }
    }
    trailing.push(visualization)
  }

  return { bySection, trailing }
}
