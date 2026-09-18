import { useState } from 'react'
import {
  Archive,
  ArchiveRestore,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Loader2,
  Sparkles,
  Trash2,
} from 'lucide-react'
import type { Mistake } from '@/entities/mistake/types'
import { MISTAKE_TYPE_LABELS } from '@/entities/mistake/types'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Card, CardContent, CardHeader } from '@/shared/ui/Card'
import { MistakeAnalysisView, AnalysisPlaceholder } from './MistakeAnalysisView'
import { PracticeMoreMenu } from './PracticeMoreMenu'
import { relativeTime } from '@/shared/lib/utils'
import { cn } from '@/shared/lib/utils'

export interface MistakeCardProps {
  mistake: Mistake
  onAnalyze: (id: string) => Promise<void>
  onMarkUnderstood: (id: string) => Promise<void>
  onArchive: (id: string) => Promise<void>
  onRestore: (id: string) => Promise<void>
  onRemove: (id: string) => Promise<void>
  onPractice: (id: string, mode: 'same_concept' | 'similar' | 'easier' | 'harder' | 'weakness') => Promise<void>
}

export function MistakeCard({
  mistake,
  onAnalyze,
  onMarkUnderstood,
  onArchive,
  onRestore,
  onRemove,
  onPractice,
}: MistakeCardProps): JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key)
    try {
      await fn()
    } finally {
      setBusy(null)
    }
  }

  const statusTone =
    mistake.status === 'understood'
      ? 'border-emerald-500/40'
      : mistake.status === 'archived'
        ? 'border-muted'
        : 'border-l-4 border-l-amber-500/60'

  return (
    <Card className={cn(statusTone)}>
      <CardHeader className="flex flex-row flex-wrap items-start gap-2 space-y-0 py-3">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{MISTAKE_TYPE_LABELS[mistake.mistakeType]}</Badge>
            <Badge variant="outline">{mistake.knowledgePoint}</Badge>
            <Badge variant="outline">{mistake.difficulty}</Badge>
            {mistake.status === 'understood' && (
              <Badge variant="default">
                <CheckCircle2 className="mr-1 h-3 w-3" /> Understood
              </Badge>
            )}
            {mistake.status === 'archived' && <Badge variant="secondary">Archived</Badge>}
            {mistake.source === 'manual' && <Badge variant="secondary">Added by you</Badge>}
            {mistake.attemptCount > 1 && <Badge variant="secondary">×{mistake.attemptCount} attempts</Badge>}
          </div>
          <p className="line-clamp-2 text-sm font-medium">{mistake.question}</p>
          <p className="text-xs text-muted-foreground">
            Your answer: <span className="font-mono">{mistake.studentAnswer || '(blank)'}</span> · Correct:{' '}
            <span className="font-mono">{mistake.correctAnswer}</span>
          </p>
        </div>
        <span className="text-xs text-muted-foreground">{relativeTime(mistake.createdAt)}</span>
        <Button variant="ghost" size="icon" aria-label="Expand" onClick={() => setExpanded((e) => !e)}>
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </Button>
      </CardHeader>

      {expanded && (
        <CardContent className="space-y-3 pt-0">
          {mistake.analysis ? (
            <MistakeAnalysisView analysis={mistake.analysis} onPractice={() => run('practice', () => onPractice(mistake.id, 'same_concept'))} />
          ) : mistake.analysisStatus === 'analyzing' ? (
            <AnalysisPlaceholder message="Analysing your answer…" />
          ) : mistake.analysisStatus === 'failed' ? (
            <div className="space-y-2">
              <AnalysisPlaceholder message={mistake.analysisError ?? 'Analysis failed. You can try again.'} />
              <Button variant="outline" size="sm" onClick={() => run('analyze', () => onAnalyze(mistake.id))} disabled={busy === 'analyze'}>
                {busy === 'analyze' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                Retry analysis
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <AnalysisPlaceholder message="Run the AI analysis to see where it went wrong, why, and a similar example." />
              <Button size="sm" onClick={() => run('analyze', () => onAnalyze(mistake.id))} disabled={busy === 'analyze'}>
                {busy === 'analyze' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                Explain my mistake
              </Button>
            </div>
          )}

          <PracticeMoreMenu onSelect={(mode) => run(`practice-${mode}`, () => onPractice(mistake.id, mode))} busy={busy?.startsWith('practice') ?? false} />

          <div className="flex flex-wrap items-center gap-2 border-t pt-3">
            {mistake.status === 'active' && (
              <Button variant="outline" size="sm" onClick={() => run('understood', () => onMarkUnderstood(mistake.id))} disabled={busy === 'understood'}>
                <CheckCircle2 className="h-4 w-4" />
                Mark as understood
              </Button>
            )}
            {mistake.status !== 'archived' ? (
              <Button variant="outline" size="sm" onClick={() => run('archive', () => onArchive(mistake.id))} disabled={busy === 'archive'}>
                <Archive className="h-4 w-4" />
                Archive
              </Button>
            ) : (
              <Button variant="outline" size="sm" onClick={() => run('restore', () => onRestore(mistake.id))} disabled={busy === 'restore'}>
                <ArchiveRestore className="h-4 w-4" />
                Restore
              </Button>
            )}
            {confirmDelete ? (
              <div className="ml-auto flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Remove permanently?</span>
                <Button variant="destructive" size="sm" onClick={() => run('remove', () => onRemove(mistake.id))} disabled={busy === 'remove'}>
                  Confirm
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
                  Cancel
                </Button>
              </div>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto text-destructive hover:text-destructive"
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 className="h-4 w-4" />
                Remove
              </Button>
            )}
          </div>
        </CardContent>
      )}
    </Card>
  )
}