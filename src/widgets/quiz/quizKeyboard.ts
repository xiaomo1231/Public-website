import { useEffect, useRef } from 'react'
import { optionLetter, type Question } from '@/entities/question/types'
import {
  GERMAN_ARTICLES,
  decodeGenderAnswer,
  encodeGenderAnswer,
} from '@/entities/question/languageDrills'

/** Option lists of up to six rows can be answered from the keyboard (A–F / 1–6). */
export const MAX_KEYBOARD_OPTIONS = 6

/** Question types whose options are picked from the keyboard (A–F / 1–6; articles 1–3). */
export function isKeyboardChoice(question: Question): boolean {
  if (question.type === 'article_gender') return Boolean(question.gender)
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

/** The keys shown in the keyboard hint: "1–3" for articles, "A–D" for four options. */
export function keyboardKeysLabel(question: Question): string {
  return question.type === 'article_gender' ? '1–3' : `A–${lastKeyboardLetter(question)}`
}

/**
 * The answer after pressing `key` on an article question (1 der, 2 die,
 * 3 das; the plural typed so far is kept), or null for any other key.
 */
export function articleForKey(key: string, value: string): string | null {
  if (!/^[1-3]$/.test(key)) return null
  return encodeGenderAnswer(GERMAN_ARTICLES[Number(key) - 1]!, decodeGenderAnswer(value).plural)
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

/** Open menus, listboxes, popovers and dialogs keep their own keys (typeahead, Enter). */
const OVERLAY_SELECTOR =
  '[role="menu"], [role="menubar"], [role="listbox"], [role="combobox"], [data-radix-popper-content-wrapper], [role="dialog"], [role="alertdialog"]'

function insideOverlay(node: EventTarget | Element | null): boolean {
  return node instanceof Element && Boolean(node.closest(OVERLAY_SELECTOR))
}

/** The option row the event came from, if any. */
function optionRow(target: EventTarget | null): Element | null {
  return target instanceof Element ? target.closest('[data-quiz-option]') : null
}

/** An option row that is already the chosen one (pressed / checked). */
function isChosenRow(row: Element): boolean {
  return row.getAttribute('aria-pressed') === 'true' || row.getAttribute('aria-checked') === 'true'
}

/** A control whose own Enter means something else. */
function ownsEnter(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
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
 * A–F / 1–6 pick an option (multi-select toggles; 1–3 pick der / die / das
 * on an article question), Enter submits. Never while
 * focus is in a text field, a modifier is held, an IME is composing or a menu,
 * listbox, popover or dialog has focus. Enter / Space on a focused option row
 * select it like any button; Enter submits from an already-chosen row or when
 * focus is not on a button.
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
      if (insideOverlay(target) || insideOverlay(document.activeElement)) return

      if (event.key === 'Enter') {
        // A held-down Enter must not submit (or skip past) the next question.
        if (event.repeat) return
        const row = optionRow(target)
        // Enter on an option picks it (native button click); only on the
        // already-chosen option does it submit.
        if (row ? !isChosenRow(row) : ownsEnter(target)) return
        event.preventDefault()
        onSubmit()
        return
      }
      if (event.repeat || !isKeyboardChoice(question)) return
      if (question.type === 'article_gender') {
        const next = articleForKey(event.key, value)
        if (next === null) return
        event.preventDefault()
        onChange(next)
        return
      }
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
