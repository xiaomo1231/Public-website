import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, BookX, Filter, Loader2, Plus, Search, Sparkles } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { Card, CardContent } from '@/shared/ui/Card'
import { Badge } from '@/shared/ui/Badge'
import { EmptyState } from '@/shared/ui/EmptyState'
import { Input } from '@/shared/ui/Input'
import { LoadingState } from '@/shared/ui/LoadingState'
import { PageContainer, PageContent, PageHeader } from '@/shared/ui/Page'
import { ProgressiveList } from '@/shared/ui/ProgressiveList'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/ui/Select2'
import { MistakeCard } from '@/widgets/mistakes/MistakeCard'
import { AddMistakeDialog } from '@/widgets/mistakes/AddMistakeDialog'
import { WeaknessPanel } from '@/widgets/mistakes/WeaknessPanel'
import { buildAIServices } from '@/services/aiServices'
import { MistakeService } from '@/services/mistakeService'
import type { Mistake, MistakeStats, MistakeStatus, MistakeType } from '@/entities/mistake/types'
import { MISTAKE_TYPES, MISTAKE_TYPE_LABEL_KEYS } from '@/entities/mistake/types'
import type { DifficultyLevel } from '@/infrastructure/ai/prompts/types'
import { toast } from '@/features/toast/toastStore'
import { friendlyAIError } from '@/shared/lib/aiErrors'
import { SEARCH_DEBOUNCE_MS, useDebouncedValue } from '@/shared/lib/useDebouncedValue'
import { useTranslation } from '@/i18n'

