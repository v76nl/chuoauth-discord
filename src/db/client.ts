import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import {
    CREATE_VERIFIED_USERS,
    REMOVED_COLUMNS,
    type NewVerifiedUser,
    type VerifiedUserRow
} from "./schema.js";

export type InsertResult =
    { ok: true } | { ok: false; conflict: "discord_user_id" | "google_sub" };

export type VerifiedUserRepository = {
    findByDiscordUserId(discordUserId: string): VerifiedUserRow | undefined;
    findByGoogleSub(googleSub: string): VerifiedUserRow | undefined;
    insert(user: NewVerifiedUser): InsertResult;
    deleteByDiscordUserId(discordUserId: string): void;
    close(): void;
};

/**
 * SQLiteを開き、テーブルがなければ作成する。":memory:" も指定できる
 */
export function openDatabase(path: string): VerifiedUserRepository {
    if (path !== ":memory:") {
        mkdirSync(dirname(path), { recursive: true });
    }
    const db = new Database(path);
    db.pragma("journal_mode = WAL");
    db.exec(CREATE_VERIFIED_USERS);
    dropRemovedColumns(db);

    const byDiscord = db.prepare<[string], VerifiedUserRow>(
        "SELECT * FROM verified_users WHERE discord_user_id = ?"
    );
    const bySub = db.prepare<[string], VerifiedUserRow>(
        "SELECT * FROM verified_users WHERE google_sub = ?"
    );
    const insertStmt = db.prepare<[NewVerifiedUser]>(
        `INSERT INTO verified_users
            (discord_user_id, google_sub, email, verified_at, guild_id)
         VALUES
            (@discord_user_id, @google_sub, @email, @verified_at, @guild_id)`
    );
    const deleteStmt = db.prepare<[string]>(
        "DELETE FROM verified_users WHERE discord_user_id = ?"
    );

    return {
        findByDiscordUserId: (id) => byDiscord.get(id),
        findByGoogleSub: (sub) => bySub.get(sub),
        insert(user) {
            try {
                insertStmt.run(user);
                return { ok: true };
            } catch (err) {
                // 事前チェックと挿入の間に競合した場合も UNIQUE 制約で弾く
                if (
                    err instanceof Database.SqliteError &&
                    err.code === "SQLITE_CONSTRAINT_UNIQUE"
                ) {
                    return {
                        ok: false,
                        conflict: err.message.includes("google_sub")
                            ? "google_sub"
                            : "discord_user_id"
                    };
                }
                throw err;
            }
        },
        deleteByDiscordUserId: (id) => {
            deleteStmt.run(id);
        },
        close: () => db.close()
    };
}

function dropRemovedColumns(db: Database.Database): void {
    const columns = new Set(
        db
            .prepare<[], { name: string }>(
                "SELECT name FROM pragma_table_info('verified_users')"
            )
            .all()
            .map((column) => column.name)
    );
    for (const column of REMOVED_COLUMNS) {
        if (columns.has(column)) {
            db.exec(`ALTER TABLE verified_users DROP COLUMN ${column}`);
        }
    }
}
