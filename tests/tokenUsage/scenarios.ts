/**
 * Token-usage scenarios: one per user action, recording the exact messages the
 * app sends. Most build their requests with the registry's prompt builders and
 * the services' own helpers, the way the services assemble them (so a prompt
 * or assembly change shows up here); the quiz runs the real `QuizService`
 * against a recording AI (see `tests/tokenUsage.test.ts`).
 */
import { prompts } from '@/infrastructure/ai/prompts'
import { planOutputBudget, planQuestionOutputBudget } from '@/entities/homework/tokenBudget'
import { sectionKeyPoints } from '@/services/homeworkWalkthroughService'
import { promptSourceText } from '@/services/homeworkService'
import type { RecordedRequest } from './estimate'
import {
  ASK_HISTORY,
  CONCLUSION,
  HOMEWORK_PAGE,
  HOMEWORK_QUESTIONS,
  PREVIOUS_SOLUTION,
  PROFESSOR_ANSWER,
  QA_HISTORY,
  STUDENT_ANSWER,
  VOCAB_TERMS,
  bioPassages,
  chunkSnippet,
  laPassages,
  workedBody,
} from './fixtures'

/** The configured output cap the scenarios assume (a manual 8192 setting). */
export const CONFIG_MAX_TOKENS = 8192

const LA = 'linear_algebra' as const
const BIO = 'biology' as const

function req(
  kind: string,
  system: string,
  user: string,
  maxTokens: number = CONFIG_MAX_TOKENS,
): RecordedRequest {
  return {
    kind,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    maxTokens,
  }
}

/** Same budget as `requestSectionJSON` in the walkthrough service. */
function sectionBudget(system: string, user: string): number {
  return planOutputBudget({
    inputChars: system.length + user.length,
    userMaxTokens: CONFIG_MAX_TOKENS,
    ceiling: 8_192,
    overhead: 4_000,
    min: 2_048,
  })
}

const clip = (value: string, max: number) =>
  value.length > max ? `${value.slice(0, max)}…` : value

const wt = prompts.homeworkWalkthrough
const [Q1, Q2, Q3] = HOMEWORK_QUESTIONS as [
  (typeof HOMEWORK_QUESTIONS)[number],
  (typeof HOMEWORK_QUESTIONS)[number],
  (typeof HOMEWORK_QUESTIONS)[number],
]

/** 完整讲解：整题（单次请求），有教授答案与旧解法。 */
function walkthroughWhole(): RecordedRequest[] {
  return [Q1, Q3].map((q) => {
    const system = prompts.subjectProfile.withSubject(
      wt.buildQuestionSystemPrompt({
        linearSystems: true,
        analysis: true,
        steps: true,
        alignProfessor: true,
      }),
      LA,
    )
    const user = wt.buildQuestionUserPrompt({
      label: q.label,
      question: q.prompt,
      sourceText: HOMEWORK_PAGE,
      language: 'zh_terms',
      professorAnswer: PROFESSOR_ANSWER,
      previousSolution: PREVIOUS_SOLUTION,
    })
    return { ...req('walkthrough.question', system, user), maxTokens: sectionBudget(system, user) }
  })
}

/** 完整讲解：分小题（第 2 题 4 个小题，逐个请求）。 */
function walkthroughSplit(): RecordedRequest[] {
  const labels = ['a', 'b', 'c', 'd']
  const system = prompts.subjectProfile.withSubject(
    wt.buildPartSystemPrompt({ linearSystems: true, punctuation: true, steps: true }),
    LA,
  )
  const written: Array<{ label: string; conclusion: string; body: string }> = []
  return labels.map((part, index) => {
    const each = written.length ? Math.max(600, Math.floor(6000 / written.length)) : 0
    const user = wt.buildPartUserPrompt({
      label: Q2.label,
      question: Q2.prompt,
      sourceText: HOMEWORK_PAGE,
      language: 'zh_terms',
      previousSolution: PREVIOUS_SOLUTION,
      part,
      parts: labels,
      earlier: written.map((w) => ({ ...w, body: clip(w.body, each) })),
      ...(index === 0 ? { analysis: true } : {}),
    })
    written.push({ label: part, conclusion: CONCLUSION, body: workedBody(3) })
    return { ...req('walkthrough.part', system, user), maxTokens: sectionBudget(system, user) }
  })
}

