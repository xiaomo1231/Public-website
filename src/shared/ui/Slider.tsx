import * as SliderPrimitive from '@radix-ui/react-slider'
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from 'react'
import { cn } from '@/shared/lib/utils'

export const Slider = forwardRef<
  ElementRef<typeof SliderPrimitive.Root>,
  ComponentPropsWithoutRef<typeof SliderPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SliderPrimitive.Root
    ref={ref}
    className={cn(
      'relative flex w-full touch-none select-none items-center coarse:min-h-11',
      className,
    )}
    {...props}
  >
    <SliderPrimitive.Track className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-muted">
      <SliderPrimitive.Range className="absolute h-full bg-primary" />
    </SliderPrimitive.Track>
    <SliderPrimitive.Thumb className="focus-ring block h-4 w-4 rounded-full border border-primary bg-background shadow transition-colors disabled:pointer-events-none disabled:opacity-50 coarse:h-6 coarse:w-6" />
  </SliderPrimitive.Root>
))
Slider.displayName = SliderPrimitive.Root.displayName
