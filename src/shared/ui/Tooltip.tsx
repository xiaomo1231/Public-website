import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import {
  forwardRef,
  useEffect,
  useState,
  type ComponentPropsWithoutRef,
  type ElementRef,
  type ReactNode,
} from 'react'
import { cn } from '@/shared/lib/utils'
import { useLongPress } from '@/shared/lib/useLongPress'

export const TooltipProvider = TooltipPrimitive.Provider
export const Tooltip = TooltipPrimitive.Root
export const TooltipTrigger = TooltipPrimitive.Trigger

export const TooltipContent = forwardRef<
  ElementRef<typeof TooltipPrimitive.Content>,
  ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        'z-50 origin-[--radix-tooltip-content-transform-origin] overflow-hidden rounded-lg bg-primary-strong px-2.5 py-1 text-xs text-primary-foreground shadow data-[state=closed]:animate-pop-out data-[state=delayed-open]:animate-pop-in',
        className,
      )}
      {...props}
    />
  </TooltipPrimitive.Portal>
))
TooltipContent.displayName = TooltipPrimitive.Content.displayName

export interface TooltipWrapperProps {
  content: ReactNode
  children: ReactNode
  delayDuration?: number
}

/** How long a tooltip opened by a long-press stays up (ms). */
export const LONG_PRESS_TOOLTIP_MS = 2_500

/**
 * A tooltip on hover / focus (mouse and keyboard, as before) and, for finger
 * and pen, on a long-press: the tooltip shows, the button does not fire, and a
 * tap anywhere or a short wait hides it again.
 */
export function TooltipWrapper({
  content,
  children,
  delayDuration = 300,
}: TooltipWrapperProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const [pressed, setPressed] = useState(false)
  const longPress = useLongPress(() => setPressed(true))

  useEffect(() => {
    if (!pressed) return
    const hide = (): void => setPressed(false)
    const timer = setTimeout(hide, LONG_PRESS_TOOLTIP_MS)
    // The next press anywhere closes it (after this press has ended).
    const onDown = (): void => hide()
    const frame = requestAnimationFrame(() =>
      document.addEventListener('pointerdown', onDown, true),
    )
    return () => {
      clearTimeout(timer)
      cancelAnimationFrame(frame)
      document.removeEventListener('pointerdown', onDown, true)
    }
  }, [pressed])

  return (
    <Tooltip
      delayDuration={delayDuration}
      open={open || pressed}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setPressed(false)
      }}
    >
      <TooltipTrigger asChild {...longPress}>
        {children}
      </TooltipTrigger>
      <TooltipContent data-long-press={pressed ? '' : undefined}>{content}</TooltipContent>
    </Tooltip>
  )
}
