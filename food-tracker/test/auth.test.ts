import { describe, expect, it } from "vitest";
import { accessIssuer, devUserEmail, verifyAccessJwt } from "../src/auth";
import { AUD, makeSigner } from "./helpers";

const signer = await makeSigner();
const opts = { teamDomain: "test-team.cloudflareaccess.com", aud: AUD, keys: signer.keys };

describe("accessIssuer", () => {
  it.each([
    ["test-team", "https://test-team.cloudflareaccess.com"],
    ["test-team.cloudflareaccess.com", "https://test-team.cloudflareaccess.com"],
    ["https://Test-Team.cloudflareaccess.com/", "https://test-team.cloudflareaccess.com"],
  ])("normalizes %s", (input, expected) => {
    expect(accessIssuer(input)).toBe(expected);
  });

  it("rejects an empty team domain", () => {
    expect(() => accessIssuer("  ")).toThrow();
  });
});

describe("verifyAccessJwt", () => {
  it("returns the lowercased email for a valid token", async () => {
    expect(await verifyAccessJwt(await signer.sign(), opts)).toBe("daughter@example.com");
  });

  it("rejects the wrong audience", async () => {
    await expect(verifyAccessJwt(await signer.sign(undefined, { aud: "other-app" }), opts)).rejects.toThrow();
  });

  it("rejects the wrong issuer", async () => {
    const token = await signer.sign(undefined, { iss: "https://evil.cloudflareaccess.com" });
    await expect(verifyAccessJwt(token, opts)).rejects.toThrow();
  });

  it("rejects an expired token", async () => {
    const token = await signer.sign(undefined, { expiresIn: Math.floor(Date.now() / 1000) - 120 });
    await expect(verifyAccessJwt(token, opts)).rejects.toThrow();
  });

  it("rejects a token signed by a different key", async () => {
    const impostor = await makeSigner("test-key");
    await expect(verifyAccessJwt(await impostor.sign(), opts)).rejects.toThrow();
  });

  it("rejects a token with no email (e.g. a service token)", async () => {
    await expect(verifyAccessJwt(await signer.sign({ common_name: "svc" }), opts)).rejects.toThrow();
  });

  it("rejects garbage", async () => {
    await expect(verifyAccessJwt("not.a.jwt", opts)).rejects.toThrow();
  });

  it("rejects everything when ACCESS_AUD is unset", async () => {
    await expect(verifyAccessJwt(await signer.sign(), { ...opts, aud: "" })).rejects.toThrow();
  });
});

describe("devUserEmail", () => {
  it("is honored on localhost", () => {
    expect(devUserEmail("Me@Example.com", "http://localhost:8787/api/whoami")).toBe("me@example.com");
    expect(devUserEmail("me@example.com", "http://127.0.0.1:8787/api/whoami")).toBe("me@example.com");
  });

  it("is ignored on any other host", () => {
    expect(devUserEmail("me@example.com", "https://food.example.com/api/whoami")).toBeNull();
    expect(devUserEmail("me@example.com", "https://localhost.example.com/api/whoami")).toBeNull();
  });

  it("is off when unset", () => {
    expect(devUserEmail(undefined, "http://localhost:8787/api/whoami")).toBeNull();
    expect(devUserEmail("", "http://localhost:8787/api/whoami")).toBeNull();
  });
});
