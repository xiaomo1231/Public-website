import { Suspense, lazy, type ComponentType } from 'react'
import { Navigate, type RouteObject } from 'react-router-dom'
import { AppShell } from './layout/AppShell'
import { LoginPage } from '@/pages/LoginPage'
import { InvitePage } from '@/pages/InvitePage'
import { RequireAuth } from './RequireAuth'
import { NotFoundPage, RouteError } from './RouteError'
import { ProjectScope } from './layout/ProjectScope'
import { LoadingState } from '@/shared/ui/LoadingState'

/**
 * Pages load on demand so the first paint only ships the shell. Each lazy
 * page gets its own Suspense boundary with the shared loading state, so the
 * sidebar stays put while a page's chunk downloads.
 */
function lazyPage<M extends Record<K, ComponentType>, K extends keyof M & string>(
  load: () => Promise<M>,
  name: K,
): ComponentType {
  const Lazy = lazy(async (): Promise<{ default: ComponentType }> => ({
    default: (await load())[name],
  }))
  function LazyPage(): JSX.Element {
    return (
      <Suspense fallback={<LoadingState />}>
        <Lazy />
      </Suspense>
    )
  }
  LazyPage.displayName = `Lazy(${name})`
  return LazyPage
}

const DashboardPage = lazyPage(() => import('@/pages/DashboardPage'), 'DashboardPage')
const ProjectsPage = lazyPage(() => import('@/pages/ProjectsPage'), 'ProjectsPage')
const ProjectDetailPage = lazyPage(() => import('@/pages/ProjectDetailPage'), 'ProjectDetailPage')
const ProjectFilesPage = lazyPage(() => import('@/pages/ProjectFilesPage'), 'ProjectFilesPage')
const DocumentDetailPage = lazyPage(
  () => import('@/pages/DocumentDetailPage'),
  'DocumentDetailPage',
)
const TutorPage = lazyPage(() => import('@/pages/TutorPage'), 'TutorPage')
const MockExamPage = lazyPage(() => import('@/pages/MockExamPage'), 'MockExamPage')
const ExamAnalysisPage = lazyPage(() => import('@/pages/ExamAnalysisPage'), 'ExamAnalysisPage')
const SlideStudyPage = lazyPage(() => import('@/pages/SlideStudyPage'), 'SlideStudyPage')
const InteractiveTutorPage = lazyPage(
  () => import('@/pages/InteractiveTutorPage'),
  'InteractiveTutorPage',
)
const ChatHistoryPage = lazyPage(() => import('@/pages/ChatHistoryPage'), 'ChatHistoryPage')
const QuizLandingPage = lazyPage(() => import('@/pages/QuizLandingPage'), 'QuizLandingPage')
const QuizPage = lazyPage(() => import('@/pages/QuizPage'), 'QuizPage')
const QuizResultPage = lazyPage(() => import('@/pages/QuizResultPage'), 'QuizResultPage')
const PracticePage = lazyPage(() => import('@/pages/PracticePage'), 'PracticePage')
const HomeworkLandingPage = lazyPage(
  () => import('@/pages/HomeworkLandingPage'),
  'HomeworkLandingPage',
)
const HomeworkPage = lazyPage(() => import('@/pages/HomeworkPage'), 'HomeworkPage')
const MasteryPage = lazyPage(() => import('@/pages/MasteryPage'), 'MasteryPage')
const MistakeBookPage = lazyPage(() => import('@/pages/MistakeBookPage'), 'MistakeBookPage')
const ReviewCardsPage = lazyPage(() => import('@/pages/ReviewCardsPage'), 'ReviewCardsPage')
const InterviewPage = lazyPage(() => import('@/pages/InterviewPage'), 'InterviewPage')
const SettingsPage = lazyPage(() => import('@/pages/SettingsPage'), 'SettingsPage')
const VocabPage = lazyPage(() => import('@/pages/VocabPage'), 'VocabPage')
const StudyPlanPage = lazyPage(() => import('@/pages/StudyPlanPage'), 'StudyPlanPage')

/**
 * Every project sub-page sits under `ProjectScope`, which shows one
 * consistent "course not found" state for an unknown or deleted project id.
 * The project overview (`projects/:id`) keeps its own handling.
 */
const projectPages: RouteObject[] = [
  { path: 'projects/:id/files', element: <ProjectFilesPage /> },
  { path: 'projects/:id/tutor/:topicId', element: <TutorPage /> },
  { path: 'projects/:id/tutor/:topicId/interactive', element: <InteractiveTutorPage /> },
  { path: 'projects/:id/tutor', element: <TutorPage /> },
  { path: 'projects/:id/slides', element: <SlideStudyPage /> },
  { path: 'projects/:id/slides/:documentId', element: <SlideStudyPage /> },
  { path: 'projects/:id/slides/:documentId/:slideNumber', element: <SlideStudyPage /> },
  { path: 'projects/:id/history', element: <ChatHistoryPage /> },
  { path: 'projects/:id/quiz', element: <QuizLandingPage /> },
  { path: 'projects/:id/quiz/:quizId', element: <QuizPage /> },
  { path: 'projects/:id/quiz/:quizId/result', element: <QuizResultPage /> },
  { path: 'projects/:id/practice', element: <PracticePage /> },
  { path: 'projects/:id/homework', element: <HomeworkLandingPage /> },
  { path: 'projects/:id/homework/exam-analysis', element: <ExamAnalysisPage /> },
  { path: 'projects/:id/homework/:assignmentId', element: <HomeworkPage /> },
  { path: 'projects/:id/homework/:assignmentId/exam', element: <MockExamPage /> },
  { path: 'projects/:id/mastery', element: <MasteryPage /> },
  { path: 'projects/:id/mistakes', element: <MistakeBookPage /> },
  { path: 'projects/:id/cards', element: <ReviewCardsPage /> },
  { path: 'projects/:id/interview', element: <InterviewPage /> },
  { path: 'projects/:id/interview/:sessionId', element: <InterviewPage /> },
  { path: 'projects/:id/documents/:did', element: <DocumentDetailPage /> },
]

export const routes: RouteObject[] = [
  { path: '/login', element: <LoginPage />, errorElement: <RouteError fullScreen /> },
  { path: '/invite', element: <InvitePage />, errorElement: <RouteError fullScreen /> },
  {
    path: '/',
    element: (
      <RequireAuth>
        <AppShell />
      </RequireAuth>
    ),
    // Errors thrown by the shell itself.
    errorElement: <RouteError fullScreen />,
    children: [
      {
        // Pathless boundary: a page that fails to render shows the localized
        // error inside the shell, so the sidebar stays usable.
        errorElement: <RouteError />,
        children: [
          { index: true, element: <Navigate to="/dashboard" replace /> },
          { path: 'dashboard', element: <DashboardPage /> },
          { path: 'projects', element: <ProjectsPage /> },
          { path: 'projects/:id', element: <ProjectDetailPage /> },
          { element: <ProjectScope />, children: projectPages },
          { path: 'vocab', element: <VocabPage /> },
          { path: 'plan', element: <StudyPlanPage /> },
          { path: 'settings', element: <SettingsPage /> },
          // Signed-in users get a "page not found"; locked users are sent to
          // the invite page by RequireAuth first, then return here.
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
]
