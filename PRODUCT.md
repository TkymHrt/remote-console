# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

本人が外出先のPCまたはスマートフォンから、自宅PCを起動してリモートデスクトップへ接続するために使う。

## Product Purpose

自宅PCの接続状態を確かめ、必要なら起動し、RDPの準備が整ったらブラウザー上のリモートデスクトップへ進める。使うたびに次の操作を迷わず判断できることが重要。

## Positioning

接続先をサーバー側で一台に固定し、Wake-on-LAN送信、RDPのTCP応答確認、CloudflareのブラウザーRDPへの移動を一つの画面につなぐ個人用コンソール。

## Operating Context

単一画面で `offline`、`starting`、`ready`、`error` の状態を見る。起動後はサーバーがRDP応答を確認し、画面が自動更新する。外出先で短時間に使うため、現在の状態と次の操作が優先される。

## Capabilities and Constraints

- 対象PCの状態確認、起動リクエスト、準備完了時のHTTPS接続リンクを提供する。
- 起動操作にはクールダウンがあり、通信失敗や起動タイムアウトを画面で扱う。
- 接続先IP、MACアドレス、ポート、RDP URLはサーバーで固定する。ブラウザーから接続先を指定できない。
- 管理画面とブラウザーRDPへの外部アクセスにはCloudflare Accessを使用する。RDPポートはインターネットへ直接公開しない。

## Brand Commitments

製品名は「Remote Console」。日本語で状態と操作を伝える。既存の見た目は刷新対象であり、固定の配色や装飾は確認されていない。

## Evidence on Hand

実際の操作、APIの状態定義、利用環境は `README.md`、`src/shared/contracts.ts`、`src/client/App.tsx` で確認できる。宣伝文句や導入実績はない。

## Product Principles

- 状態を見れば次に何をすべきか分かる。
- 起動と接続の操作を明確に区別し、同時には提示しない。
- 技術的な詳細は必要な場面で参照できればよい。
- 接続先の固定とアクセス制御を保つ。
