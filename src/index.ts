import "dotenv/config";
import { serve } from "@hono/node-server";
import { REST } from "discord.js";
import { createApp, LOGIN_PATH } from "./app.js";
import { createBotClient, registerCommands } from "./bot/client.js";
import { loadConfig } from "./config.js";
import { openDatabase } from "./db/client.js";
import { createChuoauthVerifier } from "./services/jwt.js";

const config = loadConfig();
const repo = openDatabase(config.databasePath);
const rest = new REST({ version: "10" }).setToken(config.discord.botToken);
const verifyToken = createChuoauthVerifier(config.chuoauth);

const app = createApp({ config, repo, rest, verifyToken });
const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
    console.log(`chuoauth-discord listening on http://localhost:${info.port}`);
});

const bot = createBotClient({
    guildId: config.discord.guildId,
    loginUrl: `${config.appBaseUrl}${LOGIN_PATH}`,
    repo
});
await registerCommands(rest, config.discord.clientId, config.discord.guildId);
await bot.login(config.discord.botToken);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
        void bot.destroy();
        server.close(() => {
            repo.close();
            process.exit(0);
        });
    });
}
