/**
 * 讲解模板 (pure: no storage, no AI).
 *
 * The student copies a Markdown template of the assignment into any external
 * AI together with the homework; the AI fills it in our format, and importing
 * the result is parsed locally — no request is needed to re-typeset it.
 *
 * Parsing goes by the HTML-comment markers only (`<!-- walkthrough:… -->`),
 * never by heading text: headings are localised and may be reworded. When an
 * external AI dropped the part markers inside a question, known part headings
 * (any language) are used as a fallback; a block that has neither is left for
 * the AI import path.
 */
import { formatHomeworkQuestion } from './formatQuestion'
import type { WalkthroughLanguage } from './walkthrough'
import {
  examLanguageInstruction,
  examLanguageOf,
} from '@/infrastructure/ai/prompts/exam-language/v1'

export interface TemplateQuestion {
  id: string
  /** `1`, `2(a)`, `Problem 3`. */
  label: string
  /** The question text as stored (formatted here). */
  prompt: string
  /** A professor's answer is matched to this question (not pasted into the template). */
  hasProfessorAnswer?: boolean
}

export interface WalkthroughTemplateInput {
  title: string
  language: WalkthroughLanguage
  questions: readonly TemplateQuestion[]
  /** Ask for the 线性方程组核对 JSON block (linear algebra / row reduction). */
  linearSystems: boolean
}

type Lang = 'zh' | 'en'

