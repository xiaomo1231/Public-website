import { Navigate, type RouteObject } from 'react-router-dom'
import { AppShell } from './layout/AppShell'
import { LoginPage } from '@/pages/LoginPage'
import { InvitePage } from '@/pages/InvitePage'
import { DashboardPage } from '@/pages/DashboardPage'
import { ProjectsPage } from '@/pages/ProjectsPage'
import { ProjectDetailPage } from '@/pages/ProjectDetailPage'
import { ProjectFilesPage } from '@/pages/ProjectFilesPage'
import { DocumentDetailPage } from '@/pages/DocumentDetailPage'
import { TutorPage } from '@/pages/TutorPage'
import { SlideStudyPage } from '@/pages/SlideStudyPage'
import { InteractiveTutorPage } from '@/pages/InteractiveTutorPage'
import { ChatHistoryPage } from '@/pages/ChatHistoryPage'
import { QuizLandingPage } from '@/pages/QuizLandingPage'
import { QuizPage } from '@/pages/QuizPage'
import { QuizResultPage } from '@/pages/QuizResultPage'
import { PracticePage } from '@/pages/PracticePage'
import { HomeworkLandingPage } from '@/pages/HomeworkLandingPage'
import { HomeworkPage } from '@/pages/HomeworkPage'
import { MasteryPage } from '@/pages/MasteryPage'
import { MistakeBookPage } from '@/pages/MistakeBookPage'
import { ReviewCardsPage } from '@/pages/ReviewCardsPage'
import { SettingsPage } from '@/pages/SettingsPage'
import { VocabPage } from '@/pages/VocabPage'
import { RequireAuth } from './RequireAuth'
import { NotFoundPage, RouteError } from './RouteError'
import { ProjectScope } from './layout/ProjectScope'

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
  { path: 'projects/:id/homework/:assignmentId', element: <HomeworkPage /> },
  { path: 'projects/:id/mastery', element: <MasteryPage /> },
  { path: 'projects/:id/mistakes', element: <MistakeBookPage /> },
  { path: 'projects/:id/cards', element: <ReviewCardsPage /> },
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
          { path: 'settings', element: <SettingsPage /> },
          // Signed-in users get a "page not found"; locked users are sent to
          // the invite page by RequireAuth first, then return here.
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
]
