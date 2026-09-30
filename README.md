# Remote Console

外出先のブラウザから自宅PCにWOLを送り、TCP 3389の準備完了を待って、CloudflareのブラウザRDPを開く個人用ダッシュボード。

```text
offline → WOL送信 → waking → TCP 3389の接続成立 → ready → ブラウザRDP
                           └→ timeout → 明示的な再送 / 遅れてready
```

**readyはTCP接続の成立だけ**。RDPのハンドシェイク、Windowsログイン、デスクトップ表示の成功は判定しない。offlineも電源OFFの証明ではなく、RDPポートが応答しない状態。

## 構成

- React / TypeScript **7.0.2** / Tailwind CSS **v4** / shadcn/ui（Radix）/ TanStack Query
- Hono / Zod / Node.js **26** / jose（Access JWT検証）
- Vite+ **1.0.0**に統合されたVite・Vitest・Oxlint・Oxfmt・tsdown
- LINE Seed JP Regular / Boldを同梱・自己ホスト。ライセンスは [`public/fonts/OFL.txt`](public/fonts/OFL.txt)
- ProxmoxのUbuntu LXC内でNodeとcloudflaredを別のsystemdサービスとして稼働

```text
ブラウザ ── Cloudflare Access + Tunnel ── cloudflared (Ubuntu LXC)
                                            ├── HTTP → 127.0.0.1:3000 (このアプリ)
                                            └── PCのプライベートIP経路 → TCP 3389
このアプリ ── UDP WOL / TCP 3389プローブ ── 自宅PC
```

RDP通信そのものはこのアプリを通らない。PCは1台・固定設定。DB、RDPプロキシ、Windows認証情報の保存、シャットダウン操作、独自のHTTP/Queryラッパーは持たない。

## 開発

Node.js 26とpnpmを使用。Vite+のグローバルインストールは不要。package.jsonの`devEngines`がpnpmのバージョンを指定する。

```sh
pnpm install --frozen-lockfile
cp .env.example .env
```

`.env`を実際のPCに合わせて変更し、開発時は以下を指定する。`CF_ACCESS_TEAM_DOMAIN`と`CF_ACCESS_AUD`は開発時のみ省略できる（省略する場合は行ごと削除し、空文字にしない）。

```dotenv
NODE_ENV=development
PUBLIC_ORIGIN=http://127.0.0.1:5173
```

別々のターミナルで起動する。

```sh
pnpm dev:server
pnpm dev
```

`http://127.0.0.1:5173`を開く。Viteの`/api`プロキシは`.env`の`PORT`（既定3000）に接続する。NodeもViteも127.0.0.1のみで待ち受ける。開発モードではAccess検証を行わず、画面にも警告を表示する。**開発モードをTunnelで公開しない。**

```sh
pnpm check      # Oxfmt + Oxlint + 型チェック
pnpm typecheck # TypeScript 7コンパイラ
pnpm test      # Vite+内のVitest
pnpm build     # dist/client と dist/server/index.mjs
pnpm start     # .envがあれば読み込んでビルド済みアプリを起動
```

`pnpm build`はフロントエンドの`NODE_ENV=production`を明示する。バックエンド開発用`.env`の`NODE_ENV=development`がReactの本番ビルドに混入しないため。

## 設定

[`.env.example`](.env.example)を基に、環境変数またはsystemdのEnvironmentFileを設定する。MAC・IP・URLの変更をブラウザから受け付けない。

| 設定                    | 内容                                                                                |
| ----------------------- | ----------------------------------------------------------------------------------- |
| `NODE_ENV`              | 既定`production`。本番ではAccess設定必須。`development`はlocalhostのHTTP originのみ |
| `PORT`                  | HTTP待受ポート。既定3000。待受アドレスは変更不可の127.0.0.1                         |
| `PUBLIC_ORIGIN`         | 管理画面のHTTPS origin。パス・認証情報・クエリ不可。WOL POSTのOrigin検証に使用      |
| `PC_NAME`               | 表示名（既定「自宅PC」、1〜80文字）                                                 |
| `PC_IP`                 | PCの固定IPv4アドレス / DHCP予約アドレス                                             |
| `PC_MAC`                | `AA:BB:CC:DD:EE:FF`またはハイフン区切りのMAC                                        |
| `WOL_BROADCAST`         | PCと同一LANのブロードキャストIPv4アドレス（例`192.168.1.255`）                      |
| `WOL_PORT`              | UDP宛先ポート。既定9                                                                |
| `BOOT_TIMEOUT_MS`       | 起動待ち期限。既定120000ms、1000〜600000ms                                          |
| `BROWSER_RDP_URL`       | Cloudflare AccessのRDPターゲットタイルが開く**実際のHTTPS URL**                     |
| `CF_ACCESS_TEAM_DOMAIN` | `https://<team>.cloudflareaccess.com`                                               |
| `CF_ACCESS_AUD`         | **管理画面用**AccessアプリのApplication Audience (AUD) Tag。RDPアプリのAUDではない  |

設定が不正、または本番のAccess設定が欠けていると起動を拒否する。Windowsのユーザー名・パスワード、CloudflareのAPIトークンはアプリ設定に不要。

