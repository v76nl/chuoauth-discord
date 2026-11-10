import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { Routes } from "discord.js";
import { beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type VerifiedUserRepository } from "../src/db/client.js";
import {
    completeVerification,
    type VerificationDeps
} from "../src/services/verification.js";
import type { ChuoauthClaims } from "../src/types/index.js";
import { asRest, createFakeRest } from "./helpers.js";

const GUILD = "100000000000000001";
const ROLE = "200000000000000002";
const ALICE = "300000000000000003";
const BOB = "300000000000000004";

const claims: ChuoauthClaims = {
    sub: "google-sub-1",
    email: "a0000000@g.chuo-u.ac.jp",
    domain: "g.chuo-u.ac.jp"
};

let repo: VerifiedUserRepository;
let rest: ReturnType<typeof createFakeRest>;
let deps: VerificationDeps;

beforeEach(() => {
    repo = openDatabase(":memory:");
    rest = createFakeRest();
    deps = {
        repo,
        rest: asRest(rest),
        guildId: GUILD,
        roleId: ROLE,
        now: () => 1_800_000_000_000
    };
});

const verify = (discordUserId: string, c: ChuoauthClaims = claims) =>
    completeVerification(deps, {
        discordUserId,
        discordAccessToken: "discord-access-token",
        claims: c
    });

describe("completeVerification", () => {
    it("ギルドへの追加とロール付与を行い、記録する", async () => {
        await expect(verify(ALICE)).resolves.toEqual({ ok: true });
        expect(rest.put).toHaveBeenCalledWith(
            Routes.guildMember(GUILD, ALICE),
            {
                body: { access_token: "discord-access-token", roles: [ROLE] },
                reason: expect.any(String)
            }
        );
        expect(rest.put).toHaveBeenCalledWith(
            Routes.guildMemberRole(GUILD, ALICE, ROLE),
            expect.anything()
        );
        expect(repo.findByDiscordUserId(ALICE)).toEqual({
            id: 1,
            discord_user_id: ALICE,
            google_sub: "google-sub-1",
            email: "a0000000@g.chuo-u.ac.jp",
            verified_at: 1_800_000_000,
            guild_id: GUILD
        });
    });

    it("認証済みのDiscordアカウントは拒否し、既存の記録を上書きしない", async () => {
        await verify(ALICE);
        rest.put.mockClear();

        const result = await verify(ALICE, {
            ...claims,
            sub: "google-sub-2",
            email: "b0000000@g.chuo-u.ac.jp"
        });
        expect(result).toEqual({
            ok: false,
            reason: "discord_already_verified"
        });
        expect(rest.put).not.toHaveBeenCalled();
        expect(repo.findByDiscordUserId(ALICE)?.google_sub).toBe(
            "google-sub-1"
        );
        expect(repo.findByGoogleSub("google-sub-2")).toBeUndefined();
    });

    it("使用済みの大学アカウントで別のDiscordアカウントを認証しようとすると拒否", async () => {
        await verify(ALICE);
        rest.put.mockClear();

        await expect(verify(BOB)).resolves.toEqual({
            ok: false,
            reason: "google_account_already_used"
        });
        expect(rest.put).not.toHaveBeenCalled();
        expect(repo.findByDiscordUserId(BOB)).toBeUndefined();
    });

    it("同時リクエストでも同じ大学アカウントは1件しか登録されない", async () => {
        const results = await Promise.all([verify(ALICE), verify(BOB)]);
        expect(results.filter((r) => r.ok)).toHaveLength(1);
        expect(results).toContainEqual({
            ok: false,
            reason: "google_account_already_used"
        });
    });

    it("ロール付与に失敗したら記録を取り消し、再試行できるようにする", async () => {
        rest.put.mockRejectedValueOnce(new Error("Missing Access"));
        await expect(verify(ALICE)).resolves.toEqual({
            ok: false,
            reason: "role_grant_failed"
        });
        expect(repo.findByDiscordUserId(ALICE)).toBeUndefined();

        await expect(verify(ALICE)).resolves.toMatchObject({ ok: true });
    });
});

describe("openDatabase", () => {
    it("UNIQUE 制約違反を衝突した列とともに返す", () => {
        const row = {
            discord_user_id: ALICE,
            google_sub: "sub",
            email: "a@g.chuo-u.ac.jp",
            verified_at: 0,
            guild_id: GUILD
        };
        expect(repo.insert(row)).toEqual({ ok: true });
        expect(repo.insert({ ...row, google_sub: "other" })).toEqual({
            ok: false,
            conflict: "discord_user_id"
        });
        expect(repo.insert({ ...row, discord_user_id: BOB })).toEqual({
            ok: false,
            conflict: "google_sub"
        });
    });

    it("旧スキーマの student_id 列を値ごと削除し、他の記録は残す", () => {
        const dir = mkdtempSync(join(tmpdir(), "chuoauth-discord-"));
        const path = join(dir, "legacy.db");
        try {
            const legacy = new Database(path);
            legacy.exec(`CREATE TABLE verified_users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                discord_user_id TEXT NOT NULL UNIQUE,
                google_sub TEXT NOT NULL UNIQUE,
                email TEXT NOT NULL,
                student_id TEXT,
                verified_at INTEGER NOT NULL,
                guild_id TEXT NOT NULL
            )`);
            legacy
                .prepare(
                    "INSERT INTO verified_users (discord_user_id, google_sub, email, student_id, verified_at, guild_id) VALUES (?, ?, ?, ?, ?, ?)"
                )
                .run(ALICE, "sub", "a@g.chuo-u.ac.jp", "a0000000", 0, GUILD);
            legacy.close();

            const migrated = openDatabase(path);
            expect(migrated.findByDiscordUserId(ALICE)).toEqual({
                id: 1,
                discord_user_id: ALICE,
                google_sub: "sub",
                email: "a@g.chuo-u.ac.jp",
                verified_at: 0,
                guild_id: GUILD
            });
            migrated.close();
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
