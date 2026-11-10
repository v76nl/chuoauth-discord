export const CREATE_VERIFIED_USERS = `
CREATE TABLE IF NOT EXISTS verified_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    discord_user_id TEXT NOT NULL UNIQUE,
    google_sub TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL,
    verified_at INTEGER NOT NULL,
    guild_id TEXT NOT NULL
)`;

export type VerifiedUserRow = {
    id: number;
    discord_user_id: string;
    google_sub: string;
    email: string;
    verified_at: number;
    guild_id: string;
};

export type NewVerifiedUser = Omit<VerifiedUserRow, "id">;

// 旧バージョンで作成したDBに残る列。保存済みの値ごと削除する
export const REMOVED_COLUMNS = ["student_id"] as const;
