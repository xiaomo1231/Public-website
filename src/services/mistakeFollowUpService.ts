import { isHeldOut, type EvalRoleCarrier } from '@/entities/evaluation/evalRole'
import type { AIService } from './aiService'
import type { AppDatabase } from '@/infrastructure/db/database'
import { getDb } from '@/infrastructure/db/database'
import type { ChatMessage } from '@/infrastructure/ai/types'
import { prompts } from '@/infrastructure/ai/prompts'
import { AppError, NotFoundError } from '@/infrastructure/errors/AppError'
import { MistakeRepository } from '@/entities/mistake/repository'
import type { Mistake } from '@/entities/mistake/types'
import {
  ERROR_DIMENSION_FOCUS,
  afterRetest,
  isRetestDue,
  questionHash,
  rememberVariant,
  withPracticeEvent,
  type ErrorDimension,
  type MistakeFollowUp,
  type MistakeVariant,
} from '@/entities/mistake/followUp'
import { HomeworkRepository } from '@/entities/homework/repository'
import { DocumentRepository } from '@/entities/document/repository'
import { CourseAnalysisRepository } from '@/entities/courseAnalysis/repository'
import { isReferenceOnlyMaterial } from '@/entities/document/types'
import type { SourceReference } from '@/entities/courseAnalysis/types'
import { walkthroughSubparts } from '@/entities/homework/splitQuestion'
import type { PracticeGrader, PracticePart } from '@/entities/homework/practice/types'
import {
  buildLinearSystem,
  linearSystemPart,
  linearSystemStem,
  normalizeSpec,
  type PracticeLanguage,
} from '@/entities/homework/practice/linearSystem'
import { createRng } from '@/entities/homework/practice/random'
import { checkPracticeAnswer, verifyAiPart } from '@/entities/homework/practice/verify'
import { evaluateDeterministic } from './answerEvaluationService'
import type { Question } from '@/entities/question/types'
import { judgeSigFigs, formatSigFigs } from '@/infrastructure/math/significantFigures'
import { parseNumeric } from '@/infrastructure/math/expressionEvaluator'
import type { GeneratedPracticePart } from '@/infrastructure/ai/prompts/practice-generate/v1'
import { resolveControl, type GenerationControl } from '@/shared/lib/generationControl'
import { getUILanguage, t } from '@/i18n'
import { loadProjectSubject, loadProjectSubjectContext } from './projectSubject'
import { questionText, solutionText } from './practiceSetService'
import { recordCheckedAnswer } from './practiceLearning'
import { QuestionRepository } from '@/entities/question/repository'
import { marketVariant, marketVariantSet } from '@/entities/econ/graphGenerator'
import { marketErrorDimension, type MarketGradeResult } from '@/entities/econ/graphQuestion'
import { marketFeedback } from './marketFeedback'

/**
 * 错题跟进 for one mistake: the lecture pages it relates to, 再试一次 on the same
 * question, verified variants (改编题), and spaced re-tests that always use a
 * NEW variant (1 → 3 → 7 → 14 days; a failed re-test starts again at 1 day).
 *
 * Variants reuse the practice-set machinery: a linear system is built locally
 * when the mistake came from one (exact answers), every other question is
 * written by the AI (`practice-generate`) with its answer recomputed locally
 * where a grader exists, and every variant passes the AI review
 * (`practice-review`) — once more on a rewrite, else it is not offered. A
 * variant is never the identical question (fingerprints of everything shown
 * are kept). When the last error had a kind (unit, significant figures, …),
 * the variant must exercise that same kind.
 *
 * Independent evaluation items (`evalRole: 'independent'`) never get variants
 * or re-tests. Re-test and variant answers count toward mastery like any other
 * checked answer (local checks fully, AI readings half).
 */

export interface LectureLink {
  documentId: string
  documentName: string
  page?: number
  quote?: string
}

export interface FollowUpCheck {
  verdict: 'correct' | 'partial' | 'incorrect' | 'uncertain'
  method: 'local' | 'ai'
  expectedAnswer: string
  feedback?: string
  /** The kind of error seen in this answer, when it is known. */
  dimension?: ErrorDimension
}

