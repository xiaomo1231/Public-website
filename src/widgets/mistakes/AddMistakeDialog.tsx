import { useState } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/Dialog'
import { Input } from '@/shared/ui/Input'
import { Label } from '@/shared/ui/Label'
import { Textarea } from '@/shared/ui/Textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/ui/Select2'
import type { DifficultyLevel } from '@/infrastructure/ai/prompts/types'
import { MISTAKE_TYPES, MISTAKE_TYPE_LABELS, type MistakeType } from '@/entities/mistake/types'
import { toast } from '@/features/toast/toastStore'
import { isAppError } from '@/infrastructure/errors/AppError'

export interface AddMistakeDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (input: {
    question: string
    studentAnswer: string
    correctAnswer: string
    knowledgePoint: string
    difficulty: DifficultyLevel
    mistakeType?: MistakeType
  }) => Promise<void>
}

const DIFFICULTIES: DifficultyLevel[] = ['beginner', 'basic', 'intermediate', 'advanced', 'challenge']

export function AddMistakeDialog({ open, onOpenChange, onSubmit }: AddMistakeDialogProps): JSX.Element {
  const [question, setQuestion] = useState('')
  const [studentAnswer, setStudentAnswer] = useState('')
  const [correctAnswer, setCorrectAnswer] = useState('')
  const [knowledgePoint, setKnowledgePoint] = useState('')
  const [difficulty, setDifficulty] = useState<DifficultyLevel>('basic')
  const [mistakeType, setMistakeType] = useState<MistakeType>('unknown')
  const [busy, setBusy] = useState(false)

  function reset() {
    setQuestion('')
    setStudentAnswer('')
    setCorrectAnswer('')
    setKnowledgePoint('')
    setDifficulty('basic')
    setMistakeType('unknown')
  }

  async function submit() {
    setBusy(true)
    try {
      await onSubmit({ question, studentAnswer, correctAnswer, knowledgePoint, difficulty, mistakeType })
      reset()
      onOpenChange(false)
      toast({ variant: 'success', title: 'Mistake added' })
    } catch (err) {
      const msg = isAppError(err) ? err.message : (err as Error).message
      toast({ variant: 'error', title: 'Could not add mistake', description: msg })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset()
        onOpenChange(o)
      }}
    >
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Add a mistake</DialogTitle>
          <DialogDescription>
            Record a mistake from a textbook, lecture, or your own practice.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="m-question">Question</Label>
            <Textarea
              id="m-question"
              rows={3}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="What was the question?"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="m-student">Your answer</Label>
              <Input id="m-student" value={studentAnswer} onChange={(e) => setStudentAnswer(e.target.value)} placeholder="What you wrote" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="m-correct">Correct answer</Label>
              <Input id="m-correct" value={correctAnswer} onChange={(e) => setCorrectAnswer(e.target.value)} placeholder="The right answer" />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="m-kp">Knowledge point</Label>
              <Input id="m-kp" value={knowledgePoint} onChange={(e) => setKnowledgePoint(e.target.value)} placeholder="e.g. Chain Rule" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="m-difficulty">Difficulty</Label>
              <Select value={difficulty} onValueChange={(v) => setDifficulty(v as DifficultyLevel)}>
                <SelectTrigger id="m-difficulty">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DIFFICULTIES.map((d) => (
                    <SelectItem key={d} value={d}>
                      {d}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="m-type">Category (optional)</Label>
              <Select value={mistakeType} onValueChange={(v) => setMistakeType(v as MistakeType)}>
                <SelectTrigger id="m-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MISTAKE_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {MISTAKE_TYPE_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy || !question.trim() || !correctAnswer.trim() || !knowledgePoint.trim()}>
            <Plus className="h-4 w-4" />
            {busy ? 'Adding…' : 'Add mistake'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}