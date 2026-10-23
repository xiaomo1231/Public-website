import { verifyAiPart } from '@/entities/homework/practice/verify'
import type { PracticePart } from '@/entities/homework/practice/types'
import { createRng } from '@/entities/homework/practice/random'
import { asVectorComponents, compareVector } from '@/infrastructure/math/vectorAnswer'
import { isValidUnit } from '@/infrastructure/math/quantityAnswer'
import {
  nameAccepted,
  normalizeChemicalName,
  parseFormulaAnswer,
} from '@/infrastructure/chemistry/nomenclature'
import { isNoneOption, shuffledOptions } from '@/shared/lib/shuffle'
import type { GeneratedMockQuestion } from '@/infrastructure/ai/prompts/mock-paper/v1'
import { parseQuestionMarks } from './marks'
import type { MockCandidate, MockLanguage, MockSlotSpec } from './mockPaper'

/**
 * Local checks of one AI 模拟卷 question before the AI review:
 *
 * - **Structure**: the slot's sub-part labels, and the marks of every part as
 *   the past paper printed them.
 * - **Answers**: recomputed where a grader exists (linear systems, numbers
 *   with units and significant figures, balanced equations — as for practice
 *   sets — plus vectors and nomenclature); a disagreeing answer fails.
 * - **Multiple choice**: 3–6 distinct options, one right letter, the right
 *   option not standing out by length; the professor's "None of the options"
 *   choice (when that is their convention) present and kept last.
 * - **Marking scheme**: every part has one (平台拟定).
 *
 * The question is rendered with its marks the way papers print them, and the
 * marks are read back with `parseQuestionMarks` (what the mock exam uses).
 */

export type MockRejectCode =
  'structure' | 'marks' | 'options' | 'none_option' | 'answer_check' | 'missing_answer' | 'scheme'

export type MockVerifyResult =
  { ok: true; candidate: MockCandidate } | { ok: false; code: MockRejectCode; detail?: string }

export interface MockVerifyContext {
  language: MockLanguage
  /** The professor's last option, when "None of the options" is their convention. */
  noneOption?: string
  /** Seed of the option order (reproducible). */
  seed: string
  /** Economics course: numeric answers are money / percentages (`$1,800`, `10%`). */
  economics?: boolean
}

const LETTERS = 'ABCDEF'

/** "(3 marks)" / "（3分）", as the paper's language prints marks. */
export function marksText(marks: number, language: MockLanguage): string {
  if (language === 'zh' || language === 'zh_terms') return `（${marks}分）`
  return `(${marks} ${marks === 1 ? 'mark' : 'marks'})`
}

function normalizeOption(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim()
}

function standsOut(correct: string, others: readonly string[]): boolean {
  const longest = Math.max(0, ...others.map((text) => text.length))
  return correct.length > 1.6 * longest && correct.length - longest >= 12
}

function verifyChoice(
  raw: GeneratedMockQuestion,
  slot: MockSlotSpec,
  ctx: MockVerifyContext,
): { ok: true; options: string[]; correct: string } | { ok: false; code: MockRejectCode } {
  const options = raw.options
  if (options.length < 3 || options.length > 6) return { ok: false, code: 'options' }
  if (new Set(options.map(normalizeOption)).size !== options.length)
    return { ok: false, code: 'options' }
  const index = LETTERS.indexOf(raw.correct)
  if (raw.correct.length !== 1 || index < 0 || index >= options.length)
    return { ok: false, code: 'options' }
  const labelled = options.map((label, i) => ({ label, isCorrect: i === index }))
  const nones = labelled.filter((option) => isNoneOption(option.label))
  if (ctx.noneOption !== undefined && nones.length !== 1) return { ok: false, code: 'none_option' }
  if (nones.length > 1) return { ok: false, code: 'options' }
  const right = labelled[index]!
  if (
    !isNoneOption(right.label) &&
    standsOut(
      right.label,
      labelled
        .filter((option) => !option.isCorrect && !isNoneOption(option.label))
        .map((o) => o.label),
    )
  )
    return { ok: false, code: 'options' }
  const rng = createRng(`${ctx.seed}:${slot.id}:options`)
  // A single "None of the options" choice stays in last place.
  const order = shuffledOptions(labelled, () => rng.next())
  const correct = LETTERS[order.findIndex((option) => option.isCorrect)]!
  return { ok: true, options: order.map((option) => option.label), correct }
}

