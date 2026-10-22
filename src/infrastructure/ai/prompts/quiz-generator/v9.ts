/**
 * v9 quiz-generator prompt: university chemistry and physics conventions.
 *  - `sigFigs` (option, chemistry / physics or a professor habit): a numeric
 *    answer may require a number of significant figures; the app judges value,
 *    unit and significant figures separately.
 *  - New types: `vector` (components or magnitude + direction, physics and
 *    maths), `nomenclature` (chemical name ↔ formula, chemistry) and
 *    `force_list` (the forces of a free-body diagram, physics). Described only
 *    when the quiz plans them (`types`), like v8.
 *  - Professor conventions (from the 教授出题习惯 profile): a final "none of
 *    the options are correct" choice that can be the answer, marks shown per
 *    sub-part, reliance on the course data / formula sheet, context stories
 *    with irrelevant details. Each only when the profile has it.
 * Without any of these (no option, none of the new types, no conventions) the
 * system and user prompts are v8's, word for word. v8 is kept unchanged.
 */

import * as V8 from './v8'

export const VERSION = 'v9' as const
export const PROMPT_KIND = 'quiz-generator' as const

export type QuizQuestionType = V8.QuizQuestionType | 'vector' | 'nomenclature' | 'force_list'

/** A professor convention the quiz should follow (from the habits profile). */
export type ProfessorConvention =
  'none_of_above' | 'marks_per_part' | 'data_sheet' | 'context_story' | 'sig_figs'

export interface QuizGenerationInput extends Omit<V8.QuizGenerationInput, 'plan'> {
  plan: Array<{
    difficulty: V8.QuizGenerationInput['plan'][number]['difficulty']
    type: QuizQuestionType
  }>
  /**
   * Conventions read from the professor's habits profile. Absent or empty: the
   * user prompt is v8's word for word.
   */
  professorConventions?: ProfessorConvention[]
  /** `none_of_above`: the professor's own wording of the final option. */
  noneOptionLabel?: string
}

export interface GeneratedQuizQuestion extends Omit<V8.GeneratedQuizQuestion, 'type'> {
  type: QuizQuestionType
  /** numeric only: required significant figures, or null. */
  sigFigs?: number | null
  /** numeric with `sigFigs`: why ('stated' | 'data'). */
  sigFigsBasis?: string | null
  /** vector only: the components [x, y] or [x, y, z] in `unit`. */
  components?: number[] | null
  /** nomenclature only. */
  direction?: string | null
  /** nomenclature only: the formula in plain mhchem syntax. */
  formula?: string | null
  /** nomenclature only: accepted names, standard first. */
  names?: string[] | null
  /** force_list only. */
  forces?: Array<{ type?: string; angle?: number; magnitude?: number | null }> | null
}

export interface QuizGenerationOutput {
  questions: GeneratedQuizQuestion[]
}

export interface QuizSystemPromptOptions extends Omit<V8.QuizSystemPromptOptions, 'types'> {
  types?: readonly QuizQuestionType[]
  /** Describe the `sigFigs` field for numeric answers. */
  sigFigs?: boolean
  /** The professor ends multiple-choice options with a "none of the options" choice. */
  noneOfTheAbove?: boolean
}

const NEW_TYPES: readonly QuizQuestionType[] = ['vector', 'nomenclature', 'force_list']

const NONE_OF_ABOVE_LINE =
  '     - Do not use "all of the above", "none of the above" or options that are merely the answer with its parts swapped unless that swap is a real, commonly confused alternative.'

