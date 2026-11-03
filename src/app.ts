import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import type { MemberRest } from "./bot/services/member.js";
import type { Config } from "./config.js";
import type { VerifiedUserRepository } from "./db/client.js";
import { authRoutes } from "./routes/auth.js";
import { createViews } from "./routes/views.js";
import type { ChuoauthVerifier } from "./services/jwt.js";

export type AppDeps = {
    config: Config;
    repo: VerifiedUserRepository;
    rest: MemberRest;
    verifyToken: ChuoauthVerifier;
    // テストでDiscord APIを差し替えるため
    fetch?: typeof fetch;
};

export const LOGIN_PATH = "/auth/start";

export function createApp(deps: AppDeps): Hono {
    const app = new Hono();
    const views = createViews({
        isDev: deps.config.nodeEnv === "development",
        loginPath: LOGIN_PATH
    });

    if (deps.config.nodeEnv !== "test") {
        // クエリ文字列 (認可コードやJWT) をログに残さないよう、パスのみ記録する
        app.use(async (c, next) => {
            const start = Date.now();
            await next();
            console.log(
                `${c.req.method} ${c.req.path} ${c.res.status} ${Date.now() - start}ms`
            );
        });
    }
    app.use(
        secureHeaders({
            referrerPolicy: "no-referrer",
            contentSecurityPolicy: {
                defaultSrc: ["'none'"],
                styleSrc: ["'unsafe-inline'", "https://fonts.googleapis.com"],
                fontSrc: ["https://fonts.gstatic.com"],
                formAction: ["'none'"],
                frameAncestors: ["'none'"]
            }
        })
    );

    app.get("/", (c) => c.html(views.landing()));
    app.get("/health", (c) => c.json({ status: "ok" }));
    app.route("/auth", authRoutes(deps, views));

    app.notFound((c) => c.json({ error: "not_found" }, 404));
    app.onError((err, c) => {
        console.error(err);
        return c.html(views.error("server_error"), 500);
    });

    return app;
}
