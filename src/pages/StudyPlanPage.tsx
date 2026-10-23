import { useSearchParams } from 'react-router-dom'
import { CalendarDays } from 'lucide-react'
import { PageContainer, PageContent, PageHeader } from '@/shared/ui/Page'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/Tabs'
import { TodayPanel } from '@/widgets/studyPlan/TodayPanel'
import { ExamSetup } from '@/widgets/studyPlan/ExamSetup'
import { CalendarEditor } from '@/widgets/studyPlan/CalendarEditor'
import { WeightsPanel } from '@/widgets/studyPlan/WeightsPanel'
import { TimelinePanel } from '@/widgets/studyPlan/TimelinePanel'
import { DiagnosticPanel } from '@/widgets/studyPlan/DiagnosticPanel'
import { PlanInsights } from '@/widgets/studyPlan/PlanInsights'
import { useTranslation } from '@/i18n'

const TABS = ['today', 'timeline', 'exams', 'calendar', 'weights', 'diagnostic'] as const
type PlanTab = (typeof TABS)[number]

/**
 * 学习计划 (global): today's tasks, the week-by-week timeline, the exams, the
 * calendar, the time shares between exams and the diagnostic paper. The tab
 * lives in the URL (`?tab=exams`).
 */
export function StudyPlanPage(): JSX.Element {
  const { t } = useTranslation()
  const [params, setParams] = useSearchParams()
  const raw = params.get('tab')
  const tab: PlanTab = TABS.includes(raw as PlanTab) ? (raw as PlanTab) : 'today'
  return (
    <PageContainer>
      <PageHeader
        icon={<CalendarDays className="h-5 w-5" />}
        title={t('plan.title')}
        description={t('plan.description')}
      />
      <PageContent>
        <Tabs
          value={tab}
          onValueChange={(value) =>
            setParams(value === 'today' ? {} : { tab: value }, { replace: true })
          }
        >
          <TabsList className="flex-wrap">
            {TABS.map((each) => (
              <TabsTrigger key={each} value={each}>
                {t(`plan.tab.${each}` as const)}
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value="today" className="space-y-8">
            <TodayPanel />
            <PlanInsights />
          </TabsContent>
          <TabsContent value="timeline">
            <TimelinePanel />
          </TabsContent>
          <TabsContent value="exams">
            <ExamSetup />
          </TabsContent>
          <TabsContent value="calendar">
            <CalendarEditor />
          </TabsContent>
          <TabsContent value="weights">
            <WeightsPanel />
          </TabsContent>
          <TabsContent value="diagnostic">
            <DiagnosticPanel examId={params.get('examId')} />
          </TabsContent>
        </Tabs>
      </PageContent>
    </PageContainer>
  )
}
