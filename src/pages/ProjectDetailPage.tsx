import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, BookX, Brain, Calendar, FileText, History, Layers, ListChecks, Pencil, Sparkles } from 'lucide-react'
import { useProject, useProjects } from '@/features/project/useProjects'
import { SUBJECT_LABELS } from '@/entities/project/types'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/Card'
import { EmptyState } from '@/shared/ui/EmptyState'
import { ErrorState } from '@/shared/ui/ErrorState'
import { LoadingState } from '@/shared/ui/LoadingState'
import { PageContainer, PageContent, PageHeader } from '@/shared/ui/Page'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/Tabs'
import { ProjectDocumentsTab } from '@/widgets/documents/ProjectDocumentsTab'
import { CourseAnalysisPanel } from '@/widgets/documentAnalysis/CourseAnalysisPanel'
import { RenameProjectDialog } from '@/widgets/project/RenameProjectDialog'
import { toast } from '@/features/toast/toastStore'
import { formatDate, formatDateTime } from '@/shared/lib/utils'

export function ProjectDetailPage(): JSX.Element {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { project, loading, update } = useProject(id)
  const { loaded, loading: listLoading } = useProjects()
  const [renameOpen, setRenameOpen] = useState(false)

  useEffect(() => {
    if (!loaded || listLoading) return
    if (!id) return
    if (!project) navigate('/projects', { replace: true })
  }, [id, project, loaded, listLoading, navigate])

  if (loading || listLoading || !loaded) {
    return (
      <PageContainer>
        <PageContent>
          <LoadingState label="Loading project" />
        </PageContent>
      </PageContainer>
    )
  }

  if (!project) {
    return (
      <PageContainer>
        <PageContent>
          <ErrorState
            title="Project not found"
            description="This project may have been deleted, or the link is wrong."
            action={
              <Button asChild>
                <Link to="/projects">
                  <ArrowLeft className="h-4 w-4" />
                  Back to projects
                </Link>
              </Button>
            }
          />
        </PageContent>
      </PageContainer>
    )
  }

  async function handleRename(name: string) {
    await update({ name })
    toast({ variant: 'success', title: 'Project renamed', description: name })
  }

  return (
    <PageContainer>
      <PageHeader
        title={
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="ghost" size="icon" aria-label="Back to projects">
              <Link to="/projects">
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <span>{project.name}</span>
            <Badge variant="outline">{SUBJECT_LABELS[project.subject]}</Badge>
          </div>
        }
        description={project.description || 'Manage documents, lessons, and progress for this project.'}
        actions={
          <Button variant="outline" onClick={() => setRenameOpen(true)}>
            <Pencil className="h-4 w-4" />
            Rename
          </Button>
        }
      />
      <PageContent>
        <Tabs defaultValue="documents">
          <TabsList>
            <TabsTrigger value="documents">Documents</TabsTrigger>
            <TabsTrigger value="analysis">
              <Brain className="h-4 w-4" />
              Analysis
            </TabsTrigger>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="quiz">
              <ListChecks className="h-4 w-4" />
              Quiz
            </TabsTrigger>
            <TabsTrigger value="mistakes">
              <BookX className="h-4 w-4" />
              Mistakes
            </TabsTrigger>
          </TabsList>
          <TabsContent value="documents">
            <ProjectDocumentsTab projectId={project.id} />
          </TabsContent>
          <TabsContent value="analysis" className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="flex items-center gap-2 text-base font-semibold">
                  <Sparkles className="h-4 w-4" />
                  AI Course Analysis
                </h2>
                <p className="text-sm text-muted-foreground">
                  Ask the AI to read your documents and extract topics, formulas, and symbols.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" asChild>
                  <Link to={`/projects/${project.id}/quiz`}>
                    <ListChecks className="h-4 w-4" />
                    Quiz
                  </Link>
                </Button>
                <Button variant="outline" asChild>
                  <Link to={`/projects/${project.id}/mistakes`}>
                    <BookX className="h-4 w-4" />
                    Mistakes
                  </Link>
                </Button>
                <Button variant="outline" asChild>
                  <Link to={`/projects/${project.id}/mastery`}>
                    <Brain className="h-4 w-4" />
                    Mastery
                  </Link>
                </Button>
                <Button variant="outline" asChild>
                  <Link to={`/projects/${project.id}/history`}>
                    <History className="h-4 w-4" />
                    Chat History
                  </Link>
                </Button>
                <Button variant="outline" asChild>
                  <Link to={`/projects/${project.id}/tutor`}>
                    <Sparkles className="h-4 w-4" />
                    Open Tutor
                  </Link>
                </Button>
              </div>
            </div>
            <CourseAnalysisPanel
              projectId={project.id}
              subject={SUBJECT_LABELS[project.subject]}
              onStartTutor={(topicId) => navigate(`/projects/${project.id}/tutor/${topicId}`)}
            />
          </TabsContent>
          <TabsContent value="quiz" className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="flex items-center gap-2 text-base font-semibold">
                  <ListChecks className="h-4 w-4" />
                  Quizzes
                </h2>
                <p className="text-sm text-muted-foreground">
                  Generate adaptive practice questions from your course material.
                </p>
              </div>
              <Button asChild>
                <Link to={`/projects/${project.id}/quiz`}>Open Quiz</Link>
              </Button>
            </div>
            <EmptyState
              icon={<ListChecks className="h-8 w-8" />}
              title="Ready when you are"
              description="The quiz generator uses your course analysis to create questions and adapts difficulty as you answer."
              action={
                <Button asChild>
                  <Link to={`/projects/${project.id}/quiz`}>Generate Quiz</Link>
                </Button>
              }
            />
          </TabsContent>
          <TabsContent value="mistakes" className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="flex items-center gap-2 text-base font-semibold">
                  <BookX className="h-4 w-4" />
                  Mistake Book
                </h2>
                <p className="text-sm text-muted-foreground">
                  Wrong answers are collected automatically. Analyse and practise them.
                </p>
              </div>
              <Button asChild>
                <Link to={`/projects/${project.id}/mistakes`}>Open Mistake Book</Link>
              </Button>
            </div>
            <EmptyState
              icon={<BookX className="h-8 w-8" />}
              title="Nothing recorded yet"
              description="Mistakes from quizzes appear here automatically. You can also add one manually."
              action={
                <Button asChild>
                  <Link to={`/projects/${project.id}/mistakes`}>Open Mistake Book</Link>
                </Button>
              }
            />
          </TabsContent>
          <TabsContent value="overview" className="space-y-4">
            <div className="grid gap-4 lg:grid-cols-3">
              <Card className="lg:col-span-2">
                <CardHeader>
                  <CardTitle>About this project</CardTitle>
                  <CardDescription>
                    Upload course materials from the Documents tab. The AI Tutor and Quiz features
                    arrive in later phases.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <Meta icon={<Layers className="h-4 w-4" />} label="Subject" value={SUBJECT_LABELS[project.subject]} />
                  <Meta icon={<Calendar className="h-4 w-4" />} label="Created" value={formatDate(project.createdAt)} />
                  <Meta icon={<Calendar className="h-4 w-4" />} label="Last updated" value={formatDateTime(project.updatedAt)} />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Upcoming in this project</CardTitle>
                </CardHeader>
                <CardContent>
                  <EmptyState
                    icon={<FileText className="h-6 w-6" />}
                    title="Upload to begin"
                    description="Add PDFs, slides, or paste text. We'll extract and structure them automatically."
                    action={
                      <Button asChild size="sm">
                        <Link to={`/projects/${project.id}`}>Go to Documents</Link>
                      </Button>
                    }
                  />
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </PageContent>

      <RenameProjectDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        project={project}
        onRename={handleRename}
      />
    </PageContainer>
  )
}

function Meta({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 text-muted-foreground">
      <span className="grid h-7 w-7 place-items-center rounded-md bg-muted">{icon}</span>
      <div className="flex flex-col">
        <span className="text-xs uppercase tracking-wider">{label}</span>
        <span className="text-sm font-medium text-foreground">{value}</span>
      </div>
    </div>
  )
}