export function MistakeBookPage(): JSX.Element {
  const { id: projectId } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const mistakes = useMemo(() => new MistakeService(), [])
  const { t } = useTranslation()

  const [rows, setRows] = useState<Mistake[]>([])
  const [stats, setStats] = useState<MistakeStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState<MistakeStatus | 'all'>('active')
  const [mistakeType, setMistakeType] = useState<MistakeType | 'all'>('all')
  const [query, setQuery] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const [reviewBusy, setReviewBusy] = useState(false)

  // Clearing the box applies immediately; typing is debounced.
  const debouncedQuery = useDebouncedValue(
    query,
    query.trim() === '' ? 0 : SEARCH_DEBOUNCE_MS,
  )

  // Guards against out-of-order responses and unmount updates.
  const requestSeq = useRef(0)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  /**
   * Rows depend on the filters + debounced query. Stats do not — they are
   * loaded separately so typing does not trigger an extra full scan.
   */
  const loadRows = useCallback(async () => {
    if (!projectId) return
    const seq = ++requestSeq.current
    const list = await mistakes.list(projectId, {
      status,
      ...(mistakeType !== 'all' ? { mistakeType } : {}),
      ...(debouncedQuery.trim() ? { query: debouncedQuery.trim() } : {}),
    })
    if (!alive.current || seq !== requestSeq.current) return
    setRows(list)
  }, [projectId, mistakes, status, mistakeType, debouncedQuery])

  const loadStats = useCallback(async () => {
    if (!projectId) return
    const s = await mistakes.stats(projectId)
    if (!alive.current) return
    setStats(s)
  }, [projectId, mistakes])

  const reloadAll = useCallback(async () => {
    await Promise.all([loadRows(), loadStats()])
  }, [loadRows, loadStats])

  useEffect(() => {
    if (!projectId) return
    void loadStats()
  }, [projectId, loadStats])

  useEffect(() => {
    if (!projectId) return
    void loadRows().finally(() => {
      if (alive.current) setLoading(false)
    })
  }, [projectId, loadRows])

  async function handleAnalyze(id: string) {
    const bundle = await buildAIServices()
    if (!bundle) {
      toast({ variant: 'error', title: t('mistakes.noProvider') })
      return
    }
    try {
      await bundle.mistakeAnalysis.analyze(id)
      await reloadAll()
      toast({ variant: 'success', title: t('mistakes.analysisReady') })
    } catch (err) {
      const msg = friendlyAIError(err)
      toast({ variant: 'error', title: t('mistakes.analysisFailed'), description: msg })
      await reloadAll()
    }
  }

  async function handleMarkUnderstood(id: string) {
    await mistakes.markUnderstood(id)
    await reloadAll()
  }
  async function handleArchive(id: string) {
    await mistakes.archive(id)
    await reloadAll()
  }
  async function handleRestore(id: string) {
    await mistakes.restore(id)
    await reloadAll()
  }
  async function handleRemove(id: string) {
    await mistakes.remove(id)
    await reloadAll()
    toast({ variant: 'success', title: t('mistakes.removed') })
  }

  async function handlePractice(id: string, mode: 'same_concept' | 'similar' | 'easier' | 'harder' | 'weakness') {
    if (!projectId) return
    const bundle = await buildAIServices()
    if (!bundle) {
      toast({ variant: 'error', title: t('mistakes.noProvider') })
      return
    }
    try {
      const session = await bundle.reviewSession.practiceMistake(id, mode)
      await bundle.quiz.startQuiz(session.id)
      toast({ variant: 'success', title: t('mistakes.practiceReady') })
      navigate(`/projects/${projectId}/quiz/${session.id}`)
    } catch (err) {
      const msg = friendlyAIError(err)
      toast({ variant: 'error', title: t('mistakes.practiceFailed'), description: msg })
    }
  }

  async function handleReviewSession() {
    if (!projectId) return
    const bundle = await buildAIServices()
    if (!bundle) {
      toast({ variant: 'error', title: t('mistakes.noProvider') })
      return
    }
    setReviewBusy(true)
    try {
      const session = await bundle.reviewSession.createReviewSession(projectId, { count: 10, difficulty: 'adaptive' })
      await bundle.quiz.startQuiz(session.id)
      toast({ variant: 'success', title: t('mistakes.reviewReady') })
      navigate(`/projects/${projectId}/quiz/${session.id}`)
    } catch (err) {
      const msg = friendlyAIError(err)
      toast({ variant: 'error', title: t('mistakes.reviewFailed'), description: msg })
    } finally {
      setReviewBusy(false)
    }
  }

  async function handleAdd(input: {
    question: string
    studentAnswer: string
    correctAnswer: string
    knowledgePoint: string
    difficulty: DifficultyLevel
    mistakeType?: MistakeType
  }) {
    if (!projectId) return
    await mistakes.addManual({ ...input, projectId })
    await reloadAll()
  }

  if (!projectId) return <div />

  return (
    <PageContainer>
      <PageHeader
        title={
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="icon" aria-label={t('mistakes.backToProject')}>
              <Link to={`/projects/${projectId}`}>
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <BookX className="h-4 w-4" />
            {t('mistakes.title')}
          </div>
        }
        description={t('mistakes.subtitle')}
        actions={
          <>
            <Button variant="outline" onClick={() => setAddOpen(true)}>
              <Plus className="h-4 w-4" />
              {t('mistakes.addManually')}
            </Button>
            <Button onClick={handleReviewSession} disabled={reviewBusy || !stats || stats.active === 0}>
              {reviewBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {t('mistakes.reviewRecent')}
            </Button>
          </>
        }
      />
      <PageContent className="space-y-6">
        {stats && stats.total > 0 && (
          <Card>
            <CardContent className="flex flex-wrap items-center gap-4 p-4 text-sm">
              <span className="text-muted-foreground">
                {t('mistakes.summary', {
                  active: stats.active,
                  understood: stats.understood,
                  archived: stats.archived,
                  total: stats.total,
                })}
              </span>
              <div className="ml-auto flex flex-wrap gap-1">
                {MISTAKE_TYPES.filter((type) => stats.byType[type] > 0).map((type) => (
                  <Badge key={type} variant="outline">
                    {t(MISTAKE_TYPE_LABEL_KEYS[type])}: {stats.byType[type]}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        <WeaknessPanel projectId={projectId} onReview={handleReviewSession} />

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('mistakes.searchPlaceholder')}
              className="pl-9"
            />
          </div>
          <Select value={status} onValueChange={(v) => setStatus(v as MistakeStatus | 'all')}>
            <SelectTrigger className="w-[150px]">
              <Filter className="h-4 w-4" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">{t('mistakes.filter.active')}</SelectItem>
              <SelectItem value="understood">{t('mistakes.filter.understood')}</SelectItem>
              <SelectItem value="archived">{t('mistakes.filter.archived')}</SelectItem>
              <SelectItem value="all">{t('mistakes.filter.all')}</SelectItem>
            </SelectContent>
          </Select>
          <Select value={mistakeType} onValueChange={(v) => setMistakeType(v as MistakeType | 'all')}>
            <SelectTrigger className="w-[170px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('mistakes.allCategories')}</SelectItem>
              {MISTAKE_TYPES.map((type) => (
                <SelectItem key={type} value={type}>
                  {t(MISTAKE_TYPE_LABEL_KEYS[type])}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {loading ? (
          <LoadingState label={t('mistakes.loading')} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<BookX className="h-10 w-10" />}
            title={stats && stats.total > 0 ? t('mistakes.emptyFiltered') : t('mistakes.empty')}
            description={
              stats && stats.total > 0 ? t('mistakes.emptyFilteredHint') : t('mistakes.emptyHint')
            }
            action={
              stats && stats.total > 0 ? undefined : (
                <Button onClick={() => setAddOpen(true)}>
                  <Plus className="h-4 w-4" />
                  {t('mistakes.addTitle')}
                </Button>
              )
            }
          />
        ) : (
          <ProgressiveList
            items={rows}
            pageSize={25}
            className="space-y-3"
            renderItem={(m) => (
              <MistakeCard
                key={m.id}
                mistake={m}
                onAnalyze={handleAnalyze}
                onMarkUnderstood={handleMarkUnderstood}
                onArchive={handleArchive}
                onRestore={handleRestore}
                onRemove={handleRemove}
                onPractice={handlePractice}
              />
            )}
          />
        )}
      </PageContent>

      <AddMistakeDialog open={addOpen} onOpenChange={setAddOpen} onSubmit={handleAdd} />
    </PageContainer>
  )
}