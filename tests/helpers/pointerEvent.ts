/**
 * jsdom has no PointerEvent, so `fireEvent.pointerDown(el, { pointerType })`
 * would build a plain Event without `pointerType` / `pointerId` / `button`.
 * Touch tests install this minimal one for their own duration only (other
 * suites rely on the plain-Event behaviour).
 */
class TestPointerEvent extends MouseEvent {
  readonly pointerId: number
  readonly pointerType: string
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init)
    this.pointerId = init.pointerId ?? 1
    this.pointerType = init.pointerType ?? ''
  }
}

export function installPointerEvent(): () => void {
  const target = globalThis as { PointerEvent?: unknown }
  const previous = target.PointerEvent
  target.PointerEvent = TestPointerEvent
  return () => {
    target.PointerEvent = previous
  }
}