const frameQuestions = () =>
  HOMEWORK_QUESTIONS.map((q) => ({
    label: q.label,
    question: clip(q.prompt, 800),
    conclusion: clip(CONCLUSION, 1000),
    keyPoints: sectionKeyPoints({ body: workedBody(4) }),
  }))

/** 完整讲解：开头 + 小结（两次请求）。 */
function walkthroughFrame(): RecordedRequest[] {
  return (['overview', 'summary'] as const).map((part) => {
    const system = prompts.subjectProfile.withSubject(wt.buildFramePartSystemPrompt({ part }), LA)
    const user = wt.buildFramePartUserPrompt({
      title: 'Homework 4',
      questions: frameQuestions(),
      language: 'zh_terms',
      part,
    })
    return { ...req(`walkthrough.${part}`, system, user), maxTokens: sectionBudget(system, user) }
  })
}

/** 完整讲解：详细版（第 2 题，按 4 个小题）。 */
function walkthroughDetailed(): RecordedRequest[] {
  const system = prompts.subjectProfile.withSubject(
    wt.buildVariantSystemPrompt({ linearSystems: true, level: 'detailed', part: true }),
    LA,
  )
  return ['a', 'b', 'c', 'd'].map((part) => {
    const user = wt.buildVariantUserPrompt({
      label: Q2.label,
      question: Q2.prompt,
      sourceText: HOMEWORK_PAGE,
      language: 'zh_terms',
      level: 'detailed',
      part,
      heading: `(${part}) 判断`,
      existing: { conclusion: CONCLUSION, body: workedBody(3) },
    })
    return { ...req('walkthrough.detailed', system, user), maxTokens: sectionBudget(system, user) }
  })
}

/** 完整讲解：补充题目分析。 */
function walkthroughAnalysis(): RecordedRequest[] {
  const system = prompts.subjectProfile.withSubject(wt.buildAnalysisSystemPrompt(), LA)
  const user = wt.buildAnalysisUserPrompt({
    label: Q1.label,
    question: Q1.prompt,
    sourceText: HOMEWORK_PAGE,
    conclusion: CONCLUSION,
    language: 'zh_terms',
  })
  return [{ ...req('walkthrough.analysis', system, user), maxTokens: sectionBudget(system, user) }]
}

/** 完整讲解：与教授答案对照。 */
function walkthroughCompare(): RecordedRequest[] {
  const system = prompts.subjectProfile.withSubject(
    prompts.walkthroughCompare.buildSystemPrompt(),
    LA,
  )
  const user = prompts.walkthroughCompare.buildUserPrompt({
    label: Q1.label,
    question: Q1.prompt,
    parts: [],
    professorAnswer: PROFESSOR_ANSWER,
    conclusion: CONCLUSION,
    body: workedBody(4),
    language: 'zh_terms',
  })
  return [{ ...req('walkthrough.compare', system, user), maxTokens: sectionBudget(system, user) }]
}

/** 导入讲解：一份约 3 900 字的部分。 */
function walkthroughImport(): RecordedRequest[] {
  const system = prompts.subjectProfile.withSubject(
    prompts.walkthroughImport.buildSystemPrompt({ checkIssues: true, linearSystems: true }),
    LA,
  )
  const text = workedBody(7)
  const user = prompts.walkthroughImport.buildUserPrompt({
    language: 'zh_terms',
    questions: HOMEWORK_QUESTIONS.map((q, i) => ({
      id: `q${i + 1}`,
      label: q.label,
      prompt: clip(q.prompt.replace(/\s+/g, ' '), 400),
    })),
    sourceText: text,
  })
  return [
    req(
      'walkthrough.import',
      system,
      user,
      Math.min(CONFIG_MAX_TOKENS, Math.max(2048, Math.ceil(text.length * 1.3) + 1500)),
    ),
  ]
}

/** 查看原题：中文翻译。 */
function questionTranslate(): RecordedRequest[] {
  const user = prompts.questionTranslate.buildUserPrompt({ question: Q2.prompt })
  return [
    req(
      'question.translate',
      prompts.questionTranslate.buildSystemPrompt(),
      user,
      Math.max(2048, Math.ceil(Q2.prompt.length * 1.3) + 500),
    ),
  ]
}

const HOMEWORK_UNGROUNDED = Q3.prompt

