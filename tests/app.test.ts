import type { Hono } from "hono";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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

const ALICE = "300000000000000001";
const BOB = "300000000000000002";

let signer: Signer;
let repo: VerifiedUserRepository;
let rest: ReturnType<typeof createFakeRest>;
let discordUserId: string;
let app: Hono;

function cookieOf(res: Response, name: string): string {
    const value = res.headers
        .getSetCookie()
        .map((c) => new RegExp(`^${name}=([^;]*)`).exec(c)?.[1])
        .find((v) => v);
    return `${name}=${value ?? ""}`;
}

const stateOf = (res: Response) =>
    new URL(res.headers.get("location")!).searchParams.get("state");

/**
 * 認証開始からchuoauthでの認証を済ませ、Discordへリダイレクトされるまでを再現する
 */
async function verifyUniversity(token?: string) {
    const start = await app.request("/auth/start");
    const callback = await app.request(
        `/auth/chuoauth/callback?token=${token ?? (await signer.sign({}))}&state=${stateOf(start)}`,
        { headers: { Cookie: cookieOf(start, "cad_start") } }
    );
    return {
        start,
        callback,
        cookie: cookieOf(callback, "cad_session"),
        discordState: callback.headers.get("location")
            ? stateOf(callback)
            : null
    };
}

async function linkDiscord(
    step: Awaited<ReturnType<typeof verifyUniversity>>,
    userId: string
) {
    discordUserId = userId;
    return app.request(
        `/auth/discord/callback?code=c&state=${step.discordState}`,
        { headers: { Cookie: step.cookie } }
    );
}

beforeAll(async () => {
    signer = await createSigner();
});

beforeEach(() => {
    repo = openDatabase(":memory:");
    rest = createFakeRest();
    app = createApp({
        config,
        repo,
        rest: asRest(rest),
        verifyToken: createChuoauthVerifier(config.chuoauth, signer.keys),
        fetch: vi.fn<typeof fetch>(async (input) => {
            const body = String(input).endsWith("/oauth2/token")
                ? {
                      access_token: `at-${discordUserId}`,
                      token_type: "Bearer",
                      scope: "identify guilds.join"
                  }
                : { id: discordUserId, username: `user-${discordUserId}` };
            return new Response(JSON.stringify(body), {
                headers: { "Content-Type": "application/json" }
            });
        })
    });
});

describe("連携フロー", () => {
    it("大学アカウント認証からDiscord連携を経てサーバー参加とロール付与を行う", async () => {
        const step = await verifyUniversity();
        const chuoauthLogin = new URL(step.start.headers.get("location")!);
        expect(`${chuoauthLogin.origin}${chuoauthLogin.pathname}`).toBe(
            `${ISSUER}/auth/google/login`
        );
        expect(chuoauthLogin.searchParams.get("redirect_uri")).toBe(
            config.chuoauth.redirectUri
        );

        expect(step.callback.status).toBe(302);
        const discordAuthorize = new URL(
            step.callback.headers.get("location")!
        );
        expect(discordAuthorize.hostname).toBe("discord.com");
        expect(discordAuthorize.searchParams.get("scope")).toBe(
            "identify guilds.join"
        );

        const res = await linkDiscord(step, ALICE);
        expect(res.status).toBe(200);
        expect(await res.text()).toContain("認証が完了しました");
        expect(rest.put).toHaveBeenCalledWith(
            expect.stringContaining(`/members/${ALICE}`),
            expect.objectContaining({
                body: expect.objectContaining({ access_token: `at-${ALICE}` })
            })
        );
        expect(repo.findByDiscordUserId(ALICE)).toMatchObject({
            google_sub: "google-sub-1"
        });
    });

    it("使用済みの大学アカウントはDiscord連携へ進ませない", async () => {
        await linkDiscord(await verifyUniversity(), ALICE);
        rest.put.mockClear();

        const again = await verifyUniversity();
        expect(again.callback.status).toBe(409);
        expect(await again.callback.text()).toContain(
            "この大学アカウントは使用済みです"
        );
        expect(again.callback.headers.get("location")).toBeNull();
        expect(rest.put).not.toHaveBeenCalled();
    });

    it("認証済みのDiscordアカウントを別の大学アカウントで認証すると 409", async () => {
        await linkDiscord(await verifyUniversity(), ALICE);
        rest.put.mockClear();

        const other = await verifyUniversity(
            await signer.sign({
                sub: "google-sub-2",
                email: "b0000000@g.chuo-u.ac.jp"
            })
        );
        const res = await linkDiscord(other, ALICE);
        expect(res.status).toBe(409);
        expect(await res.text()).toContain(
            "このDiscordアカウントは認証済みです"
        );
        expect(rest.put).not.toHaveBeenCalled();
        expect(repo.findByGoogleSub("google-sub-2")).toBeUndefined();
    });

    it("Discord連携の途中で同じ大学アカウントが使われたら 409", async () => {
        // 2つのブラウザで同時に大学アカウント認証を済ませた状態
        const first = await verifyUniversity();
        const second = await verifyUniversity();
        expect((await linkDiscord(first, ALICE)).status).toBe(200);

        const res = await linkDiscord(second, BOB);
        expect(res.status).toBe(409);
        expect(repo.findByDiscordUserId(BOB)).toBeUndefined();
    });

    it("chuoauthの state が一致しなければ拒否", async () => {
        const start = await app.request("/auth/start");
        const res = await app.request(
            `/auth/chuoauth/callback?token=${await signer.sign({})}&state=forged`,
            { headers: { Cookie: cookieOf(start, "cad_start") } }
        );
        expect(res.status).toBe(400);
    });

    it("chuoauthがエラーを返したら 403", async () => {
        const start = await app.request("/auth/start");
        const res = await app.request(
            `/auth/chuoauth/callback?error=access_denied&state=${stateOf(start)}`,
            { headers: { Cookie: cookieOf(start, "cad_start") } }
        );
        expect(res.status).toBe(403);
    });

    it("不正なJWTは 401 でDiscord連携へ進ませない", async () => {
        const other = await createSigner();
        const step = await verifyUniversity(await other.sign({}));
        expect(step.callback.status).toBe(401);
        expect(step.callback.headers.get("location")).toBeNull();
    });

    it("Discordの state が一致しなければ拒否", async () => {
        const step = await verifyUniversity();
        const res = await linkDiscord(
            { ...step, discordState: "forged" },
            ALICE
        );
        expect(res.status).toBe(400);
        expect(rest.put).not.toHaveBeenCalled();
    });

    it("セッションCookieがなければ拒否", async () => {
        const step = await verifyUniversity();
        const res = await linkDiscord({ ...step, cookie: "" }, ALICE);
        expect(res.status).toBe(400);
    });

    it("Discordで連携をキャンセルしたら 403", async () => {
        const step = await verifyUniversity();
        const res = await app.request(
            `/auth/discord/callback?error=access_denied&state=${step.discordState}`,
            { headers: { Cookie: step.cookie } }
        );
        expect(res.status).toBe(403);
    });

    it("トップページから認証開始URLへ案内する", async () => {
        const res = await app.request("/");
        expect(await res.text()).toContain('href="/auth/start"');
    });
});
