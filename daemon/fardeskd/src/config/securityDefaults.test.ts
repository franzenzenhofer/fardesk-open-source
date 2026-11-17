import { describe, expect, it } from "vitest";
import { configSchema } from "./config.js";

const base = { name: "m", token: "k".repeat(48) };

describe("safe defaults", () => {
  it("starts with prompts on, bypass off, coordinator off and limited, generic push, tailnet-only bind", () => {
    const config = configSchema.parse(base);
    expect(config.owned).toMatchObject({ permissionMode: "default", allowBypass: false });
    expect(config.coordinator).toMatchObject({ enabled: false, permissionMode: "default", fullTools: false, mayApprove: false });
    expect(config.push).toEqual({ content: "generic" });
    expect(config.bind.allowNonTailnet).toBe(false);
  });

  it("keeps a partly written section working: every key has its own default", () => {
    const config = configSchema.parse({ ...base, owned: { allowBypass: true }, coordinator: { enabled: true } });
    expect(config.owned).toMatchObject({ permissionMode: "default", allowBypass: true, interruptTimeoutMs: 5000 });
    expect(config.coordinator).toMatchObject({ enabled: true, permissionMode: "default", fullTools: false, mayApprove: false });
  });

  it("accepts the settings that keep the old behaviour", () => {
    const config = configSchema.parse({
      ...base,
      owned: { permissionMode: "bypassPermissions", allowBypass: true },
      coordinator: { enabled: true, permissionMode: "bypassPermissions", fullTools: true, mayApprove: true },
      push: { content: "full" },
    });
    expect(config.owned.permissionMode).toBe("bypassPermissions");
    expect(config.coordinator.permissionMode).toBe("bypassPermissions");
    expect(config.push.content).toBe("full");
  });

  it("refuses bypassPermissions as a default while owned.allowBypass is off", () => {
    const result = configSchema.safeParse({ ...base, owned: { permissionMode: "bypassPermissions" } });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain("owned.allowBypass");
  });

  it("refuses a bypass coordinator while owned.allowBypass is off", () => {
    expect(configSchema.safeParse({ ...base, coordinator: { enabled: true, permissionMode: "bypassPermissions" } }).success).toBe(false);
  });

  it("rejects an unknown push content", () => {
    expect(configSchema.safeParse({ ...base, push: { content: "some" } }).success).toBe(false);
  });
});
