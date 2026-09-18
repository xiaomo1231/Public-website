import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight,
  BookOpen,
  BookX,
  FolderKanban,
  Sparkles,
  Target,
  TrendingUp,
} from 'lucide-react'
import { useProjects } from '@/features/project/useProjects'
import { useAuth } from '@/features/auth/useAuth'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/Card'
import { EmptyState } from '@/shared/ui/EmptyState'
import { LoadingState } from '@/shared/ui/LoadingState'
import { PageContainer, PageContent, PageHeader } from '@/shared/ui/Page'
import { Progress } from '@/shared/ui/Progress'
import { WeaknessPanel } from '@/widgets/mistakes/WeaknessPanel'
import { SUBJECT_LABELS } from '@/entities/project/types'
import { relativeTime } from '@/shared/lib/utils'

export function DashboardPage(): JSX.Element {
  const { projects, loading, loaded } = useProjects()
  const { profile } = useAuth()

  const stats = useMemo(() => {
    const total = projects.length
    const subjects = new Set(projects.map((p) => p.subject)).size
    const lastUpdated = projects
      .map((p) => p.updatedAt)
      .sort((a, b) => b - a)[0]
    return { total, subjects, lastUpdated }
  }, [projects])

  const recent = projects.slice(0, 4)

  return (
    <PageContainer>
      <PageHeader
        title={`Welcome, ${profile?.name ?? 'Student'}`}
        description="Your local-first learning workspace."
        actions={
          <Button asChild>
            <Link to="/projects">
              <FolderKanban className="h-4 w-4" />
              My Projects
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        }
      />
      <PageContent>
        {!loaded && loading ? (
          <LoadingState label="Loading dashboard" />
        ) : (
          <div className="grid gap-4">
            <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard
                icon={<FolderKanban className="h-4 w-4" />}
                label="Projects"
                value={String(stats.total)}
                hint={stats.total === 0 ? 'Create your first project' : `${stats.subjects} subjects`}
              />
              <StatCard
                icon={<BookOpen className="h-4 w-4" />}
                label="Study streak"
                value="—"
                hint="Coming in a later phase"
              />
              <StatCard
                icon={<Target className="h-4 w-4" />}
                label="Mastery"
                value="—"
                hint="Quiz & Tutor coming next"
              />
              <StatCard
                icon={<TrendingUp className="h-4 w-4" />}
                label="Last activity"
                value={stats.lastUpdated ? relativeTime(stats.lastUpdated) : '—'}
                hint={stats.lastUpdated ? 'Auto-saved locally' : 'No activity yet'}
              />
            </section>

            <section className="grid gap-4 lg:grid-cols-3">
              <Card className="lg:col-span-2">
                <CardHeader>
                  <CardTitle>Recent projects</CardTitle>
                  <CardDescription>Quickly resume what you were studying.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {recent.length === 0 ? (
                    <EmptyState
                      icon={<FolderKanban className="h-8 w-8" />}
                      title="No projects yet"
                      description="Create a project to start uploading course materials."
                      action={
                        <Button asChild>
                          <Link to="/projects">
                            Create your first project
                            <ArrowRight className="h-4 w-4" />
                          </Link>
                        </Button>
                      }
                    />
                  ) : (
                    recent.map((p) => (
                      <Link
                        key={p.id}
                        to={`/projects/${p.id}`}
                        className="flex items-center justify-between rounded-md border p-3 transition-colors hover:bg-accent"
                      >
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">{p.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {SUBJECT_LABELS[p.subject]} · updated {relativeTime(p.updatedAt)}
                          </div>
                        </div>
                        <Badge variant="outline">{p.subject}</Badge>
                      </Link>
                    ))
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>What&apos;s next</CardTitle>
                  <CardDescription>Roadmap for upcoming phases.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <RoadmapItem
                    icon={<Sparkles className="h-4 w-4" />}
                    title="AI Provider"
                    state="configured"
                  />
                  <RoadmapItem icon={<FolderKanban className="h-4 w-4" />} title="Content Library" state="ready" />
                  <RoadmapItem icon={<BookOpen className="h-4 w-4" />} title="AI Tutor" state="ready" />
                  <RoadmapItem icon={<Target className="h-4 w-4" />} title="Quiz & Mastery" state="ready" />
                  <RoadmapItem icon={<BookX className="h-4 w-4" />} title="Mistake Book" state="configured" />
                </CardContent>
              </Card>
            </section>

            {recent[0] && (
              <section>
                <WeaknessPanel projectId={recent[0].id} compact />
              </section>
            )}

            <Card>
              <CardHeader>
                <CardTitle>Local-first</CardTitle>
                <CardDescription>
                  Your projects, documents, mistakes, and AI settings live on this device. Configure an
                  AI provider in Settings to unlock Tutor, Quiz, and Mistake analysis.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Progress value={stats.total > 0 ? 60 : 5} />
                <p className="mt-2 text-xs text-muted-foreground">
                  Phases 1–5 shipped. Next: knowledge retrieval, then dashboard polish.
                </p>
              </CardContent>
            </Card>
          </div>
        )}
      </PageContent>
    </PageContainer>
  )
}

function StatCard({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode
  label: string
  value: string
  hint?: string
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 p-4">
        <div className="grid h-9 w-9 place-items-center rounded-md bg-muted text-muted-foreground">
          {icon}
        </div>
        <div className="min-w-0">
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className="truncate text-lg font-semibold leading-tight">{value}</div>
          {hint && <div className="truncate text-xs text-muted-foreground">{hint}</div>}
        </div>
      </CardContent>
    </Card>
  )
}

function RoadmapItem({
  icon,
  title,
  state,
}: {
  icon: React.ReactNode
  title: string
  state: 'configured' | 'ready' | 'soon' | 'later'
}) {
  const map = {
    configured: { label: 'Phase 1 ✓', variant: 'default' as const },
    ready: { label: 'Ready', variant: 'secondary' as const },
    soon: { label: 'Phase 2', variant: 'outline' as const },
    later: { label: 'Later', variant: 'outline' as const },
  }
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2 text-foreground">
        <span className="text-muted-foreground">{icon}</span>
        {title}
      </div>
      <Badge variant={map[state].variant}>{map[state].label}</Badge>
    </div>
  )
}