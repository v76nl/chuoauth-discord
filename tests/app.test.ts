import type { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { openDatabase, type VerifiedUserRepository } from "../src/db/client.js";
import { createChuoauthVerifier } from "../src/services/jwt.js";
import {
    asRest,
    createFakeRest,
    createSigner,
    ISSUER,
    type Signer
} from "./helpers.js";

const config = loadConfig({
    NODE_ENV: "test",
    APP_BASE_URL: "http://localhost:4000",
    SESSION_SECRET: "x".repeat(32),
    DISCORD_CLIENT_ID: "100000000000000001",
    DISCORD_CLIENT_SECRET: "secret",
    DISCORD_BOT_TOKEN: "bot-token",
    DISCORD_GUILD_ID: "100000000000000002",
    DISCORD_VERIFIED_ROLE_ID: "100000000000000003",
    DISCORD_REDIRECT_URI: "http://localhost:4000/auth/discord/callback",
    CHUOAUTH_BASE_URL: ISSUER,
    CHUOAUTH_REDIRECT_URI: "http://localhost:4000/auth/chuoauth/callback"
});

let signer: Signer;
let repo: VerifiedUserRepository;
let rest: ReturnType<typeof createFakeRest>;
let app: Hono;

function discordFetch(userId: string) {
    return vi.fn<typeof fetch>(async (input) => {
        const url = String(input);
        const body = url.endsWith("/oauth2/token")
            ? {
                  access_token: `at-${userId}`,
                  token_type: "Bearer",
                  scope: "identify guilds.join"
              }
            : { id: userId, username: `user-${userId}` };
        return new Response(JSON.stringify(body), {
            headers: { "Content-Type": "application/json" }
        });
    });
}

function cookieOf(res: Response, name: string): string {
    const value = res.headers
        .getSetCookie()
        .map((c) => new RegExp(`^${name}=([^;]*)`).exec(c)?.[1])
        .find((v) => v);
    return `${name}=${value ?? ""}`;
}

/**
 * Discord連携を済ませ、chuoauthへリダイレクトされる直前までを再現する
 */
async function linkDiscord(userId: string) {
    signer ??= await createSigner();
    app = createApp({
        config,
        repo,
        rest: asRest(rest),
        verifyToken: createChuoauthVerifier(config.chuoauth, signer.keys),
        fetch: discordFetch(userId)
    });

    const login = await app.request("/auth/discord/login");
    const discordState = new URL(
        login.headers.get("location")!
    ).searchParams.get("state");
    const callback = await app.request(
        `/auth/discord/callback?code=c&state=${discordState}`,
        { headers: { Cookie: cookieOf(login, "cad_oauth") } }
    );
    return {
        callback,
        cookie: cookieOf(callback, "cad_session"),
        chuoauthState: callback.headers.get("location")
            ? new URL(callback.headers.get("location")!).searchParams.get(
                  "state"
              )
            : null
    };
}

async function finish(
    link: Awaited<ReturnType<typeof linkDiscord>>,
    token: string
) {
    return app.request(
        `/auth/chuoauth/callback?token=${token}&state=${link.chuoauthState}`,
        { headers: { Cookie: link.cookie } }
    );
}

beforeEach(() => {
    repo = openDatabase(":memory:");
    rest = createFakeRest();
});

describe("連携フロー", () => {
    it("Discord連携からchuoauth認証を経てロールを付与する", async () => {
        const link = await linkDiscord("300000000000000001");
        expect(link.callback.status).toBe(302);
        const location = new URL(link.callback.headers.get("location")!);
        expect(`${location.origin}${location.pathname}`).toBe(
            `${ISSUER}/auth/google/login`
        );
        expect(location.searchParams.get("redirect_uri")).toBe(
            config.chuoauth.redirectUri
        );

        const res = await finish(link, await signer.sign({}));
        expect(res.status).toBe(200);
        expect(await res.text()).toContain("認証が完了しました");
        expect(rest.put).toHaveBeenCalledTimes(2);
        expect(repo.findByDiscordUserId("300000000000000001")).toMatchObject({
            google_sub: "google-sub-1",
            student_id: "a0000000"
        });
    });

    it("同じ大学アカウントで別のDiscordアカウントを認証すると 409", async () => {
        await finish(
            await linkDiscord("300000000000000001"),
            await signer.sign({})
        );
        rest.put.mockClear();

        const res = await finish(
            await linkDiscord("300000000000000002"),
            await signer.sign({})
        );
        expect(res.status).toBe(409);
        expect(await res.text()).toContain("この大学アカウントは使用済みです");
        expect(rest.put).not.toHaveBeenCalled();
    });

    it("認証済みのDiscordアカウントはGoogle認証へ進ませない", async () => {
        await finish(
            await linkDiscord("300000000000000001"),
            await signer.sign({})
        );

        const again = await linkDiscord("300000000000000001");
        expect(again.callback.status).toBe(409);
        expect(again.callback.headers.get("location")).toBeNull();
    });

    it("chuoauthの state が一致しなければ拒否", async () => {
        const link = await linkDiscord("300000000000000001");
        const res = await finish(
            { ...link, chuoauthState: "forged" },
            await signer.sign({})
        );
        expect(res.status).toBe(400);
        expect(rest.put).not.toHaveBeenCalled();
    });

    it("セッションCookieがなければ拒否", async () => {
        const link = await linkDiscord("300000000000000001");
        const res = await finish(
            { ...link, cookie: "" },
            await signer.sign({})
        );
        expect(res.status).toBe(400);
    });

    it("chuoauthがエラーを返したら 403", async () => {
        const link = await linkDiscord("300000000000000001");
        const res = await app.request(
            `/auth/chuoauth/callback?error=access_denied&state=${link.chuoauthState}`,
            { headers: { Cookie: link.cookie } }
        );
        expect(res.status).toBe(403);
    });

    it("不正なJWTは 401", async () => {
        const link = await linkDiscord("300000000000000001");
        const other = await createSigner();
        const res = await finish(link, await other.sign({}));
        expect(res.status).toBe(401);
        expect(repo.findByDiscordUserId("300000000000000001")).toBeUndefined();
    });

    it("Discordの state が一致しなければ拒否", async () => {
        await linkDiscord("300000000000000001");
        const login = await app.request("/auth/discord/login");
        const res = await app.request(
            "/auth/discord/callback?code=c&state=forged",
            { headers: { Cookie: cookieOf(login, "cad_oauth") } }
        );
        expect(res.status).toBe(400);
    });
});