function verifyVector(
  raw: GeneratedMockQuestion['parts'][number],
): { ok: true; part: PracticePart } | { ok: false } {
  const components = asVectorComponents(raw.check?.components)
  if (!components) return { ok: false }
  const unit = typeof raw.check?.unit === 'string' ? raw.check.unit.trim() : ''
  if (unit && !isValidUnit(unit)) return { ok: false }
  const spec = { components, ...(unit ? { unit } : {}) }
  if (!raw.answer || compareVector(raw.answer, spec).outcome !== 'correct') return { ok: false }
  return {
    ok: true,
    part: {
      ...(raw.label ? { label: raw.label } : {}),
      prompt: raw.prompt,
      answer: raw.answer,
      solution: raw.solution,
      grader: { kind: 'vector', components, ...(unit ? { unit } : {}) },
    },
  }
}

function verifyNomenclature(
  raw: GeneratedMockQuestion['parts'][number],
  stem: string,
): { ok: true; part: PracticePart } | { ok: false } {
  const check = raw.check ?? {}
  const direction =
    check.direction === 'name_to_formula' || check.direction === 'formula_to_name'
      ? check.direction
      : null
  const formula = typeof check.formula === 'string' ? check.formula.trim() : ''
  const names = Array.isArray(check.names)
    ? check.names.filter((name): name is string => typeof name === 'string' && !!name.trim())
    : []
  if (!direction || !formula || names.length === 0 || !parseFormulaAnswer(formula))
    return { ok: false }
  const question = `${stem}\n${raw.prompt}`
  // The answer must not be given away by the question.
  if (direction === 'name_to_formula') {
    if (question.replace(/\s+/g, '').includes(formula.replace(/\s+/g, ''))) return { ok: false }
  } else {
    const normalized = normalizeChemicalName(question)
    if (names.some((name) => normalized.includes(normalizeChemicalName(name)))) return { ok: false }
    if (raw.answer && !nameAccepted(raw.answer, names)) return { ok: false }
  }
  return {
    ok: true,
    part: {
      ...(raw.label ? { label: raw.label } : {}),
      prompt: raw.prompt,
      answer: direction === 'name_to_formula' ? formula : names[0]!,
      solution: raw.solution,
      grader: { kind: 'nomenclature', direction, formula, names },
    },
  }
}

