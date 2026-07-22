import type { HTMLAttributes } from 'react'

import { cn } from '@/client/lib/utils'

export function Progress({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role="progressbar"
      aria-label="RDP接続準備の進行状況"
      className={cn('h-1.5 w-full overflow-hidden rounded-full bg-secondary', className)}
      {...props}
    >
      <div className="h-full w-2/5 animate-[loading_1.7s_ease-in-out_infinite] rounded-full bg-amber-300 shadow-[0_0_16px_rgba(252,211,77,0.45)]" />
    </div>
  )
}
