import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  ArrowUpRight,
  Check,
  Circle,
  Clock3,
  Cloud,
  ExternalLink,
  Loader2,
  LockKeyhole,
  Monitor,
  Power,
  RefreshCw,
  Router,
  ShieldCheck,
  WifiOff,
  Zap,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import { ApiClientError, fetchTargetStatus, wakeTarget } from '@/client/api'
import { Badge } from '@/client/components/ui/badge'
import { Button, buttonVariants } from '@/client/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/client/components/ui/card'
import { Progress } from '@/client/components/ui/progress'
import { cn } from '@/client/lib/utils'
import type { TargetState, TargetStatus } from '@/shared/contracts'

const STATUS_QUERY_KEY = ['target-status'] as const
const DATE_TIME_FORMATTER = new Intl.DateTimeFormat('ja-JP', {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})

interface StatePresentation {
  label: string
  eyebrow: string
  Icon: LucideIcon
  badge: 'offline' | 'starting' | 'ready' | 'error'
  orbClassName: string
  iconClassName: string
}

const STATE_PRESENTATION: Record<TargetState, StatePresentation> = {
  offline: {
    label: '停止中',
    eyebrow: 'OFFLINE',
    Icon: WifiOff,
    badge: 'offline',
    orbClassName:
      'border-slate-400/20 bg-slate-400/8 shadow-[0_0_70px_-20px_rgba(148,163,184,0.35)]',
    iconClassName: 'text-slate-300',
  },
  starting: {
    label: '起動処理中',
    eyebrow: 'BOOTING',
    Icon: Zap,
    badge: 'starting',
    orbClassName:
      'border-amber-300/25 bg-amber-300/10 shadow-[0_0_80px_-16px_rgba(252,211,77,0.42)]',
    iconClassName: 'text-amber-300',
  },
  ready: {
    label: '接続可能',
    eyebrow: 'READY',
    Icon: Monitor,
    badge: 'ready',
    orbClassName:
      'border-emerald-300/25 bg-emerald-300/10 shadow-[0_0_85px_-16px_rgba(110,231,183,0.45)]',
    iconClassName: 'text-emerald-300',
  },
  error: {
    label: '要確認',
    eyebrow: 'ATTENTION',
    Icon: AlertTriangle,
    badge: 'error',
    orbClassName:
      'border-rose-300/25 bg-rose-300/10 shadow-[0_0_80px_-18px_rgba(253,164,175,0.38)]',
    iconClassName: 'text-rose-300',
  },
}

function formatTimestamp(timestamp: string | null | undefined): string {
  return timestamp ? DATE_TIME_FORMATTER.format(new Date(timestamp)) : '—'
}

function StatusOrb({ status }: { status: TargetState | undefined }) {
  if (!status) {
    return (
      <div className="relative grid size-32 place-items-center rounded-full border border-primary/15 bg-primary/5 sm:size-36">
        <div className="absolute inset-3 animate-ping rounded-full border border-primary/20 motion-reduce:animate-none" />
        <Loader2
          className="size-11 animate-spin text-primary motion-reduce:animate-none"
          aria-hidden="true"
        />
      </div>
    )
  }

  const presentation = STATE_PRESENTATION[status]
  const { Icon } = presentation
  return (
    <div
      className={cn(
        'relative grid size-32 place-items-center rounded-full border sm:size-36',
        presentation.orbClassName,
      )}
    >
      {status === 'starting' ? (
        <div className="absolute inset-[-9px] animate-[spin_5s_linear_infinite] rounded-full border border-dashed border-amber-300/25 motion-reduce:animate-none" />
      ) : null}
      {status === 'ready' ? (
        <div className="absolute inset-[-7px] animate-pulse rounded-full border border-emerald-300/15 motion-reduce:animate-none" />
      ) : null}
      <Icon
        className={cn('size-12', presentation.iconClassName)}
        strokeWidth={1.6}
        aria-hidden="true"
      />
    </div>
  )
}

function MetaRow({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border/55 py-3 last:border-0">
      <div className="flex items-center gap-2.5 text-sm text-muted-foreground">
        <span className="text-slate-400">{icon}</span>
        {label}
      </div>
      <span className="text-right text-sm font-bold text-foreground">{value}</span>
    </div>
  )
}

