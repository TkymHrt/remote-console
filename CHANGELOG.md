# Changelog

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
