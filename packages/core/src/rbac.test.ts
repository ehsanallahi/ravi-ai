import { describe, expect, it } from "vitest";
import { assertCan, can, canAssignRole, ForbiddenError, PERMISSIONS } from "./rbac";

describe("rbac", () => {
  it("grants owners every permission", () => {
    for (const p of PERMISSIONS) expect(can("OWNER", p)).toBe(true);
  });

  it("keeps viewers read-only", () => {
    expect(can("VIEWER", "conversations:read")).toBe(true);
    expect(can("VIEWER", "conversations:reply")).toBe(false);
    expect(can("VIEWER", "leads:write")).toBe(false);
  });

  it("prevents agents from connecting WhatsApp or managing members", () => {
    expect(can("AGENT", "conversations:reply")).toBe(true);
    expect(can("AGENT", "whatsapp:connect")).toBe(false);
    expect(can("AGENT", "members:manage")).toBe(false);
  });

  it("denies missing roles", () => {
    expect(can(null, "contacts:read")).toBe(false);
    expect(() => assertCan(undefined, "contacts:read")).toThrow(ForbiddenError);
  });

  it("only lets owners assign the owner role", () => {
    expect(canAssignRole("OWNER", "OWNER")).toBe(true);
    expect(canAssignRole("ADMIN", "OWNER")).toBe(false);
    expect(canAssignRole("ADMIN", "AGENT")).toBe(true);
    expect(canAssignRole("AGENT", "VIEWER")).toBe(false);
  });
});
