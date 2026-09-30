import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  Check,
  Circle,
  Clock3,
  LoaderCircle,
  Monitor,
  Power,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { fetchPcStatus, wakePc } from "./api/pc";
import { Button } from "./components/ui/button";
import type { PcStatus } from "../shared/pc";

const pcQueryKey = ["pc"] as const;
const timeFormat = new Intl.DateTimeFormat("ja-JP", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});
const stateContent = {
  offline: {
    label: "offline",
    title: "RDPはオフラインです",
    description: "PCへ起動信号を送り、接続の準備ができるまで待ちます。",
    tone: "text-muted-foreground bg-muted",
  },
  sending: {
    label: "sending",
    title: "起動信号を送信しています",
    description: "LANへWake-on-LANのマジックパケットを送信しています。",
    tone: "text-waiting bg-waiting-soft",
  },
  waking: {
    label: "waking",
    title: "PCの起動を待っています",
    description: "TCP 3389を2秒ごとに自動確認しています。この画面のままお待ちください。",
    tone: "text-waiting bg-waiting-soft",
  },
  ready: {
    label: "ready",
    title: "RDPポートが応答しました",
    description: "接続の準備ができました。ブラウザRDPを開いて、Windowsへログインしてください。",
    tone: "text-ready bg-ready-soft",
  },
  timeout: {
    label: "timeout",
    title: "起動待ちが時間切れです",
    description:
      "RDPポートはまだ応答していません。PCの電源・WOL設定を確認し、必要なら起動信号を再送してください。",
    tone: "text-destructive bg-error-soft",
  },
  checking: {
    label: "checking",
    title: "PCの状態を確認しています",
    description: "LXCからTCP 3389への接続を確認しています。",
    tone: "text-muted-foreground bg-muted",
  },
  unknown: {
    label: "unknown",
    title: "PCの状態を確認できません",
    description:
      "最後の状態は現在の接続可否を保証しません。通信を確認して、状態を再確認してください。",
    tone: "text-destructive bg-error-soft",
  },
} satisfies Record<
  PcStatus["state"] | "sending" | "checking" | "unknown",
  { label: string; title: string; description: string; tone: string }
>;

