import { addMemberWithRole, type MemberRest } from "../bot/services/member.js";
import type { VerifiedUserRepository } from "../db/client.js";
import type { ChuoauthClaims, VerificationResult } from "../types/index.js";

export type VerificationDeps = {
    repo: VerifiedUserRepository;
    rest: MemberRest;
    guildId: string;
    roleId: string;
    now?: () => number;
};

/**
 * 重複検査、記録、ロール付与をまとめて行う。
 * 先に記録して UNIQUE 制約で同時リクエストを弾き、ロール付与に失敗したら記録を取り消す
 */
export async function completeVerification(
    deps: VerificationDeps,
    input: {
        discordUserId: string;
        discordAccessToken: string;
        claims: ChuoauthClaims;
    }
): Promise<VerificationResult> {
    const { repo } = deps;
    const { claims } = input;

    if (repo.findByDiscordUserId(input.discordUserId)) {
        return { ok: false, reason: "discord_already_verified" };
    }
    if (repo.findByGoogleSub(claims.sub)) {
        return { ok: false, reason: "google_account_already_used" };
    }

    const inserted = repo.insert({
        discord_user_id: input.discordUserId,
        google_sub: claims.sub,
        email: claims.email,
        student_id: claims.student_id,
        verified_at: Math.floor((deps.now?.() ?? Date.now()) / 1000),
        guild_id: deps.guildId
    });
    if (!inserted.ok) {
        return {
            ok: false,
            reason:
                inserted.conflict === "google_sub"
                    ? "google_account_already_used"
                    : "discord_already_verified"
        };
    }

    try {
        await addMemberWithRole(deps.rest, {
            guildId: deps.guildId,
            userId: input.discordUserId,
            roleId: deps.roleId,
            accessToken: input.discordAccessToken
        });
    } catch (err) {
        console.error("Failed to grant verified role", err);
        repo.deleteByDiscordUserId(input.discordUserId);
        return { ok: false, reason: "role_grant_failed" };
    }

    return { ok: true };
}
