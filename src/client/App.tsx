import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertCircle,
  ArrowUpRight,
  ChevronDown,
  Monitor,
  Power,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react'

import { ApiClientError, fetchTargetStatus, wakeTarget } from '@/client/api'
import type { TargetState } from '@/shared/contracts'

const STATUS_QUERY_KEY = ['target-status'] as const
const DATE_TIME_FORMATTER = new Intl.DateTimeFormat('ja-JP', {
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})

const STATE_COPY: Record<TargetState, { label: string; description: string; actionNote: string }> =
  {
    offline: {
      label: 'オフライン',
      description: 'PCからの応答がありません。',
      actionNote: '起動後は、接続できるまで自動で確認します。',
    },
    starting: {
      label: '接続を準備中',
      description: '起動を依頼しました。RDPの応答を待っています。',
      actionNote: '操作は不要です。接続できるとボタンが切り替わります。',
    },
    ready: {
      label: '接続できます',
      description: 'リモートデスクトップの準備ができました。',
      actionNote: 'リモートデスクトップは新しいタブで開きます。',
    },
    error: {
      label: '確認が必要です',
      description: 'PCの状態を確認できませんでした。',
      actionNote: '原因を確認したら、もう一度お試しください。',
    },
  }

function formatTimestamp(timestamp: string | null | undefined): string {
  return timestamp ? DATE_TIME_FORMATTER.format(new Date(timestamp)) : '—'
}

function ErrorNotice({ error, title }: { error: Error; title: string }) {
  const requestId = error instanceof ApiClientError ? error.requestId : undefined

  return (
    <div className="error-notice" role="alert">
      <AlertCircle aria-hidden="true" size={20} strokeWidth={1.8} />
      <div>
        <p className="error-title">{title}</p>
        <p className="error-message">{error.message}</p>
        {requestId ? <p className="error-id">問い合わせID: {requestId}</p> : null}
      </div>
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
  const connectionUrl = status?.connectionUrl
  const visibleError = wakeMutation.error ?? (statusQuery.isError ? statusQuery.error : null)
  const statusUnavailable = statusQuery.isError
  const stateCopy = state && !statusUnavailable ? STATE_COPY[state] : undefined
  const statusLabel = statusUnavailable ? '確認できません' : (stateCopy?.label ?? '状態を確認中')
  const statusDescription = statusUnavailable
    ? 'ネットワークを確認して、もう一度お試しください。'
    : state === 'error'
      ? (status?.message ?? STATE_COPY.error.description)
      : (stateCopy?.description ?? 'PCからの応答を確認しています。')
  const wakeDisabled = wakeMutation.isPending || !status?.canWake
  const wakeLabel = !status
    ? '状態を確認中'
    : wakeMutation.isPending
      ? '起動を依頼しています'
      : !status.canWake && status.retryAfterSeconds > 0
        ? `再実行まで ${status.retryAfterSeconds} 秒`
        : state === 'error'
          ? 'もう一度起動する'
          : 'PCを起動する'

  const retryStatus = () => {
    wakeMutation.reset()
    void statusQuery.refetch()
  }

  return (
    <div className="app-shell">
      <header className="site-header">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <Monitor size={19} strokeWidth={1.8} />
          </span>
          <span>Remote Console</span>
        </div>
        <button
          className="refresh-button"
          type="button"
          aria-label="状態を再確認"
          title="状態を再確認"
          onClick={retryStatus}
          disabled={statusQuery.isFetching}
        >
          <RefreshCw size={18} strokeWidth={1.8} aria-hidden="true" />
          <span>状態を更新</span>
        </button>
      </header>

      <main className="console-main">
        <div className="page-heading">
          <h1 id="target-name">{status?.target.name ?? '自宅PC'}</h1>
          <p>リモートデスクトップ</p>
        </div>

        <section
          className="status-sheet"
          data-state={statusUnavailable ? 'error' : (state ?? 'checking')}
          aria-labelledby="target-name"
        >
          <div className="sheet-heading">
            <div className="check-status">
              <span className="status-light" aria-hidden="true" />
              <span>
                {statusUnavailable
                  ? '再確認してください'
                  : state === 'starting'
                    ? '接続を自動で確認中'
                    : '状態を自動で確認'}
              </span>
            </div>
            <span className="checked-at">
              最終確認{' '}
              {status?.checkedAt && !statusUnavailable ? (
                <time dateTime={status.checkedAt}>{formatTimestamp(status.checkedAt)}</time>
              ) : (
                '—'
              )}
            </span>
          </div>

          <div
            className="status-body"
            aria-live="polite"
            aria-atomic="true"
            aria-busy={!status && statusQuery.isFetching}
          >
            <div className="status-text" key={statusLabel}>
              <h2>{statusLabel}</h2>
              <p>{statusDescription}</p>
            </div>
          </div>

          {visibleError ? (
            <ErrorNotice
              error={visibleError}
              title={wakeMutation.error ? 'PCを起動できませんでした' : '状態を確認できませんでした'}
            />
          ) : null}

          <div className="command-row">
            {visibleError ? (
              <button className="primary-command" type="button" onClick={retryStatus}>
                <span>再確認</span>
                <RefreshCw size={21} strokeWidth={1.8} aria-hidden="true" />
              </button>
            ) : state === 'ready' && connectionUrl ? (
              <a
                className="primary-command"
                href={connectionUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                <span>リモートデスクトップを開く</span>
                <ArrowUpRight size={22} strokeWidth={1.8} aria-hidden="true" />
              </a>
            ) : (
              <button
                className="primary-command"
                type="button"
                disabled={state === 'starting' || !status || wakeDisabled}
                onClick={() => wakeMutation.mutate()}
              >
                <span>{state === 'starting' ? '接続を待っています' : wakeLabel}</span>
                <Power size={21} strokeWidth={1.8} aria-hidden="true" />
              </button>
            )}
            <p className="action-note">
              {visibleError
                ? '通信状態を確認して、現在の状態を読み直します。'
                : !status
                  ? '数秒お待ちください。'
                  : !status.canWake &&
                      status.retryAfterSeconds > 0 &&
                      state !== 'ready' &&
                      state !== 'starting'
                    ? '連続した起動操作は一時的に制限されています。'
                    : stateCopy?.actionNote}
            </p>
          </div>
        </section>

        <details className="connection-details">
          <summary>
            <span>接続と履歴</span>
            <ChevronDown size={18} strokeWidth={1.8} aria-hidden="true" />
          </summary>
          <div className="details-content">
            <dl>
              <div>
                <dt>最終起動操作</dt>
                <dd>
                  {status?.lastWakeAt ? (
                    <time dateTime={status.lastWakeAt}>{formatTimestamp(status.lastWakeAt)}</time>
                  ) : (
                    '—'
                  )}
                </dd>
              </div>
              <div>
                <dt>外部接続</dt>
                <dd>Cloudflare Access</dd>
              </div>
            </dl>
            <p>
              <ShieldCheck size={17} strokeWidth={1.8} aria-hidden="true" />
              RDPポートをインターネットへ公開せず、Tunnel経由で接続します。
            </p>
          </div>
        </details>
      </main>
    </div>
  )
}
