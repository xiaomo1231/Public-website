import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import {
  GenerationPausedError,
  createGenerationRun,
  isAbortError,
  isGenerationInterruption,
  resolveControl,
} from '@/shared/lib/generationControl'
import { AbortedError } from '@/infrastructure/ai/errors'
import { GenerationControls } from '@/shared/ui/GenerationControls'
import { setUILanguage } from '@/i18n'

describe('createGenerationRun', () => {
  it('runs until a pause is requested, then reports paused', () => {
    const run = createGenerationRun()
    const states: string[] = []
    run.onStateChange((state) => states.push(state))
    expect(run.state).toBe('running')
    expect(run.shouldContinue()).toBe(true)
    run.requestPause()
    expect(run.shouldContinue()).toBe(false)
    // A pause lets the requests in flight finish: the signal is not aborted.
    expect(run.signal.aborted).toBe(false)
    expect(run.state).toBe('pausing')
    expect(run.finish()).toBe('paused')
    expect(states).toEqual(['pausing', 'paused'])
  })

  it('stopNow aborts the signal and ends as stopped', () => {
    const run = createGenerationRun()
    run.stopNow()
    expect(run.signal.aborted).toBe(true)
    expect(run.shouldContinue()).toBe(false)
    expect(run.finish()).toBe('stopped')
  })

  it('a stop after a pause still aborts', () => {
    const run = createGenerationRun()
    run.requestPause()
    run.stopNow()
    expect(run.signal.aborted).toBe(true)
    expect(run.finish()).toBe('stopped')
  })

  it('an uninterrupted run finishes as done and ignores later requests', () => {
    const run = createGenerationRun()
    expect(run.finish()).toBe('done')
    run.requestPause()
    run.stopNow()
    expect(run.state).toBe('done')
    expect(run.signal.aborted).toBe(false)
  })

  it('unsubscribes listeners', () => {
    const run = createGenerationRun()
    const listener = vi.fn()
    const off = run.onStateChange(listener)
    off()
    run.requestPause()
    expect(listener).not.toHaveBeenCalled()
  })
})

describe('helpers', () => {
  it('recognises aborts and pauses', () => {
    expect(isAbortError(new AbortedError())).toBe(true)
    expect(isAbortError(new DOMException('x', 'AbortError'))).toBe(true)
    expect(isAbortError(new Error('boom'))).toBe(false)
    const run = createGenerationRun()
    run.stopNow()
    expect(isAbortError(new Error('network'), run.signal)).toBe(true)
    expect(isGenerationInterruption(new GenerationPausedError())).toBe(true)
  })

  it('wraps a bare signal into a control', () => {
    const controller = new AbortController()
    const control = resolveControl(undefined, controller.signal)
    expect(control.shouldContinue()).toBe(true)
    controller.abort()
    expect(control.shouldContinue()).toBe(false)
    expect(resolveControl().shouldContinue()).toBe(true)
  })
})

describe('GenerationControls', () => {
  it('offers pause and stop while running, continue once paused', () => {
    setUILanguage('zh-CN')
    const onPause = vi.fn()
    const onStopNow = vi.fn()
    const onResume = vi.fn()
    const { rerender } = render(
      <GenerationControls
        kind="parts"
        state="running"
        onPause={onPause}
        onStopNow={onStopNow}
        onResume={onResume}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '暂停' }))
    fireEvent.click(screen.getByRole('button', { name: '立即停止' }))
    expect(onPause).toHaveBeenCalledTimes(1)
    expect(onStopNow).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: '继续' })).toBeNull()

    rerender(
      <GenerationControls
        kind="parts"
        state="pausing"
        onPause={onPause}
        onStopNow={onStopNow}
        onResume={onResume}
      />,
    )
    expect(screen.getByRole('status').textContent).toContain('正在完成当前部分')

    rerender(
      <GenerationControls
        kind="parts"
        state="paused"
        done={2}
        total={5}
        onPause={onPause}
        onStopNow={onStopNow}
        onResume={onResume}
      />,
    )
    expect(screen.getByRole('status').textContent).toBe('已暂停（已完成 2 / 5）')
    fireEvent.click(screen.getByRole('button', { name: '继续' }))
    expect(onResume).toHaveBeenCalledTimes(1)
  })

  it('a single request only offers stop', () => {
    setUILanguage('zh-CN')
    const onStopNow = vi.fn()
    render(<GenerationControls kind="single" state="running" onStopNow={onStopNow} />)
    expect(screen.queryByRole('button', { name: '暂停' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '停止' }))
    expect(onStopNow).toHaveBeenCalledTimes(1)
  })

  it('renders nothing when idle or done', () => {
    const { container, rerender } = render(<GenerationControls kind="parts" state={null} />)
    expect(container.innerHTML).toBe('')
    rerender(<GenerationControls kind="parts" state="done" />)
    expect(container.innerHTML).toBe('')
  })
})
