import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { ProjectService } from '@/services/projectService'
import { WalkthroughImportService } from '@/services/walkthroughImportService'
import { HomeworkWalkthroughService } from '@/services/homeworkWalkthroughService'
import { DocumentRepository } from '@/entities/document/repository'
import { ChunkRepository } from '@/entities/chunk/repository'
import { HomeworkRepository } from '@/entities/homework/repository'
import { UserRepository } from '@/entities/user/repository'
import type { HomeworkQuestion } from '@/entities/homework/types'
import type { Project } from '@/entities/project/types'
import {
  buildWalkthroughTemplate,
  hasTemplateMarkers,
  normalizeMathDelimiters,
  parseTemplateImport,
} from '@/entities/homework/walkthroughTemplate'
import type { AIService } from '@/services/aiService'

const P1_BODY = [
  '作 $R_2 \\to R_2 - 2R_1$：',
  '$$\\left[\\begin{array}{cc|c} 1&2&3\\\\ 0&1&2 \\end{array}\\right]$$',
  '作 $R_1 \\to R_1 - 2R_2$：',
  '$$\\left[\\begin{array}{cc|c} 1&0&-1\\\\ 0&1&2 \\end{array}\\right]$$',
  '所以 **唯一解**：',
  '$$\\boxed{x_1 = -1,\\ x_2 = 2}$$',
].join('\n')

const P1_CHECK = JSON.stringify([
  {
    label: '1',
    augmented: [
      ['1', '2', '3'],
      ['2', '5', '8'],
    ],
    rref: [
      ['1', '0', '-1'],
      ['0', '1', '2'],
    ],
    solution: 'unique',
  },
])

const P2_BODY = '### (a) 无解\n最后一行是 $0 = 1$，矛盾。\n\n$$\\boxed{\\text{无解}}$$'

let db: AppDatabase
let projectId: string
let setId: string
let homeworkDocId: string

async function setup(
  options: { subject?: Project['subject']; prompts?: string[]; answer?: boolean } = {},
): Promise<void> {
  db = new AppDatabase()
  setDbForTesting(db)
  projectId = (
    await new ProjectService(db).create({
      name: 'Course',
      subject: options.subject ?? 'linear_algebra',
    })
  ).id
  const documents = new DocumentRepository(db)
  homeworkDocId = (
    await documents.create({
      projectId,
      type: 'text',
      materialType: 'homework',
      name: 'hw.pdf',
      sizeBytes: 0,
    })
  ).id
  const repo = new HomeworkRepository(db)
  setId = crypto.randomUUID()
  await repo.upsertSet({
    id: setId,
    projectId,
    documentId: homeworkDocId,
    documentName: 'hw.pdf',
    title: 'HW3',
    status: 'ready',
    language: 'zh',
    questionCount: 2,
    promptVersion: 'v1',
    createdAt: 1,
    updatedAt: 1,
  })
  const prompts = options.prompts ?? [
    'Solve the system x + 2y = 3, 2x + 5y = 8 by row reduction.',
    'Decide whether the augmented matrix has a solution.',
  ]
  for (const [index, prompt] of prompts.entries()) {
    const question: HomeworkQuestion = {
      id: `q${index + 1}`,
      projectId,
      setId,
      documentId: homeworkDocId,
      documentName: 'hw.pdf',
      order: index,
      number: String(index + 1),
      prompt,
      sourceRefs: [],
      hints: [],
      generationStatus: 'ready',
      promptVersion: 'v1',
      draftText: '',
      revealedHints: 0,
      solutionRevealed: false,
      messages: [],
      createdAt: 1,
      updatedAt: 1,
      ...(options.answer && index === 0
        ? { answerStatus: 'matched' as const, answerText: 'Professor: eliminate x first.' }
        : {}),
    }
    await repo.upsertQuestion(question)
  }
}

