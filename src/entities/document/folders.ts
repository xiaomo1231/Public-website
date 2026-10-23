import { looksLikePastExam } from '@/entities/exam/paper'
import { looksLikeSyllabus } from '@/entities/syllabus/parse'
import type { Document, LearningMaterialType } from './types'

/**
 * Folders of a course's files (`Document.folderPath`). A folder is only a
 * `/`-separated label kept from a folder upload ("Week 3/Slides") or set on
 * the files page; there is no folder table. Pure helpers, no I/O.
 */

/** Longest folder path kept (characters). */
export const MAX_FOLDER_PATH = 240

/**
 * A folder path in its stored form: `\` → `/`, segments trimmed, empty and
 * `.` / `..` segments dropped, no leading / trailing slash. `''` = no folder.
 */
export function normalizeFolderPath(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value
    .replace(/\\/g, '/')
    .split('/')
    .map((part) => part.trim().replace(/\s+/g, ' '))
    .filter((part) => part && part !== '.' && part !== '..')
    .join('/')
    .slice(0, MAX_FOLDER_PATH)
}

/** The folder of a relative path ("Week 3/Slides/L1.pdf" → "Week 3/Slides"). */
export function folderOfRelativePath(relativePath: string | undefined | null): string {
  const path = normalizeFolderPath(relativePath ?? '')
  const at = path.lastIndexOf('/')
  return at < 0 ? '' : path.slice(0, at)
}

/** True when `folderPath` is `folder` or lies inside it ("A/B" is in "A"). */
export function isInFolder(folderPath: string | undefined, folder: string): boolean {
  const own = normalizeFolderPath(folderPath)
  const target = normalizeFolderPath(folder)
  if (!target || !own) return false
  return own === target || own.startsWith(`${target}/`)
}

/** Every folder that holds a file, parents included, sorted. */
export function listFolders(documents: ReadonlyArray<Pick<Document, 'folderPath'>>): string[] {
  const out = new Set<string>()
  for (const doc of documents) {
    const path = normalizeFolderPath(doc.folderPath)
    if (!path) continue
    const parts = path.split('/')
    for (let i = 1; i <= parts.length; i++) out.add(parts.slice(0, i).join('/'))
  }
  return [...out].sort((a, b) => a.localeCompare(b))
}

export interface FolderGroup<T> {
  /** `''` = files not in a folder (listed last). */
  folder: string
  documents: T[]
}

/** Files grouped by their own folder (not parents); files without one last. */
export function groupByFolder<T extends Pick<Document, 'folderPath'>>(
  documents: readonly T[],
): FolderGroup<T>[] {
  const groups = new Map<string, T[]>()
  for (const doc of documents) {
    const key = normalizeFolderPath(doc.folderPath)
    groups.set(key, [...(groups.get(key) ?? []), doc])
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)))
    .map(([folder, list]) => ({ folder, documents: list }))
}

const ANSWER_HINT =
  /(?:^|[^a-z])(?:answers?|solutions?|answer\s*key|key|marking|mark\s*scheme|sol)(?:[^a-z]|$)|答案|解答|参考答案|评分标准/i
const HOMEWORK_HINT =
  /(?:^|[^a-z])(?:hw|homework|assignment|problem\s*set|pset|ps\d|exercise\s*sheet|tutorial\s*sheet)(?:[^a-z]|\d|$)|作业|习题课/i
const PRACTICE_HINT =
  /(?:^|[^a-z])(?:practice|worksheet|drill|review\s*problems?)(?:[^a-z]|$)|练习|习题/i
const NOTES_HINT = /(?:^|[^a-z])(?:notes?|cheat\s*sheet|summary|review)(?:[^a-z]|$)|笔记|总结|复习/i
const TRANSCRIPT_HINT = /(?:^|[^a-z])(?:transcript|recording|captions?)(?:[^a-z]|$)|文字稿|录音/i
/** A name that says it is the paper itself (大题 / 选择题 / 题目 / 试卷 / exam paper…). */
const PAPER_HINT =
  /大题|选择题|填空题|判断题|简答题|计算题|论述题|题目|试卷|试题|考卷|真题|模拟卷|(?:^|[^a-z])(?:exam|question|test)\s*paper(?:s)?(?:[^a-z]|$)/i
// "带答案和评分" / "含答案" / "with answers" describe a paper that includes
// its answers — not an answer key. Removed before looking for answer words.
const ZH_ANSWER_PART = '(?:参考)?(?:答案|解答|解析|评分(?:标准)?)'
const EN_ANSWER_PART =
  '(?:the\\s+)?(?:answers?|solutions?|marking(?:\\s*scheme)?|mark\\s*scheme|keys?)'
const INCLUDED_ANSWERS = new RegExp(
  `(?:带|含|附带?|包含|有)\\s*${ZH_ANSWER_PART}(?:\\s*(?:和|及|与|、|\\+|&)\\s*${ZH_ANSWER_PART})*` +
    `|(?:^|[^a-z])(?:with|incl(?:uding|\\.)?|plus|\\+)\\s*${EN_ANSWER_PART}(?:\\s*(?:and|&|\\+)\\s*${EN_ANSWER_PART})*(?=[^a-z]|$)`,
  'gi',
)

/** The name without "带答案 / with answers" phrases (a paper that includes them). */
function withoutIncludedAnswers(text: string): string {
  return text.replace(INCLUDED_ANSWERS, ' ')
}

/**
 * Suggest a role from a file name and its folder ("Past exams/2024.pdf",
 * "HW/hw3 solutions.pdf"). The student sees and can change it before the
 * upload starts; nothing is switched later.
 */
export function suggestMaterialType(name: string, folderPath = ''): LearningMaterialType {
  const base = name.replace(/\.[a-z0-9]+$/i, '')
  // "大题（带答案和评分）" is a paper with its answers, not an answer key: only a
  // name that is just answers / solutions / key counts as one.
  const plain = withoutIncludedAnswers(base)
  const folderPlain = withoutIncludedAnswers(folderPath)
  const answers = ANSWER_HINT.test(plain)
  const both = `${normalizeFolderPath(folderPlain)} ${plain}`
  if (looksLikeSyllabus(base)) return 'syllabus'
  if (PAPER_HINT.test(base) && !answers) return 'past_exam'
  if (answers) return 'homework_answer'
  if (
    looksLikePastExam(plain) ||
    ((looksLikePastExam(folderPlain) || PAPER_HINT.test(folderPath)) && !ANSWER_HINT.test(both))
  )
    return 'past_exam'
  if (HOMEWORK_HINT.test(base)) return 'homework'
  if (PRACTICE_HINT.test(base)) return 'professor_practice'
  if (TRANSCRIPT_HINT.test(base)) return 'lecture_transcript'
  if (NOTES_HINT.test(base)) return 'user_notes'
  // The folder decides only when the name itself says nothing.
  if (ANSWER_HINT.test(folderPlain)) return 'homework_answer'
  if (HOMEWORK_HINT.test(folderPath)) return 'homework'
  if (PRACTICE_HINT.test(folderPath)) return 'professor_practice'
  if (NOTES_HINT.test(folderPath)) return 'user_notes'
  return 'textbook'
}