function ConnectionTimeline({ status }: { status: TargetStatus | undefined }) {
  const state = status?.status
  const hasWakeRequest = status?.lastWakeAt !== null && status?.lastWakeAt !== undefined
  const steps = [
    {
      label: '起動リクエスト',
      detail: hasWakeRequest ? formatTimestamp(status?.lastWakeAt) : '待機中',
      complete: hasWakeRequest || state === 'ready',
      active: state === 'offline' || state === 'error',
    },
    {
      label: 'PCを起動',
      detail:
        state === 'starting' ? '応答を待っています' : state === 'ready' ? '起動済み' : '未開始',
      complete: state === 'ready',
      active: state === 'starting',
    },
    {
      label: 'RDP接続を確認',
      detail: state === 'ready' ? '接続できます' : 'ポート監視中',
      complete: state === 'ready',
      active: state === 'ready',
    },
  ]

  return (
    <ol className="space-y-0" aria-label="接続までの進行状況">
      {steps.map((step, index) => (
        <li key={step.label} className="relative flex gap-3.5 pb-5 last:pb-0">
          {index < steps.length - 1 ? (
            <span
              className="absolute left-[13px] top-7 h-[calc(100%-0.25rem)] w-px bg-border"
              aria-hidden="true"
            />
          ) : null}
          <span
            className={cn(
              'relative z-10 grid size-7 shrink-0 place-items-center rounded-full border bg-card',
              step.complete && 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300',
              !step.complete && step.active && 'border-primary/45 bg-primary/10 text-primary',
              !step.complete && !step.active && 'border-border text-slate-600',
            )}
          >
            {step.complete ? (
              <Check className="size-3.5" />
            ) : (
              <Circle className="size-2.5" fill="currentColor" />
            )}
          </span>
          <div className="min-w-0 pt-0.5">
            <p
              className={cn(
                'text-sm font-bold',
                !step.active && !step.complete && 'text-muted-foreground',
              )}
            >
              {step.label}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">{step.detail}</p>
          </div>
        </li>
      ))}
    </ol>
  )
}

function ErrorNotice({ error, onRetry }: { error: Error; onRetry: () => void }) {
  const requestId = error instanceof ApiClientError ? error.requestId : undefined
  return (
    <div
      role="alert"
      className="mb-5 flex flex-col gap-3 rounded-2xl border border-rose-400/20 bg-rose-400/8 p-4 sm:flex-row sm:items-center"
    >
      <div className="flex min-w-0 flex-1 gap-3">
        <AlertTriangle className="mt-0.5 size-5 shrink-0 text-rose-300" aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-sm font-bold text-rose-100">通信エラー</p>
          <p className="mt-1 text-sm leading-6 text-rose-100/70">{error.message}</p>
          {requestId ? (
            <p className="mt-1 truncate font-mono text-[10px] text-rose-200/45">ID: {requestId}</p>
          ) : null}
        </div>
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={onRetry}
        className="border-rose-300/20 hover:bg-rose-300/10"
      >
        再確認
      </Button>
    </div>
  )
}

