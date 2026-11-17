import { randomBytes, scryptSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { FardeskError } from "../core/errors.js";
import { SCRYPT_BLOCK_SIZE, SCRYPT_COST, SCRYPT_PARALLELISM, hashPassword, verifyPassword } from "./password.js";

describe("hashPassword", () => {
  it("produces scrypt$N$r$p$salt$hash with the documented parameters and a fresh salt each time", async () => {
    const first = await hashPassword("hunter2hunter2");
    const second = await hashPassword("hunter2hunter2");
    const parts = first.split("$");
    expect(parts.slice(0, 4)).toEqual(["scrypt", String(SCRYPT_COST), String(SCRYPT_BLOCK_SIZE), String(SCRYPT_PARALLELISM)]);
    expect(SCRYPT_COST).toBe(32768);
    expect(Buffer.from(parts[4] as string, "base64")).toHaveLength(16);
    expect(Buffer.from(parts[5] as string, "base64")).toHaveLength(32);
    expect(first).not.toContain("hunter2");
    expect(second).not.toBe(first);
  });
});

describe("verifyPassword", () => {
  it("accepts the right password and rejects a wrong one", async () => {
    const stored = await hashPassword("right password");
    expect(await verifyPassword("right password", stored)).toBe(true);
    expect(await verifyPassword("wrong password", stored)).toBe(false);
  });

  it("reads the parameters from the stored string", async () => {
    const salt = randomBytes(16);
    const key = scryptSync("older password", salt, 24, { N: 1024, r: 8, p: 2 });
    const stored = ["scrypt", 1024, 8, 2, salt.toString("base64"), key.toString("base64")].join("$");
    expect(await verifyPassword("older password", stored)).toBe(true);
    expect(await verifyPassword("newer password", stored)).toBe(false);
  });

  it.each([
    ["not a hash"],
    ["bcrypt$1$2$3$c2FsdA==$aGFzaA=="],
    ["scrypt$abc$8$1$c2FsdA==$aGFzaA=="],
    ["scrypt$1000$8$1$c2FsdA==$aGFzaA=="],
    ["scrypt$1024$8$1$$aGFzaA=="],
    ["scrypt$4294967296$8$1$c2FsdA==$aGFzaA=="],
  ])("throws an internal error for the malformed stored value %j", async (stored) => {
    await expect(verifyPassword("anything", stored)).rejects.toSatisfy((error: unknown) => error instanceof FardeskError && error.code === "internal");
  });
});