### 状態とAPI

- `GET /api/pc`: TCP接続を1回確認し、状態と時刻を返す。接続タイムアウト1500ms。同時の確認は共有。
- `POST /api/pc/wake`: 状態確認後に102バイトのWOLパケットをUDP送信。wakingなら202、起動済みreadyなら200。同時要求は1回の送信にまとめ、起動待ち中の再要求は期限を延長しない。
- 画面は起動中2秒、それ以外15秒間隔で自動ポーリング。通信エラー時は停止し、手動再確認で再開。ブラウザのバックグラウンドタブではTanStack Query標準のポーリング休止動作。
- WOL送信完了はOSへのUDP送信完了を意味し、PCによる受信や起動成功を保証しない。
- 起動待ち期限を越えるとtimeout。WOLを自動再送しない。遅れてポートが開けばreadyになる。
- TCPの接続拒否・到達不能・タイムアウトはoffline/起動待ちとして扱う。予期しないプローブエラーは503、起動要求失敗は502で返し、成功状態に偽装しない。
- ブラウザRDPはready時の明示クリックで同じタブに開く。ポップアップや自動遷移を使わない。
- 起動待ちの記録は1つのNodeプロセスのメモリのみ。再起動すると消えるが、次のTCP確認で起動済みPCはreadyになる。複数ワーカーでの実行はしない。

UIとクリック/Query状態のロジックは`src/App.tsx`に集約。通信・レスポンス検証は`src/api/pc.ts`、共有レスポンス契約は`shared/pc.ts`。バックエンドの設定、LAN通信、ライフサイクル、HTTP/Access境界は`server/`に分離している。

## Ubuntu LXCへの配置

前提: systemdが稼働するUbuntu LXC、Node.js 26、PCと同一ブロードキャストドメインに出られるProxmoxブリッジ。LXCからPCのIPへ到達できること。UDPブロードキャスト送信にrootやraw socketは不要。

### 1. Windows / LAN

- WindowsのRDP対応エディションでリモートデスクトップを有効化し、ファイアウォールでLXCからTCP 3389を許可。
- DHCP予約等でIPを固定。BIOS/UEFIとNICのWOLを有効化。必要に応じて高速スタートアップ・省電力設定を調整。
- WOLを受信できる電源状態と有線NICを確認。LXC/Proxmox/ルーターのファイアウォールで必要なLAN通信を許可。
- RDPのセキュリティレイヤーはTLS対応のNegotiateまたはSSL。legacy RDP設定はブラウザRDPでは利用しない。

### 2. Nodeアプリ

対象LXCにNode.js 26とpnpmを用意し、`node --version`がv26であることを確認する。unitは`/usr/bin/node`を使用するので、別の場所にインストールした場合は**ExecStartを実際の絶対パスへ変更**する。ホームディレクトリ配下のNodeは`ProtectHome=true`により使えない。

```sh
sudo useradd --system --user-group --home-dir /opt/remote-console --shell /usr/sbin/nologin remote-console
sudo install -d -o root -g remote-console -m 0755 /opt/remote-console
sudo install -d -o root -g root -m 0700 /etc/remote-console
```

ビルドは管理者の書き込み可能なcheckoutで行い、完成した`dist`・`node_modules`・`package.json`だけをroot所有の`/opt/remote-console`へコピーする。サービスユーザーでinstall/buildを実行しない。依存関係はlockfileで固定し、pnpmの既定のローカルvirtual store（`node_modules/.pnpm`）を含むディレクトリ全体をコピーする。ホーム配下への外部symlinkを持つ独自のglobal virtual store設定は使わない。

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm build
sudo cp -a dist node_modules package.json /opt/remote-console/
sudo chown -R root:remote-console /opt/remote-console
sudo chmod -R g+rX /opt/remote-console
sudo install -o root -g root -m 0600 .env.example /etc/remote-console/remote-console.env
```

`/etc/remote-console/remote-console.env`の全ての例示値を実環境に置き換え、`NODE_ENV=production`を維持する。Nodeプロセスにはsystemdが環境変数を渡すので、このファイルをアプリユーザーが直接読む必要はない。

```sh
sudo install -m 0644 deploy/remote-console.service /etc/systemd/system/remote-console.service
sudo systemd-analyze verify /etc/systemd/system/remote-console.service
sudo systemctl daemon-reload
sudo systemctl enable --now remote-console
sudo systemctl status remote-console
sudo journalctl -u remote-console -f
```

HTTPの待受は127.0.0.1だけ。ルーターのポート転送やProxmoxの公開HTTP/RDPリスナーを作らない。

### 3. Cloudflare Tunnel / Access

[公式のcloudflaredインストール手順](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/downloads/)で同じLXCにcloudflaredを導入する。CLIでローカル管理Tunnelを作る。

```sh
cloudflared tunnel login
cloudflared tunnel create remote-console
cloudflared tunnel route dns remote-console console.example.com
```

1. **管理画面用Accessアプリを先に作成**。公開ホスト名を`console.example.com`とし、自分のIdPアカウントのみをAllowする。Bypassポリシーは設定しない。
2. そのAUDとTeam domainをNodeのEnvironmentFileへ設定する。
3. [`deploy/cloudflared.yml.example`](deploy/cloudflared.yml.example)を`/etc/cloudflared/config.yml`へ配置。Tunnel UUID、credentials-fileの実際のJSON、ホスト名、teamName、管理画面AUDを置き換える。`PORT`を変えた場合はHTTP serviceの宛先ポートも合わせる。
4. Tunnel資格情報JSONを設定した絶対パスに配置し、rootのみが読める権限にする。`cloudflared tunnel login`で得たアカウント管理用証明書はサービス実行に不要。資格情報・証明書・envをGitに追加しない。
5. 公式CLIでcloudflaredのsystemd unitを生成する。独自のcloudflared unitは作らない。

```sh
sudo cloudflared --config /etc/cloudflared/config.yml tunnel ingress validate
sudo cloudflared --config /etc/cloudflared/config.yml service install
sudo systemctl enable --now cloudflared
sudo systemctl status cloudflared
```

Tunnelは外向きに接続する。LXCからCloudflareへ必要な外向き通信を許可する。cloudflaredでのAccess検証に加え、Node側でも全リクエストの`Cf-Access-Jwt-Assertion`の署名（RS256）・issuer・管理画面AUD・期限を検証する。鍵はTeamの`/cdn-cgi/access/certs`から取得し、joseの標準キャッシュ/ローテーション動作を使う。WOL POSTは`PUBLIC_ORIGIN`とのOrigin一致も要求する。APIも静的ファイルもAccessで保護し、レスポンスはno-store。

### 4. ブラウザRDP

**`rdp://PC_IP:3389`をTunnel ingressに足すだけではブラウザRDPにならない。** [公式ブラウザRDP手順](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/use-cases/rdp/rdp-browser/)に従う。