function newTypeRules(types: ReadonlySet<string>): string[] {
  const rules: string[] = []
  if (types.has('vector'))
    rules.push(
      '  V1. For `vector`: ask for a vector quantity (a displacement, velocity, acceleration, force, field) that the student gives either as components or as magnitude and direction. Set `components` to the reference components [x, y] (or [x, y, z]) as numbers in `unit`, with +x east / right and +y north / up; `unit` is the unit in mathjs syntax (`m/s^2`, `N`) or null for a pure vector. `correctAnswer` repeats the vector, e.g. "(-0.903, 2.84) m/s^2". The prompt says which form is expected only when the course does (e.g. "give the magnitude and direction"); both forms are accepted. For a direction, state the convention the question uses (compass bearings such as "17.7° W of N", or an angle from the +x axis).',
    )
  if (types.has('nomenclature'))
    rules.push(
      '  V2. For `nomenclature` (chemistry): either give a name and ask for the formula (`direction`: "name_to_formula") or give a formula and ask for the name (`direction`: "formula_to_name"). `formula` is the species in plain mhchem syntax WITHOUT \\ce{}: `Fe2(SO4)3`, `CuSO4·5H2O`, `NH4^+`, a nuclide as `^{54}Cr^{6+}`. `names` lists the accepted names, the IUPAC / systematic name first, then accepted alternatives (a Stock name and a classical name, e.g. ["iron(III) sulfate", "ferric sulfate"]). `correctAnswer` is the formula for name_to_formula, the first name for formula_to_name. The prompt shows only the given side (write a formula in $\\ce{…}$), never the answer.',
    )
  if (types.has('force_list'))
    rules.push(
      '  V3. For `force_list` (physics, free-body diagram): describe one body and its situation, and ask for every force acting on it. `forces` lists each force on that body as `{ "type": "gravity" | "normal" | "tension" | "friction" | "applied" | "spring" | "drag" | "buoyancy" | "electric" | "magnetic", "angle": degrees counter-clockwise from +x (right = 0, up = 90, down = 270), "magnitude": newtons or null }`. Include exactly the forces that act on the body (never forces the body exerts on others, never net force or "ma"). `correctAnswer` repeats them in words.',
    )
  return rules
}

const SIG_FIG_RULE =
  '  S1. Significant figures (numeric answers computed from measured data): set `sigFigs` to the number of significant figures the answer must have — as many as the least precise datum for a product or quotient (or as the question explicitly asks) — and `sigFigsBasis` to "stated" when the question explicitly asks for that number of significant figures, otherwise "data". Write `correctAnswer` with exactly that many significant figures (scientific notation such as 1.50e3 when trailing zeros would be ambiguous). For counted or exact values (and every non-numeric type) set `sigFigs` to null.'

function noneOfAboveRule(): string {
  return '     - This professor ends every `multiple_choice` question with a final option stating that none of the other options is correct (the wording is given in the user prompt). Add it as the LAST option. It must sometimes be the correct answer (about one question in five): then every other option must be genuinely wrong. When another option is correct, the final option is false.'
}

const SCHEMA_ADDITIONS: Record<string, unknown> = {
  sigFigs: 'number | null (numeric only: required significant figures)',
  sigFigsBasis: '"stated" | "data" | null',
  components: ['number (vector only: x, y[, z])'],
  direction: '"name_to_formula" | "formula_to_name" | null (nomenclature only)',
  formula: 'string | null (nomenclature only)',
  names: ['string (nomenclature only: accepted names, standard first)'],
  forces: [{ type: 'string (force_list only)', angle: 'number', magnitude: 'number | null' }],
}

