import type { Subject } from './types'

/**
 * Guess a course's subject from its name, for the create-project dialog.
 *
 * Only a suggestion: the dialog pre-selects it until the student picks a
 * subject themselves, and anything unrecognised falls back to "other" — never
 * to a specific subject, because a wrong subject steers every AI prompt for
 * the course in the wrong direction.
 *
 * Order matters: more specific names come first ("数学分析" is calculus,
 * "分析化学" is chemistry; "概率论与数理统计" is statistics, not logic).
 */
/**
 * Languages a course may teach, by the words that name them (English, the
 * language's own name, Chinese). Checked in order; the first match wins.
 */
const LANGUAGES: ReadonlyArray<[string, RegExp]> = [
  ['de', /\bgerman\b|deutsch|sprache\b|德语|德文/i],
  ['hu', /\bhungarian\b|\bmagyar|szaknyelv|匈牙利语|匈语/i],
  ['fr', /\bfrench\b|français|francais|法语|法文/i],
  ['es', /\bspanish\b|español|espanol|西班牙语/i],
  ['it', /\bitalian\b|italiano|意大利语/i],
  ['la', /\blatin\b|拉丁语/i],
  ['ru', /\brussian\b|русск|俄语/i],
  ['ja', /\bjapanese\b|日语|日本語/i],
  ['ko', /\bkorean\b|韩语|朝鲜语/i],
  ['en', /\benglish\b|英语/i],
]

/**
 * A language course: a named foreign language, or a word that means "language
 * course" on its own (nyelv, Sprache, 外语). "Medical Terminology" alone is an
 * English-taught medicine course and is left to the rules below; programming
 * and formal languages stay computer science.
 */
const LANGUAGE_COURSE =
  /nyelv|sprache\b|(?<!programming\s|formal\s|query\s|markup\s|natural\s)\blanguages?\b(?!\s+(?:processing|models?|theory))|外语|语言课|^语言/i

const RULES: ReadonlyArray<[Subject, RegExp]> = [
  ['linear_algebra', /线性代数|线代|矩阵论|linear\s*algebra|matrix\s+theory/i],
  ['stats', /概率|统计|随机过程|probab|statistic|stochastic/i],
  [
    'discrete_math',
    /离散|组合数学|图论|集合论|数理逻辑|discrete|combinatoric|graph\s+theory|set\s+theory/i,
  ],
  // Medicine (clinical and dental basic sciences) before biology, so 人体解剖 /
  // 生理学 / 医学生物化学 of a medical curriculum are not read as biology.
  // Plant / animal physiology stays biology.
  [
    'medicine',
    /医学|人体|临床|口腔|牙|系统解剖|局部解剖|解剖学|组织学|胚胎学|组织胚胎|病理|药理|免疫学|微生物学|诊断学|护理|(?<![植动]物)生理学|medic|clinical|anatomy|histolog|embryolog|patholog|pharmacolog|immunolog|dental|dentist|odont|stomatolog|oral\s+(?:biology|anatomy)/i,
  ],
  // Biochemistry is taught as biology; "化学" alone stays chemistry.
  [
    'biology',
    /生物|细胞|遗传|基因|生理|生态|微生物|解剖|分子生物|biolog|genetic|\bcells?\b|physiolog|ecolog|microbio|anatomy/i,
  ],
  ['chemistry', /化学|chemi/i],
  [
    'physics',
    /物理|力学|电磁|热学|光学|量子|physic|mechanics|electromagnet|thermodynamic|optics|quantum/i,
  ],
  [
    'cs',
    /计算机|编程|程序设计|数据结构|算法|操作系统|计算机网络|数据库|computer|programming|algorithm|data\s+structure|operating\s+system|database|\bc\+\+|\bjava\b|python/i,
  ],
  [
    'calculus',
    /微积分|数学分析|高等数学|高数|微分|积分|calculus|real\s+analysis|mathematical\s+analysis/i,
  ],
]

export interface InferredCourse {
  subject: Subject
  /** BCP-47 primary tag, for a language course whose language is named. */
  targetLanguage?: string
}

/**
 * Guess subject (and, for a language course, the language) from a course name.
 * Language courses are checked first, so "Hungarian Medical Terminology" or
 * "医学德语" is a language course rather than medicine.
 */
export function inferCourse(name: string): InferredCourse | null {
  const text = name.trim()
  if (!text) return null
  const language = LANGUAGES.find(([, pattern]) => pattern.test(text))?.[0]
  // "English" alone usually names the language of instruction ("Anatomy in
  // English"); it makes a language course only as the course's object
  // ("医学英语", "Medical English", "English for Medical Purposes", "English II").
  const englishCourse =
    language === 'en' &&
    /英语|\benglish\s+(?:for\b|language\b|[ivx]+\b|\d)|(?:medical|academic|business|scientific)\s+english/i.test(
      text,
    )
  const namedForeign = language !== undefined && (language !== 'en' || englishCourse)
  if (namedForeign || LANGUAGE_COURSE.test(text)) {
    return language ? { subject: 'language', targetLanguage: language } : { subject: 'language' }
  }
  for (const [subject, pattern] of RULES) {
    if (pattern.test(text)) return { subject }
  }
  return null
}

export function inferSubject(name: string): Subject | null {
  return inferCourse(name)?.subject ?? null
}
