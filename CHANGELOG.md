# Changelog

## 2026-09-30 — Git-based application updates

- 本番opsadminの`~/remote-console`をmain checkoutとして使い、`git pull --ff-only`と`pnpm run deploy:update`で更新する方式を追加。
- 既存Node runtimeをビルドにも利用し、package.json指定のpnpmをユーザーの`~/.local`へ導入するsetup scriptを追加。ビルドは非root、sudoは配置のみ。
- `deploy:stage`でfrozen install・静的チェック・テスト・ビルド・commit記録を行い、共通installerの`--app-only`で配置する。trackedな未コミット変更は拒否。
- 通常更新ではPC/Access環境設定・Tunnel token・Node runtime・cloudflaredを変更しない。新しいreleaseへ切り替え、匿名origin APIの401を起動確認し、起動失敗時は前のアプリ参照へ戻す。
- Cloudflare初回構築/設定変更と、既存サーバーのアプリ更新の手順を分離。

## 2026-09-30 — Production deployment automation

- Wrangler 4.143.0を開発依存へ追加。既存OAuth認証を利用して個人アカウント/zoneを発見し、必要なDNS/Zero Trust権限は本人承認の専用APIトークンで取得。対象アカウント/zoneのみ、期限7日、ローカル0600で保存。
- `deploy:provision`で所有者メール限定のAccessアプリ、専用のremote-managed Tunnel、管理画面DNS、Windows PCのprivate `/32`経路を設定。既存RDPアプリ/ターゲット/VNET/DNSは再利用。
- `deploy:prepare`と一度の本人sudo実行でUbuntu 26.04 LXCへ配置。Node 26.10.0/cloudflared 2026.9.3は公式配布のSHA256検証済み。
- Hono/Zod/joseをNode成果物へ同梱し、外部npm importを禁止。本番にWrangler・node_modules・APIトークンは転送しない。
- API一覧はpaginationを収集、DNSはexact-hostname lookup。既存Tunnelは保護された専用ingressを確認し、再実行でconfiguration PUTしない。競合は変更前に拒否。
- 再配置時は稼働中Nodeを停止してからruntime archiveを展開し、ETXTBSYを避ける。

### 実環境で確認したこと

- `remote-console`/`cloudflared`両systemdサービスがactive、HTTPは127.0.0.1:3000のみ、Cloudflare Tunnelはhealthy。
- 本番LXCから作業中Windows PCのTCP 3389が接続を受け付けること。
- 公開管理画面の未認証APIがAccessログインへ302、LXC内のJWTなしAPIが401。
- 本人の実Access認証後、公開`/api/pc`が200/readyを返し、画面のRDPリンクから実CloudflareブラウザRDPの有効なWindowsログインフォームへ遷移。
- 本番LXCから実際のLAN broadcastへ対象MACの102-byte WOLパケットを送信。作業中PCの電源状態は変更していない。
- NICのMagic Packet/S5 WOLが有効、Fast Startup無効、RDPのTLS/NLAが有効。IPはDHCP取得のため、ルーターで予約を確認する必要がある。

Windowsログインは物理コンソールをロックし得るため実行していない。停止/スリープ状態からのWOL復帰も、本人が作業を止めてよいタイミングで別途検証する。Windowsパスワードは取得・保存していない。

## 2026-09-30 — Rebuild

`2026-09-30-rebuild`の空のブランチから再構築。過去の実装は参照していない。

### 実装

- 固定1台のPCに対するWOL → 起動待ち → TCP 3389確認 → ready → ブラウザRDPへの遷移。
- 起動中2秒・通常15秒間隔のTanStack Queryポーリング、同時起動要求の集約、起動待ち期限、明示的な再送。
- readyはTCP接続成立のみ。Windows認証情報やRDPセッションは扱わない。
- 本番のCloudflare Access JWT検証、管理画面AUD/issuer/署名/期限の確認、WOL POSTのOrigin検証。HTTPはloopbackのみ。
- LINE Seed JPの自己ホスト、shadcn Button、モバイル対応と通信/認証エラー時の操作抑止。
- TypeScript 7 / Node.js 26、Vite+でのビルド・Vitest・Oxlint・Oxfmt統合。
- systemd unit、cloudflared設定例、Ubuntu LXC / AccessブラウザRDPの配置手順。
- cloudflared 2026.9.3の実際の検証結果に合わせ、受け付けられない旧`warp-routing.enabled`キーを省略。
- 開発用.envのNODE_ENVがReactの本番ビルドに混入しないよう、フロントエンドのproductionをビルド時に明示。

### 検証

- `pnpm install --frozen-lockfile`、型チェック、lint、format、本番ビルド。
- Vitest 25件: ライフサイクル、期限境界、重複要求、送信/プローブ失敗、設定検証、Access/Origin境界、実UDP/TCP通信。
- ビルド済みNodeアプリから実際のUDP受信器へ102バイトのWOLを送信し、localhostのTCP **3389**を開閉してoffline/waking/timeout/readyを確認。
- ブラウザで2秒間隔の自動確認、readyへの切り替え、RDP URLへの実クリックによる遷移開始を確認。例示ドメインへの外部通信は検証側で遮断。
- 署名済みの**検証用RSA/JWKS**を使った実HTTP/ブラウザで、認証なし401、正しいJWTでHTML/JS配信、本番CSP、WOL 202、異なるOrigin 403、認証切れ時の操作抑止と手動復旧を確認。
- 1440px / 390pxの実画面とLINE Seed JP両ウェイトの読み込みを確認。モバイルready画面のaxe-core: 違反0、要追加確認0。
- cloudflared **2026.9.3**でingress設定を検証（例示Tunnel UUIDのみ構文上有効な検証用値へ置換）。systemd unitはローカルNodeパスへ置換した検証用コピーで構文確認。
- 文書どおり`dist`・`node_modules`・`package.json`を独立したディレクトリへコピーして本番モードで起動し、JWTなしのAPI/トップページが401になることを確認。
- 独立した読み取り専用レビューで、バックエンド/配置は確認範囲内に重大な指摘なし、UIはdesktop/mobileのready画面と状態ロジックについてship判定。

実PCの電源投入、Windowsログイン、実CloudflareアカウントのTunnel/Access経路、および対象LXC上のサービス起動は未検証。実際のPC情報・Cloudflare資格情報がこの環境にはなく、これらはREADMEの配置後確認手順に従って実環境で確認する。
