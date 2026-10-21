import {
  GERMAN_ARTICLES,
  MAX_ACCEPTED_FORMS,
  MAX_PARADIGM_BLANKS,
  MAX_PARADIGM_COLUMNS,
  MAX_PARADIGM_ROWS,
  isGermanArticle,
  stripPluralArticle,
  type GenderNoun,
  type ParadigmCell,
  type ParadigmTable,
} from '@/entities/question/languageDrills'

/**
 * Checks for AI-generated language drills against the course text they were
 * generated from. A noun, plural or table form must occur in that text —
 * the model may only copy, never invent — and the structure must be
 * consistent. Anything that fails is dropped (the quiz tops the gap up).
 * Pure functions.
 */

/** Text as compared: composed, soft hyphens gone, spaces collapsed, lower-case. Accents stay. */
export function normalizeForSource(text: string): string {
  return text.normalize('NFC').replace(/­/g, '').replace(/\s+/g, ' ').trim().toLowerCase()
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * True when `form` occurs in the (normalised) source as a whole word or
 * phrase: "Kopf" is found in "der Kopf, die Köpfe" but not in "Kopfschmerz";
 * accents must match ("hasam" ≠ "hásam").
 */
export function appearsInSource(form: string, normalizedSource: string): boolean {
  const needle = normalizeForSource(form)
  if (!needle) return false
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(needle)}(?![\\p{L}\\p{N}])`, 'u')
  return pattern.test(normalizedSource)
}

const MAX_FORM_LENGTH = 60
const MAX_LABEL_LENGTH = 40

function cleanForm(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
}

/** "—", "-", "null", "none": the model's way of saying there is no plural. */
function isNoForm(text: string): boolean {
  return !text || /^[-–—/]+$/.test(text) || /^(null|none|n\/a|kein(e)?|nincs)$/i.test(text)
}

/**
 * The source writes this noun with a different article in a dictionary-style
 * entry ("die Hand, die Hände", "das Organ, -e") and never with the given
 * one: the model's article contradicts the course.
 */
export function sourceContradictsArticle(
  noun: string,
  article: string,
  normalizedSource: string,
): boolean {
  const word = escapeRegExp(normalizeForSource(noun))
  const entry = (a: string) =>
    new RegExp(`(?<![\\p{L}])${a} ${word}(?=\\s*(?:[,;:(–—-]|pl\\.|$))`, 'u').test(normalizedSource)
  if (entry(article)) return false
  return GERMAN_ARTICLES.some((other) => other !== article && entry(other))
}

export interface RawArticleQuestion {
  noun?: unknown
  gloss?: unknown
  article?: unknown
  plural?: unknown
  correctAnswer?: unknown
}

/**
 * A German article drill, or null when it cannot be trusted: the article is
 * not der / die / das, the noun is not a capitalised word of the source, the
 * plural is not in the source, the answer text names another article or
 * noun, or the source's own word list gives the noun another article.
 */
export function validateArticleQuestion(
  raw: RawArticleQuestion,
  normalizedSource: string,
): GenderNoun | null {
  let noun = cleanForm(raw.noun)
  let article = cleanForm(raw.article).toLowerCase()
  // "der Kopf" given as the noun: the article is split off.
  const prefixed = /^(der|die|das)\s+(.+)$/i.exec(noun)
  if (prefixed) {
    if (article && article !== prefixed[1]!.toLowerCase()) return null
    article = prefixed[1]!.toLowerCase()
    noun = prefixed[2]!.trim()
  }
  if (!isGermanArticle(article)) return null
  if (!noun || noun.length > MAX_FORM_LENGTH || /[\n,;]/.test(noun)) return null
  // German nouns are capitalised; anything else is not a noun entry.
  if (!/^\p{Lu}/u.test(noun)) return null
  if (!appearsInSource(noun, normalizedSource)) return null
  if (sourceContradictsArticle(noun, article, normalizedSource)) return null

  const pluralText = stripPluralArticle(cleanForm(raw.plural))
  let plural: string | undefined
  if (!isNoForm(pluralText)) {
    if (pluralText.length > MAX_FORM_LENGTH || /[\n,;]/.test(pluralText)) return null
    if (!appearsInSource(pluralText, normalizedSource)) return null
    plural = pluralText
  }

  // The model's own answer text must agree with its fields.
  const answer = cleanForm(raw.correctAnswer)
  const stated = /^(der|die|das)\s+([^,;]+?)\s*(?:[,;]|$)/i.exec(answer)
  if (stated) {
    if (stated[1]!.toLowerCase() !== article) return null
    if (stated[2]!.trim() !== noun) return null
  }

  const gloss = cleanForm(raw.gloss).slice(0, 80)
  return { noun, article, ...(gloss ? { gloss } : {}), ...(plural ? { plural } : {}) }
}

function cleanLabels(value: unknown, max: number): string[] | null {
  if (!Array.isArray(value)) return null
  const labels = value.map((item) => (typeof item === 'string' ? cleanForm(item) : null))
  if (labels.some((label) => label === null || label.length > MAX_LABEL_LENGTH)) return null
  if (labels.length === 0 || labels.length > max) return null
  return labels as string[]
}

/**
 * A paradigm table, or null when its shape is inconsistent (rows × columns
 * do not match the cells, a cell is both given and blank or neither, labels
 * repeat, too many blanks) or a blank's form is not in the source.
 */
export function validateParadigmTable(
  raw: unknown,
  normalizedSource: string,
): ParadigmTable | null {
  if (!raw || typeof raw !== 'object') return null
  const table = raw as { title?: unknown; rows?: unknown; columns?: unknown; cells?: unknown }
  const rows = cleanLabels(table.rows, MAX_PARADIGM_ROWS)
  const columns = cleanLabels(table.columns, MAX_PARADIGM_COLUMNS)
  if (!rows || !columns || rows.length < 2) return null
  if (rows.some((row) => !row) || new Set(rows).size !== rows.length) return null
  // Several columns need names to tell them apart; a single one may be unnamed.
  if (columns.length > 1 && (columns.some((c) => !c) || new Set(columns).size !== columns.length))
    return null
  if (!Array.isArray(table.cells) || table.cells.length !== rows.length) return null

  const cells: ParadigmCell[][] = []
  let blanks = 0
  for (const rawRow of table.cells) {
    if (!Array.isArray(rawRow) || rawRow.length !== columns.length) return null
    const row: ParadigmCell[] = []
    for (const rawCell of rawRow) {
      if (!rawCell || typeof rawCell !== 'object') return null
      const cell = rawCell as { text?: unknown; answers?: unknown }
      const text = cleanForm(cell.text)
      const hasAnswers = Array.isArray(cell.answers) && cell.answers.length > 0
      if (text && hasAnswers) return null
      if (hasAnswers) {
        const seen = new Set<string>()
        const accepted = (cell.answers as unknown[])
          .map(cleanForm)
          .filter(
            (form) => form && form.length <= MAX_FORM_LENGTH && !seen.has(form) && seen.add(form),
          )
        if (accepted.length === 0 || accepted.length > MAX_ACCEPTED_FORMS) return null
        if (!appearsInSource(accepted[0]!, normalizedSource)) return null
        blanks++
        row.push({ accepted })
      } else if (text && text.length <= MAX_FORM_LENGTH) {
        row.push({ text })
      } else {
        return null
      }
    }
    cells.push(row)
  }
  if (blanks === 0 || blanks > MAX_PARADIGM_BLANKS) return null
  return { title: cleanForm(table.title).slice(0, 120), rows, columns, cells }
}