/** Store a file as upload + processing would: the bytes, and trimmed non-blank lines as chunks. */
async function addFile(text: string, type: 'text' | 'pdf' = 'text'): Promise<string> {
  const documents = new DocumentRepository(db)
  const doc = await documents.create({
    projectId,
    type,
    materialType: 'walkthrough_import',
    name: type === 'text' ? 'walkthrough.md' : 'walkthrough.pdf',
    sizeBytes: text.length,
  })
  if (type === 'text') {
    const bytes = new TextEncoder().encode(text)
    await db.documentBlobs.add({
      id: doc.id,
      projectId,
      bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      mimeType: 'text/markdown',
    })
  }
  const lines = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
  await new ChunkRepository(db).addMany(
    lines.map((line, order) => ({
      documentId: doc.id,
      projectId,
      materialType: 'walkthrough_import' as const,
      contentType: 'paragraph' as const,
      text: line,
      sourceReference: doc.name,
      order,
    })),
  )
  await documents.update(doc.id, { status: 'ready', chunkCount: lines.length })
  return doc.id
}

function stubAI(handler: (user: string) => unknown) {
  const users: string[] = []
  const streamJSON = vi.fn(async (messages: Array<{ content: string }>) => {
    users.push(messages[1]!.content)
    return { data: await handler(messages[1]!.content), raw: {} }
  })
  return {
    users,
    streamJSON,
    ai: { streamJSON, chatJSON: streamJSON, maxOutputTokens: 8192 } as unknown as AIService,
  }
}

const importer = (ai: AIService | null = null) => new WalkthroughImportService({ ai, db })

/** What an external AI returns: the template with the placeholders filled in. */
function fill(
  template: string,
  answers: Record<
    string,
    { analysis?: string; body?: string; conclusion?: string; check?: string }
  >,
  frames: { overview?: string; summary?: string; suggestions?: string } = {},
): string {
  const blocks = template.split(/(?=<!-- walkthrough:(?:question|summary|other|end))/)
  return blocks
    .map((block) => {
      const id = /walkthrough:question id="([^"]+)"/.exec(block)?.[1]
      // split/join: `$$` in a replacement string would collapse to `$`.
      const put = (text: string, placeholder: string, value = '') =>
        text.split(placeholder).join(value)
      if (block.startsWith('<!-- walkthrough:summary')) {
        return put(
          put(block, '<!-- 本次作业的题型、思路与要点 -->', frames.summary),
          '<!-- 每条一行，以 - 开头 -->',
          frames.suggestions,
        )
      }
      if (!id) {
        return frames.overview
          ? put(block, '<!-- 列出整份作业要用到的方法与工具（可留空） -->', frames.overview)
          : block
      }
      const answer = answers[id]
      if (!answer) return block
      let out = put(
        block,
        '<!-- 题目要求、已知条件、用到的知识、答案形式（不解题） -->',
        answer.analysis,
      )
      out = put(out, '<!-- 完整的解题过程 -->', answer.body)
      out = put(out, '<!-- 每个小题一两行最终答案 -->', answer.conclusion)
      if (answer.check) out = put(out, '```json\n[]\n```', `\`\`\`json\n${answer.check}\n\`\`\``)
      return out
    })
    .join('')
}

afterEach(() => {
  db?.close()
})

