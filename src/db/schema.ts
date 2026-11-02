export const CREATE_VERIFIED_USERS = `
CREATE TABLE IF NOT EXISTS verified_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    discord_user_id TEXT NOT NULL UNIQUE,
    google_sub TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL,
    student_id TEXT,
    verified_at INTEGER NOT NULL,
    guild_id TEXT NOT NULL
)`;

export type VerifiedUserRow = {
    id: number;
    discord_user_id: string;
    google_sub: string;
    email: string;
    student_id: string | null;
    verified_at: number;
    guild_id: string;
};

export type NewVerifiedUser = Omit<VerifiedUserRow, "id">;
