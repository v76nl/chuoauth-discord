import { createHash, randomBytes } from "node:crypto";
import { EncryptJWT, jwtDecrypt } from "jose";
import { z } from "zod";

// Discord認可の開始からコールバックまでのCSRF対策値
export const oauthStateSchema = z.object({
    discord_state: z.string()
});

// Discord認可後からchuoauthコールバックまで保持する情報。
// guilds.join で利用者をサーバーに追加するため、アクセストークンも暗号化して保持する
export const linkSessionSchema = z.object({
    discord_user_id: z.string(),
    discord_username: z.string(),
    discord_access_token: z.string(),
    chuoauth_state: z.string()
});

export type LinkSession = z.infer<typeof linkSessionSchema>;

export const SESSION_TTL_SECONDS = 600;

export function randomToken(): string {
    return randomBytes(32).toString("base64url");
}

function deriveKey(secret: string): Uint8Array {
    return createHash("sha256").update(secret).digest();
}

export async function seal(
    data: Record<string, string>,
    secret: string
): Promise<string> {
    return new EncryptJWT(data)
        .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
        .setIssuedAt()
        .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
        .encrypt(deriveKey(secret));
}

/**
 * 改ざん・期限切れ・形式不正の場合は null を返す
 */
export async function unseal<T>(
    sealed: string | undefined,
    secret: string,
    schema: z.ZodType<T>
): Promise<T | null> {
    if (!sealed) {
        return null;
    }
    try {
        const { payload } = await jwtDecrypt(sealed, deriveKey(secret));
        const result = schema.safeParse(payload);
        return result.success ? result.data : null;
    } catch {
        return null;
    }
}