/** 作业：提示 + 解法（一题有出处、一题无出处）。 */
function homeworkHints(): RecordedRequest[] {
  return [
    { question: Q1.prompt, source: HOMEWORK_PAGE },
    { question: HOMEWORK_UNGROUNDED, source: HOMEWORK_UNGROUNDED },
  ].map(({ question, source }) => {
    const system = prompts.subjectProfile.withSubject(
      prompts.homeworkQuestion.buildSystemPrompt('combined', false, false),
      LA,
    )
    const user = prompts.homeworkQuestion.buildUserPrompt({
      question,
      sourceText: promptSourceText(question, source),
      language: 'zh',
    })
    return req(
      'homework.hints',
      system,
      user,
      planQuestionOutputBudget(system.length + user.length, CONFIG_MAX_TOKENS),
    )
  })
}

/** 作业：复习讲解（无出处的题）。 */
function homeworkReview(): RecordedRequest[] {
  const system = prompts.subjectProfile.withSubject(prompts.homeworkReview.buildSystemPrompt(), LA)
  const user = prompts.homeworkReview.buildUserPrompt({
    question: HOMEWORK_UNGROUNDED,
    sourceText: promptSourceText(HOMEWORK_UNGROUNDED, HOMEWORK_UNGROUNDED),
    previousSolution: PREVIOUS_SOLUTION,
    language: 'zh',
  })
  return [
    req(
      'homework.review',
      system,
      user,
      planQuestionOutputBudget(system.length + user.length, CONFIG_MAX_TOKENS),
    ),
  ]
}

/** 作业：检查答案（无出处的题）。 */
function homeworkCheck(): RecordedRequest[] {
  const system = prompts.subjectProfile.withSubject(
    prompts.homeworkAnswerCheck.buildSystemPrompt(),
    LA,
  )
  const user = prompts.homeworkAnswerCheck.buildUserPrompt({
    question: HOMEWORK_UNGROUNDED,
    studentAnswer: STUDENT_ANSWER,
    referenceAnswer: PREVIOUS_SOLUTION,
    referenceKind: 'ai_solution',
    sourceText: promptSourceText(HOMEWORK_UNGROUNDED, HOMEWORK_UNGROUNDED),
    language: 'zh',
  })
  return [
    req(
      'homework.check',
      system,
      user,
      planQuestionOutputBudget(system.length + user.length, CONFIG_MAX_TOKENS),
    ),
  ]
}

/** 作业：逐题问答，连续 3 轮（无出处的题）。 */
function homeworkQa(): RecordedRequest[] {
  const system = prompts.subjectProfile.withSubject(prompts.homeworkQa.buildSystemPrompt(), LA)
  return [0, 2, 4].map((turns) =>
    req(
      'homework.qa',
      system,
      prompts.homeworkQa.buildUserPrompt({
        question: HOMEWORK_UNGROUNDED,
        sourceText: promptSourceText(HOMEWORK_UNGROUNDED, HOMEWORK_UNGROUNDED, {
          keepBlock: true,
        }),
        history: QA_HISTORY.slice(0, turns),
        message: '如果 h = 2，k 取什么值时方程组无解？',
        language: 'zh',
      }),
    ),
  )
}

/** 划词提问（完整讲解），带 6 轮历史。 */
function contextualTutor(): RecordedRequest[] {
  const system = prompts.subjectProfile.withSubject(
    prompts.contextualTutor.buildSystemPrompt('walkthrough'),
    LA,
  )
  return [0, 3, 6].map((turns) =>
    req(
      'contextual.ask',
      system,
      prompts.contextualTutor.buildUserPrompt({
        sectionHeading: Q1.label,
        selectedText: '$R_2 \\to R_2 - 2R_1$',
        surroundingContext: `${Q1.prompt}\n\n${CONCLUSION}\n\n${workedBody(6).slice(0, 6000)}`,
        question: '这一步为什么这样做？',
        language: 'zh',
        contextKind: 'walkthrough',
        history: ASK_HISTORY.slice(0, turns),
      }),
    ),
  )
}

/** 引导练习：把讲解转成带空格的步骤。 */
function guidedSteps(): RecordedRequest[] {
  return [
    req(
      'guided.steps',
      prompts.subjectProfile.withSubject(prompts.guidedSteps.buildSystemPrompt(), LA),
      prompts.guidedSteps.buildUserPrompt({
        question: Q3.prompt,
        walkthrough: `${CONCLUSION}\n\n${workedBody(5)}`,
        kinds: ['expression', 'number', 'text'],
      }),
      Math.min(8_192, Math.max(4_096, CONFIG_MAX_TOKENS)),
    ),
  ]
}