export function buildSystemPrompt(options: QuizSystemPromptOptions = {}): string {
  const { types, sigFigs, noneOfTheAbove, ...rest } = options
  const planned = new Set<string>(types ?? [])
  const newTypes = NEW_TYPES.filter((type) => planned.has(type))
  const oldTypes = (types ?? []).filter(
    (type): type is V8.QuizQuestionType => !(NEW_TYPES as readonly string[]).includes(type),
  )
  // A quiz of only new types still needs v8's general rules: plan numeric for
  // its structure (rules filtered to the always-on ones plus numeric).
  const v8Types: V8.QuizQuestionType[] | undefined =
    types && types.length > 0 ? (oldTypes.length > 0 ? oldTypes : ['numeric']) : undefined
  let prompt = V8.buildSystemPrompt({ ...rest, ...(v8Types ? { types: v8Types } : {}) })
  const sigFigRule = sigFigs && (planned.size === 0 || planned.has('numeric'))
  const noneRule = noneOfTheAbove && (planned.size === 0 || planned.has('multiple_choice'))
  if (newTypes.length === 0 && !sigFigRule && !noneRule) return prompt

  if (noneRule && prompt.includes(NONE_OF_ABOVE_LINE))
    prompt = prompt.replace(NONE_OF_ABOVE_LINE, noneOfAboveRule())
  if (newTypes.length > 0 && oldTypes.length === 0 && types) {
    // Only the new types are planned: the numeric rule was only a carrier.
    prompt = prompt.replace(/\n {2}\d+\. For `numeric`[^\n]*(?:\n {5}- [^\n]*)*/, '')
  }
  const added = [...newTypeRules(planned), ...(sigFigRule ? [SIG_FIG_RULE] : [])]
  const lines = prompt.split('\n')
  const rulesEnd = lines.findIndex(
    (line, i) => i > 0 && line === '' && lines.slice(0, i).includes('Rules:'),
  )
  if (added.length > 0 && rulesEnd > 0) lines.splice(rulesEnd, 0, ...added)
  prompt = lines.join('\n')

  // Schema: the new types in the type list, and their fields.
  const schemaStart = prompt.indexOf('JSON schema:\n')
  if (schemaStart < 0) return prompt
  const jsonStart = schemaStart + 'JSON schema:\n'.length
  const jsonEnd = prompt.indexOf('\n\n', jsonStart)
  try {
    const schema = JSON.parse(prompt.slice(jsonStart, jsonEnd)) as {
      questions: Array<Record<string, unknown>>
    }
    const question = schema.questions[0]!
    const typeList =
      types && types.length > 0
        ? [...oldTypes, ...newTypes].join(' | ')
        : `${String(question.type)} | ${newTypes.join(' | ')}`
    const fields: Record<string, unknown> = { ...question, type: typeList }
    const want = (key: string) =>
      (key === 'sigFigs' || key === 'sigFigsBasis'
        ? sigFigRule
        : key === 'components'
          ? newTypes.includes('vector')
          : key === 'forces'
            ? newTypes.includes('force_list')
            : newTypes.includes('nomenclature')) === true
    for (const [key, value] of Object.entries(SCHEMA_ADDITIONS)) if (want(key)) fields[key] = value
    if (newTypes.includes('vector') && !('unit' in fields))
      fields.unit = 'string | null (numeric / vector only)'
    const json = JSON.stringify({ questions: [fields] }, null, 2)
    return `${prompt.slice(0, jsonStart)}${json}${prompt.slice(jsonEnd)}`
  } catch {
    return prompt
  }
}

const CONVENTION_LINES: Record<Exclude<ProfessorConvention, 'none_of_above'>, string> = {
  marks_per_part:
    'Show the marks of each question or sub-part the way this professor does (e.g. "(2 marks)"), in proportion to the work it needs.',
  data_sheet:
    "This professor's students have a data / formula sheet: do not restate standard constants or formulas it contains (molar masses, R, g, standard equations); the student is expected to look them up.",
  context_story:
    'Like this professor, set calculation questions in a short realistic context that may include a detail not needed for the answer; the data needed must still be complete and unambiguous.',
  sig_figs:
    'This professor grades significant figures strictly: every numeric answer from measured data must state or imply its required significant figures (set `sigFigs`).',
}

export function buildUserPrompt(input: QuizGenerationInput): string {
  const { professorConventions, noneOptionLabel, ...rest } = input
  const base = V8.buildUserPrompt(rest as V8.QuizGenerationInput)
  const conventions = professorConventions ?? []
  if (conventions.length === 0) return base
  const lines = ['PROFESSOR CONVENTIONS (follow them in every question where they apply):']
  if (conventions.includes('none_of_above'))
    lines.push(
      `- Every multiple-choice question ends with the option "${(noneOptionLabel ?? 'None of the options are correct').replace(/"/g, "'")}" (copy this wording exactly); it is sometimes the correct answer.`,
    )
  for (const convention of conventions)
    if (convention !== 'none_of_above') lines.push(`- ${CONVENTION_LINES[convention]}`)
  // Stable for the whole quiz: before the source material, so batches still
  // share their prefix (see v8).
  const marker = '\n=== BEGIN SOURCE MATERIAL '
  const at = base.indexOf(marker)
  const section = lines.join('\n')
  return at >= 0 ? `${base.slice(0, at)}\n${section}${base.slice(at)}` : `${base}\n${section}`
}
