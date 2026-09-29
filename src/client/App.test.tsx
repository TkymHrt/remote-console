/** @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'

import type { TargetStatus } from '@/shared/contracts'

import { App } from './App'

const OFFLINE_STATUS: TargetStatus = {
  target: { name: '自宅PC' },
  status: 'offline',
  message: 'PCは停止中です。準備ができたら起動してください。',
  checkedAt: '2026-07-22T12:00:00.000Z',
  lastWakeAt: null,
  canWake: true,
  retryAfterSeconds: 0,
  connectionUrl: null,
  errorCode: null,
}

const STARTING_STATUS: TargetStatus = {
  ...OFFLINE_STATUS,
  status: 'starting',
  message: 'Wake-on-LANを送信しました。RDPの応答を待っています。',
  checkedAt: '2026-07-22T12:00:05.000Z',
  lastWakeAt: '2026-07-22T12:00:05.000Z',
  canWake: false,
  retryAfterSeconds: 60,
}

const READY_URL =
  'https://rdp.tkymhrt.dpdns.org/rdp/1d2a8e0b-3bf8-4c62-bba1-5a797e224c58/192.168.11.3/3389'
const READY_STATUS: TargetStatus = {
  ...STARTING_STATUS,
  status: 'ready',
  message: 'RDPへの接続準備が完了しました。',
  checkedAt: '2026-07-22T12:00:20.000Z',
  retryAfterSeconds: 45,
  connectionUrl: READY_URL,
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  return input instanceof URL ? input.href : input.url
}

function renderApplication(): void {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>,
  )
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('Remote Console dashboard', () => {
  it('sends a fixed wake request and reflects the starting state', async () => {
    let currentStatus = OFFLINE_STATUS
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      if (requestUrl(input) === '/api/wake') {
        currentStatus = STARTING_STATUS
        return jsonResponse(currentStatus, 202)
      }
      return jsonResponse(currentStatus)
    })
    vi.stubGlobal('fetch', fetchMock)
    renderApplication()

    const wakeButton = await screen.findByRole('button', { name: 'PCを起動する' })
    expect(wakeButton.hasAttribute('disabled')).toBe(false)
    await userEvent.click(wakeButton)

    expect(await screen.findByRole('button', { name: 'RDPの準備を待っています' })).toBeTruthy()
    expect(screen.getAllByText('起動処理中')).toHaveLength(2)

    const wakeCall = fetchMock.mock.calls.find(([input]) => requestUrl(input) === '/api/wake')
    expect(wakeCall).toBeTruthy()
    expect(wakeCall?.[1]).toMatchObject({ method: 'POST', body: '{}' })
  })

  it('shows only the server-provided HTTPS RDP URL when ready', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async () => jsonResponse(READY_STATUS)),
    )
    renderApplication()

    const link = await screen.findByRole<HTMLAnchorElement>('link', {
      name: 'リモートデスクトップを開く',
    })
    expect(link.href).toBe(READY_URL)
    expect(link.target).toBe('_blank')
    expect(link.rel).toBe('noopener noreferrer')
    expect(screen.queryByRole('button', { name: 'PCを起動する' })).toBeNull()
  })

  it('renders a recoverable message when the API cannot be reached', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(() => Promise.reject(new TypeError('connection refused'))),
    )
    renderApplication()

    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(
      screen.getByText('サーバーに接続できません。ネットワークを確認してください。'),
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: '再確認' })).toBeTruthy()
  })

  it('shows a safe, recoverable alert for an empty JSON response', async () => {
    let requestCount = 0
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async () => {
        requestCount += 1
        if (requestCount === 1) return new Response('', { status: 200 })
        return jsonResponse(OFFLINE_STATUS)
      }),
    )
    renderApplication()

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('サーバーから不正な応答を受信しました。')
    expect(screen.getByRole('button', { name: '再確認' })).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: '再確認' }))
    expect(await screen.findByRole('button', { name: 'PCを起動する' })).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