export default function App() {
  const queryClient = useQueryClient();
  const status = useQuery({
    queryKey: pcQueryKey,
    queryFn: ({ signal }) => fetchPcStatus(signal),
    retry: false,
    refetchInterval: (query) =>
      query.state.error ? false : query.state.data?.state === "waking" ? 2000 : 15000,
  });
  const wake = useMutation({
    mutationFn: wakePc,
    retry: false,
    onMutate: () => queryClient.cancelQueries({ queryKey: pcQueryKey }),
    onSuccess: (data) => queryClient.setQueryData(pcQueryKey, data),
  });
  const pc = status.data;
  const viewState = wake.isPending
    ? "sending"
    : status.isError
      ? "unknown"
      : (pc?.state ?? "checking");
  const content = stateContent[viewState];
  const waiting = viewState === "waking" || viewState === "sending" || viewState === "checking";
  const ready = viewState === "ready";
  const canWake =
    Boolean(pc) &&
    !status.isError &&
    !wake.isPending &&
    (viewState === "offline" || viewState === "timeout");
  const error = status.error ?? wake.error;
  const remainingSeconds = pc?.bootDeadlineAt
    ? Math.max(0, Math.ceil((Date.parse(pc.bootDeadlineAt) - Date.parse(pc.checkedAt)) / 1000))
    : null;
  const steps = [
    {
      title: "起動信号を送る",
      detail: pc?.wakeRequestedAt
        ? `WOL送信 ${timeFormat.format(new Date(pc.wakeRequestedAt))}`
        : ready
          ? "起動済みのためWOL不要"
          : "Wake-on-LAN / UDP",
      done: Boolean(pc?.wakeRequestedAt) || ready,
      active: viewState === "sending",
    },
    {
      title: "RDPの準備を待つ",
      detail: ready
        ? "TCP 3389の接続を確認"
        : viewState === "waking"
          ? "TCP 3389を自動監視中"
          : "TCP 3389の接続成立でready",
      done: ready,
      active: viewState === "waking",
    },
    {
      title: "ブラウザで接続する",
      detail: "Cloudflare Access → Windowsログイン",
      done: false,
      active: ready,
    },
  ];

  return (
    <div className="min-h-dvh">
      <a href="#main" className="skip-link">
        メインコンテンツへ移動
      </a>
      <header className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-6 py-7 sm:px-10">
        <div className="flex items-center gap-3 text-lg font-bold tracking-tight">
          <Monitor className="size-6 text-primary" aria-hidden="true" />
          Remote Console
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {pc?.access === "cloudflare-access" ? (
            <>
              <ShieldCheck className="size-4 text-primary" aria-hidden="true" />
              Cloudflare Accessで保護
            </>
          ) : pc?.access === "development" ? (
            <>
              <TriangleAlert className="size-4 text-waiting" aria-hidden="true" />
              開発環境 · Access検証なし
            </>
          ) : (
            "認証状態を確認中"
          )}
        </div>
      </header>

      <main id="main" className="mx-auto max-w-5xl px-6 pb-10 pt-6 sm:px-10 sm:pt-12">
        <div className="mb-8 sm:mb-10">
          <h1 className="text-3xl leading-tight font-bold tracking-tight text-balance sm:text-4xl">
            自宅PCへ、ここから。
          </h1>
          <p className="mt-3 text-sm leading-7 text-muted-foreground sm:text-base">
            起動して、準備完了を待って、ブラウザでつなぐ。
          </p>
        </div>

        <section
          aria-labelledby="pc-heading"
          className="overflow-hidden rounded-2xl border bg-card"
        >
          <div className="flex flex-wrap items-start justify-between gap-4 border-b p-6 sm:px-8 sm:py-7">
            <div className="min-w-0 flex-1">
              <h2 id="pc-heading" className="text-xl font-bold break-all sm:text-2xl">
                {pc?.pc.name ?? "自宅PC"}
              </h2>
              <p className="mt-2 font-mono text-xs text-muted-foreground">
                {pc ? `${pc.pc.ip} : ${pc.pc.rdpPort}` : "TCP 3389 · 状態を取得中"}
              </p>
            </div>
            <span
              className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 font-mono text-xs ${content.tone}`}
            >
              {waiting ? (
                <LoaderCircle className="size-3.5 motion-safe:animate-spin" aria-hidden="true" />
              ) : (
                <Circle className="size-2 fill-current" aria-hidden="true" />
              )}
              {content.label}
            </span>
          </div>

          <div className="grid gap-7 p-6 sm:p-8 md:grid-cols-[1fr_auto] md:items-center md:gap-12">
            <div>
              <div role="status" aria-live="polite" aria-atomic="true">
                <h3 className="text-xl leading-relaxed font-bold text-balance sm:text-2xl">
                  {content.title}
                </h3>
                <p className="mt-3 max-w-xl text-sm leading-7 text-muted-foreground">
                  {content.description}
                </p>
              </div>
              {viewState === "waking" && remainingSeconds !== null && (
                <p className="mt-3 flex items-center gap-2 text-xs text-waiting">
                  <Clock3 className="size-3.5" aria-hidden="true" />
                  起動待ちの上限まで約 <span className="tabular-nums">{remainingSeconds}</span> 秒
                </p>
              )}
              {viewState === "timeout" && (
                <p className="mt-3 text-xs leading-6 text-muted-foreground">
                  遅れて起動した場合も、15秒ごとの確認でreadyへ切り替わります。
                </p>
              )}
            </div>
            <div className="flex flex-col gap-3 md:min-w-56">
              {ready && pc ? (
                <Button asChild size="lg" className="h-12 gap-3 px-6 text-sm">
                  <a href={pc.pc.browserRdpUrl} rel="noreferrer">
                    ブラウザRDPを開く
                    <ArrowRight className="size-4" aria-hidden="true" />
                  </a>
                </Button>
              ) : (
                <Button
                  size="lg"
                  className="h-12 gap-3 px-6 text-sm"
                  disabled={!canWake}
                  onClick={() => wake.mutate()}
                >
                  {wake.isPending || viewState === "waking" ? (
                    <LoaderCircle className="size-4 motion-safe:animate-spin" aria-hidden="true" />
                  ) : (
                    <Power className="size-4" aria-hidden="true" />
                  )}
                  {viewState === "waking"
                    ? "起動を待っています"
                    : wake.isPending
                      ? "送信しています"
                      : viewState === "timeout"
                        ? "起動信号を再送する"
                        : "PCを起動する"}
                </Button>
              )}
              <Button
                variant="ghost"
                className="h-10 gap-2 text-muted-foreground"
                disabled={status.isFetching || wake.isPending}
                onClick={() => {
                  wake.reset();
                  void status.refetch();
                }}
              >
                <RefreshCw
                  className={`size-3.5 ${status.isFetching ? "motion-safe:animate-spin" : ""}`}
                  aria-hidden="true"
                />
                {status.isFetching ? "確認中" : "状態を再確認"}
              </Button>
            </div>
          </div>

          {error && (
            <div
              role="alert"
              className="mx-6 mb-7 flex items-start gap-3 rounded-lg bg-error-soft p-4 text-sm leading-7 text-destructive sm:mx-8"
            >
              <TriangleAlert className="mt-1 size-4 shrink-0" aria-hidden="true" />
              <p>
                {error instanceof TypeError
                  ? "管理画面と通信できません。ネットワーク接続を確認して、状態を再確認してください。"
                  : error.message}
              </p>
            </div>
          )}

          <ol
            aria-label="接続までの流れ"
            className="grid gap-7 border-t bg-muted/40 p-6 sm:p-8 md:grid-cols-3 md:gap-8"
          >
            {steps.map((step, index) => (
              <li
                key={step.title}
                className="flex items-start gap-3"
                aria-current={step.active ? "step" : undefined}
              >
                <div
                  className={`flex size-7 shrink-0 items-center justify-center rounded-full border text-xs tabular-nums ${step.done || step.active ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground"}`}
                  aria-hidden="true"
                >
                  {step.done ? (
                    <Check className="size-3.5" />
                  ) : step.active && !ready ? (
                    <LoaderCircle className="size-3.5 motion-safe:animate-spin" />
                  ) : (
                    index + 1
                  )}
                </div>
                <div>
                  <p className="text-sm font-bold leading-7">{step.title}</p>
                  <p className="mt-1 text-xs leading-6 text-muted-foreground">{step.detail}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <div className="mt-7 flex flex-wrap items-center justify-between gap-x-6 gap-y-3 text-xs leading-6 text-muted-foreground">
          <p className="flex items-center gap-2">
            <span
              className={`size-1.5 rounded-full ${status.isError ? "bg-destructive" : "bg-primary"}`}
              aria-hidden="true"
            />
            {pc ? (
              <>
                最終確認{" "}
                <time dateTime={pc.checkedAt} className="tabular-nums">
                  {timeFormat.format(new Date(pc.checkedAt))}
                </time>
              </>
            ) : (
              "最初の確認を待っています"
            )}
          </p>
          <p>
            {status.isError
              ? "通信エラーのため自動確認を停止中"
              : viewState === "waking"
                ? "2秒ごとに自動確認"
                : "15秒ごとに自動確認"}
          </p>
        </div>

        <aside aria-labelledby="readiness-note" className="mt-9 border-t pt-6">
          <h2 id="readiness-note" className="text-sm font-bold">
            readyは、RDPポートの準備完了。
          </h2>
          <p className="mt-2 max-w-3xl text-xs leading-7 text-muted-foreground">
            TCP
            3389が接続を受け付けたことを示します。Windowsへのログイン可否は確認しません。offlineはポートが応答しない状態で、PCの電源が切れているとは限りません。
          </p>
        </aside>
      </main>
      <footer className="mx-auto flex max-w-5xl flex-wrap justify-between gap-3 px-6 pb-8 text-xs text-muted-foreground sm:px-10">
        <span>WOL → TCP 3389 → Browser RDP</span>
        <span>Windowsの認証情報は、このアプリに保存しません。</span>
      </footer>
    </div>
  );
}
