import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { KeyRound, Sparkles } from 'lucide-react'
import { useAuth } from '@/features/auth/useAuth'
import { Button } from '@/shared/ui/Button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/Card'
import { Input } from '@/shared/ui/Input'
import { Label } from '@/shared/ui/Label'
import { AuthError, isAppError } from '@/infrastructure/errors/AppError'
import { logger } from '@/infrastructure/logger/logger'
import { useTranslation } from '@/i18n'

const DEMO_CODES = ['WELCOME-LEARN', 'STUDENT-2026']

export function InvitePage(): JSX.Element {
  const { t } = useTranslation()
  const { unlock, isUnlocked, loaded, loading, error } = useAuth()
  const [code, setCode] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const navigate = useNavigate()

  useEffect(() => {
    if (loaded && isUnlocked) navigate('/dashboard', { replace: true })
  }, [loaded, isUnlocked, navigate])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLocalError(null)
    setSubmitting(true)
    try {
      await unlock(code)
      navigate('/dashboard', { replace: true })
    } catch (err) {
      if (err instanceof AuthError) {
        setLocalError(err.message)
      } else if (isAppError(err)) {
        setLocalError(err.message)
      } else {
        logger.error('Invite submit failed', undefined, err)
        setLocalError(t('invite.verifyFailed'))
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="grid min-h-screen place-items-center bg-background p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="mb-2 grid h-10 w-10 place-items-center rounded-md bg-primary text-primary-foreground">
            <Sparkles className="h-5 w-5" />
          </div>
          <CardTitle>{t('invite.title')}</CardTitle>
          <CardDescription>{t('invite.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="invite">{t('invite.label')}</Label>
              <div className="relative">
                <KeyRound className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="invite"
                  className="pl-9 font-mono uppercase tracking-wider"
                  placeholder="WELCOME-LEARN"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  autoFocus
                  autoComplete="off"
                  invalid={Boolean(localError || error)}
                  required
                />
              </div>
              {(localError || error) && (
                <p className="text-sm text-destructive">{localError ?? error}</p>
              )}
            </div>

            <Button type="submit" className="w-full" disabled={submitting || loading || !code.trim()}>
              {submitting ? t('invite.verifying') : t('invite.unlock')}
            </Button>

            <div className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
              <div className="mb-1 font-medium text-foreground">{t('invite.demoCodes')}</div>
              <div className="flex flex-wrap gap-1.5">
                {DEMO_CODES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCode(c)}
                    className="rounded border bg-background px-2 py-1 font-mono text-[11px] hover:bg-accent"
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}