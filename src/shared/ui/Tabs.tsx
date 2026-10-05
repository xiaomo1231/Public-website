import * as TabsPrimitive from '@radix-ui/react-tabs'
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from 'react'
import { cn } from '@/shared/lib/utils'
import { useSlidingIndicator } from '@/shared/lib/useSlidingIndicator'

export const Tabs = TabsPrimitive.Root

export const TabsList = forwardRef<
  ElementRef<typeof TabsPrimitive.List>,
  ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, children, ...props }, ref) => {
  const { containerRef, ready, animate, style } = useSlidingIndicator<HTMLDivElement>(
    '[role="tab"][data-state="active"]',
  )
  return (
    <TabsPrimitive.List
      ref={(node) => {
        containerRef.current = node
        if (typeof ref === 'function') ref(node)
        else if (ref) ref.current = node
      }}
      data-indicator={ready ? 'ready' : undefined}
      className={cn(
        // Scrolls inside itself on narrow screens instead of widening the page.
        'group/tabs relative inline-flex h-10 max-w-full items-center justify-start gap-1 overflow-x-auto overflow-y-hidden rounded-lg border border-border/70 bg-muted/60 p-1 text-muted-foreground',
        className,
      )}
      {...props}
    >
      {/* One highlight glides between tabs; triggers keep a static fallback. */}
      <span
        aria-hidden
        data-animate={animate}
        className={cn('slide-indicator rounded-md bg-card shadow-soft', !ready && 'hidden')}
        style={style}
      />
      {children}
    </TabsPrimitive.List>
  )
})
TabsList.displayName = TabsPrimitive.List.displayName

export const TabsTrigger = forwardRef<
  ElementRef<typeof TabsPrimitive.Trigger>,
  ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      'relative inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium ring-offset-background transition-colors duration-200 hover:text-foreground focus-ring disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-soft group-data-[indicator=ready]/tabs:data-[state=active]:bg-transparent group-data-[indicator=ready]/tabs:data-[state=active]:shadow-none',
      className,
    )}
    {...props}
  />
))
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName

export const TabsContent = forwardRef<
  ElementRef<typeof TabsPrimitive.Content>,
  ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      'animate-tab-in mt-4 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
      className,
    )}
    {...props}
  />
))
TabsContent.displayName = TabsPrimitive.Content.displayName