import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { z } from "zod";
import type { ChuoauthClaims } from "../types/index.js";

const claimsSchema = z.object({
    sub: z.string().min(1),
    email: z.string().min(1),
    domain: z.string(),
    student_id: z.string().nullable()
});

export class ChuoauthTokenError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "ChuoauthTokenError";
    }
}

export type ChuoauthVerifierOptions = {
    jwksUrl: string;
    issuer: string;
    audience?: string;
    allowedDomain: string;
};

export type ChuoauthVerifier = (token: string) => Promise<ChuoauthClaims>;

/**
 * chuoauthのJWKSで署名を検証する関数を作る。
 * 公開鍵は jose 側でキャッシュされ、未知の kid が来たときだけ再取得される
 */
export function createChuoauthVerifier(
    options: ChuoauthVerifierOptions,
    keys: JWTVerifyGetKey = createRemoteJWKSet(new URL(options.jwksUrl), {
        cacheMaxAge: 10 * 60 * 1000
    })
): ChuoauthVerifier {
    return async (token) => {
        let payload: unknown;
        try {
            ({ payload } = await jwtVerify(token, keys, {
                issuer: options.issuer,
                audience: options.audience,
                algorithms: ["RS256"],
                requiredClaims: ["exp", "sub"]
            }));
        } catch {
            throw new ChuoauthTokenError("Token verification failed");
        }

        const parsed = claimsSchema.safeParse(payload);
        if (!parsed.success) {
            throw new ChuoauthTokenError("Token claims are malformed");
        }
        if (parsed.data.domain !== options.allowedDomain) {
            throw new ChuoauthTokenError("Domain is not allowed");
        }
        return parsed.data;
    };
}
