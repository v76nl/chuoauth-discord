import { Routes, type REST } from "discord.js";

export type MemberRest = Pick<REST, "put" | "patch">;

const AUDIT_LOG_REASON = "chuoauth: 大学アカウント認証";

/**
 * 対象ユーザーをギルドに参加させたうえで認証済みロールを付与する
 */
export async function addMemberWithRole(
    rest: MemberRest,
    options: {
        guildId: string;
        userId: string;
        roleId: string;
        accessToken: string;
    }
): Promise<void> {
    // 未参加ならguilds.joinで追加と同時にロールを付ける。参加済みの場合このAPIは何も変更しない
    await rest.put(Routes.guildMember(options.guildId, options.userId), {
        body: { access_token: options.accessToken, roles: [options.roleId] },
        reason: AUDIT_LOG_REASON
    });
    // 参加済みメンバーには上のAPIでロールが付かないため、ロール付与APIも呼ぶ (冪等)
    await rest.put(
        Routes.guildMemberRole(options.guildId, options.userId, options.roleId),
        { reason: AUDIT_LOG_REASON }
    );
}

/**
 * ニックネームを変更する。サーバー所有者やBotより上位ロールのメンバーは変更できないため、
 * 失敗しても認証自体は成功扱いとし false を返す
 */
export async function setNickname(
    rest: MemberRest,
    options: { guildId: string; userId: string; nickname: string }
): Promise<boolean> {
    try {
        await rest.patch(Routes.guildMember(options.guildId, options.userId), {
            body: { nick: options.nickname },
            reason: AUDIT_LOG_REASON
        });
        return true;
    } catch (err) {
        console.warn("Failed to update nickname", err);
        return false;
    }
}
