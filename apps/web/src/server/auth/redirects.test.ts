import { describe, expect, it } from "vitest";
import { safeNextPath } from "./redirects";

describe("safeNextPath", () => {
  it("keeps same-origin relative paths", () => {
    expect(safeNextPath("/o/acme")).toBe("/o/acme");
    expect(safeNextPath("/o/acme/leads?status=NEW#top")).toBe("/o/acme/leads?status=NEW#top");
    expect(safeNextPath("/invite/abc_DEF-123")).toBe("/invite/abc_DEF-123");
  });

  it.each([
    ["protocol-relative", "//evil.example"],
    ["absolute URL", "https://evil.example"],
    ["tab trick", "/\t/evil.example"],
    ["newline trick", "/\n/evil.example"],
    ["carriage return", "/\r/evil.example"],
    ["backslash trick", "/\\evil.example"],
    ["mixed slashes", "/\\/evil.example"],
    ["javascript scheme", "javascript:alert(1)"],
    ["relative without slash", "o/acme"],
    ["null byte", "/o/acme\u0000"],
    ["empty", ""],
    ["too long", `/${"a".repeat(600)}`],
  ])("rejects %s", (_label, input) => {
    expect(safeNextPath(input)).toBe("/dashboard");
  });

  it("uses the provided fallback", () => {
    expect(safeNextPath(undefined, "/login")).toBe("/login");
  });
});
