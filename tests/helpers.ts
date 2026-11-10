import {
    createLocalJWKSet,
    exportJWK,
    generateKeyPair,
    SignJWT,
    type JWTVerifyGetKey
} from "jose";
import { vi } from "vitest";
import type { MemberRest } from "../src/bot/services/member.js";

export const ISSUER = "http://localhost:3000";
export const KID = "test-key";

export type Signer = {
    keys: JWTVerifyGetKey;
    sign(
        claims: Record<string, unknown>,
        options?: { issuer?: string; expiresIn?: string; alg?: string }
    ): Promise<string>;
};

/**
 * chuoauthと同じ形式のJWTを発行するテスト用の署名器
 */
export async function createSigner(): Promise<Signer> {
    const { privateKey, publicKey } = await generateKeyPair("RS256");
    const jwk = { ...(await exportJWK(publicKey)), kid: KID, alg: "RS256" };
    return {
        keys: createLocalJWKSet({ keys: [jwk] }),
        sign: (claims, options = {}) =>
            new SignJWT({
                email: "a0000000@g.chuo-u.ac.jp",
                domain: "g.chuo-u.ac.jp",
                ...claims
            })
                .setProtectedHeader({ alg: "RS256", typ: "JWT", kid: KID })
                .setIssuer(options.issuer ?? ISSUER)
                .setSubject(
                    typeof claims.sub === "string" ? claims.sub : "google-sub-1"
                )
                .setIssuedAt()
                .setExpirationTime(options.expiresIn ?? "10m")
                .sign(privateKey)
    };
}

export function createFakeRest() {
    return {
        put: vi.fn(async () => undefined)
    } satisfies Record<keyof MemberRest, unknown>;
}

export const asRest = (fake: ReturnType<typeof createFakeRest>) =>
    fake as unknown as MemberRest;