const TEXT = {
  zh: {
    heading: (title: string) => `# ${title} · 完整讲解模板`,
    rulesTitle: '## 写作要求（给 AI）',
    language: {
      zh_terms:
        '用简体中文写。关键术语第一次出现时在括号里附英文，例如 主元（pivot）、简化行阶梯形（RREF）。',
      zh: '用简体中文写。',
      en: '用英文写（Write in English）。',
    },
    rules: [
      '只在每个 `<!-- walkthrough:… -->` 标记后面填写内容。**原样保留所有标记**（包括 id 和 label），不要修改、删除或新增标记；每道题只写在它自己的题目块里，不要改动题号。',
      '数学一律用 LaTeX：行内公式 `$…$`，独占一行的公式 `$$…$$`；不要用 `\\( \\)` 或 `\\[ \\]`。',
      '小题用 `### (a) …` 作小标题；不要使用 `#` 或 `##` 标题。',
      '行化简的每一步单独一行：先写「作 $R_3 \\to R_3 - 3R_1$：」（同一步的多个变换各占一个 `$…$`，用逗号分隔），下一行写完整的结果矩阵 `$$…$$`。增广矩阵写成 `\\left[\\begin{array}{ccc|c} … \\end{array}\\right]`，交换写成 $R_1 \\leftrightarrow R_2$。',
      '术语只在第一次出现时加粗；每段最多加粗两处关键结果，不要整句加粗。',
      '每个小题的末尾用 `\\boxed{…}` 写出最终答案；方框所在的公式后面不要加句号或逗号。',
      '「题目分析」简要说明题目要求什么、已知什么、用到哪些知识、答案应是什么形式（这里不解题）。「讲解」写完整的解题过程。「结论」每个小题一两行最终答案。',
    ],
    checkRule:
      '「线性方程组核对」：对每个用行化简求解的方程组，在 ```json 代码块里写一个数组，每项为 {"label":"(a)","coefficients":[["1","2"],["0","1"]],"rhs":["3","4"],"rref":[["1","0","-5"],["0","1","4"]],"solution":"none|unique|infinite"}：coefficients 只写系数矩阵（每个方程一行、每个未知数一列；向量题中每个向量是一列），rhs 写右端（每个方程一项；齐次方程组 Ax = 0，如判断线性无关，写 "homogeneous"；右端含字母时照写，网站不核对），rref 写 [系数 | 右端] 最终的简化行阶梯形（齐次时只写系数部分的），solution 写解的情况（无解 / 唯一解 / 无穷多解；齐次时唯一解即只有零解）；矩阵元素写成字符串（整数或分数）。没有方程组就写 `[]`。网站会在本地重新核对。',
    professorRule:
      '标有「有教授答案」的题，请按教授的方法讲解。教授答案不在模板里，如需参考请另外附上。',
    outputRule:
      '把整份结果放在一个 ```markdown 代码块里输出（这样标记不会被隐藏），保存为 .md 文件，再在网站的「导入讲解」中上传。',
    overview: '## 开头：需要掌握的工具',
    overviewHint: '<!-- 列出整份作业要用到的方法与工具（可留空） -->',
    question: (label: string) => `## 第 ${label} 题`,
    prompt: '#### 原题',
    professor: '> （有教授答案：请按教授的方法讲解）',
    analysis: '#### 题目分析',
    analysisHint: '<!-- 题目要求、已知条件、用到的知识、答案形式（不解题） -->',
    body: '#### 讲解',
    bodyHint: '<!-- 完整的解题过程 -->',
    conclusion: '#### 结论',
    conclusionHint: '<!-- 每个小题一两行最终答案 -->',
    check: '#### 线性方程组核对',
    summary: '## 小结',
    summaryHint: '<!-- 本次作业的题型、思路与要点 -->',
    suggestions: '#### 复习建议',
    suggestionsHint: '<!-- 每条一行，以 - 开头 -->',
    other: '## 其它内容',
    otherHint: '<!-- 不属于任何题目的内容（可留空） -->',
  },
  en: {
    heading: (title: string) => `# ${title} · walkthrough template`,
    rulesTitle: '## Instructions (for the AI)',
    language: {
      zh_terms: 'Write in English.',
      zh: 'Write in English.',
      en: 'Write in English.',
    },
    rules: [
      'Fill in content only after each `<!-- walkthrough:… -->` marker. **Keep every marker exactly as it is** (including id and label): do not change, remove or add markers; write each question only inside its own block and do not renumber questions.',
      'All mathematics in LaTeX: inline `$…$`, display `$$…$$` on lines of their own; do not use `\\( \\)` or `\\[ \\]`.',
      'Use `### (a) …` sub-headings for parts; no `#` or `##` headings.',
      'Write every row-reduction step on its own line: first "Apply $R_3 \\to R_3 - 3R_1$:" (several operations of one step in separate `$…$`, separated by commas), then on the next line the complete resulting matrix as `$$…$$`. Write an augmented matrix as `\\left[\\begin{array}{ccc|c} … \\end{array}\\right]` and a swap as $R_1 \\leftrightarrow R_2$.',
      'Bold a technical term only where it first appears; bold at most two key results per paragraph; never bold a whole sentence.',
      'End every part with its final answer in `\\boxed{…}`; no full stop or comma after a formula that ends with the box.',
      '"Analysis": briefly what is asked, what is given, the knowledge used and the form of the answer (do not solve here). "Walkthrough": the complete worked solution. "Conclusion": one or two lines of final answer per part.',
    ],
    checkRule:
      '"Linear system check": for every system solved by row reduction, write an array in a ```json code block, each item {"label":"(a)","coefficients":[["1","2"],["0","1"]],"rhs":["3","4"],"rref":[["1","0","-5"],["0","1","4"]],"solution":"none|unique|infinite"}: "coefficients" is the coefficient matrix only (one row per equation, one column per unknown; in a question about vectors each vector is a column), "rhs" the right-hand side (one entry per equation; "homogeneous" for A x = 0, e.g. a linear independence test; a symbolic right-hand side is written as is and not checked), "rref" the final reduced row echelon form of [coefficients | rhs] (of the coefficients alone when homogeneous), "solution" the kind of solution (for a homogeneous system "unique" means only the trivial solution); matrix entries as strings (integers or fractions). Write `[]` when there is none. The site re-checks it locally.',
    professorRule:
      'For questions marked "professor answer available", follow the professor’s method. The professor’s answer is not in this template; attach it separately if you want it used.',
    outputRule:
      'Output the whole result inside one ```markdown code block (so the markers are not hidden), save it as a .md file and upload it in the site’s "Import walkthrough".',
    overview: '## Opening: tools you need',
    overviewHint: '<!-- Methods and tools used across the assignment (may be left empty) -->',
    question: (label: string) => `## Question ${label}`,
    prompt: '#### Question',
    professor: '> (professor answer available: follow the professor’s method)',
    analysis: '#### Analysis',
    analysisHint:
      '<!-- What is asked, what is given, knowledge used, form of the answer (no solving) -->',
    body: '#### Walkthrough',
    bodyHint: '<!-- The complete worked solution -->',
    conclusion: '#### Conclusion',
    conclusionHint: '<!-- One or two lines of final answer per part -->',
    check: '#### Linear system check',
    summary: '## Summary',
    summaryHint: '<!-- Question types, ideas and key points of this assignment -->',
    suggestions: '#### Review suggestions',
    suggestionsHint: '<!-- One per line, starting with - -->',
    other: '## Other content',
    otherHint: '<!-- Content that belongs to no question (may be left empty) -->',
  },
} as const