/** 做练习题：出题（4 个位置一批）+ 审核。 */
function practiceSet(): RecordedRequest[] {
  const habits =
    '- [structure] 每道大题 3–4 个小题，由易到难\n- [numbers] 系数为小整数，不出现分数\n- [notation] 用增广矩阵表示方程组'
  const keyPoints = sectionKeyPoints({ body: workedBody(4) })
  const slots = HOMEWORK_QUESTIONS.map((q, i) => ({
    id: `s${i + 1}`,
    mode: 'full' as const,
    original: clip(q.prompt, 2500),
    partLabels: i === 1 ? ['a', 'b', 'c', 'd'] : [],
    knowledgePoints: ['行化简', '解集'],
  }))
  const generateSystem = prompts.subjectProfile.withSubject(
    prompts.practiceGenerate.buildSystemPrompt(),
    LA,
  )
  return [
    req(
      'practice.generate',
      generateSystem,
      prompts.practiceGenerate.buildUserPrompt({
        language: 'zh',
        keyPoints,
        slots: slots.slice(0, 2),
        professorHabits: habits,
      }),
      Math.min(8192, 600 + 1100 * 2),
    ),
    req(
      'practice.generate',
      generateSystem,
      prompts.practiceGenerate.buildUserPrompt({
        language: 'zh',
        keyPoints,
        slots: slots.slice(2),
        professorHabits: habits,
      }),
      Math.min(8192, 600 + 1100 * 1),
    ),
    req(
      'practice.review',
      prompts.subjectProfile.withSubject(prompts.practiceReview.buildSystemPrompt(), LA),
      prompts.practiceReview.buildUserPrompt({
        originals: HOMEWORK_QUESTIONS.map((q) => clip(q.prompt, 600)).join('\n\n'),
        keyPoints,
        questions: slots.map((slot) => ({
          id: `p${slot.id}`,
          mode: 'full',
          text: slot.original,
          answers: CONCLUSION,
        })),
      }),
      Math.min(4096, 300 + 80 * 3),
    ),
  ]
}

/** 教授出题习惯：分析一批题目。 */
function questionStyle(): RecordedRequest[] {
  return [
    req(
      'question.style',
      prompts.subjectProfile.withSubject(prompts.questionStyle.buildSystemPrompt(), LA),
      prompts.questionStyle.buildUserPrompt({
        language: 'zh',
        current: [
          { id: 'h1', category: 'structure', statement: '大题含 3–4 个小题', locked: false },
        ],
        units: HOMEWORK_QUESTIONS.map((q, i) => ({
          label: `U${i + 1}`,
          kind: 'homework' as const,
          documentName: 'hw4.pdf',
          position: q.label,
          text: clip(q.prompt, 600),
        })),
      }),
      Math.max(CONFIG_MAX_TOKENS, 3000),
    ),
  ]
}

const bioSnippets = (from: number, count: number) =>
  bioPassages
    .slice(from, from + count)
    .map((text, i) => chunkSnippet(from + i, text, 'Campbell Biology.pdf'))

/** 口试练习：两个考点（逐个请求）。 */
function oralExam(): RecordedRequest[] {
  const system = prompts.subjectProfile.withSubject(prompts.oralExam.buildSystemPrompt(), BIO)
  const habits = '- [wording] 口试先问定义，再追问机制\n- [structure] 追问常涉及临床联系'
  return ['Cellular respiration', 'Membrane transport'].map((topic, i) =>
    req(
      'oral.exam',
      system,
      prompts.oralExam.buildUserPrompt({
        topic,
        courseTopics: [topic],
        knowledgePoints: ['ATP yield', 'electron transport chain', 'chemiosmosis'],
        sourceSnippets: bioSnippets(i * 6, 6),
        language: 'zh_terms',
        professorHabits: habits,
      }),
      Math.min(8192, Math.max(CONFIG_MAX_TOKENS, 3500)),
    ),
  )
}

