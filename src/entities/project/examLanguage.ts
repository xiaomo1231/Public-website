import type { AppDatabase } from '@/infrastructure/db/database'
import type { Document, LearningMaterialType } from '@/entities/document/types'
import { normalizeLanguageTag, type Project } from './types'
import {
  classifyScript,
  countScripts,
  sampleProjectMaterials,
  type MaterialSample,
} from './subjectContext'

/**
 * The language a course is examined in, for 「跟随考试语言（中文辅助）」.
 * Read from the course's own papers first (past exams), then the handbook /
 * exam-topic list, then the professor's practice and homework, then any
 * processed material. Pure detection + one loader; nothing is stored.
 */

/** Frequent function words that tell Latin-script languages apart. */
const STOPWORDS: Record<string, readonly string[]> = {
  en: [
    'the',
    'and',
    'of',
    'to',
    'is',
    'in',
    'which',
    'what',
    'are',
    'for',
    'with',
    'that',
    'this',
    'by',
    'from',
    'describe',
    'explain',
    'following',
  ],
  de: [
    'der',
    'die',
    'das',
    'und',
    'ist',
    'nicht',
    'mit',
    'von',
    'den',
    'dem',
    'ein',
    'eine',
    'zu',
    'im',
    'auf',
    'welche',
    'wie',
    'für',
    'des',
    'sind',
    'beschreiben',
    'sie',
  ],
  hu: [
    'az',
    'és',
    'hogy',
    'nem',
    'egy',
    'van',
    'meg',
    'mi',
    'milyen',
    'mit',
    'vagy',
    'ez',
    'azt',
    'mely',
    'melyik',
    'ismertesse',
    'jellemezze',
    'mik',
  ],
  fr: [
    'le',
    'les',
    'et',
    'des',
    'est',
    'une',
    'du',
    'que',
    'qui',
    'pour',
    'dans',
    'pas',
    'sur',
    'avec',
    'décrivez',
    'quelle',
  ],
  es: [
    'el',
    'los',
    'las',
    'y',
    'que',
    'es',
    'una',
    'por',
    'con',
    'para',
    'del',
    'se',
    'qué',
    'cuál',
    'describa',
  ],
  it: [
    'il',
    'di',
    'che',
    'è',
    'per',
    'con',
    'del',
    'della',
    'sono',
    'non',
    'gli',
    'descrivere',
    'quale',
  ],
}

const LOOKUP: Map<string, string[]> = (() => {
  const map = new Map<string, string[]>()
  for (const [language, words] of Object.entries(STOPWORDS))
    for (const word of words) map.set(word, [...(map.get(word) ?? []), language])
  return map
})()

/** Hits per language needed before a Latin-script text is given a language. */
const MIN_HITS = 3

/**
 * The language of one text: `zh` when mostly Chinese, else the Latin-script
 * language whose function words occur most; undefined when it cannot tell.
 */
export function detectTextLanguage(text: string): string | undefined {
  const script = classifyScript(countScripts(text))
  if (script === null) return undefined
  if (script === 'zh') return 'zh'
  const hits = new Map<string, number>()
  for (const token of text.toLowerCase().match(/\p{L}+/gu) ?? []) {
    for (const language of LOOKUP.get(token) ?? [])
      hits.set(language, (hits.get(language) ?? 0) + 1)
  }
  let best: string | undefined
  let bestHits = 0
  for (const [language, count] of hits) {
    if (count > bestHits) {
      best = language
      bestHits = count
    }
  }
  return bestHits >= MIN_HITS ? best : undefined
}

/** The language with the most weight across samples; undefined when none is known. */
export function detectExamLanguage(samples: readonly MaterialSample[]): string | undefined {
  const weights = new Map<string, number>()
  for (const sample of samples) {
    const language = detectTextLanguage(sample.text)
    if (language) weights.set(language, (weights.get(language) ?? 0) + sample.weight)
  }
  let best: string | undefined
  let bestWeight = 0
  for (const [language, weight] of weights) {
    if (weight > bestWeight) {
      best = language
      bestWeight = weight
    }
  }
  return best
}

/** Document roles read in turn: the first group with a detectable language wins. */
const ROLE_GROUPS: ReadonlyArray<readonly LearningMaterialType[] | null> = [
  ['past_exam'],
  ['syllabus'],
  ['professor_practice', 'homework', 'homework_answer'],
  null,
]

/**
 * The exam language of a course (BCP-47 primary tag, `zh` for Chinese):
 * a language course's target language, else detected from its materials.
 * Undefined when the project is missing or nothing can be told yet.
 */
export async function loadExamLanguage(
  db: AppDatabase,
  projectId: string,
): Promise<string | undefined> {
  const project = await db.table<Project, string>('projects').get(projectId)
  if (!project) return undefined
  if (project.subject === 'language') {
    const target = normalizeLanguageTag(project.targetLanguage)
    if (target) return target
  }
  for (const roles of ROLE_GROUPS) {
    const include = roles
      ? (doc: Document) => roles.includes(doc.materialType ?? 'textbook')
      : undefined
    const language = detectExamLanguage(await sampleProjectMaterials(db, projectId, include))
    if (language) return language
  }
  return undefined
}
