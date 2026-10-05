import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Languages,
  Loader2,
  MessageCircle,
  Presentation,
  RefreshCw,
  Send,
  Sparkles,
} from 'lucide-react'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/Card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/ui/DropdownMenu'
import { EmptyState } from '@/shared/ui/EmptyState'
import { ErrorState } from '@/shared/ui/ErrorState'
import { LoadingState } from '@/shared/ui/LoadingState'
import { PageContainer, PageContent, PageHeader } from '@/shared/ui/Page'
import { RichText } from '@/shared/ui/RichText'
import { Textarea } from '@/shared/ui/Textarea'
import { TruncatedText } from '@/shared/ui/TruncatedText'
import { SourceQuote } from '@/widgets/source/SourceQuote'
import { SlideViewer } from '@/widgets/slides/SlideViewer'
import { StudyModeTabs } from '@/widgets/slides/StudyModeTabs'
import { TutorSymbolsPanel } from '@/widgets/tutor/TutorSymbolsPanel'
import { ProjectFlowNav } from '@/widgets/project/ProjectFlowNav'
import { useSlideLessonService } from '@/features/slides/useSlideLessonService'
import type {
  SlideContent,
  SlideDocumentInfo,
  SlideIndex,
} from '@/services/slideLessonService'
import type { SlideLesson } from '@/entities/slideLesson/types'
import { PROCESSING_STATUS_LABEL_KEYS } from '@/entities/document/types'
import { friendlyAIError } from '@/shared/lib/aiErrors'
import { cn } from '@/shared/lib/utils'
import { useTranslation, type TranslationKey } from '@/i18n'

const LANGUAGES: Array<{ value: 'zh' | 'en' | 'mixed'; labelKey: TranslationKey }> = [
  { value: 'en', labelKey: 'language.en' },
  { value: 'zh', labelKey: 'language.zh' },
  { value: 'mixed', labelKey: 'language.bilingual' },
]

/**
 * Learn by slide: pick a presentation, move through its slides one at a time,
 * read the original slide content, and ask the AI to explain the current page
 * and answer questions about it.
 *
 * Nothing is generated until the student explicitly asks for a slide, and every
 * generated explanation is cached locally. Browsing slides, changing the theme
 * or switching the UI language never spends tokens.
 */
