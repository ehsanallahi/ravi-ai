import { describe, expect, it } from "vitest";
import { diagnoseConnection, graphGet, maskPhone, redactToken } from "./graph";

const TOKEN = "EAAtest-token-value-1234567890";
const PHONE_ID = "1234567890123456";
const WABA_ID = "98765432109876543";

type Route = (url: URL) => { status: number; body: unknown };

function fakeFetch(route: Route) {
  const calls: { url: URL; init: RequestInit | undefined }[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    const { status, body } = route(url);
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  return { impl, calls };
}

const healthy: Route = (url) => {
  const path = url.pathname.split("/").slice(2).join("/");
  if (path === PHONE_ID) {
    return {
      status: 200,
      body: {
        id: PHONE_ID,
        display_phone_number: "+1 555 010 0199",
        verified_name: "Test Number",
        platform_type: "CLOUD_API",
        quality_rating: "GREEN",
      },
    };
  }
  if (path === WABA_ID) return { status: 200, body: { id: WABA_ID, name: "Ravi AI Test" } };
  if (path === `${WABA_ID}/phone_numbers`)
    return { status: 200, body: { data: [{ id: PHONE_ID }] } };
  if (path === `${WABA_ID}/subscribed_apps`) {
    return {
      status: 200,
      body: { data: [{ whatsapp_business_api_data: { id: "4242", name: "Ravi AI" } }] },
    };
  }
  return { status: 404, body: { error: { message: "not found", code: 803 } } };
};

describe("graphGet", () => {
  it("sends the token only in the Authorization header and uses GET", async () => {
    const { impl, calls } = fakeFetch(healthy);
    await graphGet({
      accessToken: TOKEN,
      graphApiVersion: "v24.0",
      path: PHONE_ID,
      fetchImpl: impl,
    });
    expect(calls[0]!.init?.method).toBe("GET");
    expect(calls[0]!.url.toString()).not.toContain(TOKEN);
    expect((calls[0]!.init?.headers as Record<string, string>).Authorization).toBe(
      `Bearer ${TOKEN}`,
    );
  });

  it("rejects paths that are not numeric IDs", async () => {
    const { impl } = fakeFetch(healthy);
    await expect(
      graphGet({ accessToken: TOKEN, graphApiVersion: "v24.0", path: "../me", fetchImpl: impl }),
    ).rejects.toThrow("Invalid Graph API path");
  });

  it("redacts the token if Meta echoes it in an error", async () => {
    const { impl } = fakeFetch(() => ({
      status: 400,
      body: { error: { message: `Malformed access token ${TOKEN}`, code: 190 } },
    }));
    const err = await graphGet({
      accessToken: TOKEN,
      graphApiVersion: "v24.0",
      path: PHONE_ID,
      fetchImpl: impl,
    }).catch((e: Error) => e);
    expect(String(err)).toContain("code 190");
    expect(String(err)).not.toContain(TOKEN);
  });
});

describe("diagnoseConnection", () => {
  const params = { accessToken: TOKEN, phoneNumberId: PHONE_ID, wabaId: WABA_ID, appId: "4242" };

  it("passes for a readable number that belongs to a subscribed account", async () => {
    const { impl, calls } = fakeFetch(healthy);
    const d = await diagnoseConnection({ ...params, graphApiVersion: "v26.0", fetchImpl: impl });
    expect(d.ok).toBe(true);
    expect(d.checks.map((c) => c.status)).toEqual(["pass", "pass", "pass", "pass", "pass"]);
    expect(calls.every((c) => c.init?.method === "GET")).toBe(true);
    expect(JSON.stringify(d.checks)).not.toContain("010 0199");
  });

  it("warns on an older but available Graph API version", async () => {
    const { impl } = fakeFetch(healthy);
    const d = await diagnoseConnection({ ...params, graphApiVersion: "v24.0", fetchImpl: impl });
    expect(d.ok).toBe(true);
    expect(d.checks[0]).toMatchObject({ status: "warn" });
  });

  it("fails when the phone number is not on the business account", async () => {
    const { impl } = fakeFetch((url) =>
      url.pathname.endsWith("/phone_numbers")
        ? { status: 200, body: { data: [{ id: "111" }] } }
        : healthy(url),
    );
    const d = await diagnoseConnection({ ...params, graphApiVersion: "v26.0", fetchImpl: impl });
    expect(d.ok).toBe(false);
    expect(d.checks.find((c) => c.name.startsWith("Phone number belongs"))?.status).toBe("fail");
  });

  it("reports an expired token without leaking it", async () => {
    const { impl } = fakeFetch(() => ({
      status: 401,
      body: {
        error: {
          message: "Error validating access token: Session has expired",
          code: 190,
          error_subcode: 463,
        },
      },
    }));
    const d = await diagnoseConnection({ ...params, graphApiVersion: "v26.0", fetchImpl: impl });
    expect(d.ok).toBe(false);
    expect(d.checks[1]).toMatchObject({ status: "fail" });
    expect(d.checks[1]!.detail).toContain("190/463");
    expect(JSON.stringify(d)).not.toContain(TOKEN);
  });

  it("warns when only another app (e.g. Meta's sample app) is subscribed", async () => {
    const { impl } = fakeFetch(healthy);
    const d = await diagnoseConnection({
      ...params,
      appId: "999",
      graphApiVersion: "v26.0",
      fetchImpl: impl,
    });
    expect(d.checks.at(-1)).toMatchObject({ status: "warn" });
    expect(d.checks.at(-1)!.detail).toContain("NOT subscribed");
  });

  it("warns when no app is subscribed to webhooks", async () => {
    const { impl } = fakeFetch((url) =>
      url.pathname.endsWith("/subscribed_apps")
        ? { status: 200, body: { data: [] } }
        : healthy(url),
    );
    const d = await diagnoseConnection({ ...params, graphApiVersion: "v26.0", fetchImpl: impl });
    expect(d.ok).toBe(true);
    expect(d.checks.at(-1)).toMatchObject({ status: "warn" });
  });
});

describe("helpers", () => {
  it("masks phone numbers and redacts tokens", () => {
    expect(maskPhone("+1 555 010 0199")).toBe("+1555*****99");
    expect(redactToken(`a ${TOKEN} b`, TOKEN)).toBe("a [REDACTED] b");
  });
});
