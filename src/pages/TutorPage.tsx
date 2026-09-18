import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Brain, Languages, Sigma, Sparkles, X } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/Card'
import { Badge } from '@/shared/ui/Badge'
import { EmptyState } from '@/shared/ui/EmptyState'
import { LoadingState } from '@/shared/ui/LoadingState'
import { PageContainer, PageContent, PageHeader } from '@/shared/ui/Page'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/shared/ui/DropdownMenu'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/Dialog'
import { CourseAnalysisRepository } from '@/entities/courseAnalysis/repository'
import type { CourseAnalysis, Topic } from '@/entities/courseAnalysis/types'
import { TutorPanel } from '@/widgets/tutor/TutorPanel'
import { FormulaPanel } from '@/widgets/formulaPanel/FormulaPanel'
import { cn } from '@/shared/lib/utils'

const LANGUAGES: Array<{ value: 'zh' | 'en' | 'mixed'; label: string }> = [
  { value: 'en', label: 'English' },
  { value: 'zh', label: '中文' },
  { value: 'mixed', label: 'Bilingual' },
]

export function TutorPage(): JSX.Element {
  const { id: projectId, topicId } = useParams<{ id: string; topicId: string }>()
  const navigate = useNavigate()
  const [analysis, setAnalysis] = useState<CourseAnalysis | null>(null)
  const [topics, setTopics] = useState<Topic[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTopicId, setActiveTopicId] = useState<string | undefined>(topicId)
  const [language, setLanguage] = useState<'zh' | 'en' | 'mixed'>('en')
  const [formulasOpen, setFormulasOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      if (!projectId) return
      try {
        const repo = new CourseAnalysisRepository()
        const a = await repo.getByProject(projectId)
        if (cancelled) return
        setAnalysis(a ?? null)
        const ts = await repo.listTopics(projectId)
        if (cancelled) return
        setTopics(ts)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [projectId])

  useEffect(() => {
    if (topicId) setActiveTopicId(topicId)
  }, [topicId])

  useEffect(() => {
    if (analysis?.language) setLanguage(analysis.language)
  }, [analysis?.language])

  if (!projectId) return <div />

  if (loading) {
    return (
      <PageContainer>
        <PageContent>
          <LoadingState label="Loading tutor" />
        </PageContent>
      </PageContainer>
    )
  }

  if (!analysis || topics.length === 0) {
    return (
      <PageContainer>
        <PageHeader
          title="AI Tutor"
          description="Run the course analysis first to extract topics."
        />
        <PageContent>
          <EmptyState
            icon={<Brain className="h-10 w-10" />}
            title="Course not analysed yet"
            description="Open the project and click Analyze Course to extract topics, formulas, and symbols."
            action={
              <Button onClick={() => navigate(`/projects/${projectId}`)}>
                Go to project
              </Button>
            }
          />
        </PageContent>
      </PageContainer>
    )
  }

  const activeTopic = topics.find((t) => t.id === activeTopicId) ?? topics[0]

  const formulaPanelNode = activeTopic ? (
    <FormulaPanel projectId={projectId} topicId={activeTopic.id} />
  ) : (
    <FormulaPanel projectId={projectId} />
  )

  return (
    <PageContainer>
      <PageHeader
        title={
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="icon" aria-label="Back to project">
              <Link to={`/projects/${projectId}`}>
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <Sparkles className="h-4 w-4" />
            AI Tutor
          </div>
        }
        description="Question-driven learning grounded in your course material."
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="lg:hidden"
              onClick={() => setFormulasOpen(true)}
              aria-label="Open formulas"
            >
              <Sigma className="h-4 w-4" />
              Formulas
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <Languages className="h-4 w-4" />
                  {LANGUAGES.find((l) => l.value === language)?.label ?? 'English'}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Teaching language</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {LANGUAGES.map((l) => (
                  <DropdownMenuItem key={l.value} onSelect={() => setLanguage(l.value)}>
                    {l.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        }
      />
      <PageContent>
        {/* Desktop: three columns. Mobile: topics + tutor stacked, formulas in drawer. */}
        <div className="grid gap-6 lg:grid-cols-[220px_1fr_280px]">
          <aside className="space-y-3">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Topics</CardTitle>
                <CardDescription>Pick a topic to study.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-1">
                {topics.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => {
                      setActiveTopicId(t.id)
                      navigate(`/projects/${projectId}/tutor/${t.id}`)
                    }}
                    className={`flex w-full items-start gap-2 rounded-md px-2 py-2 text-left text-sm transition-colors ${
                      activeTopic?.id === t.id ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'
                    }`}
                  >
                    <span className="mt-0.5 text-muted-foreground">{topics.indexOf(t) + 1}.</span>
                    <span className="flex-1">{t.name}</span>
                  </button>
                ))}
              </CardContent>
            </Card>
            {analysis && (
              <Card className="hidden lg:block">
                <CardHeader>
                  <CardTitle className="text-base">Status</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-xs text-muted-foreground">
                  <Badge variant="outline">{analysis.language === 'mixed' ? 'Bilingual' : analysis.language.toUpperCase()}</Badge>
                  <p>{topics.length} topics · prompt {analysis.promptVersion}</p>
                </CardContent>
              </Card>
            )}
          </aside>
          <section>
            {activeTopic ? (
              <TutorPanel
                key={`${activeTopic.id}-${language}`}
                projectId={projectId}
                topicId={activeTopic.id}
                topicName={activeTopic.name}
                topicDescription={activeTopic.description}
                language={language}
                onClose={() => navigate(`/projects/${projectId}`)}
              />
            ) : (
              <EmptyState title="Pick a topic" description="Choose a topic on the left to start the tutor." />
            )}
          </section>
          <aside className="hidden lg:block">
            <div className="mb-2 text-sm font-semibold">Formula &amp; Symbols</div>
            {formulaPanelNode}
          </aside>
        </div>
      </PageContent>

      {/* Mobile formulas sheet */}
      <Dialog open={formulasOpen} onOpenChange={setFormulasOpen}>
        <DialogContent
          className={cn(
            'left-0 top-auto right-0 bottom-0 max-h-[85vh] w-full max-w-none translate-x-0 translate-y-0 rounded-b-none rounded-t-lg p-4 sm:left-[50%] sm:top-[50%] sm:bottom-auto sm:right-auto sm:max-h-[85vh] sm:w-[480px] sm:translate-x-[-50%] sm:translate-y-[-50%] sm:rounded-lg',
          )}
        >
          <DialogHeader className="mb-2">
            <DialogTitle className="flex items-center gap-2">
              <Sigma className="h-4 w-4" /> Formula &amp; Symbols
              <Button
                variant="ghost"
                size="icon"
                className="ml-auto"
                onClick={() => setFormulasOpen(false)}
                aria-label="Close formulas"
              >
                <X className="h-4 w-4" />
              </Button>
            </DialogTitle>
          </DialogHeader>
          {formulaPanelNode}
        </DialogContent>
      </Dialog>
    </PageContainer>
  )
}