/** Inline 再试一次 only for question types graded locally from typed text. */
const RETRY_TYPES = new Set([
  'multiple_choice',
  'true_false',
  'numeric',
  'math_expr',
  'code_output',
  'chem_equation',
])

const SIG_FIG_REQUEST =
  /(\d{1,2})\s*(?:significant\s+figures?|sig\.?\s*figs?|s\.?\s*f\.)|(?:保留|取)\s*(\d{1,2})\s*位有效数字|(\d{1,2})\s*位有效数字/i

/** The number of significant figures a question asks for, when it says. */
export function requestedSigFigs(text: string): number | undefined {
  const match = SIG_FIG_REQUEST.exec(text)
  const value = Number(match?.[1] ?? match?.[2] ?? match?.[3])
  return Number.isInteger(value) && value >= 1 && value <= 10 ? value : undefined
}

export class MistakeFollowUpService {
  private ai: AIService | null
  private db: AppDatabase
  private mistakes: MistakeRepository

  constructor(deps: { ai: AIService | null; db?: AppDatabase }) {
    this.ai = deps.ai
    this.db = deps.db ?? getDb()
    this.mistakes = new MistakeRepository(this.db)
  }

  hasAI(): boolean {
    return this.ai !== null
  }

  /** Active mistakes whose re-test is due now. */
  async dueRetests(projectId: string, now = Date.now()): Promise<Mistake[]> {
    const rows = await this.mistakes.listByProject(projectId, { status: 'active' })
    return rows
      .filter((mistake) => isRetestDue(mistake, now))
      .sort((a, b) => (a.followUp?.dueAt ?? 0) - (b.followUp?.dueAt ?? 0))
  }

