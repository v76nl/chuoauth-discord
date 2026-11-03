# chuoauth-discord

chuoauthのJWTを検証し、Discordサーバーで中央大学の学生に認証済みロールを付与する連携サービス

## 目次

1. [概要](#1-概要)
2. [仕組み](#2-仕組み)
3. [構造](#3-構造)
4. [セットアップ](#4-セットアップ)
5. [実行方法](#5-実行方法)
6. [エンドポイントとBotコマンド](#6-エンドポイントとbotコマンド)
7. [セキュリティ設計](#7-セキュリティ設計)

## 1. 概要

新規ユーザーには公開URL (`/`) を配る。
利用者はまず [chuoauth](https://github.com/v76nl/chuoauth) で大学のGoogleアカウントにログインし、その後Discordアカウントを連携する。
chuoauth-discordはJWTをchuoauthの公開鍵で検証し、Botが利用者を対象サーバーに参加させて認証済みロールを付与する。
Discordの招待リンクを公開しなくても、このURLが学生専用の入口になる。
Googleとは直接通信せず、Discord API操作、JWT検証、ユーザーの紐付け管理のみを担う

```text
利用者 ── /auth/start ──> chuoauth /auth/google/login ──> 大学Googleアカウントでログイン
                                                              │
       <── /auth/chuoauth/callback?token=<JWT> ───────────────┘
            JWKSで署名検証 → 大学アカウントの重複検査 → 暗号化Cookieに保持
       ── Discord認可 (identify, guilds.join)
                                                              │
       <── /auth/discord/callback ────────────────────────────┘
            Discordアカウントの重複検査 → DB記録 → サーバー参加・ロール付与 → 完了画面
```

学生以外はDiscord連携の前に拒否される。
同じ大学アカウントで複数のDiscordアカウントを認証すること、同じDiscordアカウントで複数回認証することはできない

## 2. 仕組み

- 言語: TypeScript (Node.js 20以上)
- HTTPフレームワーク: Hono + `@hono/node-server`
- Discord: discord.js v14
- JWT検証: `jose` (`createRemoteJWKSet`)
- データベース: SQLite (better-sqlite3)
- バリデーション: `zod`
- テスト: Vitest
- パッケージマネージャー: pnpm

## 3. 構造

```text
chuoauth-discord/
├── src/
│   ├── index.ts                 - Webサーバー起動、スラッシュコマンド登録、Botログイン
│   ├── app.ts                   - Honoアプリ、ミドルウェア、ルート登録
│   ├── config.ts                - 環境変数の読み込みとzodによる検証
│   ├── bot/
│   │   ├── client.ts            - Discord Client生成、インタラクションの振り分け
│   │   ├── commands/
│   │   │   └── setup.ts         - /setup-verify と認証ボタン
│   │   └── services/
│   │       └── member.ts        - ギルド追加、ロール付与、ニックネーム変更
│   ├── db/
│   │   ├── schema.ts            - verified_users のDDLと型
│   │   └── client.ts            - SQLite接続、クエリ関数
│   ├── routes/
│   │   ├── auth.ts              - Discord・chuoauthの認証フロー
│   │   └── views.ts             - 完了画面・エラー画面のHTML
│   ├── services/
│   │   ├── discord-oauth.ts     - Discord OAuth2のURL生成、コード交換
│   │   ├── jwt.ts               - chuoauthのJWKSによるJWT検証
│   │   ├── session.ts           - 暗号化Cookieの封入・開封
│   │   └── verification.ts      - 重複検査、記録、ロール付与の一連処理
│   └── types/
│       └── index.ts
├── tests/
│   ├── app.test.ts              - 連携フロー全体の結合テスト
│   ├── verification.test.ts     - 正常系と多重登録拒否
│   ├── jwt.test.ts
│   ├── discord-oauth.test.ts
│   └── helpers.ts               - テスト用のJWT署名器、Discord RESTのスタブ
├── data/                        - SQLiteデータベースの保存先 (Git管理外)
├── .env.example
├── Dockerfile
├── package.json
├── pnpm-workspace.yaml          - pnpmのビルドスクリプト許可設定
├── tsconfig.json
└── tsconfig.build.json          - 本番ビルド (dist/ 出力) 用
```

## 4. セットアップ

### Discord Developer Portal

1. アプリケーションを作成し、OAuth2 の Redirects に `DISCORD_REDIRECT_URI` と同じ値を登録する
2. Bot を作成してトークンを `DISCORD_BOT_TOKEN` に設定する。Privileged Gateway Intents の **Server Members Intent** を有効にする
3. 次のURLでBotをサーバーに招待する (`<CLIENT_ID>` を置き換える)。権限は「ロールの管理」「ニックネームの管理」「招待を作成」
    ```text
    https://discord.com/oauth2/authorize?client_id=<CLIENT_ID>&scope=bot+applications.commands&permissions=402653185
    ```
4. サーバー設定のロール一覧で、**Botのロールを認証済みロールより上に配置する** (下にあるとロールを付与できない)

### chuoauth側

chuoauthの `ALLOWED_REDIRECT_URIS` に `CHUOAUTH_REDIRECT_URI` (例: `http://localhost:4000/auth/chuoauth/callback`) を追加する

### 環境変数

`.env.example` を `.env` にコピーして設定する

| 変数                            | 必須 | 説明                                                             |
| ------------------------------- | ---- | ---------------------------------------------------------------- |
| `PORT`                          |      | 待受ポート (既定: 4000)                                          |
| `APP_BASE_URL`                  | 必須 | 公開URL。`https:` の場合はCookieに Secure 属性を付与             |
| `SESSION_SECRET`                | 必須 | 連携中のCookieを暗号化するキー (32文字以上)                      |
| `DATABASE_PATH`                 |      | SQLiteファイルのパス (既定: `data/chuoauth-discord.db`)          |
| `DISCORD_CLIENT_ID`             | 必須 | アプリケーションID                                               |
| `DISCORD_CLIENT_SECRET`         | 必須 |                                                                  |
| `DISCORD_BOT_TOKEN`             | 必須 |                                                                  |
| `DISCORD_GUILD_ID`              | 必須 | 対象サーバーのID                                                 |
| `DISCORD_VERIFIED_ROLE_ID`      | 必須 | 付与するロールのID                                               |
| `DISCORD_REDIRECT_URI`          | 必須 | `/auth/discord/callback` の完全なURL                             |
| `CHUOAUTH_BASE_URL`             | 必須 | chuoauthのURL                                                    |
| `CHUOAUTH_ISSUER`               |      | JWTの `iss` と照合する値 (既定: `CHUOAUTH_BASE_URL`)             |
| `CHUOAUTH_JWKS_URL`             |      | 公開鍵の取得先 (既定: `CHUOAUTH_BASE_URL/.well-known/jwks.json`) |
| `CHUOAUTH_REDIRECT_URI`         | 必須 | `/auth/chuoauth/callback` の完全なURL                            |
| `CHUOAUTH_AUDIENCE`             |      | chuoauthで `TOKEN_AUDIENCE` を設定した場合に同じ値を設定         |
| `ALLOWED_DOMAIN`                |      | 許可する大学ドメイン (既定: `g.chuo-u.ac.jp`)                    |
| `CHANGE_NICKNAME_TO_STUDENT_ID` |      | `true` で認証時にニックネームを学籍番号に変更                    |

## 5. 実行方法

| コマンド         | 実行内容                               |
| ---------------- | -------------------------------------- |
| `pnpm install`   | パッケージのインストール               |
| `pnpm dev`       | 開発サーバーとBotの起動 (変更で再起動) |
| `pnpm build`     | `dist/` へのビルド                     |
| `pnpm start`     | ビルド済みサーバーとBotの起動          |
| `pnpm test`      | テストの実行                           |
| `pnpm typecheck` | 型チェック                             |
| `pnpm format`    | Prettierによる整形                     |

起動後、対象サーバーの認証用チャンネルで `/setup-verify` を実行すると案内メッセージが設置される

### Docker

`/app/data` を永続ボリュームとしてマウントする

```bash
docker build -t chuoauth-discord .
docker run --env-file .env -p 4000:4000 -v chuoauth-discord-data:/app/data chuoauth-discord
```

## 6. エンドポイントとBotコマンド

| メソッド | パス                      | 説明                                                           |
| -------- | ------------------------- | -------------------------------------------------------------- |
| GET      | `/`                       | 認証開始ページ (新規ユーザーに配るURL)                         |
| GET      | `/auth/start`             | chuoauthのログインへリダイレクト                               |
| GET      | `/auth/chuoauth/callback` | chuoauthからの戻り先。JWT検証後、Discord認可画面へリダイレクト |
| GET      | `/auth/discord/callback`  | Discordからの戻り先。サーバー参加、ロール付与、完了画面の表示  |
| GET      | `/health`                 | `{"status":"ok"}`                                              |

| コマンド・操作                     | 説明                                                   |
| ---------------------------------- | ------------------------------------------------------ |
| `/setup-verify`                    | 管理者限定。認証案内とボタンをチャンネルに設置         |
| 「大学アカウントで認証する」ボタン | 認証ページへのリンクを本人にだけ見えるメッセージで返す |

### 記録されるデータ (`verified_users`)

| カラム            | 内容                              |
| ----------------- | --------------------------------- |
| `discord_user_id` | DiscordユーザーID (UNIQUE)        |
| `google_sub`      | Googleアカウントの固有ID (UNIQUE) |
| `email`           | 大学メールアドレス                |
| `student_id`      | 学籍番号 (教職員などは NULL)      |
| `verified_at`     | 認証日時 (UNIX秒)                 |
| `guild_id`        | ロールを付与したサーバーID        |

## 7. セキュリティ設計

- 検証済みの大学アカウント情報は、`SESSION_SECRET` で暗号化 (A256GCM) したHttpOnly Cookieに保持し、改ざんや盗み見を防ぐ。有効期限は10分
- Discordのアクセストークンは受け取ったリクエスト内でサーバー参加に使うだけで、Cookieにも DB にも保存しない
- chuoauth認証とDiscord認可のそれぞれでstateを照合し、他人のJWTやDiscordアカウントを差し込まれるのを防ぐ
- JWTは `iss`、`exp`、RS256署名、`domain` を検証する。公開鍵は jose がキャッシュし、未知の `kid` が来たときだけ再取得する
- 先にDBへ記録して UNIQUE 制約で同時リクエストによる二重登録を防ぎ、ロール付与に失敗した場合は記録を取り消して再試行できるようにしている
- アクセスログにはクエリ文字列 (認可コードやJWT) を出力しない
