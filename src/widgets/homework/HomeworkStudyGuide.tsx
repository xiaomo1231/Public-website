import { useState } from 'react'
import { ArrowRight, MessageCircle } from 'lucide-react'
import {
  LINEAR_ALGEBRA_METHODS,
  type LinearAlgebraMethod,
} from '@/entities/homework/linearAlgebraGuide'
import { Button } from '@/shared/ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/Card'
import { RichText } from '@/shared/ui/RichText'
import { useTranslation, type TranslationKey } from '@/i18n'

const STEPS = ['read', 'translate', 'match', 'solve', 'interpret', 'check'] as const
type StudyStep = (typeof STEPS)[number]

interface HomeworkStudyGuideProps {
  suggestedMethod: LinearAlgebraMethod
  solutionRevealed: boolean
  onAsk: (message: string) => void
  onWork: () => void
}

/** A student-controlled route through the six steps; no AI call occurs here. */
export function HomeworkStudyGuide({
  suggestedMethod,
  solutionRevealed,
  onAsk,
  onWork,
}: HomeworkStudyGuideProps): JSX.Element {
  const { t } = useTranslation()
  const [step, setStep] = useState<StudyStep>('read')
  const [method, setMethod] = useState<LinearAlgebraMethod | null>(null)
  const stepIndex = STEPS.indexOf(step)

  const titleKey = `homework.guide.step.${step}` as TranslationKey
  const bodyKey = `homework.guide.body.${step}` as TranslationKey
  const askKey = `homework.guide.ask.${step}` as TranslationKey

  return (
    <Card>
      <CardHeader className="space-y-2">
        <CardTitle className="text-base">{t('homework.guide.title')}</CardTitle>
        <p className="text-sm leading-relaxed text-muted-foreground">{t('homework.guide.intro')}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div role="group" aria-label={t('homework.guide.steps')} className="flex flex-wrap gap-2">
          {STEPS.map((item, index) => (
            <Button
              key={item}
              type="button"
              size="sm"
              variant={step === item ? 'default' : 'outline'}
              aria-pressed={step === item}
              onClick={() => setStep(item)}
            >
              {index + 1}. {t(`homework.guide.step.${item}` as TranslationKey)}
            </Button>
          ))}
        </div>

        <div className="space-y-3 border-t border-border/70 pt-4">
          <h4 className="text-sm font-semibold text-foreground">{t(titleKey)}</h4>
          <p className="text-sm leading-relaxed text-muted-foreground">{t(bodyKey)}</p>

          {step === 'match' && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">{t('homework.guide.methodCaution')}</p>
              <div
                role="group"
                aria-label={t('homework.guide.chooseMethod')}
                className="flex flex-wrap gap-2"
              >
                {LINEAR_ALGEBRA_METHODS.map((item) => (
                  <Button
                    key={item}
                    type="button"
                    size="sm"
                    variant={method === item ? 'default' : 'outline'}
                    aria-pressed={method === item}
                    onClick={() => setMethod(item)}
                  >
                    {t(`homework.guide.method.${item}` as TranslationKey)}
                    {item === suggestedMethod ? ` · ${t('homework.guide.suggested')}` : ''}
                  </Button>
                ))}
              </div>
              {method && (
                <div className="rounded-lg bg-muted/40 p-3">
                  <RichText
                    text={t(`homework.guide.template.${method}` as TranslationKey)}
                    format="markdown"
                    paragraphClassName="text-sm leading-relaxed"
                  />
                </div>
              )}
            </div>
          )}

          {step === 'check' && (
            <>
              <ul className="list-inside list-disc space-y-1 text-sm leading-relaxed text-foreground">
                <li>{t('homework.guide.checkQuestion')}</li>
                <li>{t('homework.guide.checkConditions')}</li>
                <li>{t('homework.guide.checkConclusion')}</li>
              </ul>
              {solutionRevealed && (
                <div className="rounded-lg bg-muted/40 p-3 text-sm leading-relaxed">
                  <strong className="font-semibold">{t('homework.guide.examTitle')}</strong>
                  <p className="mt-1 text-muted-foreground">{t('homework.guide.examOutline')}</p>
                </div>
              )}
            </>
          )}

          <div className="flex flex-wrap gap-2 pt-1">
            <Button type="button" variant="outline" size="sm" onClick={onWork}>
              {t('homework.guide.writeWorking')}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => onAsk(t(askKey))}>
              <MessageCircle className="h-4 w-4" aria-hidden />
              {t('homework.guide.askAI')}
            </Button>
            {stepIndex < STEPS.length - 1 && (
              <Button type="button" size="sm" onClick={() => setStep(STEPS[stepIndex + 1]!)}>
                {t('homework.guide.nextStep')}
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">{t('homework.guide.notGraded')}</p>
        </div>
      </CardContent>
    </Card>
  )
}