const marker = (name: string, attrs = ''): string => `<!-- walkthrough:${name}${attrs} -->`

/** Attribute values never contain a quote or a closing comment. */
const attr = (value: string): string => value.replace(/["<>]/g, '').replace(/--/g, '-')

/** The Markdown template of one assignment, in the walkthrough language. */
export function buildWalkthroughTemplate(input: WalkthroughTemplateInput): string {
  const exam = examLanguageOf(input.language)
  const lang: Lang = input.language === 'en' || exam ? 'en' : 'zh'
  const text = TEXT[lang]
  const rules = [
    exam
      ? `Write in ${examLanguageInstruction(exam)}.`
      : text.language[input.language as 'zh_terms' | 'zh' | 'en'],
    ...text.rules,
    ...(input.linearSystems ? [text.checkRule] : []),
    ...(input.questions.some((question) => question.hasProfessorAnswer)
      ? [text.professorRule]
      : []),
    text.outputRule,
  ]
  const lines: string[] = [
    text.heading(input.title.trim() || 'Homework'),
    '',
    text.rulesTitle,
    '',
    ...rules.map((rule, index) => `${index + 1}. ${rule}`),
    '',
    marker('overview'),
    text.overview,
    text.overviewHint,
    '',
  ]
  for (const question of input.questions) {
    const quoted = formatHomeworkQuestion(question.prompt)
      .trim()
      .split('\n')
      .map((line) => (line.trim() ? `> ${line}` : '>'))
    lines.push(
      marker('question', ` id="${attr(question.id)}" label="${attr(question.label)}"`),
      text.question(question.label),
      '',
      marker('prompt'),
      text.prompt,
      ...quoted,
      ...(question.hasProfessorAnswer ? ['>', text.professor] : []),
      '',
      marker('analysis'),
      text.analysis,
      text.analysisHint,
      '',
      marker('body'),
      text.body,
      text.bodyHint,
      '',
      marker('conclusion'),
      text.conclusion,
      text.conclusionHint,
      '',
      ...(input.linearSystems ? [marker('check'), text.check, '```json', '[]', '```', ''] : []),
    )
  }
  lines.push(
    marker('summary'),
    text.summary,
    text.summaryHint,
    '',
    marker('suggestions'),
    text.suggestions,
    text.suggestionsHint,
    '',
    marker('other'),
    text.other,
    text.otherHint,
    '',
    marker('end'),
    '',
  )
  return lines.join('\n')
}

/** A file name for the downloaded template. */
export function templateFileName(title: string, language: WalkthroughLanguage): string {
  const base = (title.trim() || 'homework').replace(/[\\/:*?"<>|\s]+/g, '-').slice(0, 60)
  return `${base}-${language === 'en' ? 'walkthrough-template' : '讲解模板'}.md`
}

// --- Parsing ----------------------------------------------------------------

const TOP_MARKERS = ['overview', 'question', 'summary', 'other', 'end'] as const
const PART_MARKERS = ['prompt', 'analysis', 'body', 'conclusion', 'check', 'suggestions'] as const
type TopMarker = (typeof TOP_MARKERS)[number]
type PartMarker = (typeof PART_MARKERS)[number]

const MARKER =
  /<!--\s*walkthrough\s*:\s*(overview|question|summary|other|end|prompt|analysis|body|conclusion|check|suggestions)\b([^>]*?)-->/gi

/** Whether a text is (or contains) a filled-in walkthrough template. */
export function hasTemplateMarkers(text: string): boolean {
  return /<!--\s*walkthrough\s*:\s*question\b/i.test(text)
}

/** Why one question block of a template could not be read locally. */
export type TemplateProblemReason =
  /** The block has no walkthrough written. */
  | 'empty'
  /** Neither part markers nor recognisable part headings. */
  | 'unstructured'
  /** A question marker without an id. */
  | 'no-id'
  /** The id is not a question of this assignment (content dropped). */
  | 'unknown-id'
  /** The 线性方程组核对 block could not be read (imported without the check). */
  | 'invalid-check'

export interface TemplateProblem {
  questionId?: string
  label?: string
  reason: TemplateProblemReason
}

/** One parsed question, in the shape of an import reply. */
export interface TemplateQuestionReply {
  questionId: string
  analysis: string
  body: string
  conclusion: string
  linearSystems: unknown[]
}

export interface TemplateParseResult {
  /** Raw reply in the import's shape (read further by `normalizeImport`). */
  reply: {
    overview: string
    questions: TemplateQuestionReply[]
    summary: string
    suggestions: string[]
    other: string
  }
  problems: TemplateProblem[]
  unknownIds: string[]
  /**
   * The question blocks the parser could not use but an AI could (no id,
   * unstructured), as written — the only text 「用 AI 整理剩下的」 sends.
   */
  rest: string[]
}

/**
 * Undo the usual ways an external AI wraps its output: everything before the
 * first marker is ignored anyway; a whole-output code fence leaves a dangling
 * closing fence (or a restarted ```markdown line) after it.
 */
function unwrapFences(text: string): string {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const first = lines.findIndex((line) => new RegExp(MARKER.source, 'i').test(line))
  if (first < 0) return ''
  const kept = lines.filter(
    (line, index) =>
      index < first ||
      !(/^\s*`{3,}\s*(?:markdown|md)\s*$/i.test(line) || /^\s*`{4,}\s*$/.test(line)),
  )
  const fences = kept
    .map((line, index) => ({ line, index }))
    .filter(({ line, index }) => index > first && /^\s*```/.test(line))
  if (fences.length % 2 === 1) {
    const last = [...fences].reverse().find(({ line }) => /^\s*```\s*$/.test(line))
    // The wrapper's closing fence ends the walkthrough: chatter after it is dropped.
    if (last) kept.splice(last.index, last === fences[fences.length - 1] ? Infinity : 1)
  }
  return kept.slice(first).join('\n')
}

/** `\[…\]` → `$$…$$` and `\(…\)` → `$…$` (outside code; never `\\[2pt]`). */
export function normalizeMathDelimiters(text: string): string {
  return text
    .split(/(```[\s\S]*?```|`[^`\n]*`)/)
    .map((piece, index) =>
      index % 2 === 1
        ? piece
        : piece
            .replace(
              /(?<!\\)\\\[([\s\S]*?)(?<!\\)\\\]/g,
              (_m, body: string) => `$$${body.trim()}$$`,
            )
            .replace(/(?<!\\)\\\(([\s\S]*?)(?<!\\)\\\)/g, (_m, body: string) => `$${body.trim()}$`),
    )
    .join('')
}

/** Remove placeholder comments (any `<!-- … -->` that is not a marker). */
function stripComments(text: string): string {
  return text.replace(/<!--(?!\s*walkthrough\s*:)[\s\S]*?-->/gi, '')
}

const PART_LABELS: Record<string, PartMarker | 'frame'> = {}
for (const [part, labels] of Object.entries({
  prompt: ['原题', '题目', '题面', 'question', 'problem', 'original question'],
  analysis: ['题目分析', '分析', 'analysis', 'question analysis', 'problem analysis'],
  body: [
    '讲解',
    '解答',
    '解题过程',
    '解析',
    '详解',
    'walkthrough',
    'solution',
    'explanation',
    'worked solution',
  ],
  conclusion: ['结论', '答案', '最终答案', 'conclusion', 'answer', 'final answer', 'answers'],
  check: ['线性方程组核对', '核对', '方程组核对', 'linear system check', 'linear systems', 'check'],
  suggestions: ['复习建议', '建议', 'suggestions', 'review suggestions', 'review advice'],
  frame: [
    '开头',
    '需要掌握的工具',
    '小结',
    '总结',
    '其它内容',
    '其他内容',
    'opening',
    'overview',
    'tools you need',
    'summary',
    'other',
    'other content',
  ],
})) {
  for (const label of labels) PART_LABELS[label] = part as PartMarker | 'frame'
}

const HEADING = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/

/** The part a heading names, ignoring numbering and trailing punctuation. */
function headingPart(line: string): { level: number; part?: PartMarker | 'frame' } | null {
  const match = HEADING.exec(line)
  if (!match) return null
  const label = match[2]!
    .replace(/\*+/g, '')
    .trim()
    .toLowerCase()
    .replace(/[：:。.]\s*$/, '')
  const head = label.split(/[：:（(]/)[0]!.trim()
  return { level: match[1]!.length, part: PART_LABELS[label] ?? PART_LABELS[head] }
}

/**
 * Drop the localised heading our template put right after a marker (or the
 * external AI's own wording of it). In a body or a frame a `### (a) …`
 * heading is content and stays; in a short part (analysis, conclusion…) any
 * leading heading is only its label.
 */
function dropLeadingHeading(text: string, anyHeading = false): string {
  const lines = text.split('\n')
  const first = lines.findIndex((line) => line.trim() !== '')
  if (first < 0) return ''
  const heading = headingPart(lines[first]!)
  if (heading && (anyHeading || heading.level !== 3 || heading.part)) lines.splice(first, 1)
  return lines.join('\n').trim()
}

/** Clean one part's text: placeholders gone, maths delimiters ours. */
function cleanPart(text: string, anyHeading = false): string {
  return normalizeMathDelimiters(dropLeadingHeading(stripComments(text), anyHeading))
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function readAttrs(raw: string): { id?: string; label?: string } {
  const value = (name: string): string | undefined => {
    const match = new RegExp(
      `${name}\\s*=\\s*(?:["'“”‘’]([^"'“”‘’]*)["'“”‘’]|([^\\s"'“”‘’]+))`,
      'i',
    ).exec(raw)
    const found = (match?.[1] ?? match?.[2])?.trim()
    return found ? found : undefined
  }
  const id = value('id')
  const label = value('label')
  return { ...(id ? { id } : {}), ...(label ? { label } : {}) }
}

/** Split a question block into parts by its markers, else by known headings. */
function questionParts(block: string): Partial<Record<PartMarker, string>> | null {
  const parts: Partial<Record<PartMarker, string>> = {}
  const found = [...block.matchAll(MARKER)].filter((match) =>
    (PART_MARKERS as readonly string[]).includes(match[1]!.toLowerCase()),
  )
  if (found.length > 0) {
    found.forEach((match, index) => {
      const name = match[1]!.toLowerCase() as PartMarker
      const end = index + 1 < found.length ? found[index + 1]!.index : block.length
      const text = block.slice(match.index + match[0].length, end)
      parts[name] = parts[name] ? `${parts[name]}\n\n${text}` : text
    })
    return parts
  }
  // Fallback: the markers were dropped but our part headings remain.
  const lines = stripComments(block).split('\n')
  let current: PartMarker | null = null
  let inFence = false
  for (const line of lines) {
    if (/^\s*```/.test(line)) inFence = !inFence
    const heading = inFence ? null : headingPart(line)
    if (heading?.part && heading.part !== 'frame') {
      current = heading.part
      parts[current] = parts[current] ?? ''
      continue
    }
    if (current) parts[current] = `${parts[current]}${line}\n`
  }
  return parts.body !== undefined ? parts : null
}

/** The JSON of a 线性方程组核对 part: an array, `{linearSystems:[…]}` or one object. */
function readCheck(text: string): unknown[] | null {
  const cleaned = stripComments(text)
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(cleaned)
  const source = (fenced ? fenced[1]! : dropLeadingHeading(cleaned, true)).trim()
  if (!source) return []
  try {
    const value: unknown = JSON.parse(source)
    if (Array.isArray(value)) return value
    if (value && typeof value === 'object') {
      const systems = (value as Record<string, unknown>).linearSystems
      return Array.isArray(systems) ? systems : [value]
    }
    return null
  } catch {
    return null
  }
}

function readSuggestions(text: string): string[] {
  return cleanPart(text)
    .split('\n')
    .map((line) => line.replace(/^\s*(?:[-*+•]|\d+[.)、])\s+/, '').trim())
    .filter(Boolean)
}

/**
 * Read a filled-in template. Question ids must be in `allowedIds` (anything
 * else is reported and dropped, never guessed); a block without a written
 * walkthrough or without readable parts is reported, the others are kept.
 */
export function parseTemplateImport(
  text: string,
  allowedIds: ReadonlySet<string>,
): TemplateParseResult {
  const source = unwrapFences(text)
  const tops = [...source.matchAll(MARKER)].filter((match) =>
    (TOP_MARKERS as readonly string[]).includes(match[1]!.toLowerCase()),
  )
  const reply: TemplateParseResult['reply'] = {
    overview: '',
    questions: [],
    summary: '',
    suggestions: [],
    other: '',
  }
  const problems: TemplateProblem[] = []
  const unknownIds: string[] = []
  const rest: string[] = []
  const append = (current: string, next: string): string =>
    current && next ? `${current}\n\n${next}` : current || next

  tops.forEach((match, index) => {
    const name = match[1]!.toLowerCase() as TopMarker
    const end = index + 1 < tops.length ? tops[index + 1]!.index : source.length
    const block = source.slice(match.index + match[0].length, end)
    if (name === 'end') return
    if (name === 'overview') {
      reply.overview = append(reply.overview, cleanPart(block))
      return
    }
    if (name === 'other') {
      reply.other = append(reply.other, cleanPart(block))
      return
    }
    if (name === 'summary') {
      const split = /<!--\s*walkthrough\s*:\s*suggestions\b[^>]*?-->/i.exec(block)
      reply.summary = append(reply.summary, cleanPart(split ? block.slice(0, split.index) : block))
      if (split)
        reply.suggestions.push(...readSuggestions(block.slice(split.index + split[0].length)))
      return
    }
    const { id, label } = readAttrs(match[2] ?? '')
    const raw = `${match[0]}${block}`.trim()
    if (!id) {
      problems.push({ ...(label ? { label } : {}), reason: 'no-id' })
      if (stripComments(block).trim()) rest.push(raw)
      return
    }
    if (!allowedIds.has(id)) {
      unknownIds.push(id)
      problems.push({ questionId: id, ...(label ? { label } : {}), reason: 'unknown-id' })
      return
    }
    const parts = questionParts(block)
    if (!parts) {
      problems.push({ questionId: id, ...(label ? { label } : {}), reason: 'unstructured' })
      rest.push(raw)
      return
    }
    const body = cleanPart(parts.body ?? '')
    if (!body) {
      problems.push({ questionId: id, ...(label ? { label } : {}), reason: 'empty' })
      return
    }
    let linearSystems: unknown[] = []
    if (parts.check !== undefined) {
      const systems = readCheck(parts.check)
      if (systems) linearSystems = systems
      else problems.push({ questionId: id, ...(label ? { label } : {}), reason: 'invalid-check' })
    }
    reply.questions.push({
      questionId: id,
      analysis: cleanPart(parts.analysis ?? '', true),
      body,
      conclusion: cleanPart(parts.conclusion ?? '', true),
      linearSystems,
    })
  })
  return { reply, problems, unknownIds, rest }
}