/** 课程分析：两份 4 万字的部分。 */
function courseAnalysis(): RecordedRequest[] {
  const system = prompts.subjectProfile.withSubject(
    prompts.documentAnalyzer.buildSystemPrompt(),
    LA,
  )
  const text = (from: number) =>
    laPassages
      .concat(laPassages)
      .slice(from, from + 52)
      .map(
        (p, i) =>
          `[c:0f8e${String(from + i).padStart(4, '0')}-6a1b-4c2d-9e3f-a1b2c3d4e5f6 · Ch 1 · 1.${(i % 5) + 1} · p${from + i}] ${p}`,
      )
      .join('\n')
  return [0, 52].map((from, index) =>
    req(
      'analysis.segment',
      system,
      prompts.documentAnalyzer.buildUserPrompt({
        documentName: 'Lay - Linear Algebra.pdf',
        documentText: text(from % 40),
        language: 'en',
        part: { index, total: 2, label: `Chapter ${index + 1}` },
      }),
      Math.max(CONFIG_MAX_TOKENS, 8192),
    ),
  )
}

/** 导师课时：一节（8 段教材 + 4 段笔记）。 */
function tutorLesson(): RecordedRequest[] {
  return [
    req(
      'tutor.lesson',
      prompts.subjectProfile.withSubject(prompts.tutorLesson.buildSystemPrompt(), BIO, {
        forLesson: true,
      }),
      prompts.tutorLesson.buildUserPrompt({
        topicName: 'Cellular respiration',
        topicDescription: 'Glycolysis, the citric acid cycle and oxidative phosphorylation.',
        language: 'zh',
        sourceSnippets: bioSnippets(0, 8),
        notesSnippets: bioSnippets(10, 4),
        chapterLabel: 'Chapter 9',
      }),
    ),
  ]
}

const tutorSnippets = () => bioPassages.slice(0, 6)

/** 交互导师：开场 + 3 道题，每题一次判分。 */
function interactiveTutor(): RecordedRequest[] {
  const out: RecordedRequest[] = [
    req(
      'tutor.introduce',
      prompts.subjectProfile.withSubject(prompts.tutorIntroduce.buildSystemPrompt(), BIO),
      prompts.tutorIntroduce.buildUserPrompt({
        topicName: 'Cellular respiration',
        topicDescription: 'Glycolysis, the citric acid cycle and oxidative phosphorylation.',
        context: 'Project 3c1d2e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f.',
        sourceSnippets: tutorSnippets(),
        language: 'zh',
      }),
    ),
  ]
  const asked: string[] = []
  for (let i = 0; i < 3; i++) {
    out.push(
      req(
        'tutor.question',
        prompts.subjectProfile.withSubject(prompts.tutorQuestion.buildSystemPrompt(), BIO),
        prompts.tutorQuestion.buildUserPrompt({
          topicName: 'Cellular respiration',
          topicDescription: 'Glycolysis, the citric acid cycle and oxidative phosphorylation.',
          difficulty: (['basic', 'basic', 'intermediate'] as const)[i]!,
          language: 'zh',
          ...(asked.length ? { avoidRepeating: asked.slice(-3) } : {}),
          sourceSnippets: tutorSnippets(),
          ...(i > 0 ? { recentContext: 'Student answered the previous question correctly.' } : {}),
        }),
      ),
    )
    const question = `第 ${i + 1} 题：糖酵解在细胞的哪个部位进行？净产生多少 ATP？`
    asked.push(question)
    out.push(
      req(
        'tutor.evaluate',
        prompts.subjectProfile.withSubject(prompts.tutorEvaluate.buildSystemPrompt(), BIO),
        prompts.tutorEvaluate.buildUserPrompt({
          topicName: 'Cellular respiration',
          question,
          expectedAnswer: '细胞质基质；净产生 2 ATP。',
          studentAnswer: '在细胞质中，产生 2 个 ATP',
          language: 'zh',
          sourceSnippets: tutorSnippets(),
          sourceRefs: [],
        }),
      ),
    )
  }
  return out
}

/** 错题分析。 */
function mistakeAnalysis(): RecordedRequest[] {
  return [
    req(
      'mistake.analysis',
      prompts.subjectProfile.withSubject(prompts.mistakeAnalyzer.buildSystemPrompt(), BIO),
      prompts.mistakeAnalyzer.buildUserPrompt({
        question: '下列关于糖酵解的叙述，正确的是？',
        studentAnswer: '在线粒体中进行',
        correctAnswer: '在细胞质基质中进行，净产生 2 ATP',
        solution: '糖酵解在细胞质基质中把一分子葡萄糖分解为两分子丙酮酸，净生成 2 ATP 与 2 NADH。',
        knowledgePoint: 'glycolysis',
        difficulty: 'basic',
        language: 'zh',
        sourceSnippets: bioPassages.slice(0, 4),
        recentMistakes: ['柠檬酸循环的场所 / 细胞质 / 线粒体基质'],
      }),
    ),
  ]
}

