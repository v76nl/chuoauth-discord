import { z } from "zod";

const snowflake = z
    .string()
    .regex(/^\d{17,20}$/, "Discord ID must be a snowflake");

const envSchema = z.object({
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    NODE_ENV: z
        .enum(["development", "production", "test"])
        .default("development"),
    APP_BASE_URL: z.url(),
    SESSION_SECRET: z.string().min(32),
    DATABASE_PATH: z.string().min(1).default("data/chuoauth-discord.db"),
    DISCORD_CLIENT_ID: snowflake,
    DISCORD_CLIENT_SECRET: z.string().min(1),
    DISCORD_BOT_TOKEN: z.string().min(1),
    DISCORD_GUILD_ID: snowflake,
    DISCORD_VERIFIED_ROLE_ID: snowflake,
    DISCORD_REDIRECT_URI: z.url(),
    CHUOAUTH_BASE_URL: z.url(),
    CHUOAUTH_ISSUER: z.url().optional(),
    CHUOAUTH_JWKS_URL: z.url().optional(),
    CHUOAUTH_REDIRECT_URI: z.url(),
    CHUOAUTH_AUDIENCE: z.string().min(1).optional(),
    ALLOWED_DOMAIN: z.string().min(1).default("g.chuo-u.ac.jp")
});

export type Config = {
    port: number;
    nodeEnv: "development" | "production" | "test";
    appBaseUrl: string;
    sessionSecret: string;
    databasePath: string;
    discord: {
        clientId: string;
        clientSecret: string;
        botToken: string;
        guildId: string;
        verifiedRoleId: string;
        redirectUri: string;
    };
    chuoauth: {
        baseUrl: string;
        issuer: string;
        jwksUrl: string;
        redirectUri: string;
        audience?: string;
        allowedDomain: string;
    };
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
    // 空文字の環境変数は未設定として扱い、default / optional を効かせる
    const normalized = Object.fromEntries(
        Object.entries(env).filter(([, value]) => value !== "")
    );
    const result = envSchema.safeParse(normalized);
    if (!result.success) {
        throw new Error(
            `Invalid environment variables:\n${z.prettifyError(result.error)}`
        );
    }
    const e = result.data;
    const chuoauthBase = e.CHUOAUTH_BASE_URL.replace(/\/+$/, "");
    return {
        port: e.PORT,
        nodeEnv: e.NODE_ENV,
        appBaseUrl: e.APP_BASE_URL.replace(/\/+$/, ""),
        sessionSecret: e.SESSION_SECRET,
        databasePath: e.DATABASE_PATH,
        discord: {
            clientId: e.DISCORD_CLIENT_ID,
            clientSecret: e.DISCORD_CLIENT_SECRET,
            botToken: e.DISCORD_BOT_TOKEN,
            guildId: e.DISCORD_GUILD_ID,
            verifiedRoleId: e.DISCORD_VERIFIED_ROLE_ID,
            redirectUri: e.DISCORD_REDIRECT_URI
        },
        chuoauth: {
            baseUrl: chuoauthBase,
            issuer: e.CHUOAUTH_ISSUER ?? chuoauthBase,
            jwksUrl:
                e.CHUOAUTH_JWKS_URL ?? `${chuoauthBase}/.well-known/jwks.json`,
            redirectUri: e.CHUOAUTH_REDIRECT_URI,
            audience: e.CHUOAUTH_AUDIENCE,
            allowedDomain: e.ALLOWED_DOMAIN
        }
    };
}
