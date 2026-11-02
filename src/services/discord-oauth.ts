import { z } from "zod";
import type { DiscordUser } from "../types/index.js";

const AUTHORIZE_URL = "https://discord.com/oauth2/authorize";
const API_BASE = "https://discord.com/api/v10";
// guilds.join はサーバー未参加の利用者をBotが追加するために必要
const SCOPES = ["identify", "guilds.join"];

const tokenResponseSchema = z.object({
    access_token: z.string().min(1),
    token_type: z.string(),
    scope: z.string()
});

const userResponseSchema = z.object({
    id: z.string().min(1),
    username: z.string()
});

export class DiscordOAuthError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "DiscordOAuthError";
    }
}

export type DiscordOAuthOptions = {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
};

export function buildAuthorizeUrl(
    options: DiscordOAuthOptions,
    state: string
): string {
    const url = new URL(AUTHORIZE_URL);
    url.search = new URLSearchParams({
        client_id: options.clientId,
        redirect_uri: options.redirectUri,
        response_type: "code",
        scope: SCOPES.join(" "),
        state
    }).toString();
    return url.toString();
}

/**
 * 認可コードをアクセストークンに交換し、利用者情報を取得する
 */
export async function exchangeCode(
    options: DiscordOAuthOptions,
    code: string,
    fetchImpl: typeof fetch = fetch
): Promise<{ accessToken: string; user: DiscordUser }> {
    const tokenRes = await fetchImpl(`${API_BASE}/oauth2/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            grant_type: "authorization_code",
            code,
            redirect_uri: options.redirectUri,
            client_id: options.clientId,
            client_secret: options.clientSecret
        })
    });
    if (!tokenRes.ok) {
        throw new DiscordOAuthError(
            `Token exchange failed with status ${tokenRes.status}`
        );
    }
    const token = tokenResponseSchema.safeParse(await tokenRes.json());
    if (!token.success) {
        throw new DiscordOAuthError("Unexpected token response");
    }
    const granted = token.data.scope.split(" ");
    if (!SCOPES.every((scope) => granted.includes(scope))) {
        throw new DiscordOAuthError("Required scopes were not granted");
    }

    const userRes = await fetchImpl(`${API_BASE}/users/@me`, {
        headers: { Authorization: `Bearer ${token.data.access_token}` }
    });
    if (!userRes.ok) {
        throw new DiscordOAuthError(
            `User lookup failed with status ${userRes.status}`
        );
    }
    const user = userResponseSchema.safeParse(await userRes.json());
    if (!user.success) {
        throw new DiscordOAuthError("Unexpected user response");
    }
    return { accessToken: token.data.access_token, user: user.data };
}
