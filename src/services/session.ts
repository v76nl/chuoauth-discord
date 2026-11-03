import { createHash, randomBytes } from "node:crypto";
import { EncryptJWT, jwtDecrypt } from "jose";
import { z } from "zod";

// 認証開始からchuoauthコールバックまでのCSRF対策値
export const startStateSchema = z.object({
    chuoauth_state: z.string()
});

// 大学アカウントの検証後からDiscordコールバックまで保持する情報。
// 学籍番号やメールアドレスを含むため、署名だけでなく暗号化して保持する
export const linkSessionSchema = z.object({
    google_sub: z.string(),
    email: z.string(),
    domain: z.string(),
    student_id: z.string().nullable(),
    discord_state: z.string()
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
    data: Record<string, string | null>,
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