1. CloudflareのNetworking → Routesで、TunnelのCIDRルートとしてPCのIPv4 `/32`を追加する。cloudflared **2026.9.3**では旧`warp-routing.enabled`キーを受け付けないため、サンプル設定には書かない（[現行設定型](https://github.com/cloudflare/cloudflared/blob/2026.9.3/config/configuration.go)と実際のCLIで確認）。プライベート経路はCloudflare側のルートとターゲットで設定する。
2. Access controls → TargetsでWindows PCのIPとVirtual networkを登録する。
3. **別の**公開ホスト名（例`rdp.example.com`）にproxied DNSレコードを作る。公式手順の例ではAレコード`240.0.0.0`を利用でき、実際の公開PC IPを指定する必要はない。
4. 「Self-hosted and private」のAccessアプリにその**公開ホスト名**を設定し、browser-based RDPを有効化。対象ターゲット、ポート3389、自分のAllowポリシーを設定する。private hostname/IPのみのアプリやパスのみの定義ではブラウザRDPを利用できない。
5. Access App Launcherからターゲットを開いて得たURLを`BROWSER_RDP_URL`へ設定する。

```text
https://<rdp-app-domain>/rdp/<actual-vnet-id>/<pc-ip>/3389
```

VNET IDは実際のTunnel経路のものを使い、推測で作らない。ログインはCloudflare Access → Windowsの順。このアプリがWindowsパスワードを受け取ることはない。

設定変更後は必要なサービスを再起動する。

```sh
sudo systemctl restart remote-console
sudo systemctl restart cloudflared
```

### 運用時の確認

- 公開URLがまずAccessログインを要求すること。自分以外のアカウントが拒否されること。
- LXC内の`curl -i http://127.0.0.1:3000/api/pc`がJWTなしで401になること。
- PCを停止した状態からWOL、waking、自動ready、RDPリンクを順に確認すること。
- readyでもWindowsログイン失敗は別問題。RDP側の権限・認証・TLS設定を確認する。
- timeoutの場合はブロードキャストアドレス、Proxmoxブリッジ、WOL対応電源状態を確認。HTTP/API自体の通信障害はunknownとして扱う。
- 更新は新しい成果物をビルドしてからサービスを再起動する。配信中のdistを書き換えるビルドを避ける。

## 生成元と参考資料

雛形は公式`vp create vite -- . --template react-ts`と`create-hono --template nodejs`を使用し、単一packageへ統合。UIは公式`shadcn init --template vite --base radix --preset nova` / `shadcn add button`を使用している。不要な雛形・フォント・別package/lockfileは削除。

- [Vite+ Guide](https://viteplus.dev/guide/) / [Project-local CLI](https://viteplus.dev/guide/local-cli)
- [Hono Node.js](https://hono.dev/docs/getting-started/nodejs)
- [shadcn/ui Vite](https://ui.shadcn.com/docs/installation/vite)
- [TanStack Query](https://tanstack.com/query/latest/docs/framework/react/overview)
- [CloudflareブラウザRDP](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/use-cases/rdp/rdp-browser/)
- [Access JWT検証](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)
- [cloudflared Linux systemd](https://developers.cloudflare.com/tunnel/features/locally-managed-tunnels/as-a-service/linux/)
- [LINE Seed JP](https://seed.line.me/index_jp.html)