/** 简答题按得分点判分 + 填空 AI 核对。 */
function answerChecks(): RecordedRequest[] {
  return [
    req(
      'check.shortAnswer',
      prompts.subjectProfile.withSubject(prompts.shortAnswerCheck.buildSystemPrompt(), BIO),
      prompts.shortAnswerCheck.buildUserPrompt({
        question: '简述化学渗透（chemiosmosis）如何驱动 ATP 合成。',
        points: [
          { id: 'p1', text: '电子传递链把 H+ 泵到膜间隙' },
          { id: 'p2', text: '形成跨内膜的质子梯度' },
          { id: 'p3', text: 'H+ 经 ATP 合酶回流' },
          { id: 'p4', text: '回流的能量用于合成 ATP' },
        ],
        referenceAnswer:
          '电子传递链把质子泵入膜间隙，形成质子梯度；质子经 ATP 合酶顺梯度回流，驱动 ADP 磷酸化为 ATP。',
        studentAnswer: '质子被泵出去，然后通过 ATP 合酶流回来，产生 ATP。',
        language: 'zh',
      }),
    ),
    req(
      'check.fillBlank',
      prompts.fillBlankCheck.buildSystemPrompt(),
      prompts.fillBlankCheck.buildUserPrompt({
        question: '糖酵解的终产物是 ____。',
        blanks: [{ index: 0, accepted: ['丙酮酸', 'pyruvate'], answer: '丙酮酸盐' }],
      }),
      256,
    ),
    req(
      'check.rubric',
      prompts.rubricExtractor.buildSystemPrompt(),
      prompts.rubricExtractor.buildUserPrompt({
        question: '简述化学渗透如何驱动 ATP 合成。',
        referenceAnswer:
          '电子传递链把质子泵入膜间隙，形成质子梯度；质子经 ATP 合酶顺梯度回流，驱动 ADP 磷酸化为 ATP。',
        language: 'zh',
      }),
    ),
  ]
}

/** 课程词汇：一批 40 个词补释义。 */
function vocabGloss(): RecordedRequest[] {
  return [
    req(
      'vocab.gloss',
      prompts.vocabGloss.buildSystemPrompt({}),
      prompts.vocabGloss.buildUserPrompt({ subject: 'biology', terms: VOCAB_TERMS }),
      2048,
    ),
  ]
}

export const PROMPT_SCENARIOS: Array<{ action: string; run: () => RecordedRequest[] }> = [
  { action: '完整讲解 · 整题 ×2（含教授答案）', run: walkthroughWhole },
  { action: '完整讲解 · 分小题（4 小题）', run: walkthroughSplit },
  { action: '完整讲解 · 开头 + 小结', run: walkthroughFrame },
  { action: '完整讲解 · 详细版（4 小题）', run: walkthroughDetailed },
  { action: '完整讲解 · 补充题目分析', run: walkthroughAnalysis },
  { action: '完整讲解 · 与教授答案对照', run: walkthroughCompare },
  { action: '导入讲解 · 一部分', run: walkthroughImport },
  { action: '查看原题 · 中文翻译', run: questionTranslate },
  { action: '作业 · 提示与解法 ×2', run: homeworkHints },
  { action: '作业 · 复习讲解', run: homeworkReview },
  { action: '作业 · 检查答案', run: homeworkCheck },
  { action: '作业 · 逐题问答 3 轮', run: homeworkQa },
  { action: '划词提问 3 轮（含历史）', run: contextualTutor },
  { action: '引导练习 · 步骤', run: guidedSteps },
  { action: '做练习题 · 出题 2 批 + 审核', run: practiceSet },
  { action: '教授出题习惯 · 一批', run: questionStyle },
  { action: '口试练习 · 2 个考点', run: oralExam },
  { action: '课程分析 · 2 个部分', run: courseAnalysis },
  { action: '导师课时', run: tutorLesson },
  { action: '交互导师 · 开场 + 3 题 + 3 次判分', run: interactiveTutor },
  { action: '错题分析', run: mistakeAnalysis },
  { action: '简答判分 + 填空核对 + 得分点提取', run: answerChecks },
  { action: '课程词汇释义 · 40 词', run: vocabGloss },
]