  /**
   * Course pages the mistake relates to: its question's lecture citations,
   * else the sources of its course topic. Past papers, answer keys and other
   * reference-only files are not lecture pages.
   */
  async lectureLinks(mistake: Mistake, limit = 4): Promise<LectureLink[]> {
    let refs: SourceReference[] = mistake.sourceRefs ?? []
    const documents = new Map(
      (await new DocumentRepository(this.db).listByProject(mistake.projectId)).map((doc) => [
        doc.id,
        doc,
      ]),
    )
    const lecture = (ref: SourceReference) => {
      const doc = documents.get(ref.documentId)
      return !!doc && !isReferenceOnlyMaterial(doc.materialType)
    }
    if (!refs.some(lecture) && mistake.topicId) {
      const topic = await new CourseAnalysisRepository(this.db).getTopic(mistake.topicId)
      refs = topic?.sourceRefs ?? []
    }
    const out: LectureLink[] = []
    const seen = new Set<string>()
    for (const ref of refs) {
      if (!lecture(ref)) continue
      const key = `${ref.documentId}:${ref.page ?? ''}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({
        documentId: ref.documentId,
        documentName: documents.get(ref.documentId)?.name ?? ref.documentName,
        ...(ref.page ? { page: ref.page } : {}),
        ...(ref.quote ? { quote: ref.quote } : {}),
      })
      if (out.length >= limit) break
    }
    return out
  }

  /** Whether variants and re-tests may be offered for this mistake. */
  async canFollowUp(mistake: Mistake): Promise<boolean> {
    if (mistake.status === 'archived') return false
    return !(await this.isIndependent(mistake))
  }

  /** Whether the same question can be answered again right here (local grading). */
  async retryQuestion(mistake: Mistake): Promise<Question | null> {
    if (!mistake.questionId || mistake.homeworkSetId) return null
    const question = await this.db.questions.get(mistake.questionId)
    return question && RETRY_TYPES.has(question.type) ? question : null
  }

  /** 再试一次: grade the same question locally. Never moves the re-test schedule. */
  async retry(mistakeId: string, answer: string): Promise<FollowUpCheck> {
    const mistake = await this.requireMistake(mistakeId)
    const question = await this.retryQuestion(mistake)
    if (!question) throw new AppError(t('followUp.retryUnavailable'), 'VALIDATION_ERROR')
    const evaluation = evaluateDeterministic(
      question,
      answer,
      question.type === 'numeric'
        ? { subject: await loadProjectSubject(question.projectId, this.db) }
        : {},
    )
    const verdict =
      evaluation.isCorrect === null ? 'uncertain' : evaluation.isCorrect ? 'correct' : 'incorrect'
    if (mistake.followUp)
      await this.mistakes.update(mistake.id, {
        followUp: withPracticeEvent(mistake.followUp, 'retry', verdict === 'correct', Date.now()),
      })
    return {
      verdict,
      method: 'local',
      expectedAnswer: mistake.correctAnswer,
      ...(evaluation.note ? { feedback: evaluation.note } : {}),
    }
  }

  /**
   * Make a new verified variant (改编题) for practice (`variant`) or for the
   * due re-test (`retest`). Stored as `followUp.current`.
   */
  async createVariant(
    mistakeId: string,
    purpose: MistakeVariant['purpose'],
    options: { control?: GenerationControl } = {},
  ): Promise<MistakeVariant> {
    const control = resolveControl(options.control)
    const mistake = await this.requireMistake(mistakeId)
    if (!(await this.canFollowUp(mistake)))
      throw new AppError(t('followUp.notAllowed'), 'VALIDATION_ERROR')
    if (purpose === 'retest' && !isRetestDue(mistake, Date.now()))
      throw new AppError(t('followUp.notDue'), 'VALIDATION_ERROR')
    const followUp: MistakeFollowUp = mistake.followUp ?? {
      stage: 0,
      dueAt: Date.now(),
      history: [],
      seen: [questionHash(mistake.question)],
    }
    const seen = new Set([...followUp.seen, questionHash(mistake.question)])
    // Variants are written in the language of the original question.
    const language: PracticeLanguage = /[一-鿿]/.test(mistake.question) ? 'zh' : 'en'
    const dimension = followUp.reason ?? mistake.errorDimension

    let variant: MistakeVariant | null = null
    let rejected: string | undefined
    // A graph question: a new market of the same structure, every answer
    // from the engine (no AI review needed — nothing in it is the model's).
    const graph = await this.marketLocalVariant(mistake, purpose, followUp, language)
    if (graph && !seen.has(graph.hash)) variant = graph
    const local = variant ? null : await this.localVariant(mistake, purpose, followUp, language)
    if (local && !seen.has(local.hash)) {
      const review = await this.review(mistake, local, control)
      if (review.pass) variant = local
    }
    for (let round = 0; !variant && round < 2; round += 1) {
      if (!control.shouldContinue()) break
      const written = await this.writeVariant(
        mistake,
        purpose,
        language,
        dimension,
        rejected,
        control,
      )
      if (!written.variant) {
        rejected = written.reason
        continue
      }
      if (seen.has(written.variant.hash)) {
        rejected = 'It repeats a question the student has already seen; write a different one.'
        continue
      }
      const review = await this.review(mistake, written.variant, control)
      if (review.pass) variant = written.variant
      else rejected = review.reason || 'Failed review.'
    }
    if (!variant) throw new AppError(t('followUp.variantFailed'), 'INVALID_RESPONSE')
    await this.mistakes.update(mistake.id, { followUp: rememberVariant(followUp, variant) })
    return variant
  }

  /**
   * Check an answer to the current variant. Local graders decide where they
   * can (with the significant figures the variant asks for), else the AI
   * compares with the variant's worked solution. A re-test moves the ladder
   * (passed → next stage; failed → back to 1 day, the mistake counts again);
   * a practice variant only adds to the history. Both count toward mastery.
   */
  async checkVariant(
    mistakeId: string,
    answer: string,
    options: { signal?: AbortSignal; language?: 'zh' | 'en' } = {},
  ): Promise<FollowUpCheck> {
    const mistake = await this.requireMistake(mistakeId)
    const variant = mistake.followUp?.current
    if (!mistake.followUp || !variant)
      throw new AppError(t('followUp.noVariant'), 'VALIDATION_ERROR')
    if (!answer.trim()) throw new AppError(t('homework.check.empty'), 'VALIDATION_ERROR')
    const result = await this.grade(mistake, variant, answer, options)
    const now = Date.now()
    if (result.verdict !== 'uncertain') {
      const passed = result.verdict === 'correct'
      const followUp =
        variant.purpose === 'retest'
          ? afterRetest(mistake.followUp, passed, now, result.dimension)
          : { ...withPracticeEvent(mistake.followUp, 'variant', passed, now), current: variant }
      const patch: Partial<Mistake> = { followUp }
      if (variant.purpose === 'retest') {
        if (followUp.completedAt) {
          patch.status = 'understood'
          patch.resolvedAt = now
        } else if (!passed) {
          // A failed re-test is the error happening again.
          patch.attemptCount = mistake.attemptCount + 1
          patch.lastOccurredAt = now
          if (result.dimension) patch.errorDimension = result.dimension
        }
      }
      await this.mistakes.update(mistake.id, patch)
      await recordCheckedAnswer(this.db, {
        projectId: mistake.projectId,
        questionId: `${mistake.id}:${variant.id}`,
        prompt: questionText(variant),
        solution: solutionText(variant),
        knowledgePoint: mistake.knowledgePoint,
        ...(mistake.topicId ? { topicId: mistake.topicId } : {}),
        difficulty: mistake.difficulty,
        answer,
        correctAnswer: result.expectedAnswer,
        check: { verdict: result.verdict, method: result.method },
        origin: mistake.origin ?? 'quiz',
        skipMistake: true,
      })
    }
    return result
  }

  // ---------------------------------------------------------------------------

  private async grade(
    mistake: Mistake,
    variant: MistakeVariant,
    answer: string,
    options: { signal?: AbortSignal; language?: 'zh' | 'en' },
  ): Promise<FollowUpCheck> {
    const expectedAnswer = variant.parts
      .map((part) => (part.label ? `(${part.label}) ${part.answer}` : part.answer))
      .join('; ')
    const local = checkPracticeAnswer(variant, answer)
    if (local) {
      let verdict: FollowUpCheck['verdict'] = local.verdict
      let dimension: ErrorDimension | undefined
      // Significant figures, when the variant asks for them: a right value
      // with the wrong number of figures is not a pass of this re-test.
      const required = requestedSigFigs(questionText(variant))
      if (required && variant.parts.length === 1 && verdict === 'correct') {
        const judged = judgeSigFigs(answer.trim(), required)
        if (judged.status === 'too-many' || judged.status === 'too-few') {
          verdict = 'incorrect'
          dimension = 'sig_figs'
        }
      }
      if (verdict !== 'correct' && !dimension) {
        const grader = variant.parts[0]?.grader
        if (grader?.kind === 'quantity') dimension = unitOrValue(grader, answer)
        else if (grader?.kind === 'numeric') dimension = 'value'
      }
      // Graph parts: item-by-item feedback and the kind of error.
      const graphs = (local.market ?? []).filter((item): item is MarketGradeResult => !!item)
      if (graphs.length > 0) {
        if (verdict !== 'correct' && !dimension)
          dimension = graphs.map(marketErrorDimension).find(Boolean)
        return {
          verdict,
          method: 'local',
          expectedAnswer,
          feedback:
            graphs
              .map((item) => marketFeedback(item))
              .filter(Boolean)
              .join(' ') ||
            t(verdict === 'correct' ? 'followUp.check.correct' : 'followUp.check.incorrect'),
          ...(dimension ? { dimension } : {}),
        }
      }
      return {
        verdict,
        method: 'local',
        expectedAnswer,
        feedback: t(
          verdict === 'correct'
            ? 'followUp.check.correct'
            : dimension
              ? DIMENSION_FEEDBACK[dimension]
              : verdict === 'partial'
                ? 'practiceSet.check.partial'
                : 'followUp.check.incorrect',
        ),
        ...(dimension ? { dimension } : {}),
      }
    }
    const ai = this.requireAI()
    const subject = await loadProjectSubjectContext(mistake.projectId, this.db)
    const messages: ChatMessage[] = [
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
          question: questionText(variant),
          studentAnswer: answer.trim(),
          referenceAnswer: solutionText(variant),
          referenceKind: 'ai_solution',
          sourceText: '',
          language: options.language ?? (getUILanguage() === 'zh-CN' ? 'zh' : 'en'),
        }),
      },
    ]
    const { data } = await ai.streamJSON<unknown>(messages, undefined, {
      ...(options.signal ? { signal: options.signal } : {}),
    })
    const assessed = prompts.homeworkAnswerCheck.normalizeAssessment(data)
    if (!assessed || assessed.status !== 'ready')
      return { verdict: 'uncertain', method: 'ai', expectedAnswer }
    return {
      verdict: assessed.verdict,
      method: 'ai',
      expectedAnswer,
      feedback: assessed.feedback,
    }
  }

  /**
   * An economics graph question built locally with new numbers, when the
   * mistake came from one (a quiz graph question, or a practice / mock-paper
   * question whose parts are all graph parts).
   */
  private async marketLocalVariant(
    mistake: Mistake,
    purpose: MistakeVariant['purpose'],
    followUp: MistakeFollowUp,
    language: PracticeLanguage,
  ): Promise<MistakeVariant | null> {
    if (!mistake.questionId) return null
    const rng = createRng(`${mistake.id}:${followUp.seen.length}:${followUp.history.length}:market`)
    if (mistake.homeworkSetId) {
      const question = await new HomeworkRepository(this.db).getQuestion(mistake.questionId)
      const parts = question?.practice?.parts ?? []
      if (parts.length === 0 || parts.some((part) => part.grader.kind !== 'market')) return null
      const set = marketVariantSet(
        parts.map((part) => ({
          ...(part.label ? { label: part.label } : {}),
          question: (part.grader as Extract<PracticeGrader, { kind: 'market' }>).question,
        })),
        rng,
        language,
      )
      if (!set) return null
      return makeVariant(
        purpose,
        'local',
        set.stem,
        set.parts.map((part) => ({
          ...(part.label ? { label: part.label } : {}),
          prompt: part.prompt,
          answer: part.answer,
          solution: part.solution,
          grader: { kind: 'market', question: part.question },
        })),
      )
    }
    const question = await new QuestionRepository(this.db).get(mistake.questionId)
    if (!question?.market) return null
    const built = marketVariant(question.market, rng, language)
    if (!built) return null
    return makeVariant(purpose, 'local', '', [
      {
        prompt: built.stem,
        answer: built.answer,
        solution: built.solution,
        grader: { kind: 'market', question: built.question },
      },
    ])
  }

  /** A locally built linear system, when the mistake came from one. */
  private async localVariant(
    mistake: Mistake,
    purpose: MistakeVariant['purpose'],
    followUp: MistakeFollowUp,
    language: PracticeLanguage,
  ): Promise<MistakeVariant | null> {
    if (!mistake.homeworkSetId || !mistake.questionId) return null
    const question = await new HomeworkRepository(this.db).getQuestion(mistake.questionId)
    const graders = question?.practice?.parts.map((part) => part.grader) ?? []
    if (graders.length === 0 || graders.some((grader) => grader.kind !== 'linear_system'))
      return null
    const rng = createRng(`${mistake.id}:${followUp.seen.length}:${followUp.history.length}`)
    const parts: PracticePart[] = []
    for (const [index, grader] of graders.entries()) {
      if (grader.kind !== 'linear_system') return null
      const spec = normalizeSpec({
        rows: grader.augmented.length,
        vars: (grader.augmented[0]?.length ?? 2) - 1,
        solution: grader.solution,
        free: grader.free,
      })
      const built = buildLinearSystem(spec, rng)
      if (!built) return null
      const label = question?.practice?.parts[index]?.label
      parts.push(linearSystemPart(built, { ...(label ? { label } : {}), language, asMatrix: true }))
    }
    return makeVariant(purpose, 'local', linearSystemStem(language, true), parts)
  }

  /** One AI-written variant, checked locally; `reason` says why none came back. */
  private async writeVariant(
    mistake: Mistake,
    purpose: MistakeVariant['purpose'],
    language: PracticeLanguage,
    dimension: ErrorDimension | undefined,
    rejected: string | undefined,
    control: GenerationControl,
  ): Promise<{ variant?: MistakeVariant; reason?: string }> {
    const ai = this.requireAI()
    const subject = await loadProjectSubjectContext(mistake.projectId, this.db)
    const labels = walkthroughSubparts(mistake.question).map((part) => part.label)
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: prompts.subjectProfile.withSubject(
          prompts.practiceGenerate.buildSystemPrompt(
            subject?.subject === 'economics' ? { economics: true } : {},
          ),
          subject,
        ),
      },
      {
        role: 'user',
        content: prompts.practiceGenerate.buildUserPrompt({
          language,
          keyPoints: `- ${mistake.knowledgePoint}`,
          slots: [
            {
              id: 's1',
              mode: 'full',
              original: mistake.question.slice(0, 2_500),
              partLabels: labels,
              knowledgePoints: [mistake.knowledgePoint],
              ...(rejected ? { rejected } : {}),
              ...(dimension ? { focus: ERROR_DIMENSION_FOCUS[dimension] } : {}),
            },
          ],
        }),
      },
    ]
    const { data } = await ai.streamJSON<unknown>(messages, undefined, {
      signal: control.signal,
    })
    const [written] = prompts.practiceGenerate.normalizeOutput(data, new Set(['s1']))
    if (!written) return { reason: 'No question was returned.' }
    const got = written.parts.map((part) => part.label ?? '')
    if (labels.length > 0 && (got.length !== labels.length || labels.some((l, i) => got[i] !== l)))
      return { reason: 'The sub-parts must match the original question.' }
    const parts: PracticePart[] = []
    for (const item of written.parts) {
      const raw = dimension === 'sig_figs' ? roundedToExact(item) : item
      if (!raw)
        return {
          reason:
            'The stated answer is not the computed value to the requested significant figures.',
        }
      const verified = verifyAiPart(raw, undefined, language, {
        economics: subject?.subject === 'economics',
      })
      if (!verified.ok)
        return { reason: `The stated answer did not check out (${verified.reason}).` }
      parts.push(verified.part)
    }
    const variant = makeVariant(purpose, 'ai', written.stem, parts)
    if (dimension === 'sig_figs') {
      // The variant must say how many significant figures it wants, and its
      // stored answer is written to exactly that many.
      const required = requestedSigFigs(questionText(variant))
      const part = variant.parts[0]
      if (!required || variant.parts.length !== 1 || !part || !isNumber(part.grader))
        return { reason: 'It must state the number of significant figures required.' }
      part.answer = withSigFigs(part.grader, required)
    }
    if (dimension === 'unit' && !variant.parts.some((part) => part.grader.kind === 'quantity'))
      return { reason: 'Its answer must carry a unit.' }
    return { variant }
  }

  /** The AI review of a variant (verdict only; answers never change). */
  private async review(
    mistake: Mistake,
    variant: MistakeVariant,
    control: GenerationControl,
  ): Promise<{ pass: boolean; reason: string }> {
    const ai = this.requireAI()
    const subject = await loadProjectSubjectContext(mistake.projectId, this.db)
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: prompts.subjectProfile.withSubject(
          prompts.practiceReview.buildSystemPrompt(),
          subject,
        ),
      },
      {
        role: 'user',
        content: prompts.practiceReview.buildUserPrompt({
          originals: `[1] ${mistake.question.replace(/\s+/g, ' ').slice(0, 1_200)}`,
          keyPoints: `- ${mistake.knowledgePoint}`,
          questions: [
            {
              id: 'p1',
              mode: 'full',
              mirrors: '1',
              text: questionText(variant).slice(0, 1_500),
              answers: variant.parts
                .map((part) => `${part.label ? `(${part.label}) ` : ''}${part.answer}`)
                .join('; ')
                .slice(0, 400),
            },
          ],
        }),
      },
    ]
    const { data } = await ai.streamJSON<unknown>(messages, undefined, {
      signal: control.signal,
    })
    const verdict = prompts.practiceReview
      .normalizeReview(data, new Set(['p1']))
      .find((item) => item.id === 'p1')
    return { pass: verdict?.pass === true, reason: verdict?.reason ?? '' }
  }

  private async isIndependent(mistake: Mistake): Promise<boolean> {
    if (mistake.homeworkSetId) {
      const homework = new HomeworkRepository(this.db)
      const [set, question] = await Promise.all([
        homework.getSet(mistake.homeworkSetId),
        mistake.questionId ? homework.getQuestion(mistake.questionId) : undefined,
      ])
      const paper = set ? await this.db.documents.get(set.documentId) : undefined
      return isHeldOut(set, question, paper)
    }
    if (mistake.questionId) {
      const question = await this.db.questions.get(mistake.questionId)
      return isHeldOut(question as EvalRoleCarrier | undefined)
    }
    return false
  }

  private async requireMistake(id: string): Promise<Mistake> {
    const mistake = await this.mistakes.get(id)
    if (!mistake) throw new NotFoundError('Mistake', id)
    return mistake
  }

  private requireAI(): AIService {
    if (!this.ai) throw new AppError(t('mistakes.noProvider'), 'MISSING_API_KEY')
    return this.ai
  }
}

const DIMENSION_FEEDBACK: Record<
  ErrorDimension,
  | 'followUp.check.value'
  | 'followUp.check.unit'
  | 'followUp.check.sigFigs'
  | 'followUp.check.sign'
  | 'followUp.check.incorrect'
> = {
  value: 'followUp.check.value',
  unit: 'followUp.check.unit',
  sig_figs: 'followUp.check.sigFigs',
  sign: 'followUp.check.sign',
  concept: 'followUp.check.incorrect',
}

/**
 * A sig-fig question states a rounded answer ("3.33" for 10/3). It is checked
 * against the computation rounded to the figures the question asks for; the
 * exact value then goes to the usual verification. `null` when it disagrees.
 */
function roundedToExact(part: GeneratedPracticePart): GeneratedPracticePart | null {
  const check = part.check
  if (check?.type !== 'numeric' || typeof check.expression !== 'string') return part
  const value = parseNumeric(check.expression)
  const required = requestedSigFigs(part.prompt)
  const stated = parseNumeric(/-?\d+(?:\.\d+)?(?:e-?\d+)?/i.exec(part.answer)?.[0] ?? '')
  if (value === null || !required || stated === null) return part
  const rounded = Number(formatSigFigs(value, required))
  if (Math.abs(stated - rounded) > Math.abs(rounded) * 1e-9 + 1e-12) return null
  return { ...part, answer: String(value) }
}

function makeVariant(
  purpose: MistakeVariant['purpose'],
  origin: MistakeVariant['origin'],
  stem: string,
  parts: PracticePart[],
): MistakeVariant {
  return {
    id: crypto.randomUUID(),
    purpose,
    origin,
    stem,
    parts,
    hash: questionHash(questionText({ stem, parts })),
    createdAt: Date.now(),
  }
}

function isNumber(
  grader: PracticeGrader,
): grader is Extract<PracticeGrader, { kind: 'numeric' | 'quantity' }> {
  return grader.kind === 'numeric' || grader.kind === 'quantity'
}

function withSigFigs(
  grader: Extract<PracticeGrader, { kind: 'numeric' | 'quantity' }>,
  figures: number,
): string {
  if (grader.kind === 'numeric') return formatSigFigs(grader.expected, figures)
  return `${formatSigFigs(grader.value, figures)} ${grader.unit}`
}

/** A wrong quantity answer: was the number right (then the unit is the error)? */
function unitOrValue(
  grader: Extract<PracticeGrader, { kind: 'quantity' }>,
  answer: string,
): ErrorDimension {
  const number = Number(/-?\d+(?:\.\d+)?(?:e-?\d+)?/i.exec(answer.replace(/,/g, ''))?.[0])
  return Number.isFinite(number) &&
    Math.abs(number - grader.value) <= Math.abs(grader.value) * 0.01 + 1e-12
    ? 'unit'
    : 'value'
}
