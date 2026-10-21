import { useUiStyle } from '@/features/theme/useAppearance'
import type { CourseOverview } from '@/services/homeOverviewService'
import { FigureStrip, type FigureItem } from '@/widgets/dashboard/Figures'
import type { CourseMasteryEstimate } from '@/widgets/dashboard/useCourseMastery'
import { useTranslation, type TranslationKey } from '@/i18n'

const ANALYSIS_STATE_KEY: Record<CourseOverview['analysis'], TranslationKey> = {
  ready: 'projectDetail.analysisState.ready',
  pending: 'projectDetail.analysisState.pending',
  analyzing: 'projectDetail.analysisState.analyzing',
  failed: 'projectDetail.analysisState.failed',
  none: 'projectDetail.analysisState.none',
}

/**
 * The course home's numbers. Lecture: a figures row (mastery estimate, topics,
 * mistakes, open homework). Lab: a readout strip (materials, analysis state,
 * mastery estimate with a bar, pending work). Every value is counted from
 * stored rows; mastery is always labelled as an estimate and shows a dash
 * until there is practice to base it on.
 */
export function CourseFigures({
  course,
  mastery,
}: {
  course: CourseOverview
  mastery?: CourseMasteryEstimate
}): JSX.Element {
  const { t } = useTranslation()
  const { uiStyle } = useUiStyle()
  const open = Math.max(0, course.homework.questions - course.homework.worked)
  const masterySub = mastery
    ? t('projectDetail.fig.masterySub', { count: mastery.points })
    : t('projectDetail.fig.masteryNone')
  const topicsValue = course.analysis === 'ready' ? course.topicCount : null

  const items: FigureItem[] =
    uiStyle === 'lab'
      ? [
          {
            label: t('projectDetail.fig.materials'),
            value: course.materials.total,
            sub:
              [
                course.materials.processing > 0
                  ? t('projectDetail.fig.processing', { count: course.materials.processing })
                  : '',
                course.materials.failed > 0
                  ? t('projectDetail.fig.failed', { count: course.materials.failed })
                  : '',
              ]
                .filter(Boolean)
                .join(' · ') || undefined,
          },
          {
            label: t('projectDetail.fig.analysis'),
            value: t(ANALYSIS_STATE_KEY[course.analysis]),
            tone: course.analysis === 'ready' ? 'accent' : 'default',
            sub:
              topicsValue !== null ? t('home.courses.topics', { count: topicsValue }) : undefined,
          },
          {
            label: t('projectDetail.fig.mastery'),
            value: mastery ? `${Math.round(mastery.average * 100)}%` : null,
            sub: masterySub,
            ratio: mastery?.average,
          },
          {
            label: t('projectDetail.fig.pending'),
            value: course.activeMistakes + open,
            sub: t('projectDetail.fig.pendingSub', {
              count: course.activeMistakes,
              mistakes: course.activeMistakes,
              homework: open,
            }),
          },
        ]
      : [
          {
            label: t('projectDetail.fig.mastery'),
            value: mastery ? Math.round(mastery.average * 100) : null,
            unit: mastery ? '%' : undefined,
            sub: masterySub,
          },
          {
            label: t('projectDetail.fig.topics'),
            value: topicsValue,
            sub: topicsValue === null ? t(ANALYSIS_STATE_KEY[course.analysis]) : undefined,
          },
          { label: t('projectDetail.fig.mistakes'), value: course.activeMistakes },
          {
            label: t('projectDetail.fig.homework'),
            value: open,
            unit: course.homework.questions > 0 ? `/ ${course.homework.questions}` : undefined,
          },
        ]

  return <FigureStrip items={items} label={t('projectDetail.figures.label')} />
}
