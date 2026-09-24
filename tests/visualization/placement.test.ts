import { describe, expect, it } from 'vitest'
import { anchorVisualizations } from '@/entities/tutorVisualization/placement'
import { parseLessonSections } from '@/shared/lib/lessonDocument'
import {
  TUTOR_VISUALIZATION_SCHEMA_VERSION,
  type TutorVisualization,
} from '@/entities/tutorVisualization/types'

function figure(id: string, placement: TutorVisualization['placement']): TutorVisualization {
  return {
    id,
    schemaVersion: TUTOR_VISUALIZATION_SCHEMA_VERSION,
    placement,
    type: 'transform_2d',
    matrix: { a: 1, b: 0, c: 0, d: 1 },
    vectors: [],
    showBasis: true,
    showUnitSquare: true,
    showGrid: true,
    showArea: true,
  }
}

const LESSON = [
  '## Definition',
  '',
  'A transformation maps vectors to vectors.',
  '',
  '## Example',
  '',
  'A = [[2, 0], [0, 1]].',
  '',
  '## Example',
  '',
  'B = [[0, -1], [1, 0]].',
  '',
  '## Summary',
  '',
  'Done.',
].join('\n')

describe('anchorVisualizations', () => {
  it('places a figure after the matching teaching block', () => {
    const sections = parseLessonSections(LESSON)
    const visualization = figure('x', { scope: 'section', block: 'example', index: 1 })
    const { bySection, trailing } = anchorVisualizations([visualization], sections)
    const exampleIndices = sections
      .map((section, index) => ({ kind: section.spec?.kind, index }))
      .filter((entry) => entry.kind === 'example')
      .map((entry) => entry.index)
    expect(exampleIndices).toHaveLength(2)
    expect(bySection.get(exampleIndices[1]!)).toEqual([visualization])
    expect(trailing).toEqual([])
  })

  it('falls back to trailing when the anchor does not resolve', () => {
    const sections = parseLessonSections(LESSON)
    const visualization = figure('x', { scope: 'section', block: 'workedExample', index: 0 })
    const { bySection, trailing } = anchorVisualizations([visualization], sections)
    expect(bySection.size).toBe(0)
    expect(trailing).toEqual([visualization])
  })

  it('keeps lesson-scope figures trailing', () => {
    const sections = parseLessonSections(LESSON)
    const visualization = figure('x', { scope: 'lesson' })
    expect(anchorVisualizations([visualization], sections).trailing).toEqual([visualization])
  })

  it('handles undefined visualizations', () => {
    expect(anchorVisualizations(undefined, []).trailing).toEqual([])
  })
})