describe('讲解模板 generation', () => {
  it('lists every question with its id, label and text, in the walkthrough language', async () => {
    await setup({ answer: true })
    const { text, fileName } = await importer().template(setId)
    expect(fileName).toBe('HW3-讲解模板.md')
    expect(text).toContain('<!-- walkthrough:question id="q1" label="1" -->')
    expect(text).toContain('<!-- walkthrough:question id="q2" label="2" -->')
    expect(text).toContain('> Solve the system x + 2y = 3, 2x + 5y = 8 by row reduction.')
    expect(text).toContain('用简体中文写。关键术语第一次出现时')
    expect(text).toContain('#### 讲解')
    // Formatting conventions of the generated walkthrough.
    expect(text).toContain('作 $R_3 \\to R_3 - 3R_1$：')
    expect(text).toContain('\\boxed{…}')
    expect(text).toContain('### (a)')
    // Linear algebra: the check block, with its JSON fence.
    expect(text).toContain('<!-- walkthrough:check -->')
    expect(text).toContain('```json\n[]\n```')
    // A matched professor answer is mentioned, never pasted.
    expect(text).toContain('有教授答案')
    expect(text).not.toContain('eliminate x first')
    // The template parses back to nothing (no walkthrough written yet).
    const parsed = parseTemplateImport(text, new Set(['q1', 'q2']))
    expect(parsed.reply.questions).toEqual([])
    expect(parsed.problems.map((problem) => problem.reason)).toEqual(['empty', 'empty'])
  })

  it('is in English for an English preference, and has no check block outside linear algebra', async () => {
    await setup({
      subject: 'physics',
      prompts: ['A ball is thrown upward at 5 m/s.', 'Find the tension.'],
    })
    await new UserRepository(db).update({ questionLanguage: 'en' })
    const { text, fileName } = await importer().template(setId)
    expect(fileName).toBe('HW3-walkthrough-template.md')
    expect(text).toContain('Write in English.')
    expect(text).toContain('#### Walkthrough')
    expect(text).not.toContain('walkthrough:check')
    expect(text).not.toContain('有教授答案')
  })

  it('never puts a quote or a comment end into a marker', () => {
    const text = buildWalkthroughTemplate({
      title: 'T',
      language: 'zh',
      linearSystems: false,
      questions: [{ id: 'a"b-->', label: '1', prompt: 'p' }],
    })
    expect(text).toContain('<!-- walkthrough:question id="ab-" label="1" -->')
  })
})

