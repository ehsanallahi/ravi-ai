import { describe, expect, it } from "vitest";
import { assertSafeTestDatabaseUrl, UnsafeDatabaseError } from "./safety";

describe("assertSafeTestDatabaseUrl", () => {
  it("accepts local *_test databases", () => {
    expect(() =>
      assertSafeTestDatabaseUrl("postgresql://u:p@127.0.0.1:5432/ravi_ai_test"),
    ).not.toThrow();
    expect(() => assertSafeTestDatabaseUrl("postgres://u:p@localhost/x_test")).not.toThrow();
  });

  it.each([
    ["missing", undefined],
    ["remote host", "postgresql://u:p@db.example.com:5432/ravi_ai_test"],
    ["dev database", "postgresql://u:p@localhost:5432/ravi_ai_dev"],
    ["production-like name", "postgresql://u:p@localhost:5432/ravi_ai"],
    ["test as prefix only", "postgresql://u:p@localhost:5432/test_ravi_ai"],
    ["not postgres", "mysql://u:p@localhost:3306/ravi_ai_test"],
    ["garbage", "not a url"],
  ])("rejects %s", (_label, url) => {
    expect(() => assertSafeTestDatabaseUrl(url)).toThrow(UnsafeDatabaseError);
  });
});
