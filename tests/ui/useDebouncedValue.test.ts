import { describe, expect, it } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useDebouncedValue } from '@/shared/lib/useDebouncedValue'

describe('useDebouncedValue', () => {
  it('returns the initial value immediately', () => {
    const { result } = renderHook(() => useDebouncedValue('a', 30))
    expect(result.current).toBe('a')
  })

  it('delays updates until the delay elapses', async () => {
    const { result, rerender } = renderHook(
      ({ value, delay }: { value: string; delay: number }) => useDebouncedValue(value, delay),
      { initialProps: { value: 'a', delay: 30 } },
    )

    rerender({ value: 'ab', delay: 30 })
    expect(result.current).toBe('a')

    await waitFor(() => expect(result.current).toBe('ab'))
  })

  it('only emits the final value for rapid changes', async () => {
    const { result, rerender } = renderHook(
      ({ value }: { value: string }) => useDebouncedValue(value, 30),
      { initialProps: { value: '' } },
    )

    for (const value of ['q', 'qu', 'qui', 'quiz']) {
      rerender({ value })
    }
    await waitFor(() => expect(result.current).toBe('quiz'))
    expect(result.current).toBe('quiz')
  })

  it('updates immediately when the delay is zero', () => {
    const { result, rerender } = renderHook(
      ({ value, delay }: { value: string; delay: number }) => useDebouncedValue(value, delay),
      { initialProps: { value: 'quiz', delay: 30 } },
    )

    rerender({ value: '', delay: 0 })
    expect(result.current).toBe('')
  })

  it('clears the pending timer on unmount without updating state', async () => {
    const { result, rerender, unmount } = renderHook(
      ({ value }: { value: string }) => useDebouncedValue(value, 30),
      { initialProps: { value: 'a' } },
    )
    rerender({ value: 'b' })
    unmount()
    // No assertion beyond "does not throw / warn"; give the timer a chance to fire.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 40))
    })
    expect(result.current).toBe('a')
  })
})
