import { html, raw } from "hono/html";
import type { HtmlEscapedString } from "hono/utils/html";

type Html = HtmlEscapedString | Promise<HtmlEscapedString>;

export type ErrorKind =
    | "invalid_session"
    | "discord_denied"
    | "discord_failed"
    | "chuoauth_denied"
    | "invalid_token"
    | "discord_already_verified"
    | "google_account_already_used"
    | "role_grant_failed"
    | "server_error";

const ERROR_MESSAGES: Record<
    ErrorKind,
    { title: string; message: string; retry: boolean }
> = {
    invalid_session: {
        title: "認証をやり直してください",
        message:
            "認証の有効期限 (10分) が切れたか、リクエストが正しくありません",
        retry: true
    },
    discord_denied: {
        title: "Discordの連携がキャンセルされました",
        message: "認証にはDiscordアカウントの連携が必要です",
        retry: true
    },
    discord_failed: {
        title: "Discordとの通信に失敗しました",
        message: "しばらく待ってから再度お試しください",
        retry: true
    },
    chuoauth_denied: {
        title: "大学アカウントで認証できませんでした",
        message:
            "中央大学のGoogleアカウント (g.chuo-u.ac.jp) でログインしてください",
        retry: true
    },
    invalid_token: {
        title: "認証情報を検証できませんでした",
        message: "最初からやり直してください",
        retry: true
    },
    discord_already_verified: {
        title: "このDiscordアカウントは認証済みです",
        message: "再度認証する必要はありません",
        retry: false
    },
    google_account_already_used: {
        title: "この大学アカウントは使用済みです",
        message:
            "この大学アカウントは別のDiscordアカウントの認証に使われています。心当たりがない場合はサーバーの運営者に連絡してください",
        retry: false
    },
    role_grant_failed: {
        title: "ロールを付与できませんでした",
        message:
            "認証は記録されていません。時間をおいて再度お試しいただき、解決しない場合はサーバーの運営者に連絡してください",
        retry: true
    },
    server_error: {
        title: "エラーが発生しました",
        message: "時間をおいて再度お試しください",
        retry: true
    }
};

const STYLE = `
:root {
    color-scheme: light dark;
    --bg: #f4f5f7;
    --card: #ffffff;
    --text: #1f2328;
    --muted: #59636e;
    --accent: #5865f2;
    --accent-text: #ffffff;
    --ok: #1a7f37;
    --ng: #cf222e;
}
@media (prefers-color-scheme: dark) {
    :root {
        --bg: #16181d;
        --card: #22252c;
        --text: #e6e8eb;
        --muted: #9aa3ad;
        --ok: #4ac26b;
        --ng: #ff7b72;
    }
}
* { box-sizing: border-box; }
body {
    margin: 0;
    min-height: 100vh;
    display: grid;
    place-items: center;
    padding: 16px;
    background: var(--bg);
    color: var(--text);
    font-family: "Zen Maru Gothic", system-ui, sans-serif;
    line-height: 1.7;
}
main {
    width: 100%;
    max-width: 480px;
    padding: 32px 28px;
    border-radius: 16px;
    background: var(--card);
    box-shadow: 0 2px 16px rgb(0 0 0 / 0.08);
}
h1 { margin: 0 0 12px; font-size: 1.35rem; }
p { margin: 0 0 16px; color: var(--muted); }
.ok { color: var(--ok); }
.ng { color: var(--ng); }
a.button {
    display: inline-block;
    padding: 10px 20px;
    border-radius: 8px;
    background: var(--accent);
    color: var(--accent-text);
    font-weight: 700;
    text-decoration: none;
}
`;

export function createViews(options: { isDev: boolean; loginPath: string }) {
    const layout = (title: string, body: Html) =>
        html`<!doctype html>
            <html lang="ja">
                <head>
                    <meta charset="utf-8" />
                    <meta
                        name="viewport"
                        content="width=device-width, initial-scale=1"
                    />
                    <title>${options.isDev ? "[DEV] " : ""}${title}</title>
                    <link
                        rel="preconnect"
                        href="https://fonts.googleapis.com"
                    />
                    <link
                        rel="stylesheet"
                        href="https://fonts.googleapis.com/css2?family=Zen+Maru+Gothic:wght@500;700&display=swap"
                    />
                    <style>
                        ${raw(STYLE)}
                    </style>
                </head>
                <body>
                    <main>${body}</main>
                </body>
            </html>`;

    const retryLink = html`<a
        class="button"
        href="${options.loginPath}"
        >最初からやり直す</a
    >`;

    return {
        landing: () =>
            layout(
                "大学アカウント認証",
                html`<h1>大学アカウント認証</h1>
                    <p>
                        中央大学のGoogleアカウントで認証したあとDiscordアカウントを連携すると、サーバーに参加して認証済みロールを受け取れます
                    </p>
                    <a
                        class="button"
                        href="${options.loginPath}"
                        >認証を始める</a
                    >`
            ),
        success: (input: {
            discordUsername: string;
            email: string;
            nicknameUpdated: boolean;
        }) =>
            layout(
                "認証が完了しました",
                html`<h1 class="ok">認証が完了しました</h1>
                    <p>
                        ${input.discordUsername} に認証済みロールを付与しました
                        (${input.email})
                    </p>
                    ${
                        input.nicknameUpdated
                            ? html`<p>ニックネームを学籍番号に変更しました</p>`
                            : ""
                    }
                    <p>このページを閉じてDiscordに戻ってください</p>`
            ),
        error: (kind: ErrorKind) => {
            const entry = ERROR_MESSAGES[kind];
            return layout(
                entry.title,
                html`<h1 class="ng">${entry.title}</h1>
                    <p>${entry.message}</p>
                    ${entry.retry ? retryLink : ""}`
            );
        }
    };
}

export type Views = ReturnType<typeof createViews>;
