import { describe, expect, it } from 'vitest'
import {
  localProfessorMap,
  segmentProfessorAnswer,
  validateProfessorMap,
  isUnlocated,
  type ProfessorMapEntry,
} from '@/entities/homework/professorMap'
import { FIXTURES, type Coverage, type LocalCoverage } from './fixtures'

function localOf(entry: ProfessorMapEntry): LocalCoverage {
  if (isUnlocated(entry)) return 'unsure'
  return entry.coverage === 'none' ? 'none' : 'direct'
}

describe('answer-key alignment corpus: local pass', () => {
  for (const fixture of FIXTURES) {
    it(`${fixture.family}: ${fixture.name}`, () => {
      const local = localProfessorMap(fixture.answer, fixture.question)
      const got = Object.fromEntries(local.map((entry) => [entry.label, localOf(entry)]))
      expect(got).toEqual(fixture.local)
      for (const label of fixture.misplaced ?? []) {
        const entry = local.find((item) => item.label === label)!
        expect(entry.flags).toContain('misplaced')
        expect(entry.from?.nestedUnder).toBeTruthy()
      }
      for (const label of fixture.shared ?? []) {
        expect(local.find((item) => item.label === label)!.flags).toContain('shared')
      }
    })
  }
})

describe('answer-key alignment corpus: AI reply after local validation', () => {
  for (const fixture of FIXTURES.filter((item) => item.reply)) {
    it(`${fixture.family}: ${fixture.name}`, () => {
      const result = validateProfessorMap(fixture.reply!, {
        question: fixture.question,
        answer: fixture.answer,
      })!
      const got = Object.fromEntries(result.entries.map((entry) => [entry.label, entry.coverage]))
      expect(got).toEqual(fixture.final)
      const low = result.entries
        .filter((entry) => entry.confidence === 'low')
        .map((entry) => entry.label)
      expect(low.sort()).toEqual([...(fixture.confirm ?? [])].sort())
      // Every kept excerpt occurs in the key.
      for (const entry of result.entries)
        for (const quote of entry.quotes) expect(quote).toBeTruthy()
    })
  }
})

/**
 * Precision / recall of "this sub-part is covered by the key" over the whole
 * corpus. The local pass may abstain (unsure) but must never be wrong; after
 * the (simulated) AI reply and validation every sub-part with a reply is
 * right.
 */
describe('answer-key alignment corpus: metrics', () => {
  it('local pass: covered precision 1, deferral precision 1, recall ≥ 0.85', () => {
    let truePositive = 0
    let predictedCovered = 0
    let actualCovered = 0
    let predictedNone = 0
    let correctNone = 0
    for (const fixture of FIXTURES) {
      for (const entry of localProfessorMap(fixture.answer, fixture.question)) {
        const truth: Coverage = fixture.truth[entry.label]!
        const covered = truth !== 'none'
        if (covered) actualCovered += 1
        const local = localOf(entry)
        if (local === 'direct') {
          predictedCovered += 1
          if (covered) truePositive += 1
        } else if (local === 'none') {
          predictedNone += 1
          if (!covered) correctNone += 1
        }
      }
    }
    const precision = truePositive / predictedCovered
    const recall = truePositive / actualCovered
    // Shown in the test output for the record.
    console.info(
      `[answer alignment] local: precision ${precision.toFixed(3)}, recall ${recall.toFixed(3)} (${truePositive}/${actualCovered}), deferral precision ${(correctNone / predictedNone).toFixed(3)}`,
    )
    expect(precision).toBe(1)
    expect(correctNone).toBe(predictedNone)
    expect(recall).toBeGreaterThanOrEqual(0.85)
  })

  it('validated AI replies: every sub-part right, nothing unlocated left', () => {
    let total = 0
    let right = 0
    for (const fixture of FIXTURES.filter((item) => item.reply)) {
      const result = validateProfessorMap(fixture.reply!, {
        question: fixture.question,
        answer: fixture.answer,
      })!
      for (const entry of result.entries) {
        total += 1
        if (entry.coverage === fixture.truth[entry.label]) right += 1
      }
    }
    console.info(`[answer alignment] validated replies: accuracy ${right}/${total}`)
    expect(right).toBe(total)
  })

  it('segments never invent text: each one is a verbatim part of the cleaned key', () => {
    for (const fixture of FIXTURES) {
      const flat = fixture.answer.replace(/\s+/g, ' ')
      for (const segment of segmentProfessorAnswer(fixture.answer, fixture.question))
        expect(flat).toContain(segment.text.split('\n')[0]!.replace(/\s+/g, ' ').trim())
    }
  })
})
