import { useState } from 'react'
import { AlertCircle, ArrowRight, BookOpen, Lightbulb, Sparkles } from 'lucide-react'
import type { MistakeAnalysis } from '@/entities/mistake/types'
import { MISTAKE_TYPE_LABELS } from '@/entities/mistake/types'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { cn } from '@/shared/lib/utils'

export interface MistakeAnalysisViewProps {
  analysis: MistakeAnalysis
  onPractice?: () => void
}

interface Step {
  key: string
  label: string
  content: string
  tone?: 'neutral' | 'warn' | 'good'
}

/**
 * Reveals the analysis one step at a time so the student is never flooded
 * with text. Each step is a short card; "Next step" advances.
 */
export function MistakeAnalysisView({ analysis, onPractice }: MistakeAnalysisViewProps): JSX.Element {
  const steps: Step[] = [
    { key: 'where', label: 'Where it first diverges', content: analysis.whereWrong },
    { key: 'first', label: 'The key error', content: analysis.firstError, tone: 'warn' },
    { key: 'why', label: 'Why that step does not hold', content: analysis.whyWrong },
    { key: 'correct', label: 'Correct approach', content: analysis.correctApproach, tone: 'good' },
    { key: 'cause', label: 'Possible cause', content: analysis.possibleCause },
  ]

  const [revealed, setRevealed] = useState(1)
  const done = revealed >= steps.length

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{MISTAKE_TYPE_LABELS[analysis.mistakeType]}</Badge>
        {analysis.reviewKnowledgePoints.map((kp) => (
          <Badge key={kp} variant="secondary">
            {kp}
          </Badge>
        ))}
        <span className="ml-auto text-xs text-muted-foreground">
          Step {Math.min(revealed, steps.length)} / {steps.length}
        </span>
      </div>

      <ol className="space-y-2">
        {steps.slice(0, revealed).map((step, i) => (
          <li
            key={step.key}
            className={cn(
              'rounded-md border p-3 text-sm',
              step.tone === 'warn' && 'border-amber-500/40 bg-amber-50/40 dark:bg-amber-950/20',
              step.tone === 'good' && 'border-emerald-500/40 bg-emerald-50/40 dark:bg-emerald-950/20',
            )}
          >
            <div className="mb-1 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <span className="grid h-5 w-5 place-items-center rounded-full bg-muted text-[10px] text-foreground">
                {i + 1}
              </span>
              {step.label}
            </div>
            <p className="whitespace-pre-wrap">{step.content}</p>
          </li>
        ))}
      </ol>

      {!done ? (
        <Button variant="outline" onClick={() => setRevealed((r) => r + 1)}>
          Next step
          <ArrowRight className="h-4 w-4" />
        </Button>
      ) : (
        <div className="space-y-3">
          {analysis.similarExample && (
            <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-sm">
              <div className="mb-1 flex items-center gap-2 font-medium">
                <Lightbulb className="h-4 w-4" />
                Try a similar one
              </div>
              <p>{analysis.similarExample.prompt}</p>
              <details className="mt-1 text-xs text-muted-foreground">
                <summary className="cursor-pointer">Show answer</summary>
                <p className="mt-1 font-mono">{analysis.similarExample.answer}</p>
                {analysis.similarExample.explanation && <p className="mt-1">{analysis.similarExample.explanation}</p>}
              </details>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 p-3 text-sm">
            <Sparkles className="h-4 w-4 text-muted-foreground" />
            <span>{analysis.continuePrompt}</span>
            {onPractice && (
              <Button size="sm" className="ml-auto" onClick={onPractice}>
                Practice now
              </Button>
            )}
          </div>

          {!analysis.shouldPracticeMore && (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <AlertCircle className="h-3.5 w-3.5" />
              The analysis suggests more practice is optional for this one.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

export function AnalysisPlaceholder({ message }: { message: string }): JSX.Element {
  return (
    <div className="flex items-start gap-2 rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
      <BookOpen className="mt-0.5 h-4 w-4" />
      <span>{message}</span>
    </div>
  )
}