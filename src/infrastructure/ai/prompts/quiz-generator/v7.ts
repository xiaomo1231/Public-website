/**
 * v7 quiz-generator prompt: language-course drills.
 *  - `article_gender` (German courses only): a noun from the course material;
 *    the student picks der / die / das and, when the course gives it, writes
 *    the plural. The app shows the noun, the three articles and the plural
 *    field itself; graded locally.
 *  - `paradigm_table` (language courses): a conjugation / declension / suffix
 *    table taken from the material with some forms left blank; graded locally
 *    cell by cell by exact spelling.
 * Both are only described to the model for a `language` course (the article
 * drill only when it teaches German); for every other course the system and
 * user prompts are v6's, word for word. v6 is kept unchanged.
 */

import * as V6 from './v6'

export const VERSION = 'v7' as const
export const PROMPT_KIND = 'quiz-generator' as const

export type QuizQuestionType = V6.QuizQuestionType | 'article_gender' | 'paradigm_table'

export interface QuizGenerationInput extends Omit<V6.QuizGenerationInput, 'plan'> {
  plan: Array<{
    difficulty: V6.QuizGenerationInput['plan'][number]['difficulty']
    type: QuizQuestionType
  }>
}

/** A table as the model writes it: each cell a given form or a blank's accepted forms. */
export interface GeneratedParadigm {
  title?: string | null
  rows?: string[] | null
  columns?: string[] | null
  cells?: Array<Array<{ text?: string | null; answers?: string[] | null }>> | null
}

export interface GeneratedQuizQuestion extends Omit<V6.GeneratedQuizQuestion, 'type'> {
  type: QuizQuestionType
  /** article_gender only: the noun as written in the material, without article. */
  noun?: string | null
  /** article_gender only: its meaning in the response language. */
  gloss?: string | null
  /** article_gender only. */
  article?: string | null
  /** article_gender only: the plural without article, or null when the material gives none. */
  plural?: string | null
  /** paradigm_table only. */
  table?: GeneratedParadigm | null
}

export interface QuizGenerationOutput {
  questions: GeneratedQuizQuestion[]
}

export interface QuizSystemPromptOptions {
  /**
   * The course teaches this language (`Project.targetLanguage`): describe the
   * language drills. Absent for every other course.
   */
  languageDrills?: { targetLanguage?: string }
}

const LANGUAGE_NAMES: Record<string, string> = { de: 'German', hu: 'Hungarian' }

function drillRules(targetLanguage: string | undefined): string[] {
  const german = targetLanguage === 'de'
  const language = (targetLanguage && LANGUAGE_NAMES[targetLanguage]) || 'the target language'
  return [
    '',
    `Language-course drills (the course teaches ${language}):`,
    '  L1. Every word, form and table you use must be copied from the SOURCE MATERIAL exactly as written there (spelling, accents, umlauts, capitals). Never invent a noun, a form or a table the material does not contain; if the material has none, generate a different question of the planned type from what it does contain.',
    ...(german
      ? [
          '  L2. For `article_gender`: pick a German noun that the material shows WITH its definite article (e.g. in a word list "der Kopf, die Köpfe" or "das Organ, -e"). Set `noun` to the noun without article ("Kopf"), `article` to exactly "der", "die" or "das" as the material gives it, `plural` to the plural without article ("Köpfe") only when the material writes it out, otherwise null, and `gloss` to its meaning in the response language. `prompt` is a short instruction such as "选择冠词并写出复数" (no answer in it). `options` is null; the app shows der / die / das itself. `correctAnswer` repeats the dictionary form: "der Kopf, die Köpfe" (or "der Kopf" without a plural).',
        ]
      : []),
    `  L3. For \`paradigm_table\`: reproduce a conjugation, declension, possessive or suffix table from the material (e.g. "sein — Präsens" with rows ich / du / er/sie/es / wir / ihr / sie/Sie). \`table.title\` names it; \`table.rows\` lists 2–10 row labels; \`table.columns\` lists 1–3 column labels; \`table.cells\` has exactly one array per row with exactly one cell per column. A cell is either \`{ "text": "bin" }\` (shown to the student) or \`{ "answers": ["bist"] }\` (a blank, with 1–3 accepted forms, the form the material uses first). Leave 1–12 cells blank and give the rest. \`prompt\` says what to fill in. \`correctAnswer\` repeats the blanks' first forms joined by " | ".`,
  ]
}

const SCHEMA_ADDITIONS = {
  noun: 'string | null (article_gender only)',
  gloss: 'string | null (article_gender only)',
  article: '"der" | "die" | "das" | null (article_gender only)',
  plural: 'string | null (article_gender only)',
  table: {
    title: 'string',
    rows: ['string'],
    columns: ['string'],
    cells: [[{ text: 'string (given form)', answers: ['string (blank: accepted forms)'] }]],
  },
}

export function buildSystemPrompt(options: QuizSystemPromptOptions = {}): string {
  const base = V6.buildSystemPrompt()
  if (!options.languageDrills) return base
  const german = options.languageDrills.targetLanguage === 'de'
  const types = german ? 'article_gender | paradigm_table' : 'paradigm_table'
  const schema = {
    ...SCHEMA_ADDITIONS,
    ...(german ? {} : { noun: undefined, gloss: undefined, article: undefined, plural: undefined }),
  }
  // The language types and fields go into the JSON schema; the rest of v6
  // stays as it is.
  const withTypes = base.replace('| fill_blank"', `| fill_blank | ${types}"`)
  const marker = 'Security rules (apply unconditionally):'
  const at = withTypes.indexOf(marker)
  const addition = [
    ...drillRules(options.languageDrills.targetLanguage),
    '',
    'Additional JSON fields for the drills (inside each question object):',
    JSON.stringify(schema, null, 2),
    '',
  ].join('\n')
  return at >= 0 ? `${withTypes.slice(0, at)}${addition}\n${withTypes.slice(at)}` : withTypes
}

export function buildUserPrompt(input: QuizGenerationInput): string {
  return V6.buildUserPrompt(input as V6.QuizGenerationInput)
}
