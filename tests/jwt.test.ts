import { beforeAll, describe, expect, it } from "vitest";
import {
    ChuoauthTokenError,
    createChuoauthVerifier,
    type ChuoauthVerifier
} from "../src/services/jwt.js";
import { createSigner, ISSUER, type Signer } from "./helpers.js";

let signer: Signer;
let verify: ChuoauthVerifier;

beforeAll(async () => {
    signer = await createSigner();
    verify = createChuoauthVerifier(
        {
            jwksUrl: `${ISSUER}/.well-known/jwks.json`,
            issuer: ISSUER,
            allowedDomain: "g.chuo-u.ac.jp"
        },
        signer.keys
    );
});

describe("createChuoauthVerifier", () => {
    it("正しいトークンから利用者情報を取り出す", async () => {
        const token = await signer.sign({ sub: "google-sub-1" });
        await expect(verify(token)).resolves.toEqual({
            sub: "google-sub-1",
            email: "a0000000@g.chuo-u.ac.jp",
            domain: "g.chuo-u.ac.jp",
            student_id: "a0000000"
        });
    });

    it("student_id が null でも受け付ける", async () => {
        const token = await signer.sign({ student_id: null });
        await expect(verify(token)).resolves.toMatchObject({
            student_id: null
        });
    });

    it("iss が異なれば拒否", async () => {
        const token = await signer.sign({}, { issuer: "https://evil.example" });
        await expect(verify(token)).rejects.toBeInstanceOf(ChuoauthTokenError);
    });

    it("期限切れなら拒否", async () => {
        const token = await signer.sign({}, { expiresIn: "-1s" });
        await expect(verify(token)).rejects.toBeInstanceOf(ChuoauthTokenError);
    });

    it("domain が異なれば拒否", async () => {
        const token = await signer.sign({ domain: "example.com" });
        await expect(verify(token)).rejects.toThrow("Domain is not allowed");
    });

    it("別の鍵で署名されたトークンは拒否", async () => {
        const other = await createSigner();
        const token = await other.sign({});
        await expect(verify(token)).rejects.toBeInstanceOf(ChuoauthTokenError);
    });

    it("改ざんされたトークンは拒否", async () => {
        const token = await signer.sign({});
        const [header, , signature] = token.split(".");
        const forged = Buffer.from(
            JSON.stringify({
                iss: ISSUER,
                sub: "attacker",
                email: "x@g.chuo-u.ac.jp",
                domain: "g.chuo-u.ac.jp",
                student_id: null,
                exp: Math.floor(Date.now() / 1000) + 600
            })
        ).toString("base64url");
        await expect(
            verify(`${header}.${forged}.${signature}`)
        ).rejects.toBeInstanceOf(ChuoauthTokenError);
    });

    it("必須クレームが欠けていれば拒否", async () => {
        const token = await signer.sign({ email: undefined });
        await expect(verify(token)).rejects.toThrow("malformed");
    });
});
