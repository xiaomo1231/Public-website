import { Navigate, type RouteObject } from 'react-router-dom'
import { AppShell } from './layout/AppShell'
import { LoginPage } from '@/pages/LoginPage'
import { InvitePage } from '@/pages/InvitePage'
import { DashboardPage } from '@/pages/DashboardPage'
import { ProjectsPage } from '@/pages/ProjectsPage'
import { ProjectDetailPage } from '@/pages/ProjectDetailPage'
import { DocumentDetailPage } from '@/pages/DocumentDetailPage'
import { TutorPage } from '@/pages/TutorPage'
import { InteractiveTutorPage } from '@/pages/InteractiveTutorPage'
import { ChatHistoryPage } from '@/pages/ChatHistoryPage'
import { QuizLandingPage } from '@/pages/QuizLandingPage'
import { QuizPage } from '@/pages/QuizPage'
import { QuizResultPage } from '@/pages/QuizResultPage'
import { PracticePage } from '@/pages/PracticePage'
import { MasteryPage } from '@/pages/MasteryPage'
import { MistakeBookPage } from '@/pages/MistakeBookPage'
import { SettingsPage } from '@/pages/SettingsPage'
import { RequireAuth } from './RequireAuth'

export const routes: RouteObject[] = [
  { path: '/login', element: <LoginPage /> },
  { path: '/invite', element: <InvitePage /> },
  {
    path: '/',
    element: (
      <RequireAuth>
        <AppShell />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <Navigate to="/dashboard" replace /> },
      { path: 'dashboard', element: <DashboardPage /> },
      { path: 'projects', element: <ProjectsPage /> },
      { path: 'projects/:id', element: <ProjectDetailPage /> },
      { path: 'projects/:id/tutor/:topicId', element: <TutorPage /> },
      { path: 'projects/:id/tutor/:topicId/interactive', element: <InteractiveTutorPage /> },
      { path: 'projects/:id/tutor', element: <TutorPage /> },
      { path: 'projects/:id/history', element: <ChatHistoryPage /> },
      { path: 'projects/:id/quiz', element: <QuizLandingPage /> },
      { path: 'projects/:id/quiz/:quizId', element: <QuizPage /> },
      { path: 'projects/:id/quiz/:quizId/result', element: <QuizResultPage /> },
      { path: 'projects/:id/practice', element: <PracticePage /> },
      { path: 'projects/:id/mastery', element: <MasteryPage /> },
      { path: 'projects/:id/mistakes', element: <MistakeBookPage /> },
      { path: 'projects/:id/documents/:did', element: <DocumentDetailPage /> },
      { path: 'settings', element: <SettingsPage /> },
    ],
  },
  { path: '*', element: <Navigate to="/invite" replace /> },
]