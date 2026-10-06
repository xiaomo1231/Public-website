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
const RULES: ReadonlyArray<[Subject, RegExp]> = [
  ['linear_algebra', /线性代数|线代|矩阵论|linear\s*algebra|matrix\s+theory/i],
  ['stats', /概率|统计|随机过程|probab|statistic|stochastic/i],
  ['discrete_math', /离散|组合数学|图论|集合论|数理逻辑|discrete|combinatoric|graph\s+theory|set\s+theory/i],
  // Medicine (clinical and dental basic sciences) before biology, so 人体解剖 /
  // 生理学 / 医学生物化学 of a medical curriculum are not read as biology.
  // Plant / animal physiology stays biology.
  [
    'medicine',
    /医学|人体|临床|口腔|牙|系统解剖|局部解剖|解剖学|组织学|胚胎学|组织胚胎|病理|药理|免疫学|微生物学|诊断学|护理|(?<![植动]物)生理学|medic|clinical|anatomy|histolog|embryolog|patholog|pharmacolog|immunolog|dental|dentist|odont|stomatolog|oral\s+(?:biology|anatomy)/i,
  ],
  // Biochemistry is taught as biology; "化学" alone stays chemistry.
  ['biology', /生物|细胞|遗传|基因|生理|生态|微生物|解剖|分子生物|biolog|genetic|\bcells?\b|physiolog|ecolog|microbio|anatomy/i],
  ['chemistry', /化学|chemi/i],
  ['physics', /物理|力学|电磁|热学|光学|量子|physic|mechanics|electromagnet|thermodynamic|optics|quantum/i],
  [
    'cs',
    /计算机|编程|程序设计|数据结构|算法|操作系统|计算机网络|数据库|computer|programming|algorithm|data\s+structure|operating\s+system|database|\bc\+\+|\bjava\b|python/i,
  ],
  ['calculus', /微积分|数学分析|高等数学|高数|微分|积分|calculus|real\s+analysis|mathematical\s+analysis/i],
]

export function inferSubject(name: string): Subject | null {
  const text = name.trim()
  if (!text) return null
  for (const [subject, pattern] of RULES) {
    if (pattern.test(text)) return subject
  }
  return null
}