export function SlideStudyPage(): JSX.Element {
  const { t } = useTranslation()
  const { id: projectId, documentId, slideNumber } = useParams<{
    id: string
    documentId: string
    slideNumber: string
  }>()
  const navigate = useNavigate()
  const service = useSlideLessonService()

  const slideNumberNum = slideNumber !== undefined ? Number(slideNumber) : undefined
  const validSlideNumber =
    slideNumberNum !== undefined && Number.isInteger(slideNumberNum) && slideNumberNum > 0
      ? slideNumberNum
      : undefined

  const [documents, setDocuments] = useState<SlideDocumentInfo[]>([])
  const [loadingDocs, setLoadingDocs] = useState(true)
  const [index, setIndex] = useState<SlideIndex | null>(null)
  const [content, setContent] = useState<SlideContent | null>(null)
  const [lesson, setLesson] = useState<SlideLesson | null>(null)
  const [loadingSlide, setLoadingSlide] = useState(false)
  const [language, setLanguage] = useState<'zh' | 'en' | 'mixed'>('en')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [askText, setAskText] = useState('')

  // Load the project's presentations (local only).
  useEffect(() => {
    if (!projectId || !service) return
    let alive = true
    setLoadingDocs(true)
    void service
      .listSlideDocuments(projectId)
      .then((docs) => {
        if (alive) setDocuments(docs)
      })
      .catch(() => {
        if (alive) setDocuments([])
      })
      .finally(() => {
        if (alive) setLoadingDocs(false)
      })
    return () => {
      alive = false
    }
  }, [projectId, service])

  // With exactly one presentation, skip the file picker.
  useEffect(() => {
    if (!documentId && documents.length === 1 && documents[0]?.ready) {
      navigate(`/projects/${projectId}/slides/${documents[0].document.id}`, { replace: true })
    }
  }, [documentId, documents, navigate, projectId])

  // Load the slide index for the chosen document.
  useEffect(() => {
    if (!service || !documentId) {
      setIndex(null)
      return
    }
    let alive = true
    void service
      .buildIndex(documentId)
      .then((next) => {
        if (alive) setIndex(next)
      })
      .catch(() => {
        if (alive) setIndex(null)
      })
    return () => {
      alive = false
    }
  }, [service, documentId])

  // Resume the last studied slide when no slide number is in the URL.
  useEffect(() => {
    if (!service || !documentId || validSlideNumber !== undefined || !index) return
    let alive = true
    void service.resumeSlideNumber(documentId).then((resume) => {
      if (!alive) return
      const target = resume ?? 1
      navigate(`/projects/${projectId}/slides/${documentId}/${target}`, { replace: true })
    })
    return () => {
      alive = false
    }
  }, [service, documentId, validSlideNumber, index, navigate, projectId])

  // Load the current slide's material + its cached lesson.
  useEffect(() => {
    if (!service || !documentId || validSlideNumber === undefined) {
      setContent(null)
      setLesson(null)
      return
    }
    let alive = true
    setLoadingSlide(true)
    setError(null)
    void Promise.all([
      service.getSlideContent(documentId, validSlideNumber),
      service.getLesson({
        projectId: projectId ?? '',
        documentId,
        slideNumber: validSlideNumber,
        language,
      }),
    ])
      .then(([nextContent, nextLesson]) => {
        if (!alive) return
        setContent(nextContent)
        setLesson(nextLesson ?? null)
      })
      .catch((err) => {
        if (alive) setError(friendlyAIError(err))
      })
      .finally(() => {
        if (alive) setLoadingSlide(false)
      })
    return () => {
      alive = false
    }
  }, [service, documentId, validSlideNumber, language, projectId])

  const slideNumbers = useMemo(() => (index?.slides ?? []).map((entry) => entry.slideNumber), [index])
  const currentPosition = slideNumbers.indexOf(validSlideNumber ?? -1)
  const previousSlide =
    validSlideNumber !== undefined ? slideNumbers[currentPosition - 1] : undefined
  const nextSlide = validSlideNumber !== undefined ? slideNumbers[currentPosition + 1] : undefined

  const goToSlide = useCallback(
    (number: number) => navigate(`/projects/${projectId}/slides/${documentId}/${number}`),
    [navigate, projectId, documentId],
  )

  const generate = useCallback(
    async (force: boolean) => {
      if (!service || !projectId || !documentId || validSlideNumber === undefined) return
      setBusy(true)
      setError(null)
      try {
        const input = { projectId, documentId, slideNumber: validSlideNumber, language }
        const result = force ? await service.regenerate(input) : await service.generate(input)
        setLesson(result.lesson)
        if (result.error) setError(result.error)
      } catch (err) {
        setError(friendlyAIError(err))
      } finally {
        setBusy(false)
      }
    },
    [service, projectId, documentId, validSlideNumber, language],
  )

  const ask = useCallback(async () => {
    if (!service || !lesson || !askText.trim()) return
    setBusy(true)
    setError(null)
    try {
      const updated = await service.ask(lesson.id, askText)
      setLesson(updated)
      setAskText('')
    } catch (err) {
      setError(friendlyAIError(err))
    } finally {
      setBusy(false)
    }
  }, [service, lesson, askText])

  if (!projectId) return <div />

  const header = (
    <PageHeader
      icon={<Presentation className="h-5 w-5" />}
      title={t('slides.title')}
      description={t('slides.subtitle')}
      nav={<ProjectFlowNav projectId={projectId} active="tutor" />}
      actions={<StudyModeTabs projectId={projectId} active="slides" />}
    />
  )

  if (loadingDocs || (documentId && !index && !error)) {
    return (
      <PageContainer>
        {header}
        <PageContent>
          <LoadingState label={t('common.loading')} />
        </PageContent>
      </PageContainer>
    )
  }

  if (documents.length === 0) {
    return (
      <PageContainer>
        {header}
        <PageContent>
          <EmptyState
            icon={<Presentation className="h-10 w-10" />}
            title={t('slides.noPresentations')}
            description={t('slides.noPresentationsHint')}
            action={
              <Button asChild>
                <Link to={`/projects/${projectId}/files`}>{t('slides.openFiles')}</Link>
              </Button>
            }
          />
        </PageContent>
      </PageContainer>
    )
  }

  // File selection (multiple presentations).
  if (!documentId) {
    return (
      <PageContainer>
        {header}
        <PageContent className="space-y-4">
          <p className="text-sm text-muted-foreground">{t('slides.pickFileHint')}</p>
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {documents.map((doc) => (
              <li key={doc.document.id}>
                <Card className="flex h-full flex-col">
                  <CardHeader>
                    <CardTitle className="min-w-0 text-base">
                      <TruncatedText text={doc.document.name} className="min-w-0 max-w-full" />
                    </CardTitle>
                    <CardDescription>
                      {doc.ready
                        ? t('slides.slideCount', { count: doc.slideCount })
                        : t(PROCESSING_STATUS_LABEL_KEYS[doc.document.status])}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="mt-auto space-y-2">
                    {!doc.ready && doc.document.errorMessage && (
                      <p className="text-xs text-muted-foreground">{doc.document.errorMessage}</p>
                    )}
                    {doc.ready ? (
                      <Button asChild className="w-full">
                        <Link to={`/projects/${projectId}/slides/${doc.document.id}`}>
                          {t('slides.start')}
                          <ArrowRight className="h-4 w-4" />
                        </Link>
                      </Button>
                    ) : (
                      <Button variant="outline" className="w-full" asChild>
                        <Link to={`/projects/${projectId}/files`}>{t('slides.openFiles')}</Link>
                      </Button>
                    )}
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        </PageContent>
      </PageContainer>
    )
  }

  const currentDocumentInfo = documents.find((doc) => doc.document.id === documentId)

  // Document chosen but no slide number yet: show the table of contents.
  if (validSlideNumber === undefined) {
    return (
      <PageContainer>
        {header}
        <PageContent className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="min-w-0 text-base font-semibold">
              <TruncatedText text={index?.document.name ?? ''} className="min-w-0" />
            </h2>
            {documents.length > 1 && (
              <Button variant="outline" size="sm" asChild>
                <Link to={`/projects/${projectId}/slides`}>{t('slides.backToFiles')}</Link>
              </Button>
            )}
          </div>
          <p className="text-sm text-muted-foreground">{t('slides.pickSlideHint')}</p>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {(index?.slides ?? []).map((entry) => (
              <li key={entry.slideNumber}>
                <button
                  type="button"
                  onClick={() => goToSlide(entry.slideNumber)}
                  className="focus-ring flex w-full min-w-0 flex-col gap-1 rounded-lg border border-border/70 bg-card p-3 text-left transition-colors hover:border-primary/40"
                >
                  <span className="data-num font-mono text-xs text-muted-foreground">
                    {t('slides.position', {
                      current: entry.slideNumber,
                      total: index?.slideTotal ?? 0,
                    })}
                  </span>
                  <span className="line-clamp-2 text-sm text-foreground">
                    {entry.title ?? (entry.hasText ? t('slides.untitled') : t('slides.noText'))}
                  </span>
                  {entry.hasImage && <Badge variant="outline">{t('slides.hasImage')}</Badge>}
                </button>
              </li>
            ))}
          </ul>
        </PageContent>
      </PageContainer>
    )
  }

  const notReady = currentDocumentInfo && !currentDocumentInfo.ready

  return (
    <PageContainer>
      {header}
      <PageContent className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              aria-label={t('slides.backToFiles')}
              onClick={() =>
                documents.length > 1
                  ? navigate(`/projects/${projectId}/slides`)
                  : navigate(`/projects/${projectId}/slides/${documentId}`)
              }
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <span className="min-w-0 text-sm font-medium">
              <TruncatedText text={content?.document.name ?? ''} className="min-w-0" />
            </span>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <Languages className="h-4 w-4" />
                {t(LANGUAGES.find((item) => item.value === language)?.labelKey ?? 'language.en')}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>{t('tutor.teachingLanguage')}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {LANGUAGES.map((item) => (
                <DropdownMenuItem key={item.value} onSelect={() => setLanguage(item.value)}>
                  {t(item.labelKey)}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {notReady ? (
          <ErrorState
            title={t('slides.notReadyTitle')}
            description={
              currentDocumentInfo?.document.errorMessage ?? t('slides.notReadyBody')
            }
          />
        ) : loadingSlide || !content ? (
          <LoadingState label={t('common.loading')} />
        ) : (
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="min-w-0 space-y-4">
              <SlideViewer content={content} />
              <div className="flex items-center justify-between gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => previousSlide !== undefined && goToSlide(previousSlide)}
                  disabled={previousSlide === undefined}
                >
                  <ChevronLeft className="h-4 w-4" />
                  {t('slides.prev')}
                </Button>
                <Badge variant="outline" className="data-num font-mono">
                  {t('slides.position', {
                    current: validSlideNumber,
                    total: index?.slideTotal ?? content.slideTotal,
                  })}
                </Badge>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => nextSlide !== undefined && goToSlide(nextSlide)}
                  disabled={nextSlide === undefined}
                >
                  {t('slides.next')}
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <section className="min-w-0 space-y-4">
              {error && (
                <Card className="border-destructive/40 bg-destructive/5">
                  <CardContent className="flex items-start gap-2 p-3 text-sm text-destructive">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                    <span>{error}</span>
                  </CardContent>
                </Card>
              )}

              {!lesson || lesson.status !== 'ready' ? (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <BookOpen className="h-4 w-4 text-muted-foreground" aria-hidden />
                      {t('slides.lessonLabel')}
                    </CardTitle>
                    <CardDescription>
                      {lesson?.status === 'failed'
                        ? lesson.errorMessage ?? t('slides.failedBody')
                        : t('slides.generateHint')}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Button onClick={() => void generate(lesson?.status === 'failed')} disabled={busy}>
                      {busy ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : lesson?.status === 'failed' ? (
                        <RefreshCw className="h-4 w-4" />
                      ) : (
                        <Sparkles className="h-4 w-4" />
                      )}
                      {lesson?.status === 'failed' ? t('slides.retry') : t('slides.explain')}
                    </Button>
                  </CardContent>
                </Card>
              ) : (
                <>
                  <Card>
                    <CardHeader className="flex-row items-start justify-between gap-2 space-y-0">
                      <CardTitle className="text-base">{t('slides.lessonLabel')}</CardTitle>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void generate(true)}
                        disabled={busy}
                        className="shrink-0"
                      >
                        {busy ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <RefreshCw className="h-4 w-4" />
                        )}
                        {t('slides.regenerate')}
                      </Button>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <RichText
                        text={lesson.content ?? ''}
                        format="markdown"
                        paragraphClassName="text-[15px] leading-relaxed"
                      />
                      <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
                        <p className="text-xs font-medium text-muted-foreground mb-1">{t('slides.guidingQuestion')}</p>
                        <RichText
                          text={lesson.question ?? ''}
                          format="markdown"
                          paragraphClassName="text-[15px] leading-relaxed"
                        />
                      </div>
                      {lesson.sourceRefs[0] && (
                        <SourceQuote
                          documentName={lesson.sourceRefs[0].documentName}
                          location={t('slides.position', {
                            current: lesson.slideNumber,
                            total: lesson.slideTotal,
                          })}
                          quote={lesson.sourceRefs[0].quote ?? ''}
                          documentHref={`/projects/${projectId}/documents/${lesson.documentId}`}
                        />
                      )}
                    </CardContent>
                  </Card>

                  {lesson.symbols.length > 0 && <TutorSymbolsPanel symbols={lesson.symbols} />}

                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-base">
                        <MessageCircle className="h-4 w-4 text-muted-foreground" aria-hidden />
                        {t('slides.askTitle')}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {lesson.messages.length > 0 && (
                        <ul className="space-y-2">
                          {lesson.messages.map((message) => (
                            <li
                              key={message.id}
                              className={cn(
                                'max-w-[85%] rounded-xl px-3 py-2 text-sm leading-relaxed',
                                message.role === 'student'
                                  ? 'ml-auto bg-primary-strong text-primary-foreground'
                                  : 'bg-muted/50 text-foreground',
                              )}
                            >
                              <span className="sr-only">
                                {message.role === 'student' ? t('slides.you') : t('slides.tutor')}:{' '}
                              </span>
                              {message.content}
                            </li>
                          ))}
                        </ul>
                      )}
                      <div className="flex items-end gap-2">
                        <Textarea
                          value={askText}
                          onChange={(event) => setAskText(event.target.value)}
                          placeholder={t('slides.askPlaceholder')}
                          rows={2}
                          aria-label={t('slides.askTitle')}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' && !event.shiftKey) {
                              event.preventDefault()
                              void ask()
                            }
                          }}
                        />
                        <Button onClick={() => void ask()} disabled={busy || !askText.trim()}>
                          {busy ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Send className="h-4 w-4" />
                          )}
                          {t('slides.send')}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                </>
              )}
            </section>
          </div>
        )}
      </PageContent>
    </PageContainer>
  )
}