describe('importing a filled-in template', () => {
  it('is parsed locally: sections by question id, checks from the JSON, no AI call', async () => {
    await setup()
    const template = (await importer().template(setId)).text
    const filled = fill(
      template,
      {
        q1: {
          analysis: '- 求解 2×2 方程组',
          body: P1_BODY,
          conclusion: '$x_1=-1, x_2=2$',
          check: P1_CHECK,
        },
        q2: { body: P2_BODY, conclusion: '无解' },
      },
      {
        overview: '- 高斯消元',
        summary: '两道题都用行化简。',
        suggestions: '- 重做第 2 题\n- 复习 RREF',
      },
    )
    const documentId = await addFile(filled)
    const { ai, streamJSON } = stubAI(() => ({}))
    const service = importer(ai)
    expect(await service.isTemplateDocument(documentId)).toBe(true)
    const preview = await service.prepare({ setId, documentId, checkIssues: true })
    expect(streamJSON).not.toHaveBeenCalled()
    expect(preview).toMatchObject({
      mode: 'template',
      complete: true,
      uncovered: [],
      unknownIds: [],
    })
    expect(preview.restText).toBeUndefined()
    expect(preview.sections.map((section) => section.id).sort()).toEqual([
      'overview',
      'q:q1',
      'q:q2',
      'summary',
    ])
    const q1 = preview.sections.find((section) => section.id === 'q:q1')!
    expect(q1).toMatchObject({ origin: 'imported', sourceDocumentId: documentId, status: 'ready' })
    // Paragraphs kept: read from the stored bytes, not the trimmed chunks.
    expect(q1.body).toContain('作 $R_2 \\to R_2 - 2R_1$：\n$$')
    expect(q1.body).not.toContain('<!--')
    expect(q1.body).not.toContain('#### 讲解')
    expect(q1.analysis).toBe('- 求解 2×2 方程组')
    expect(q1.conclusion).toBe('$x_1=-1, x_2=2$')
    expect(q1.checks).toEqual([
      expect.objectContaining({ label: '1', rrefMatches: true, kindMatches: true }),
    ])
    const summary = preview.sections.find((section) => section.id === 'summary')!
    expect(summary.body).toBe('两道题都用行化简。')
    expect(summary.suggestions).toEqual(['重做第 2 题', '复习 RREF'])

    // No AI configured at all: the template still imports, and saves like any import.
    const offline = importer(null)
    const again = await offline.prepare({ setId, documentId, checkIssues: false })
    expect(again.sections).toHaveLength(4)
    expect(await offline.commit(again)).toEqual({ saved: 4, replaced: 0 })
    const state = await new HomeworkWalkthroughService({ ai: null, db }).state(setId)
    const entry = state.plan.find((item) => item.id === 'q:q1')!
    expect(entry.needsWork).toBe(false)
    expect(entry.section?.origin).toBe('imported')
    // A second import asks before replacing the first.
    const third = await offline.prepare({ setId, documentId, checkIssues: false })
    expect(third.conflicts.sort()).toEqual(['overview', 'q:q1', 'q:q2', 'summary'])
    await expect(offline.commit(third)).rejects.toMatchObject({ code: 'IMPORT_NEEDS_CONFIRMATION' })
  })

  it('reads a template from a non-text file through its extracted text', async () => {
    await setup()
    const filled = fill((await importer().template(setId)).text, { q1: { body: P1_BODY } })
    const documentId = await addFile(filled, 'pdf')
    const preview = await importer().prepare({ setId, documentId, checkIssues: true })
    expect(preview.mode).toBe('template')
    expect(preview.sections.map((section) => section.id)).toEqual(['q:q1'])
    expect(preview.uncovered).toEqual(['q2'])
  })

  it('tolerates an external AI’s usual deviations', () => {
    const output = [
      'Sure! Here is the completed walkthrough:',
      '',
      '```markdown',
      '# HW3',
      "<!--walkthrough : question  id='q1'  label='1'-->",
      '## Question 1',
      '<!--  walkthrough:analysis  -->',
      '### Analysis of the problem',
      'Two equations.',
      '<!-- WALKTHROUGH:body -->',
      '### Solution',
      'Apply \\(R_2 \\to R_2 - 2R_1\\):',
      '\\[ \\begin{bmatrix} 1 & 2 \\\\[2pt] 0 & 1 \\end{bmatrix} \\]',
      '<!-- walkthrough:conclusion -->',
      '**Answer**',
      '$x = 1$',
      '<!-- walkthrough:check -->',
      '```json',
      '{"linearSystems":[{"label":"1","augmented":[["1","2"]],"rref":[["1","2"]],"solution":"unique"}]}',
      '```',
      '<!-- walkthrough:question id=“q2” label=“2” -->',
      '#### 原题',
      '> Decide.',
      '#### 分析',
      'Asks for consistency.',
      '#### 讲解',
      'The last row reads $0 = 1$.',
      '#### 结论',
      'No solution.',
      '```',
      '',
      'Let me know if you need anything else.',
    ].join('\n')
    expect(hasTemplateMarkers(output)).toBe(true)
    const parsed = parseTemplateImport(output, new Set(['q1', 'q2']))
    expect(parsed.problems).toEqual([])
    const [q1, q2] = parsed.reply.questions
    expect(q1).toMatchObject({
      questionId: 'q1',
      analysis: 'Two equations.',
      conclusion: '**Answer**\n$x = 1$',
    })
    // \( \) and \[ \] become $ / $$; a row break with spacing (\\[2pt]) is left alone.
    expect(q1!.body).toBe(
      'Apply $R_2 \\to R_2 - 2R_1$:\n$$\\begin{bmatrix} 1 & 2 \\\\[2pt] 0 & 1 \\end{bmatrix}$$',
    )
    expect(q1!.linearSystems).toHaveLength(1)
    // Part markers dropped: the part headings (any language) are used instead.
    expect(q2).toMatchObject({
      questionId: 'q2',
      analysis: 'Asks for consistency.',
      body: 'The last row reads $0 = 1$.',
      conclusion: 'No solution.',
    })
    // The trailing prose after the closing fence stays outside (it follows no part marker).
    expect(JSON.stringify(parsed.reply)).not.toContain('```')
  })

  it('keeps maths in code untouched and leaves display maths alone', () => {
    expect(normalizeMathDelimiters('`\\(x\\)` and \\(y\\)')).toBe('`\\(x\\)` and $y$')
    expect(normalizeMathDelimiters('$$a \\\\[1em] b$$')).toBe('$$a \\\\[1em] b$$')
  })

  it('reports bad blocks, imports the good ones and lets the AI read only the rest', async () => {
    await setup()
    const template = (await importer().template(setId)).text
    // q2: the external AI dropped every part marker and heading.
    const filled = fill(template, { q1: { body: P1_BODY, check: '[{"label": oops' } }).replace(
      /(<!-- walkthrough:question id="q2" label="2" -->)[\s\S]*?(?=<!-- walkthrough:summary)/,
      '$1\nRow reduce: the last row reads $0 = 1$, so the system has no solution.\n\n',
    )
    const documentId = await addFile(filled)
    const { ai, users } = stubAI(() => ({
      questions: [
        {
          questionId: 'q2',
          conclusion: 'No solution.',
          body: 'Row reduce: the last row reads $0 = 1$, so the system has no solution.',
        },
      ],
    }))
    const service = importer(ai)
    const preview = await service.prepare({ setId, documentId, checkIssues: true })
    expect(users).toHaveLength(0)
    expect(preview.sections.map((section) => section.id)).toEqual(['q:q1'])
    // The unreadable check only skips the local check; the question is imported.
    expect(preview.sections[0]!.checks).toBeUndefined()
    expect(preview.templateProblems).toEqual([
      { questionId: 'q1', label: '1', reason: 'invalid-check' },
      { questionId: 'q2', label: '2', reason: 'unstructured' },
    ])
    expect(preview.restText).toContain('Row reduce')
    expect(preview.restText).not.toContain('R_2 \\to R_2 - 2R_1')

    const done = await service.prepare({
      setId,
      documentId,
      checkIssues: true,
      resume: preview,
      rest: true,
    })
    // Only the unreadable block, and only the questions still missing.
    expect(users).toHaveLength(1)
    expect(users[0]).toContain('Row reduce')
    expect(users[0]).not.toContain('R_2 \\to R_2 - 2R_1')
    expect(users[0]).toContain('id: q2 |')
    expect(users[0]).not.toContain('id: q1 |')
    expect(done.complete).toBe(true)
    expect(done.restText).toBeUndefined()
    expect(done.sections.map((section) => section.id).sort()).toEqual(['q:q1', 'q:q2'])
    expect(done.sections.find((section) => section.id === 'q:q1')!.body).toBe(
      preview.sections[0]!.body,
    )
    expect(done.templateProblems).toEqual([
      { questionId: 'q1', label: '1', reason: 'invalid-check' },
    ])
    expect(await service.commit(done)).toEqual({ saved: 2, replaced: 0 })
  })

  it('drops unknown ids and sends blocks without an id to the AI', () => {
    const text = [
      '<!-- walkthrough:question id="q9" label="9" -->',
      '<!-- walkthrough:body -->',
      'Something else.',
      '<!-- walkthrough:question label="2" -->',
      '<!-- walkthrough:body -->',
      'The answer to two.',
    ].join('\n')
    const parsed = parseTemplateImport(text, new Set(['q1', 'q2']))
    expect(parsed.unknownIds).toEqual(['q9'])
    expect(parsed.problems).toEqual([
      { questionId: 'q9', label: '9', reason: 'unknown-id' },
      { label: '2', reason: 'no-id' },
    ])
    expect(parsed.rest).toHaveLength(1)
    expect(parsed.rest[0]).toContain('The answer to two.')
    expect(parsed.reply.questions).toEqual([])
  })

  it('a file without template markers takes the AI path as before', async () => {
    await setup()
    const documentId = await addFile('Problem 1. Row reduce ... $x = 1$.')
    const { ai, users } = stubAI(() => ({
      questions: [
        { questionId: 'q1', conclusion: 'c', body: 'Problem 1. Row reduce ... $x = 1$.' },
      ],
    }))
    const service = importer(ai)
    expect(await service.isTemplateDocument(documentId)).toBe(false)
    const preview = await service.prepare({ setId, documentId, checkIssues: true })
    expect(users).toHaveLength(1)
    expect(preview.mode).toBeUndefined()
    expect(preview.sections.map((section) => section.id)).toEqual(['q:q1'])
  })
})
