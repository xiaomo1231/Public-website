import { prompts } from '@/infrastructure/ai/prompts'
import { AppError } from '@/infrastructure/errors/AppError'
import { t } from '@/i18n'
import type { AIService } from './aiService'
import type { PlanSummary } from '@/entities/studyPlan/types'
import { StudyPlanService } from './studyPlanService'
import type { AppDatabase } from '@/infrastructure/db/database'

/**
 * Optional short AI read of the plan (priorities and risks): one request with
 * the full output cap, stoppable. Only numbers the local planner computed are
 * sent — exam and topic names, days left, shares, mastery estimates and what
 * did not fit — never course material.
 */
export class PlanSummaryService {
  private plans: StudyPlanService

  constructor(
    private ai: Pick<AIService, 'chat'> | null,
    db?: AppDatabase,
  ) {
    this.plans = new StudyPlanService(db ? { db } : {})
  }

  async summarize(
    language: 'zh' | 'en',
    options: { signal?: AbortSignal; now?: number } = {},
  ): Promise<PlanSummary> {
    if (!this.ai) throw new AppError(t('errors.aiKeyRequired'), 'MISSING_API_KEY')
    const now = options.now ?? Date.now()
    const contexts = await this.plans.contexts(now)
    if (contexts.length === 0) throw new AppError(t('plan.summary.noExams'), 'VALIDATION_ERROR')
    const weights = await this.plans.weights(now, contexts)
    const plan = await this.plans.getPlan()
    const input = {
      language,
      exams: contexts.map((c) => ({
        name: c.exam.name,
        course: c.project.name,
        daysLeft: c.daysLeft,
        share: weights.shares[c.exam.id]?.share ?? 0,
        ...(c.mastery !== null ? { mastery: Math.round(c.mastery * 100) } : {}),
        weakTopics: [...c.topics]
          .filter((topic) => topic.mastery !== null && topic.mastery < 0.6)
          .sort((a, b) => (a.mastery ?? 0) - (b.mastery ?? 0))
          .slice(0, 4)
          .map((topic) => topic.name),
      })),
      dropped: (plan.overflow?.dropped ?? []).slice(0, 10).map((item) => ({
        label: item.label,
        minutes: item.minutes,
      })),
      minutesPerDay: Math.round(
        plan.calendar.weekly.reduce(
          (sum, type) => sum + (type === 'off' ? 0 : plan.calendar.minutes[type]),
          0,
        ) / 7,
      ),
    }
    const response = await this.ai.chat(
      [
        { role: 'system', content: prompts.studyPlanSummary.buildSystemPrompt() },
        { role: 'user', content: prompts.studyPlanSummary.buildUserPrompt(input) },
      ],
      { ...(options.signal ? { signal: options.signal } : {}), usageKind: 'other' },
    )
    const text = response.content.trim()
    if (!text) throw new AppError(t('errors.aiMalformedJson'), 'INVALID_RESPONSE')
    const summary: PlanSummary = {
      text: text.slice(0, 2000),
      at: now,
      promptVersion: `study-plan-summary/${prompts.studyPlanSummary.VERSION}`,
    }
    await this.plans.saveSummary(summary)
    return summary
  }
}
