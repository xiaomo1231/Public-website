/**
 * Quiz generation through the real `QuizService` with a recording AI: every
 * batch, top-up round and retry is recorded as sent.
 */
import { vi } from 'vitest'
import type { AppDatabase } from '@/infrastructure/db/database'
import { ProjectService } from '@/services/projectService'
import { QuizService } from '@/services/quizService'
import { CourseAnalysisRepository } from '@/entities/courseAnalysis/repository'
import { DocumentRepository } from '@/entities/document/repository'
import { ChunkRepository } from '@/entities/chunk/repository'
import type { AIService } from '@/services/aiService'
import type { QuizConfig } from '@/entities/quiz/types'
import type { ChatMessage } from '@/infrastructure/ai/types'
import type { RecordedRequest } from './estimate'
import { bioPassages } from './fixtures'
import { CONFIG_MAX_TOKENS } from './scenarios'

const TOPICS = [
  'Membrane transport',
  'Glycolysis',
  'Citric acid cycle',
  'Oxidative phosphorylation',
]

async function seed(db: AppDatabase): Promise<string> {
  const project = await new ProjectService(db).create({ name: 'Biology', subject: 'biology' })
  const documents = new DocumentRepository(db)
  const doc = await documents.create({
    projectId: project.id,
    type: 'pdf',
    name: 'Campbell Biology.pdf',
    sizeBytes: 1,
  })
  await documents.update(doc.id, { status: 'ready' })
  const chunks = await new ChunkRepository(db).addMany(
    bioPassages.map((text, i) => ({
      documentId: doc.id,
      projectId: project.id,
      contentType: 'paragraph' as const,
      text,
      sourceReference: 'Campbell Biology.pdf',
      order: i,
      pageNumber: i + 1,
    })),
  )
  await new CourseAnalysisRepository(db).reseedProject(
    project.id,
    {
      topics: TOPICS.map((name, i) => ({
        id: `t${i + 1}`,
        name,
        description: `${name} in eukaryotic cells.`,
        sourceRefs: [],
        sourceChunkIds: chunks.slice(i * 6, i * 6 + 6).map((c) => c.id),
      })),
      concepts: TOPICS.map((name) => ({
        name: `${name} key idea`,
        definition: 'd',
        topicNames: [name],
        sourceRefs: [],
      })),
      formulas: [],
      symbols: [],
      examples: [],
      exercises: [],
      prerequisites: [],
      topicsByName: new Map(TOPICS.map((name, i) => [name, `t${i + 1}`])),
      documentIds: [doc.id],
    },
    'en',
  )
  return project.id
}

/** Answers each plan line with a valid question of its type; drops one question in `dropIn` call. */
function recordingAI(recorded: RecordedRequest[], dropInCall: number) {
  let call = 0
  // Chunk / project ids are random; give them stable stand-ins of the same shape.
  const ids = new Map<string, string>()
  const stable = (text: string) =>
    text.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, (id) => {
      if (!ids.has(id))
        ids.set(id, `0f8e${String(ids.size).padStart(4, '0')}-6a1b-4c2d-9e3f-a1b2c3d4e5f6`)
      return ids.get(id)!
    })
  const chatJSON = vi.fn(async (messages: ChatMessage[], options?: { maxTokens?: number }) => {
    call++
    recorded.push({
      kind: 'quiz.batch',
      messages: messages.map((m) => ({ role: m.role, content: stable(String(m.content)) })),
      maxTokens: options?.maxTokens ?? CONFIG_MAX_TOKENS,
    })
    const plan = [...messages[1]!.content.matchAll(/^\s*\d+\. type=(\w+)/gm)].map((m) => m[1]!)
    const questions = plan.map((type, i) => {
      const prompt = `第 ${call}.${i + 1} 题：关于细胞呼吸中 ATP 的产生，下列哪一项描述与教材第 ${call * 10 + i} 页所述的化学渗透机制一致？请结合质子梯度与 ATP 合酶的作用加以判断。`
      return type === 'short_answer'
        ? {
            prompt,
            type,
            correctAnswer: '电子传递链泵出质子形成梯度，质子经 ATP 合酶回流驱动 ATP 合成。',
            rubric: [
              '质子被泵到膜间隙',
              '形成质子梯度',
              '质子经 ATP 合酶回流',
              '回流驱动 ATP 合成',
            ],
            solution: '见教材。',
            knowledgePoint: 'chemiosmosis',
            difficulty: 'basic',
            hints: ['想想质子梯度。'],
          }
        : {
            prompt,
            type: 'multiple_choice',
            options: [
              { label: `质子经 ATP 合酶回流驱动合成（${i}）`, isCorrect: true },
              { label: `电子直接把 ADP 磷酸化成 ATP（${i}）`, isCorrect: false },
              { label: `葡萄糖在线粒体基质中被分解（${i}）`, isCorrect: false },
              { label: `氧气在膜间隙中接受质子成水（${i}）`, isCorrect: false },
            ],
            correctAnswer: `质子经 ATP 合酶回流驱动合成（${i}）`,
            solution: '见教材。',
            knowledgePoint: 'chemiosmosis',
            difficulty: 'basic',
            hints: ['想想质子梯度。'],
          }
    })
    if (call === dropInCall) questions.pop()
    return { data: { questions }, raw: {} }
  })
  return { chatJSON, maxOutputTokens: CONFIG_MAX_TOKENS } as unknown as AIService
}

export async function runQuizScenario(
  db: AppDatabase,
  config: Omit<QuizConfig, 'mode'> & { mode: QuizConfig['mode'] },
  dropInCall = 1,
): Promise<RecordedRequest[]> {
  const projectId = await seed(db)
  const recorded: RecordedRequest[] = []
  await new QuizService({ ai: recordingAI(recorded, dropInCall), db }).generateQuiz(
    projectId,
    config as QuizConfig,
  )
  return recorded
}

export const QUIZ_SCENARIOS: Array<{ action: string; config: QuizConfig }> = [
  {
    action: '测验 · 主题 15 题（单选 + 简答，含 1 次补题）',
    config: {
      mode: 'topic',
      topicId: 't3',
      count: 15,
      difficulty: 'basic',
      types: ['multiple_choice', 'short_answer'],
    } as QuizConfig,
  },
  {
    action: '测验 · 混合复习 10 题（4 个主题，含 1 次补题）',
    config: {
      mode: 'mixed',
      count: 10,
      difficulty: 'basic',
      types: ['multiple_choice'],
    } as QuizConfig,
  },
]
