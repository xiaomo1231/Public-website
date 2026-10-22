/**
 * Builds the exact messages the app sends for one homework, using the real
 * prompt modules, so the measured tokens match production. Loaded by
 * `server.mjs` through Vite's SSR loader (which resolves the `@/` alias).
 */
import { prompts } from '@/infrastructure/ai/prompts'
import type { Subject } from '@/entities/project/types'

export interface Message {
  role: 'system' | 'user' | 'assistant'
  content: string
}

const LANGUAGE = 'zh_terms' as const

/** Same label shape as the app's chunk prefixes, one passage per page. */
export function documentText(pages: string[]): string {
  return pages
    .map((page, index) => `[c:p${index + 1} · p${index + 1}]\n${page.trim()}`)
    .join('\n\n')
}

export function recognize(name: string, pages: string[]): Message[] {
  return [
    { role: 'system', content: prompts.homeworkAnalyzer.buildSystemPrompt() },
    {
      role: 'user',
      content: prompts.homeworkAnalyzer.buildUserPrompt({
        documentName: name,
        documentText: documentText(pages),
        language: 'mixed',
      }),
    },
  ]
}

// The registry may point at any walkthrough version; call whatever it exports,
// the way `homeworkWalkthroughService` does for that version.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const walkthrough = prompts.homeworkWalkthrough as any

export function walkthroughQuestion(subject: Subject, label: string, question: string): Message[] {
  return [
    {
      role: 'system',
      content: prompts.subjectProfile.withSubject(
        walkthrough.buildQuestionSystemPrompt({
          linearSystems: subject === 'linear_algebra',
          analysis: true,
        }),
        subject,
      ),
    },
    {
      role: 'user',
      content: prompts.homeworkWalkthrough.buildQuestionUserPrompt({
        label,
        question,
        sourceText: question,
        language: LANGUAGE,
      }),
    },
  ]
}

// Same limits as homeworkWalkthroughService.
const FRAME_EXCERPT_CHARS = 1_500
const FRAME_QUESTION_CHARS = 800
const FRAME_CONCLUSION_CHARS = 1_000
const FRAME_KEY_POINT_CHARS = 600

function clip(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value
}

/** Copy of `sectionKeyPoints` in homeworkWalkthroughService (headings + bold terms). */
function keyPoints(body: string): string {
  const points: string[] = []
  const add = (value: string): void => {
    const point = value.replace(/\s+/g, ' ').trim()
    if (point && !points.includes(point)) points.push(point)
  }
  for (const match of body.matchAll(/^#{2,4}\s+(.+)$/gm)) add(match[1]!)
  for (const match of body.matchAll(/\*\*([^*\n]{2,80})\*\*/g)) add(match[1]!)
  let text = ''
  for (const point of points) {
    const line = `- ${point}`
    if (text.length + line.length + 1 > FRAME_KEY_POINT_CHARS) break
    text += text ? `\n${line}` : line
  }
  return text
}

export function walkthroughFrame(
  subject: Subject,
  title: string,
  questions: Array<{ label: string; question: string; conclusion: string; body: string }>,
): Message[] {
  const compact = typeof walkthrough.buildFrameKeyPointsUserPrompt === 'function'
  return [
    {
      role: 'system',
      content: prompts.subjectProfile.withSubject(
        walkthrough.buildFrameSystemPrompt({ keyPoints: compact }),
        subject,
      ),
    },
    {
      role: 'user',
      content: compact
        ? walkthrough.buildFrameKeyPointsUserPrompt({
            title,
            questions: questions.map((q) => ({
              label: q.label,
              question: clip(q.question, FRAME_QUESTION_CHARS),
              conclusion: clip(q.conclusion, FRAME_CONCLUSION_CHARS),
              keyPoints: keyPoints(q.body),
            })),
            language: LANGUAGE,
          })
        : walkthrough.buildFrameUserPrompt({
            title,
            questions: questions.map((q) => ({
              label: q.label,
              question: q.question,
              conclusion: q.conclusion,
              excerpt: q.body.slice(0, FRAME_EXCERPT_CHARS),
            })),
            language: LANGUAGE,
          }),
    },
  ]
}

/** Which walkthrough prompt version the registry currently uses. */
export const WALKTHROUGH_VERSION: string = walkthrough.VERSION

export function hints(subject: Subject, question: string): Message[] {
  return [
    {
      role: 'system',
      content: prompts.subjectProfile.withSubject(
        prompts.homeworkQuestion.buildSystemPrompt('hints'),
        subject,
      ),
    },
    {
      role: 'user',
      content: prompts.homeworkQuestion.buildUserPrompt({
        question,
        sourceText: '',
        language: 'zh',
      }),
    },
  ]
}

export function answerCheck(
  subject: Subject,
  question: string,
  studentAnswer: string,
  referenceAnswer: string,
): Message[] {
  return [
    {
      role: 'system',
      content: prompts.subjectProfile.withSubject(
        prompts.homeworkAnswerCheck.buildSystemPrompt(),
        subject,
      ),
    },
    {
      role: 'user',
      content: prompts.homeworkAnswerCheck.buildUserPrompt({
        question,
        studentAnswer,
        referenceAnswer,
        referenceKind: 'ai_solution',
        sourceText: '',
        language: 'zh',
      }),
    },
  ]
}

export function ask(
  subject: Subject,
  input: {
    sectionHeading: string
    selectedText: string
    surroundingContext: string
    question: string
    history: Array<{ question: string; answer: string }>
  },
): Message[] {
  return [
    {
      role: 'system',
      content: prompts.subjectProfile.withSubject(
        prompts.contextualTutor.buildSystemPrompt('walkthrough'),
        subject,
      ),
    },
    {
      role: 'user',
      content: prompts.contextualTutor.buildUserPrompt({
        ...input,
        language: 'zh',
        contextKind: 'walkthrough',
      }),
    },
  ]
}

export const normalizeQuestionSection = walkthrough.normalizeQuestionSection as (
  raw: unknown,
) => { status: string; conclusion?: string; body?: string } | null