export function App() {
  const queryClient = useQueryClient()
  const statusQuery = useQuery({
    queryKey: STATUS_QUERY_KEY,
    queryFn: ({ signal }) => fetchTargetStatus(signal),
    staleTime: 1_000,
    refetchInterval: (query) => {
      const state = query.state.data?.status
      if (state === 'starting') return 2_500
      if (state === 'ready') return 15_000
      return 10_000
    },
    retry: (failureCount, error) =>
      error instanceof ApiClientError && error.status >= 500 && failureCount < 2,
  })
  const wakeMutation = useMutation({
    mutationFn: wakeTarget,
    onSuccess: (status) => {
      queryClient.setQueryData(STATUS_QUERY_KEY, status)
      void queryClient.invalidateQueries({ queryKey: STATUS_QUERY_KEY })
    },
  })

  const status = statusQuery.data
  const state = status?.status
  const presentation = state ? STATE_PRESENTATION[state] : undefined
  const visibleError = wakeMutation.error ?? (statusQuery.isError ? statusQuery.error : null)
  const wakeDisabled = wakeMutation.isPending || !status?.canWake
  const wakeLabel = !status
    ? '状態を確認しています'
    : wakeMutation.isPending
      ? '起動リクエストを送信中'
      : !status.canWake && status.retryAfterSeconds > 0
        ? `${status.retryAfterSeconds}秒後に再実行できます`
        : state === 'error'
          ? 'もう一度起動する'
          : 'PCを起動する'

  return (
    <div className="relative min-h-dvh overflow-hidden bg-background text-foreground">
      <div className="pointer-events-none fixed inset-0 opacity-75" aria-hidden="true">
        <div className="absolute left-[-12rem] top-[-12rem] size-[30rem] rounded-full bg-primary/8 blur-[110px]" />
        <div className="absolute bottom-[-18rem] right-[-12rem] size-[38rem] rounded-full bg-blue-500/7 blur-[130px]" />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.018)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.018)_1px,transparent_1px)] bg-[size:52px_52px] [mask-image:linear-gradient(to_bottom,black,transparent_80%)]" />
      </div>

      <div className="relative mx-auto flex min-h-dvh w-full max-w-6xl flex-col px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] sm:px-6 lg:px-8">
        <header className="flex items-center justify-between gap-4 py-3 sm:py-5">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-xl border border-primary/20 bg-primary/10 text-primary shadow-[0_0_24px_-9px_var(--primary)]">
              <Monitor className="size-5" aria-hidden="true" />
            </span>
            <div>
              <p className="text-sm font-bold tracking-tight sm:text-base">Remote Console</p>
              <p className="text-[10px] font-bold tracking-[0.18em] text-muted-foreground">
                PRIVATE CONTROL PANEL
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="neutral" className="hidden sm:inline-flex">
              <ShieldCheck className="size-3" /> Access保護
            </Badge>
            <Button
              variant="ghost"
              size="icon"
              aria-label="状態を再確認"
              title="状態を再確認"
              onClick={() => void statusQuery.refetch()}
              disabled={statusQuery.isFetching}
            >
              <RefreshCw
                className={cn(statusQuery.isFetching && 'animate-spin motion-reduce:animate-none')}
              />
            </Button>
          </div>
        </header>

        <main className="flex flex-1 flex-col justify-center py-5 sm:py-8">
          {visibleError ? (
            <ErrorNotice
              error={visibleError}
              onRetry={() => {
                wakeMutation.reset()
                void statusQuery.refetch()
              }}
            />
          ) : null}

          <div className="grid items-stretch gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(19rem,0.8fr)] lg:gap-5">
            <Card className="relative overflow-hidden">
              <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/50 to-transparent" />
              <CardContent className="flex h-full flex-col p-5 sm:p-8 lg:p-10">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-bold tracking-[0.18em] text-muted-foreground">
                      TARGET DEVICE
                    </p>
                    <h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">
                      {status?.target.name ?? '自宅PC'}
                    </h1>
                  </div>
                  {presentation ? (
                    <Badge variant={presentation.badge}>
                      <span className="size-1.5 rounded-full bg-current shadow-[0_0_8px_currentColor]" />
                      {presentation.label}
                    </Badge>
                  ) : (
                    <Badge variant="neutral">確認中</Badge>
                  )}
                </div>

                <div className="flex flex-1 flex-col items-center justify-center py-9 text-center sm:py-12">
                  <StatusOrb status={state} />
                  <p className="mt-7 text-[11px] font-bold tracking-[0.28em] text-muted-foreground">
                    {presentation?.eyebrow ?? 'CHECKING'}
                  </p>
                  <h2 className="mt-2 text-2xl font-bold sm:text-3xl">
                    {presentation?.label ?? '状態を確認中'}
                  </h2>
                  <p
                    aria-live="polite"
                    className="mt-3 max-w-md text-sm leading-7 text-muted-foreground sm:text-base"
                  >
                    {status?.message ?? '対象PCのRDP接続状態を確認しています。'}
                  </p>
                  {state === 'starting' ? <Progress className="mt-7 max-w-sm" /> : null}
                </div>

                <div className="mt-auto">
                  {status?.status === 'ready' && status.connectionUrl ? (
                    <a
                      href={status.connectionUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={cn(buttonVariants({ size: 'lg' }), 'w-full')}
                    >
                      リモートデスクトップを開く
                      <ExternalLink className="size-4" />
                    </a>
                  ) : (
                    <Button
                      size="lg"
                      className="w-full"
                      disabled={state === 'starting' || !status || wakeDisabled}
                      onClick={() => wakeMutation.mutate()}
                    >
                      {wakeMutation.isPending || state === 'starting' ? (
                        <Loader2 className="animate-spin motion-reduce:animate-none" />
                      ) : (
                        <Power />
                      )}
                      {state === 'starting' ? 'RDPの準備を待っています' : wakeLabel}
                    </Button>
                  )}
                  <p className="mt-3 flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
                    <LockKeyhole className="size-3.5" /> 接続情報はサーバー側で固定されています
                  </p>
                </div>
              </CardContent>
            </Card>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
              <Card>
                <CardHeader className="pb-4">
                  <CardTitle className="flex items-center gap-2">
                    <Router className="size-4.5 text-primary" /> 接続フロー
                  </CardTitle>
                  <CardDescription>RDPが応答するまで自動で確認します。</CardDescription>
                </CardHeader>
                <CardContent>
                  <ConnectionTimeline status={status} />
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2">
                    <Cloud className="size-4.5 text-primary" /> 接続情報
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <MetaRow
                    icon={<Clock3 className="size-4" />}
                    label="最終確認"
                    value={formatTimestamp(status?.checkedAt)}
                  />
                  <MetaRow
                    icon={<Zap className="size-4" />}
                    label="最終起動操作"
                    value={formatTimestamp(status?.lastWakeAt)}
                  />
                  <MetaRow
                    icon={<ShieldCheck className="size-4" />}
                    label="外部接続"
                    value="Cloudflare Access"
                  />
                  <div className="mt-4 rounded-2xl border border-primary/12 bg-primary/5 p-3.5">
                    <div className="flex gap-3">
                      <LockKeyhole className="mt-0.5 size-4 shrink-0 text-primary" />
                      <p className="text-xs leading-5 text-muted-foreground">
                        RDPポートをインターネットへ公開せず、Tunnel経由で接続します。
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </main>

        <footer className="flex flex-col items-center justify-between gap-2 border-t border-border/50 py-4 text-[11px] text-muted-foreground sm:flex-row">
          <span>Personal infrastructure · Wake-on-LAN console</span>
          <a
            href="https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/use-cases/rdp/rdp-browser/"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 transition-colors hover:text-foreground"
          >
            Browser RDP <ArrowUpRight className="size-3" />
          </a>
        </footer>
      </div>
    </div>
  )
}
