import { describe, expect, it, vi } from "vitest";
import {
    buildAuthorizeUrl,
    DiscordOAuthError,
    exchangeCode
} from "../src/services/discord-oauth.js";

const options = {
    clientId: "100000000000000001",
    clientSecret: "secret",
    redirectUri: "http://localhost:4000/auth/discord/callback"
};

const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" }
    });

describe("buildAuthorizeUrl", () => {
    it("identify と guilds.join を要求する", () => {
        const url = new URL(buildAuthorizeUrl(options, "state-1"));
        expect(url.origin + url.pathname).toBe(
            "https://discord.com/oauth2/authorize"
        );
        expect(url.searchParams.get("scope")).toBe("identify guilds.join");
        expect(url.searchParams.get("state")).toBe("state-1");
        expect(url.searchParams.get("redirect_uri")).toBe(options.redirectUri);
    });
});

describe("exchangeCode", () => {
    it("認可コードをトークンと利用者情報に交換する", async () => {
        const fetchMock = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(
                json({
                    access_token: "at",
                    token_type: "Bearer",
                    scope: "guilds.join identify"
                })
            )
            .mockResolvedValueOnce(json({ id: "42", username: "alice" }));

        await expect(exchangeCode(options, "code", fetchMock)).resolves.toEqual(
            {
                accessToken: "at",
                user: { id: "42", username: "alice" }
            }
        );
        const body = fetchMock.mock.calls[0]?.[1]?.body as URLSearchParams;
        expect(body.get("code")).toBe("code");
        expect(body.get("grant_type")).toBe("authorization_code");
        expect(fetchMock.mock.calls[1]?.[1]?.headers).toEqual({
            Authorization: "Bearer at"
        });
    });

    it("トークン交換が失敗したらエラー", async () => {
        const fetchMock = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(json({ error: "invalid_grant" }, 400));
        await expect(
            exchangeCode(options, "code", fetchMock)
        ).rejects.toBeInstanceOf(DiscordOAuthError);
    });

    it("guilds.join が許可されていなければエラー", async () => {
        const fetchMock = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(
                json({
                    access_token: "at",
                    token_type: "Bearer",
                    scope: "identify"
                })
            );
        await expect(exchangeCode(options, "code", fetchMock)).rejects.toThrow(
            "scopes"
        );
    });
});
