// chuoauthのJWTから取り出す利用者情報
export type ChuoauthClaims = {
    sub: string;
    email: string;
    domain: string;
    student_id: string | null;
};

export type DiscordUser = {
    id: string;
    username: string;
};

export type VerificationFailureReason =
    | "discord_already_verified"
    | "google_account_already_used"
    | "role_grant_failed";

export type VerificationResult =
    | { ok: true; nicknameUpdated: boolean }
    | { ok: false; reason: VerificationFailureReason };
