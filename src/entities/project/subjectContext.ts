import type { AppDatabase } from '@/infrastructure/db/database'
import type { Document } from '@/entities/document/types'
import type { DocumentChunk } from '@/entities/chunk/types'
import {
  EXAM_STYLES,
  normalizeLanguageTag,
  type ExamStyle,
  type Project,
  type SubjectContext,
} from './types'

/** Chunks read per document, and characters per course, to judge its script. */
const SAMPLE_CHUNKS_PER_DOCUMENT = 30
const SAMPLE_CHARS_PER_COURSE = 60_000

/**
 * One CJK character carries roughly as much text as three Latin letters, so a
 * Chinese textbook that names terms in English still reads as Chinese.
 */
const CJK_WEIGHT = 3

export interface ScriptCounts {
  cjk: number
  latin: number
}

/** Count CJK characters and Latin-script letters (with diacritics) in a text. */
export function countScripts(text: string): ScriptCounts {
  let cjk = 0
  let latin = 0
  for (const ch of text) {
    if (/[㐀-鿿豈-﫿]/.test(ch)) cjk++
    else if (/\p{Script=Latin}/u.test(ch)) latin++
  }
  return { cjk, latin }
}

/** Whether a text is mostly Chinese (`zh`), mostly another script (`other`), or empty. */
export function classifyScript(counts: ScriptCounts): 'zh' | 'other' | null {
  if (counts.cjk === 0 && counts.latin === 0) return null
  return counts.cjk * CJK_WEIGHT >= counts.latin ? 'zh' : 'other'
}

export interface MaterialSample {
  /** Relative weight of the document (its text length). */
  weight: number
  text: string
}

/**
 * Default exam style from a course's materials: mostly non-Chinese materials
 * mean an English-taught programme (`international`); mostly Chinese, or no
 * materials yet, keep the domestic style.
 */
export function inferExamStyle(samples: readonly MaterialSample[]): ExamStyle {
  let zh = 0
  let other = 0
  for (const sample of samples) {
    const kind = classifyScript(countScripts(sample.text))
    if (kind === 'zh') zh += sample.weight
    else if (kind === 'other') other += sample.weight
  }
  return other > zh ? 'international' : 'domestic'
}

/** The prompt context for a project, given the default exam style of its materials. */
export function resolveSubjectContext(
  project: Pick<Project, 'subject' | 'targetLanguage' | 'examStyle'>,
  inferredExamStyle?: ExamStyle,
): SubjectContext {
  const context: SubjectContext = { subject: project.subject }
  if (project.subject === 'language') {
    const tag = normalizeLanguageTag(project.targetLanguage)
    if (tag) context.targetLanguage = tag
  }
  if (project.subject === 'medicine') {
    const explicit =
      project.examStyle && EXAM_STYLES.includes(project.examStyle) ? project.examStyle : undefined
    context.examStyle = explicit ?? inferredExamStyle ?? 'domestic'
  }
  return context
}

/** A text sample of each processed document of a project, for `inferExamStyle`. */
export async function sampleProjectMaterials(
  db: AppDatabase,
  projectId: string,
): Promise<MaterialSample[]> {
  const documents = await db
    .table<Document, string>('documents')
    .where('[projectId+status]')
    .equals([projectId, 'ready'])
    .toArray()
  const samples: MaterialSample[] = []
  let budget = SAMPLE_CHARS_PER_COURSE
  const perDocument = Math.max(2_000, Math.floor(budget / Math.max(1, documents.length)))
  for (const doc of documents) {
    if (budget <= 0) break
    const chunks = await db
      .table<DocumentChunk, string>('chunks')
      .where('[documentId+order]')
      .between([doc.id, -Infinity], [doc.id, Infinity])
      .limit(SAMPLE_CHUNKS_PER_DOCUMENT)
      .toArray()
    const text = chunks
      .map((chunk) => chunk.text)
      .join('\n')
      .slice(0, Math.min(perDocument, budget))
    if (!text.trim()) continue
    budget -= text.length
    samples.push({ weight: doc.textLength ?? text.length, text })
  }
  return samples
}

/**
 * Everything about a project's subject that shapes prompts. The exam-style
 * default is only computed for medicine courses without an explicit choice.
 * `undefined` when the project does not exist (deleted mid-run).
 */
export async function loadSubjectContext(
  db: AppDatabase,
  projectId: string,
): Promise<SubjectContext | undefined> {
  const project = await db.table<Project, string>('projects').get(projectId)
  if (!project) return undefined
  const needsInference = project.subject === 'medicine' && !project.examStyle
  const inferred = needsInference
    ? inferExamStyle(await sampleProjectMaterials(db, projectId))
    : undefined
  return resolveSubjectContext(project, inferred)
}
