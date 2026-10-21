import { useEffect, useRef } from 'react'
import { optionLetter, type Question } from '@/entities/question/types'

/** Option lists of up to six rows can be answered from the keyboard (A–F / 1–6). */
export const MAX_KEYBOARD_OPTIONS = 6

/** Question types whose options are picked with A–F / 1–6. */
export function isKeyboardChoice(question: Question): boolean {
  const count = question.options?.length ?? 0
  return (
    (question.type === 'multiple_choice' || question.type === 'multiple_select') &&
    count > 0 &&
    count <= MAX_KEYBOARD_OPTIONS
  )
}

/** The last option letter the keyboard reaches ("D" for four options). */
export function lastKeyboardLetter(question: Question): string {
  return optionLetter(Math.min(question.options?.length ?? 1, MAX_KEYBOARD_OPTIONS) - 1)
}

/** Toggle one option of a multi-select answer, keeping option order. */
export function toggleOptionValue(question: Question, value: string, id: string): string {
  const options = question.options ?? []
  const chosen = new Set(value.split(',').filter(Boolean))
  if (chosen.has(id)) chosen.delete(id)
  else chosen.add(id)
  return options
    .filter((o) => chosen.has(o.id))
    .map((o) => o.id)
    .join(',')
}

/** Which option a key picks (A–F or 1–6), or -1. */
export function optionIndexForKey(key: string, count: number): number {
  const limit = Math.min(count, MAX_KEYBOARD_OPTIONS)
  let index = -1
  if (/^[a-f]$/i.test(key)) index = key.toLowerCase().charCodeAt(0) - 97
  else if (/^[1-6]$/.test(key)) index = Number(key) - 1
  return index >= 0 && index < limit ? index : -1
}

function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  if (target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]'))
    return true
  return target instanceof HTMLElement && target.isContentEditable
}

/** A control whose own Enter means something else (except the option rows). */
function ownsEnter(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  if (target.closest('[data-quiz-option]')) return false
  return Boolean(
    target.closest(
      'button, a[href], summary, [role="button"], [role="checkbox"], [role="radio"], [role="tab"], [role="menuitem"], [role="option"], [role="slider"]',
    ),
  )
}

export interface QuizKeyboardOptions {
  question: Question
  value: string
  onChange: (value: string) => void
  /** Called on Enter; it decides itself whether a submit is possible. */
  onSubmit: () => void
  /** Off while grading or after the answer is graded. */
  enabled: boolean
}

/**
 * A–F / 1–6 pick an option (multi-select toggles), Enter submits. Never while
 * focus is in a text field, a modifier is held, an IME is composing or a dialog
 * has focus; Enter on another button keeps that button's own meaning.
 */
export function useQuizKeyboard(options: QuizKeyboardOptions): void {
  const latest = useRef(options)
  latest.current = options

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const { question, value, onChange, onSubmit, enabled } = latest.current
      if (!enabled || event.defaultPrevented || event.isComposing) return
      if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return
      const target = event.target
      if (isTextEntry(target)) return
      if (target instanceof Element && target.closest('[role="dialog"], [role="alertdialog"]'))
        return

      if (event.key === 'Enter') {
        if (ownsEnter(target)) return
        event.preventDefault()
        onSubmit()
        return
      }
      if (event.repeat || !isKeyboardChoice(question)) return
      const index = optionIndexForKey(event.key, question.options!.length)
      if (index === -1) return
      const option = question.options![index]!
      event.preventDefault()
      onChange(
        question.type === 'multiple_select'
          ? toggleOptionValue(question, value, option.id)
          : option.id,
      )
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
