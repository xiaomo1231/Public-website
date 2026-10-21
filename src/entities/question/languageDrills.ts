/**
 * Language-course drills (`subject === 'language'`): the German article of a
 * noun (with its plural) and conjugation / declension / suffix tables. Pure
 * data helpers shared by the generator's validation, the grader and the
 * answer inputs. Answers are plain strings like every other question type:
 *  - article_gender: `<article>\n<plural>` (the plural line may be empty)
 *  - paradigm_table: the blanks' answers in reading order, one per line
 */

export const GERMAN_ARTICLES = ['der', 'die', 'das'] as const
export type GermanArticle = (typeof GERMAN_ARTICLES)[number]

export function isGermanArticle(value: unknown): value is GermanArticle {
  return typeof value === 'string' && (GERMAN_ARTICLES as readonly string[]).includes(value)
}

/** A German noun to give the article (and plural) of. */
export interface GenderNoun {
  /** The noun as written in the course, without article ("Kopf"). */
  noun: string
  /** Its meaning in the explanation language ("头"), shown with the noun. */
  gloss?: string
  article: GermanArticle
  /** The plural form without article ("Köpfe"); absent when not asked. */
  plural?: string
}

/** "der Kopf, die Köpfe" — the form a dictionary (and the course) writes. */
export function genderAnswerText(noun: GenderNoun): string {
  const singular = `${noun.article} ${noun.noun}`
  return noun.plural ? `${singular}, die ${noun.plural}` : singular
}

/** The stored answer of an article question. */
export function encodeGenderAnswer(article: string, plural = ''): string {
  return `${article}\n${plural.replace(/\n/g, ' ')}`
}

export function decodeGenderAnswer(value: string): { article: string; plural: string } {
  const [article = '', plural = ''] = value.split('\n')
  return { article: article.trim(), plural: plural.trim() }
}

/** A plural written with or without its article ("die Köpfe" / "Köpfe") → "Köpfe". */
export function stripPluralArticle(text: string): string {
  return text
    .trim()
    .replace(/^die\s+/i, '')
    .trim()
}

/** One cell of a paradigm table: a given form, or a blank with its accepted forms. */
export interface ParadigmCell {
  text?: string
  accepted?: string[]
}

/** A conjugation / declension / suffix table with some forms left blank. */
export interface ParadigmTable {
  /** "sein — Präsens", "Possessivsuffixe". */
  title: string
  /** Row labels: ich, du, er/sie/es … or Nominativ, Akkusativ … */
  rows: string[]
  /** 1–3 column labels (the tenses, cases, numbers …). */
  columns: string[]
  /** `rows.length` × `columns.length` cells. */
  cells: ParadigmCell[][]
}

/** At most this many blanks per table. */
export const MAX_PARADIGM_BLANKS = 12
export const MAX_PARADIGM_COLUMNS = 3
export const MAX_PARADIGM_ROWS = 10
export const MAX_ACCEPTED_FORMS = 3

export interface ParadigmBlank {
  row: number
  column: number
  accepted: string[]
}

/** The blanks of a table in reading order (row by row). */
export function paradigmBlanks(table: ParadigmTable): ParadigmBlank[] {
  const blanks: ParadigmBlank[] = []
  table.cells.forEach((cells, row) =>
    cells.forEach((cell, column) => {
      if (cell.accepted?.length) blanks.push({ row, column, accepted: cell.accepted })
    }),
  )
  return blanks
}

/**
 * The accessible / feedback name of a cell: "du × Präsens", or just the row
 * when the table has a single column.
 */
export function paradigmCellLabel(table: ParadigmTable, row: number, column: number): string {
  const rowLabel = table.rows[row] ?? ''
  const columnLabel = table.columns[column] ?? ''
  return table.columns.length > 1 && columnLabel ? `${rowLabel} × ${columnLabel}` : rowLabel
}

/** "du: bist；er/sie/es: ist" — the expected forms, labelled. */
export function paradigmAnswerText(table: ParadigmTable): string {
  return paradigmBlanks(table)
    .map((blank) => `${paradigmCellLabel(table, blank.row, blank.column)}: ${blank.accepted[0]}`)
    .join('；')
}
