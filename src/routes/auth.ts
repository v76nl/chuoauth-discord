import { Hono } from "hono";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { AppDeps } from "../app.js";
import {
    buildAuthorizeUrl,
    DiscordOAuthError,
    exchangeCode
} from "../services/discord-oauth.js";
import { ChuoauthTokenError } from "../services/jwt.js";
import {
    linkSessionSchema,
    randomToken,
    seal,
    SESSION_TTL_SECONDS,
    startStateSchema,
    unseal
} from "../services/session.js";
import { completeVerification } from "../services/verification.js";
import type { VerificationFailureReason } from "../types/index.js";
import type { ErrorKind, Views } from "./views.js";

const START_COOKIE = "cad_start";
const SESSION_COOKIE = "cad_session";
const COOKIE_PATH = "/auth";

const FAILURE_STATUS: Record<VerificationFailureReason, ContentfulStatusCode> =
    {
        discord_already_verified: 409,
        google_account_already_used: 409,
        role_grant_failed: 502
    };

export function authRoutes(deps: AppDeps, views: Views): Hono {
    const { config } = deps;
    const secure = new URL(config.appBaseUrl).protocol === "https:";
    const discordOptions = {
        clientId: config.discord.clientId,
        clientSecret: config.discord.clientSecret,
        redirectUri: config.discord.redirectUri
    };
    const app = new Hono();

    // chuoauth・Discordからのトップレベル遷移でも送られるよう SameSite=Lax にする
    const writeCookie = (c: Context, name: string, value: string) =>
        setCookie(c, name, value, {
            path: COOKIE_PATH,
            httpOnly: true,
            secure,
            sameSite: "Lax",
            maxAge: SESSION_TTL_SECONDS
        });
    const takeCookie = (c: Context, name: string) => {
        const value = getCookie(c, name);
        deleteCookie(c, name, { path: COOKIE_PATH, secure });
        return value;
    };
    const fail = (c: Context, kind: ErrorKind, status: ContentfulStatusCode) =>
        c.html(views.error(kind), status);

    // 学生以外をDiscord連携の前に弾くため、大学アカウント認証から始める
    app.get("/start", async (c) => {
        const state = randomToken();
        writeCookie(
            c,
            START_COOKIE,
            await seal({ chuoauth_state: state }, config.sessionSecret)
        );
        const login = new URL(`${config.chuoauth.baseUrl}/auth/google/login`);
        login.searchParams.set("redirect_uri", config.chuoauth.redirectUri);
        login.searchParams.set("state", state);
        return c.redirect(login.toString(), 302);
    });

    app.get("/chuoauth/callback", async (c) => {
        const start = await unseal(
            takeCookie(c, START_COOKIE),
            config.sessionSecret,
            startStateSchema
        );
        const { token, state, error } = c.req.query();
        if (!start || state !== start.chuoauth_state) {
            return fail(c, "invalid_session", 400);
        }
        if (error || !token) {
            return fail(c, "chuoauth_denied", 403);
        }

        let claims;
        try {
            claims = await deps.verifyToken(token);
        } catch (err) {
            if (err instanceof ChuoauthTokenError) {
                console.warn(err.message);
                return fail(c, "invalid_token", 401);
            }
            throw err;
        }
        // Discord連携へ進ませる前に、使用済みの大学アカウントを弾く
        if (deps.repo.findByGoogleSub(claims.sub)) {
            return fail(c, "google_account_already_used", 409);
        }

        const discordState = randomToken();
        writeCookie(
            c,
            SESSION_COOKIE,
            await seal(
                {
                    google_sub: claims.sub,
                    email: claims.email,
                    domain: claims.domain,
                    discord_state: discordState
                },
                config.sessionSecret
            )
        );
        return c.redirect(buildAuthorizeUrl(discordOptions, discordState), 302);
    });

    app.get("/discord/callback", async (c) => {
        const session = await unseal(
            takeCookie(c, SESSION_COOKIE),
            config.sessionSecret,
            linkSessionSchema
        );
        const { code, state, error } = c.req.query();
        if (!session || state !== session.discord_state) {
            return fail(c, "invalid_session", 400);
        }
        if (error || !code) {
            return fail(c, "discord_denied", 403);
        }

        let discord;
        try {
            discord = await exchangeCode(discordOptions, code, deps.fetch);
        } catch (err) {
            if (err instanceof DiscordOAuthError) {
                console.warn(err.message);
                return fail(c, "discord_failed", 502);
            }
            throw err;
        }

        const result = await completeVerification(
            {
                repo: deps.repo,
                rest: deps.rest,
                guildId: config.discord.guildId,
                roleId: config.discord.verifiedRoleId
            },
            {
                discordUserId: discord.user.id,
                discordAccessToken: discord.accessToken,
                claims: {
                    sub: session.google_sub,
                    email: session.email,
                    domain: session.domain
                }
            }
        );
        if (!result.ok) {
            return fail(c, result.reason, FAILURE_STATUS[result.reason]);
        }
        return c.html(
            views.success({
                discordUsername: discord.user.username,
                email: session.email
            })
        );
    });

    return app;
}