export function verifyMockQuestion(
  raw: GeneratedMockQuestion,
  slot: MockSlotSpec,
  ctx: MockVerifyContext,
): MockVerifyResult {
  // 1. Structure: the slot's sub-parts, in order.
  const expected = slot.parts.map((part) => part.label)
  if (expected.length >= 2) {
    const got = raw.parts.map((part) => part.label ?? '')
    if (got.length !== expected.length || got.some((label, i) => label !== expected[i]))
      return { ok: false, code: 'structure' }
  } else if (raw.parts.length !== 1) return { ok: false, code: 'structure' }

  // 2. Marks as printed on the past paper.
  if (expected.length >= 2) {
    for (const [i, part] of slot.parts.entries()) {
      const got = raw.parts[i]!.marks
      if (part.marks !== undefined && got !== undefined && got !== part.marks)
        return { ok: false, code: 'marks' }
    }
  } else if (slot.marks !== undefined && raw.parts[0]!.marks !== undefined) {
    if (raw.parts[0]!.marks !== slot.marks) return { ok: false, code: 'marks' }
  }

  // 3. Answers, checked locally where possible.
  const language = ctx.language === 'zh' || ctx.language === 'zh_terms' ? 'zh' : 'en'
  const parts: PracticePart[] = []
  let options: string[] = []
  if (slot.kind === 'multiple_choice' && expected.length < 2) {
    const choice = verifyChoice(raw, slot, ctx)
    if (!choice.ok) return { ok: false, code: choice.code }
    options = choice.options
    const part = raw.parts[0]!
    parts.push({
      prompt: part.prompt,
      answer: `${choice.correct}. ${options[LETTERS.indexOf(choice.correct)]}`,
      solution: part.solution,
      grader: { kind: 'choice', correct: choice.correct, count: options.length },
    })
  } else {
    for (const part of raw.parts) {
      const type = typeof part.check?.type === 'string' ? part.check.type : ''
      if (type === 'vector') {
        const result = verifyVector(part)
        if (!result.ok) return { ok: false, code: 'answer_check', detail: 'vector' }
        parts.push(result.part)
        continue
      }
      if (type === 'nomenclature') {
        const result = verifyNomenclature(part, raw.stem)
        if (!result.ok) return { ok: false, code: 'answer_check', detail: 'nomenclature' }
        parts.push(result.part)
        continue
      }
      const verified = verifyAiPart(
        {
          ...(part.label ? { label: part.label } : {}),
          prompt: part.prompt,
          answer: part.answer,
          solution: part.solution,
          check: type === 'vector' || type === 'nomenclature' ? null : part.check,
        },
        undefined,
        language,
        ctx.economics ? { economics: true } : {},
      )
      if (!verified.ok)
        return {
          ok: false,
          code: verified.reason === 'missing-answer' ? 'missing_answer' : 'answer_check',
          detail: verified.reason,
        }
      parts.push(verified.part)
    }
  }
  if (expected.length < 2) parts.splice(0, parts.length, ...withoutLabels(parts))

  // 4. A marking scheme for every part.
  if (raw.parts.some((part) => part.scheme.length === 0)) return { ok: false, code: 'scheme' }

  const candidate = renderCandidate(raw, slot, parts, options, ctx.language)
  // 5. The printed marks read back as the slot's (what the mock exam shows).
  const read = parseQuestionMarks(candidate.prompt)
  if (slot.marks !== undefined && read.total !== slot.marks) return { ok: false, code: 'marks' }
  for (const part of slot.parts) {
    if (part.marks === undefined) continue
    if (read.parts.find((item) => item.label === part.label)?.marks !== part.marks)
      return { ok: false, code: 'marks' }
  }
  return { ok: true, candidate }
}

function withoutLabels(parts: readonly PracticePart[]): PracticePart[] {
  return parts.map((part) => {
    const { label: _label, ...rest } = part
    void _label
    return rest
  })
}

/** The printed question, the reference solution and the scheme. */
export function renderCandidate(
  raw: GeneratedMockQuestion,
  slot: MockSlotSpec,
  parts: PracticePart[],
  options: string[],
  language: MockLanguage,
): MockCandidate {
  const multi = slot.parts.length >= 2
  const partMarksStated = slot.parts.some((part) => part.marks !== undefined)
  const blocks: string[] = []
  let stem = raw.stem.trim()
  if (multi) {
    // Marks for the whole question only: printed after the shared statement.
    if (slot.marks !== undefined && !partMarksStated)
      stem = `${stem}${stem ? ' ' : ''}${marksText(slot.marks, language)}`
    if (stem) blocks.push(stem)
    slot.parts.forEach((spec, i) => {
      const part = parts[i]!
      const marks = spec.marks !== undefined ? ` ${marksText(spec.marks, language)}` : ''
      blocks.push(`(${spec.label}) ${part.prompt}${marks}`)
    })
  } else {
    if (stem) blocks.push(stem)
    const marks = slot.marks !== undefined ? ` ${marksText(slot.marks, language)}` : ''
    blocks.push(`${parts[0]!.prompt}${marks}`)
    if (options.length) blocks.push(options.map((text, i) => `${LETTERS[i]}. ${text}`).join('\n'))
  }
  const scheme = raw.parts.flatMap((part, i) =>
    part.scheme.map((line) => (multi ? `(${slot.parts[i]!.label}) ${line}` : line)),
  )
  const solution = parts
    .map((part) =>
      [part.label ? `### (${part.label})` : '', part.solution, `**${part.answer}**`]
        .filter(Boolean)
        .join('\n\n'),
    )
    .join('\n\n')
  return { prompt: blocks.join('\n\n'), parts, scheme, solution }
}
