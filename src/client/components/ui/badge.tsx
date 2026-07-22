import { cva } from 'class-variance-authority'
import type { VariantProps } from 'class-variance-authority'
import type { HTMLAttributes } from 'react'

import { cn } from '@/client/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-bold tracking-wide',
  {
    variants: {
      variant: {
        neutral: 'border-border bg-secondary text-muted-foreground',
        offline: 'border-slate-500/25 bg-slate-400/10 text-slate-300',
        starting: 'border-amber-400/25 bg-amber-400/10 text-amber-300',
        ready: 'border-emerald-400/25 bg-emerald-400/10 text-emerald-300',
        error: 'border-rose-400/25 bg-rose-400/10 text-rose-300',
      },
    },
    defaultVariants: { variant: 'neutral' },
  },
)

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />
}
