/**
 * Figure groups on a past paper (local, pure): several questions — typically
 * multiple choice — that all refer to ONE figure, graph or table ("Use the
 * graph below to answer questions 3–5"; "Refer to Figure 2" on three
 * consecutive questions). Economics papers do this for supply-and-demand
 * graphs; the AI mock paper keeps such groups together (one topic, one shared
 * figure when a figure engine can draw it).
 *
 * Detection only reads what the paper says:
 *   1. a lead-in naming a range of questions together with a figure word;
 *   2. consecutive questions naming the same figure label (Figure 2, Graph A, 图 3);
 *   3. with the professor's habit "several questions share one figure"
 *      (`loose`), consecutive multiple-choice questions that each speak of a
 *      figure / graph / diagram.
 * Groups never overlap and have 2–6 members.
 */

export interface FigureGroupQuestion {
  /** Printed number (`3`), when known. */
  label: string
  prompt: string
  multipleChoice: boolean
}

const MIN_GROUP = 2
const MAX_GROUP = 6

const FIGURE_WORD = /\b(?:graphs?|figures?|fig\.|diagrams?|charts?|exhibits?|tables?)\b|图|表/i

/** "questions 3–5", "Questions 3 to 5", "第 3–5 题", "3-5 题". */
const RANGE =
  /questions?\s*(\d{1,3})\s*(?:-|–|—|to|through|and|&)\s*(\d{1,3})|第?\s*(\d{1,3})\s*(?:-|–|—|~|～|至|到)\s*(\d{1,3})\s*(?:题|小题)/gi

/** A named figure: "Figure 2", "Fig. 3a", "Graph A", "Diagram 1", "图 3", "图3-1". */
const FIGURE_LABEL =
  /\b([Ff]igure|FIGURE|[Ff]ig\.|[Gg]raph|GRAPH|[Dd]iagram|[Cc]hart|[Ee]xhibit)\s*([A-Z]|\d+(?:\.\d+)?[a-z]?)\b|图\s*(\d+(?:[-.]\d+)?)/

function numberOf(label: string): number | null {
  const match = /\d+/.exec(label)
  return match ? Number(match[0]) : null
}

function figureLabelOf(prompt: string): string | null {
  const match = FIGURE_LABEL.exec(prompt)
  if (!match) return null
  if (match[3]) return `图${match[3]}`
  const word = match[1]!.toLowerCase().replace('fig.', 'figure')
  return `${word} ${match[2]!.toLowerCase()}`
}

/** The ranges a lead-in names together with a figure word, as [first, last] question numbers. */
function leadInRanges(prompt: string): Array<[number, number]> {
  const out: Array<[number, number]> = []
  for (const sentence of prompt.split(/(?<=[.!?。！？])\s+|\n/)) {
    if (!FIGURE_WORD.test(sentence)) continue
    for (const match of sentence.matchAll(RANGE)) {
      const first = Number(match[1] ?? match[3])
      const last = Number(match[2] ?? match[4])
      if (last > first && last - first < MAX_GROUP) out.push([first, last])
    }
  }
  return out
}

/**
 * The groups of a paper, as lists of question indices (in paper order).
 * `loose`: the professor's habit says questions share figures, so
 * consecutive multiple-choice questions that each speak of a figure group too.
 */
export function detectFigureGroups(
  questions: readonly FigureGroupQuestion[],
  options: { loose?: boolean } = {},
): number[][] {
  const taken = new Set<number>()
  const groups: number[][] = []
  const add = (indices: number[]) => {
    const free = indices.filter((index) => !taken.has(index))
    if (free.length < MIN_GROUP || free.length !== indices.length) return
    const members = free.slice(0, MAX_GROUP)
    for (const index of members) taken.add(index)
    groups.push(members)
  }

  // 1. Lead-ins naming a range of questions.
  const byNumber = new Map<number, number>()
  questions.forEach((question, index) => {
    const number = numberOf(question.label)
    if (number !== null && !byNumber.has(number)) byNumber.set(number, index)
  })
  for (const question of questions) {
    for (const [first, last] of leadInRanges(question.prompt)) {
      const indices: number[] = []
      for (let number = first; number <= last; number++) {
        const index = byNumber.get(number)
        if (index === undefined) break
        indices.push(index)
      }
      if (indices.length === last - first + 1) add(indices)
    }
  }

  // 2. Consecutive questions naming the same figure.
  let run: number[] = []
  let runLabel: string | null = null
  const flush = () => {
    if (run.length >= MIN_GROUP) add(run)
    run = []
    runLabel = null
  }
  questions.forEach((question, index) => {
    const label = figureLabelOf(question.prompt)
    if (label && label === runLabel) run.push(index)
    else {
      flush()
      if (label) {
        run = [index]
        runLabel = label
      }
    }
  })
  flush()

  // 3. The professor's habit: consecutive multiple choice about "the graph".
  if (options.loose) {
    let loose: number[] = []
    const flushLoose = () => {
      if (loose.length >= MIN_GROUP) add(loose)
      loose = []
    }
    questions.forEach((question, index) => {
      if (question.multipleChoice && FIGURE_WORD.test(question.prompt) && !taken.has(index))
        loose.push(index)
      else flushLoose()
    })
    flushLoose()
  }

  return groups.sort((a, b) => a[0]! - b[0]!)
}
