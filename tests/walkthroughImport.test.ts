import 'fake-indexeddb/auto'
import { readFileSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { ProjectService } from '@/services/projectService'
import { HomeworkWalkthroughService } from '@/services/homeworkWalkthroughService'
import {
  IMPORT_SEGMENT_CHARS,
  WalkthroughImportPartError,
  WalkthroughImportService,
  importOutputBudget,
  importPartMessage,
  importSegmentChars,
  mergeImportParts,
  splitImportPieces,
} from '@/services/walkthroughImportService'
import { AuthFailedError, OutputTruncatedError } from '@/infrastructure/ai/errors'
import { friendlyAIError } from '@/shared/lib/aiErrors'
import { DocumentRepository } from '@/entities/document/repository'
import { ChunkRepository } from '@/entities/chunk/repository'
import { HomeworkRepository } from '@/entities/homework/repository'
import { WalkthroughRepository } from '@/entities/homework/walkthroughRepository'
import { UserRepository } from '@/entities/user/repository'
import {
  isCourseMaterialType,
  isReferenceOnlyMaterial,
  type Document,
} from '@/entities/document/types'
import { selectAnalysisDocuments } from '@/entities/courseContent/sourceHash'
import {
  buildSourceIndex,
  checkDerivedFromSource,
  issueQuoteFound,
} from '@/entities/homework/walkthroughImport'
import { formatHomeworkReviewText } from '@/entities/homework/reviewFormatting'
import {
  normalizeSectionSources,
  sectionLevel,
  sectionSources,
  walkthroughId,
  type WalkthroughSection,
} from '@/entities/homework/walkthrough'
import { prompts } from '@/infrastructure/ai/prompts'
import { createGenerationRun } from '@/shared/lib/generationControl'
import {
  NOTE_MARK_ATTRIBUTE,
  applyNoteMarkStyle,
  resolveNoteMarkStyle,
} from '@/features/theme/noteMarkStyle'
import type { AIService } from '@/services/aiService'
import type { HomeworkQuestion } from '@/entities/homework/types'

const readSource = (relative: string): string =>
  readFileSync(resolvePath(process.cwd(), relative), 'utf8')

/** Pages 1–3 of a real imported walkthrough (HW3 RREF), as the PDF extractor reads them. */
const FIXTURE = readSource('tests/fixtures/walkthrough-import-hw3.txt')

/** Problem 1 of the fixture, re-typeset the way the import asks for (values unchanged). */
const PROBLEM_1_BODY = [
  '增广矩阵：',
  '$$\\left[\\begin{array}{cccc|c} 1&2&3&4&10\\\\ 2&3&5&6&14\\\\ 3&4&6&8&18 \\end{array}\\right]$$',
  '第 1 列：主元已经是 1，把它下方消成 0。做 $R_2 \\to R_2 - 2R_1$，$R_3 \\to R_3 - 3R_1$：',
  '$$\\left[\\begin{array}{cccc|c} 1&2&3&4&10\\\\ 0&-1&-1&-2&-6\\\\ 0&-2&-3&-4&-12 \\end{array}\\right]$$',
  '第 2 列：做 $R_2 \\to -R_2$，然后 $R_3 \\to R_3 + 2R_2$。第 3 列：做 $R_3 \\to -R_3$，把主元变成 1。',
  '向上消元：依次做 $R_2 \\to R_2 - R_3$，$R_1 \\to R_1 - 3R_3$，$R_1 \\to R_1 - 2R_2$，得到 RREF：',
  '$$\\left[\\begin{array}{cccc|c} 1&0&0&0&-2\\\\ 0&1&0&2&6\\\\ 0&0&1&0&0 \\end{array}\\right]$$',
  '读解：主元在第 1、2、3 列，第 4 列没有主元，所以 $x_4$ 是自由变量。令 $x_4 = t$：',
  '$$x_1=-2,\\quad x_2=6-2t,\\quad x_3=0,\\quad x_4=t$$',
  '验算：代回第一个方程，$-2 + 2(6 - 2t) + 0 + 4t = 10$，成立。',
].join('\n\n')

/** Problem 2 (a) and (b) of the fixture, re-typeset. */
const PROBLEM_2_BODY = [
  '### (a) 3 个变量：无解',
  '$$\\left[\\begin{array}{ccc|c} 1&2&0&3\\\\ 0&1&3&4\\\\ 4&0&2&1\\\\ 0&1&1&2 \\end{array}\\right]$$',
  '先做 $R_3 \\to R_3 - 4R_1$，然后 $R_1 \\to R_1 - 2R_2$，$R_3 \\to R_3 + 8R_2$，$R_4 \\to R_4 - R_2$。',
  '最后一行表示 $0 = -5$，这是矛盾，所以无解。',
  '### (b) 2 个变量：无解',
  '先交换 $R_1 \\leftrightarrow R_2$，让左上角是 1。出现了 $0 = 13$，所以无解。',
].join('\n\n')

const P1_SYSTEM = {
  label: '1',
  augmented: [
    ['1', '2', '3', '4', '10'],
    ['2', '3', '5', '6', '14'],
    ['3', '4', '6', '8', '18'],
  ],
  rref: [
    ['1', '0', '0', '0', '-2'],
    ['0', '1', '0', '2', '6'],
    ['0', '0', '1', '0', '0'],
  ],
  solution: 'infinite',
}

interface Call {
  system: string
  user: string
}

function stubAI(handler: (call: Call, index: number) => unknown) {
  const calls: Call[] = []
  const streamJSON = vi.fn(async (messages: Array<{ content: string }>) => {
    const call = { system: messages[0]!.content, user: messages[1]!.content }
    calls.push(call)
    return { data: await handler(call, calls.length - 1), raw: {} }
  })
  return {
    calls,
    ai: { streamJSON, chatJSON: streamJSON, maxOutputTokens: 8192 } as unknown as AIService,
  }
}

let db: AppDatabase
let projectId: string
let setId: string
let importDocId: string

async function setup(options: { chunks?: string[] } = {}): Promise<void> {
  db = new AppDatabase()
  setDbForTesting(db)
  projectId = (await new ProjectService(db).create({ name: 'LA', subject: 'linear_algebra' })).id
  const documents = new DocumentRepository(db)
  const hw = await documents.create({
    projectId,
    type: 'text',
    materialType: 'homework',
    name: 'hw3.pdf',
    sizeBytes: 0,
  })
  const repo = new HomeworkRepository(db)
  setId = crypto.randomUUID()
  await repo.upsertSet({
    id: setId,
    projectId,
    documentId: hw.id,
    documentName: 'hw3.pdf',
    title: 'HW3',
    status: 'ready',
    language: 'zh',
    questionCount: 2,
    promptVersion: 'v1',
    createdAt: 1,
    updatedAt: 1,
  })
  const prompts = [
    'Problem 1. Solve the linear system by row reduction (RREF).',
    'Problem 2. For each augmented matrix (a)–(g), decide whether the system has no, one or infinitely many solutions.',
  ]
  for (const [index, prompt] of prompts.entries()) {
    const question: HomeworkQuestion = {
      id: `q${index + 1}`,
      projectId,
      setId,
      documentId: hw.id,
      documentName: 'hw3.pdf',
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
    }
    await repo.upsertQuestion(question)
  }
  const imported = await documents.create({
    projectId,
    type: 'pdf',
    materialType: 'walkthrough_import',
    name: 'HW3 行化简（RREF）完整讲解.pdf',
    sizeBytes: 10,
  })
  importDocId = imported.id
  const texts = options.chunks ?? FIXTURE.split(/\n(?=Problem \d)/)
  await new ChunkRepository(db).addMany(
    texts.map((text, order) => ({
      documentId: importDocId,
      projectId,
      materialType: 'walkthrough_import' as const,
      contentType: 'paragraph' as const,
      text,
      sourceReference: imported.name,
      order,
    })),
  )
  await documents.update(importDocId, { status: 'ready', chunkCount: texts.length })
}

const importer = (ai: AIService | null) => new WalkthroughImportService({ ai, db })
const walkthroughs = (ai: AIService | null = null) => new HomeworkWalkthroughService({ ai, db })

/** A faithful import reply for the fixture. */
function faithfulReply(extra: Record<string, unknown> = {}) {
  return {
    overview: '',
    questions: [
      {
        questionId: 'q1',
        conclusion: '无穷多解，$x_1 = -2$，$x_2 = 6 - 2t$，$x_3 = 0$，$x_4 = t$。',
        analysis: '求一个 3×4 线性方程组的通解。',
        body: PROBLEM_1_BODY,
        issues: [],
        linearSystems: [P1_SYSTEM],
      },
      {
        questionId: 'q2',
        conclusion: '(a)(b) 无解。',
        body: PROBLEM_2_BODY,
        issues: [],
        linearSystems: [],
      },
    ],
    summary: '',
    suggestions: [],
    other: '',
    ...extra,
  }
}

afterEach(() => {
  db?.close()
})

describe('walkthrough_import material role', () => {
  it('is reference only: excluded from analysis, quizzes, tutor sources and vocabulary', () => {
    expect(isReferenceOnlyMaterial('walkthrough_import')).toBe(true)
    expect(isCourseMaterialType('walkthrough_import')).toBe(false)
    const doc = (id: string, materialType: Document['materialType']) =>
      ({ id, status: 'ready', materialType }) as Document
    // Course analysis and course vocabulary read through selectAnalysisDocuments.
    expect(
      selectAnalysisDocuments([doc('book', 'textbook'), doc('import', 'walkthrough_import')]).map(
        (d) => d.id,
      ),
    ).toEqual(['book'])
  })
})

describe('source derivation checks', () => {
  const index = buildSourceIndex(FIXTURE)

  it('accepts a faithful re-typesetting (Kangxi radicals, minus signs and LaTeX normalised)', () => {
    expect(checkDerivedFromSource(PROBLEM_1_BODY, index)).toMatchObject({ ok: true })
    expect(checkDerivedFromSource(PROBLEM_2_BODY, index)).toMatchObject({ ok: true })
  })

  it('rejects invented text and changed values', () => {
    expect(
      checkDerivedFromSource(
        'Using Cramer’s rule we compute the determinant and find a unique solution by back substitution of every pivot variable.',
        index,
      ),
    ).toMatchObject({ ok: false, reason: 'not-in-source' })
    // Same wording, but the author's numbers replaced by different ones.
    const changed = PROBLEM_1_BODY.replace(/10/g, '97')
      .replace(/14/g, '73')
      .replace(/18/g, '59')
      .replace(/-12/g, '-83')
      .replace(/-6/g, '-71')
    expect(checkDerivedFromSource(changed, index)).toMatchObject({
      ok: false,
      reason: 'numbers-changed',
    })
  })

  it('finds issue quotes in the section or the file', () => {
    expect(issueQuoteFound('$x_3 = 0$', PROBLEM_1_BODY, index)).toBe(true)
    expect(issueQuoteFound('the eigenvalue is 42', PROBLEM_1_BODY, index)).toBe(false)
  })
})

describe('importing a walkthrough', () => {
  it('maps content to the closed set of question ids and drops invented ids', async () => {
    await setup()
    const { ai, calls } = stubAI(() =>
      faithfulReply({
        questions: [
          ...faithfulReply().questions,
          { questionId: 'q99', conclusion: 'x', body: PROBLEM_2_BODY },
          { questionId: '2', conclusion: 'x', body: PROBLEM_2_BODY },
        ],
        other: '合上答案，重做 2(a)：无解的典型。',
      }),
    )
    const preview = await importer(ai).prepare({
      setId,
      documentId: importDocId,
      checkIssues: true,
    })
    expect(preview.complete).toBe(true)
    // The prompt lists the assignment's ids and the untrusted file.
    expect(calls[0]!.user).toContain('id: q1 | label: 1')
    expect(calls[0]!.user).toContain('BEGIN WALKTHROUGH TO IMPORT (UNTRUSTED CONTENT')
    expect(calls[0]!.system).toContain('Security rules')
    expect(preview.sections.map((section) => section.id).sort()).toEqual(['q:q1', 'q:q2'])
    expect(preview.unknownIds.sort()).toEqual(['2', 'q99'])
    expect(preview.conflicts).toEqual([])
    // 「其它内容」 not found in the file text: rejected like any invented section.
    const q1 = preview.sections.find((section) => section.id === 'q:q1')!
    expect(q1).toMatchObject({
      origin: 'imported',
      sourceDocumentId: importDocId,
      status: 'ready',
      title: '1',
    })

    const result = await importer(ai).commit(preview)
    expect(result).toEqual({ saved: preview.sections.length, replaced: 0 })
    const state = await walkthroughs().state(setId)
    const entry = state.plan.find((item) => item.id === 'q:q1')!
    // Saved with the current input hash: shown as up to date, not 「可更新」.
    expect(entry.needsWork).toBe(false)
    expect(entry.section?.origin).toBe('imported')
  })

  it('keeps unmatched content as 「其它内容」 when it is in the file', async () => {
    await setup()
    const { ai } = stubAI(() =>
      faithfulReply({
        other: '直观理解：第 4 个方程要求 $x_3 = 1$，第 3 个方程却要求 $x_3 = 21/26$，两者冲突。',
      }),
    )
    const service = importer(ai)
    await service.commit(
      await service.prepare({ setId, documentId: importDocId, checkIssues: true }),
    )
    const plan = (await walkthroughs().state(setId)).plan
    const other = plan.find((entry) => entry.kind === 'other')
    expect(other?.section).toMatchObject({ origin: 'imported', status: 'ready' })
    expect(other?.needsWork).toBe(false)
    // Nothing to regenerate it from.
    await expect(
      walkthroughs(stubAI(() => ({})).ai).regenerateSection(setId, 'other'),
    ).rejects.toThrow()
  })

  it('rejects sections that are not in the file', async () => {
    await setup()
    const invented =
      'We apply Cramer’s rule: compute det(A) = 42, then each variable equals the ratio of determinants, which gives a unique solution.'
    const { ai } = stubAI(() => {
      const reply = faithfulReply()
      reply.questions[1]!.body = invented
      return reply
    })
    const preview = await importer(ai).prepare({
      setId,
      documentId: importDocId,
      checkIssues: true,
    })
    expect(preview.sections.map((section) => section.id)).toEqual(['q:q1'])
    expect(preview.rejected).toEqual([
      { sectionId: 'q:q2', questionId: 'q2', reason: 'not-in-source' },
    ])
    expect(preview.uncovered).toEqual(['q2'])
  })

  it('shows reported issues but keeps the author’s math unchanged', async () => {
    await setup()
    const { ai } = stubAI(() => {
      const reply = faithfulReply()
      reply.questions[0]!.issues = [
        { quote: '$x_3 = 0$', note: '代回第三个方程检查 $x_3$ 的值。' },
        { quote: 'the eigenvalue is 42', note: 'Invented quote.' },
      ] as never[]
      return reply
    })
    const preview = await importer(ai).prepare({
      setId,
      documentId: importDocId,
      checkIssues: true,
    })
    const q1 = preview.sections.find((section) => section.id === 'q:q1')!
    // The body is exactly the model's re-typesetting of the author's text.
    expect(q1.body).toBe(formatHomeworkReviewText(PROBLEM_1_BODY))
    expect(q1.body).toContain('x_1=-2,\\quad x_2=6-2t')
    expect(q1.issues).toEqual([{ quote: '$x_3 = 0$', note: '代回第三个方程检查 $x_3$ 的值。' }])
    expect(preview.droppedIssues).toBe(1)
  })

  it('只排版，不核对 leaves the issue-finding part out', async () => {
    await setup()
    const { ai, calls } = stubAI(() => {
      const reply = faithfulReply()
      reply.questions[0]!.issues = [{ quote: '$x_3 = 0$', note: 'n' }] as never[]
      return reply
    })
    const preview = await importer(ai).prepare({
      setId,
      documentId: importDocId,
      checkIssues: false,
    })
    expect(calls[0]!.system).not.toContain('"issues"')
    expect(calls[0]!.system).toContain('Do not check the work for mistakes')
    expect(preview.sections.every((section) => !section.issues)).toBe(true)
    const full = prompts.walkthroughImport.buildSystemPrompt({
      checkIssues: true,
      linearSystems: false,
    })
    expect(calls[0]!.system.length).toBeLessThan(full.length + 2_000)
    expect(full).toContain('"issues"')
  })

  it('re-checks row reductions of imported linear-algebra sections locally', async () => {
    await setup()
    const { ai, calls } = stubAI(() => {
      const reply = faithfulReply()
      reply.questions[1]!.linearSystems = [
        {
          label: '(a)',
          augmented: [
            ['1', '2', '0', '3'],
            ['0', '1', '3', '4'],
            ['4', '0', '2', '1'],
            ['0', '1', '1', '2'],
          ],
          // Wrong on purpose: the system is inconsistent, RREF is I₄ (rows of width 4).
          rref: [
            ['1', '0', '0', '1'],
            ['0', '1', '0', '1'],
            ['0', '0', '1', '1'],
            ['0', '0', '0', '0'],
          ],
          solution: 'unique',
        },
      ]
      return reply
    })
    const preview = await importer(ai).prepare({
      setId,
      documentId: importDocId,
      checkIssues: true,
    })
    expect(calls[0]!.system).toContain('"linearSystems"')
    const q1 = preview.sections.find((section) => section.id === 'q:q1')!
    expect(q1.checks).toEqual([
      expect.objectContaining({ label: '1', rrefMatches: true, kindMatches: true }),
    ])
    const q2 = preview.sections.find((section) => section.id === 'q:q2')!
    expect(q2.checks).toEqual([
      expect.objectContaining({ label: '(a)', rrefMatches: false, computedKind: 'none' }),
    ])
  })

  it('keeps the generated walkthrough as the other source, switchable both ways', async () => {
    await setup()
    const state = await walkthroughs().state(setId)
    const entry = state.plan.find((item) => item.id === 'q:q1')!
    const generated: WalkthroughSection = {
      id: 'q:q1',
      kind: 'question',
      questionId: 'q1',
      title: '1',
      conclusion: 'Generated conclusion.',
      body: 'Generated body.',
      status: 'ready',
      inputHash: entry.inputHash,
      level: 'detailed',
      variants: {
        detailed: { body: 'Generated detailed.', inputHash: entry.inputHash, generatedAt: 4 },
      },
      previous: { body: 'Older generated body.', inputHash: entry.inputHash, generatedAt: 2 },
      generatedAt: 5,
    }
    const repo = new WalkthroughRepository(db)
    await repo.putSection(
      { id: walkthroughId(setId, state.language), projectId, setId, language: state.language },
      generated,
    )
    const { ai } = stubAI(() => faithfulReply())
    const service = importer(ai)
    const preview = await service.prepare({ setId, documentId: importDocId, checkIssues: true })
    // Nothing imported before: nothing is replaced, the generated one is kept.
    expect(preview.conflicts).toEqual([])
    expect(preview.keptGenerated).toEqual(['q:q1'])
    expect(await service.commit(preview)).toEqual({ saved: 2, replaced: 0 })

    const read = async () =>
      (await walkthroughs().state(setId)).plan.find((item) => item.id === 'q:q1')!
    let shown = await read()
    expect(shown.section!.origin).toBe('imported')
    expect(sectionSources(shown.section)).toEqual(['imported', 'generated'])
    // The generated source is kept whole: its level, detailed version and own 上一版.
    expect(shown.section!.alternate).toMatchObject({
      body: 'Generated body.',
      level: 'detailed',
      variants: { detailed: { body: 'Generated detailed.' } },
      previous: { body: 'Older generated body.' },
    })
    expect(shown.section!.previous).toBeUndefined()
    expect(shown.generated?.body).toBe('Generated body.')
    // An imported section shows one level, whatever the setting.
    expect(sectionLevel(shown.section, 'detailed')).toBe('standard')

    await walkthroughs().setSource(setId, 'q:q1', 'generated')
    shown = await read()
    expect(shown.section).toMatchObject({ body: 'Generated body.', level: 'detailed' })
    expect(shown.section!.origin).toBeUndefined()
    expect(shown.section!.previous).toMatchObject({ body: 'Older generated body.' })
    expect(shown.section!.alternate).toMatchObject({ origin: 'imported', body: PROBLEM_1_BODY })
    // 恢复上一版 still works within the generated source and keeps the import.
    await walkthroughs().restorePrevious(setId, 'q:q1')
    shown = await read()
    expect(shown.section!.body).toBe('Older generated body.')
    expect(shown.section!.alternate?.origin).toBe('imported')
    await walkthroughs().setSource(setId, 'q:q1', 'imported')
    shown = await read()
    expect(shown.section!.origin).toBe('imported')
    expect(shown.section!.alternate?.body).toBe('Older generated body.')
  })

  it('asks before replacing an earlier import and keeps it as 上一版', async () => {
    await setup()
    const { ai } = stubAI(() => faithfulReply())
    const service = importer(ai)
    await service.commit(
      await service.prepare({ setId, documentId: importDocId, checkIssues: true }),
    )
    const again = await service.prepare({ setId, documentId: importDocId, checkIssues: false })
    expect(again.conflicts).toEqual(['q:q1', 'q:q2'])
    await expect(service.commit(again)).rejects.toMatchObject({
      code: 'IMPORT_NEEDS_CONFIRMATION',
    })
    expect(await service.commit(again, { confirmReplace: true })).toMatchObject({ replaced: 2 })
    const section = (await walkthroughs().state(setId)).walkthrough!.sections.find(
      (item) => item.id === 'q:q1',
    )!
    expect(section.origin).toBe('imported')
    expect(section.previous).toMatchObject({ origin: 'imported', body: PROBLEM_1_BODY })
  })

  it('reads sections saved before sources existed: the other source in 上一版 becomes switchable', async () => {
    await setup()
    const state = await walkthroughs().state(setId)
    const entry = state.plan.find((item) => item.id === 'q:q1')!
    const legacy: WalkthroughSection = {
      id: 'q:q1',
      kind: 'question',
      questionId: 'q1',
      title: '1',
      body: 'Imported body.',
      status: 'ready',
      origin: 'imported',
      sourceDocumentId: importDocId,
      inputHash: entry.inputHash,
      previous: { body: 'Generated body.', inputHash: entry.inputHash, generatedAt: 1 },
      generatedAt: 2,
    }
    // Written raw, as an older version stored it.
    await db.table('homeworkWalkthroughs').put({
      id: walkthroughId(setId, state.language),
      projectId,
      setId,
      language: state.language,
      sections: [legacy],
      createdAt: 1,
      updatedAt: 1,
    })
    const shown = (await walkthroughs().state(setId)).plan.find((item) => item.id === 'q:q1')!
    expect(sectionSources(shown.section)).toEqual(['imported', 'generated'])
    expect(shown.section!.previous).toBeUndefined()
    await walkthroughs().setSource(setId, 'q:q1', 'generated')
    const after = (await walkthroughs().state(setId)).walkthrough!.sections[0]!
    expect(after.body).toBe('Generated body.')
    expect(after.alternate).toMatchObject({ origin: 'imported', body: 'Imported body.' })
    // A section that never had an import is untouched by the reading.
    const plain: WalkthroughSection = { ...legacy, origin: undefined, previous: undefined }
    delete plain.origin
    delete plain.previous
    expect(normalizeSectionSources(plain)).toBe(plain)
    expect(sectionSources(plain)).toEqual(['generated'])
  })
  it('reads a long file in parts, pausable between parts, and joins a question split across them', async () => {
    const big = 'x'.repeat(IMPORT_SEGMENT_CHARS)
    await setup({ chunks: [`${PROBLEM_1_BODY}\n${big}`, `${PROBLEM_2_BODY}\n${big}`] })
    const run = createGenerationRun()
    const { ai, calls } = stubAI((_call, index) => {
      if (index === 0) {
        run.requestPause()
        return { questions: [{ questionId: 'q1', conclusion: 'c1', body: PROBLEM_1_BODY }] }
      }
      return {
        questions: [
          { questionId: 'q1', conclusion: '', body: '验算：代回第一个方程，成立。' },
          { questionId: 'q2', conclusion: 'c2', body: PROBLEM_2_BODY },
        ],
      }
    })
    const service = importer(ai)
    const paused = await service.prepare({
      setId,
      documentId: importDocId,
      checkIssues: true,
      control: run,
    })
    expect(paused).toMatchObject({ complete: false, partsTotal: 2 })
    expect(paused.parts).toHaveLength(1)
    expect(calls[0]!.user).toContain('part 1 of 2')
    await expect(service.commit(paused)).rejects.toThrow()

    const done = await service.prepare({
      setId,
      documentId: importDocId,
      checkIssues: true,
      resume: paused,
    })
    expect(calls).toHaveLength(2)
    expect(done.complete).toBe(true)
    const q1 = done.sections.find((section) => section.id === 'q:q1')!
    expect(q1.body).toContain('验算：代回第一个方程，成立。')
    expect(q1.body.startsWith('增广矩阵')).toBe(true)
  })

  it('merges replies of several parts in order', () => {
    const merged = mergeImportParts([
      {
        questions: [
          { questionId: 'q1', conclusion: 'a', body: 'one', issues: [], linearSystems: [] },
        ],
        overview: 'open',
        summary: '',
        suggestions: [],
        other: '',
        unknownIds: ['x'],
      },
      {
        questions: [
          { questionId: 'q1', conclusion: 'b', body: 'two', issues: [], linearSystems: [] },
        ],
        overview: 'ignored',
        summary: 'close',
        suggestions: ['redo'],
        other: 'extra',
        unknownIds: ['x'],
      },
    ])
    expect(merged.questions[0]).toMatchObject({ body: 'one\n\ntwo', conclusion: 'a\n\nb' })
    expect(merged).toMatchObject({
      overview: 'open',
      summary: 'close',
      suggestions: ['redo'],
      other: 'extra',
      unknownIds: ['x'],
    })
  })
})

describe('long imports and the output cap', () => {
  /** A model with an output cap: records each request's budget. */
  function cappedAI(
    handler: (user: string, maxTokens: number) => unknown,
    caps: { maxOutputTokens?: number; modelMaxOutputTokens?: number } = {},
  ) {
    const budgets: number[] = []
    const users: string[] = []
    const streamJSON = vi.fn(
      async (
        messages: Array<{ content: string }>,
        _delta: unknown,
        options: { maxTokens: number },
      ) => {
        budgets.push(options.maxTokens)
        users.push(messages[1]!.content)
        return { data: await handler(messages[1]!.content, options.maxTokens), raw: {} }
      },
    )
    return {
      budgets,
      users,
      ai: {
        streamJSON,
        chatJSON: streamJSON,
        maxOutputTokens: caps.maxOutputTokens ?? 8192,
        modelMaxOutputTokens: caps.modelMaxOutputTokens,
      } as unknown as AIService,
    }
  }
  const replyFor = (user: string) => ({
    questions: [
      ...(user.includes('增广矩阵')
        ? [{ questionId: 'q1', conclusion: 'c1', body: PROBLEM_1_BODY }]
        : []),
      ...(user.includes('(a) 3 个变量')
        ? [{ questionId: 'q2', conclusion: 'c2', body: PROBLEM_2_BODY }]
        : []),
    ],
  })

  it('plans parts from the output cap and never asks for more than the cap', () => {
    expect(importSegmentChars(8192)).toBe(IMPORT_SEGMENT_CHARS)
    expect(IMPORT_SEGMENT_CHARS).toBeLessThan(4_000)
    // Estimated reply of a planned part fits the cap.
    expect(importOutputBudget(IMPORT_SEGMENT_CHARS, 8192)).toBeLessThanOrEqual(8192)
    expect(importSegmentChars(384_000)).toBe(12_000)
    expect(importSegmentChars(1_024)).toBe(2_000)
    expect(importOutputBudget(100_000, 8192)).toBe(8192)
  })

  it('doubles the budget up to the cap, then reads the part in halves and merges them', async () => {
    await setup({ chunks: [PROBLEM_1_BODY, PROBLEM_2_BODY] })
    const { ai, budgets, users } = cappedAI((user) => {
      // The whole part never fits; each half does.
      if (user.includes('增广矩阵') && user.includes('(a) 3 个变量'))
        throw new OutputTruncatedError()
      return replyFor(user)
    })
    const preview = await importer(ai).prepare({
      setId,
      documentId: importDocId,
      checkIssues: true,
    })
    expect(budgets[0]).toBe(
      importOutputBudget(`${PROBLEM_1_BODY}\n\n${PROBLEM_2_BODY}`.length, 8192),
    )
    expect(budgets.slice(0, 3)).toEqual([budgets[0], budgets[0]! * 2, 8192])
    expect(users).toHaveLength(5)
    expect(users[3]).toContain('only a fragment')
    expect(users[0]).not.toContain('only a fragment')
    expect(preview.complete).toBe(true)
    expect(preview.partsTotal).toBe(1)
    expect(preview.pieces).toBeUndefined()
    expect(preview.sections.map((section) => section.id).sort()).toEqual(['q:q1', 'q:q2'])
  })

  it('a failed piece keeps what was read; continuing asks only for the rest', async () => {
    await setup({ chunks: [PROBLEM_1_BODY, PROBLEM_2_BODY] })
    const failing = cappedAI((user) => {
      if (user.includes('增广矩阵') && user.includes('(a) 3 个变量'))
        throw new OutputTruncatedError()
      if (user.includes('(a) 3 个变量')) throw new AuthFailedError('Key rejected by provider.')
      return replyFor(user)
    })
    const error = await importer(failing.ai)
      .prepare({ setId, documentId: importDocId, checkIssues: true })
      .catch((err: unknown) => err)
    expect(error).toBeInstanceOf(WalkthroughImportPartError)
    const partial = (error as WalkthroughImportPartError).partial
    expect(partial.complete).toBe(false)
    expect(Object.values(partial.pieces ?? {})).toContain('split')
    expect((error as Error).message).not.toContain('请重试本题')

    const working = cappedAI((user) => replyFor(user))
    const done = await importer(working.ai).prepare({
      setId,
      documentId: importDocId,
      checkIssues: true,
      resume: partial,
    })
    // Only the failed half: the whole part is not asked for again.
    expect(working.users).toHaveLength(1)
    expect(working.users[0]).toContain('(a) 3 个变量')
    expect(working.users[0]).not.toContain('增广矩阵')
    expect(done.complete).toBe(true)
    expect(done.sections.map((section) => section.id).sort()).toEqual(['q:q1', 'q:q2'])
  })

  it('says which part was too long and whose limit it was', () => {
    const atModel = importPartMessage(
      2,
      3,
      new OutputTruncatedError(8192, { limit: 8192, by: 'model' }),
    )
    expect(atModel).toContain('8192')
    expect(atModel).toMatch(/2/)
    expect(atModel).not.toBe(friendlyAIError(new OutputTruncatedError()))
    const atSetting = importPartMessage(
      1,
      1,
      new OutputTruncatedError(4096, { limit: 4096, by: 'setting' }),
    )
    expect(atSetting).toContain('4096')
    expect(atSetting).not.toBe(atModel.replace('8192', '4096'))
    const other = importPartMessage(1, 2, new AuthFailedError('Key rejected by provider.'))
    expect(other).toContain(friendlyAIError(new AuthFailedError('Key rejected by provider.')))
  })

  it('never splits a piece inside a display formula', () => {
    const matrix = `$$\\begin{bmatrix}\n${Array.from({ length: 40 }, (_, i) => `${i} & ${i + 1} \\\\`).join('\n')}\n\\end{bmatrix}$$`
    const text = `${'Intro line. '.repeat(30)}\n\n${matrix}\n\n${'Closing words. '.repeat(30)}`
    const halves = splitImportPieces([text])!
    expect(halves).not.toBeNull()
    for (const half of halves) {
      const joined = half.join('')
      expect((joined.match(/\$\$/g) ?? []).length % 2).toBe(0)
    }
    expect(splitImportPieces(['short'])).toBeNull()
    expect(splitImportPieces(['a', 'b', 'c'])).toEqual([['a'], ['b', 'c']])
  })
})

describe('问答标记样式', () => {
  it('applies the stored style to <html> and defaults to the link style', () => {
    expect(resolveNoteMarkStyle(undefined)).toBe('link')
    expect(resolveNoteMarkStyle('neon')).toBe('link')
    expect(applyNoteMarkStyle('highlighter')).toBe('highlighter')
    expect(document.documentElement.getAttribute(NOTE_MARK_ATTRIBUTE)).toBe('highlighter')
    applyNoteMarkStyle(undefined)
    expect(document.documentElement.getAttribute(NOTE_MARK_ATTRIBUTE)).toBe('link')
  })

  it('styles saved and unsaved marks for both styles and dark mode with theme tokens', () => {
    const css = readSource('src/shared/styles/globals.css').replace(/\s+/g, ' ')
    for (const name of ['walkthrough-note', 'walkthrough-link']) {
      expect(css).toContain(`:root:not([data-note-mark='highlighter']) ::highlight(${name})`)
      expect(css).toContain(`:root[data-note-mark='highlighter'] ::highlight(${name})`)
      expect(css).toContain(`:root.dark[data-note-mark='highlighter'] ::highlight(${name})`)
    }
    // Saved is stronger than unsaved in the highlighter style.
    const alpha = (selector: string): number =>
      Number(
        new RegExp(
          `${selector.replace(/[[\]().']/g, '\\$&')} \\{ background-color: hsl\\(var\\(--primary\\) / ([\\d.]+)\\)`,
        ).exec(css)![1],
      )
    expect(
      alpha(":root[data-note-mark='highlighter'] ::highlight(walkthrough-note)"),
    ).toBeGreaterThan(alpha(":root[data-note-mark='highlighter'] ::highlight(walkthrough-link)"))
    // No hard-coded colours in the mark rules.
    const rules = css.slice(
      css.indexOf('::highlight(walkthrough-note)') - 60,
      css.indexOf('::highlight(walkthrough-flash)'),
    )
    expect(rules).not.toMatch(/#[0-9a-f]{3,6}\b|rgb\(/i)
  })

  it('is stored on the user profile', async () => {
    db = new AppDatabase()
    setDbForTesting(db)
    const users = new UserRepository(db)
    expect((await users.update({ noteMarkStyle: 'highlighter' })).noteMarkStyle).toBe('highlighter')
    expect((await users.get()).noteMarkStyle).toBe('highlighter')
  })
})
