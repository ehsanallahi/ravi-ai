const PLACEHOLDER_ORIGIN = "https://ravi.invalid";

/**
 * Returns a same-origin relative path for post-login redirects, or the fallback.
 *
 * Browsers strip tabs and newlines and treat "\" like "/", so "/\t/evil.example" or
 * "/\evil.example" would become "//evil.example" (an open redirect). This rejects whitespace,
 * control characters and backslashes outright, then parses the result to confirm it is
 * same-origin.
 */
export function safeNextPath(next: string | null | undefined, fallback = "/dashboard"): string {
  if (!next || next.length > 512) return fallback;
  // eslint-disable-next-line no-control-regex -- control characters are exactly what we reject
  if (!/^\/[^\s\\\u0000-\u001f\u007f]*$/.test(next) || next.startsWith("//")) return fallback;
  let url: URL;
  try {
    url = new URL(next, PLACEHOLDER_ORIGIN);
  } catch {
    return fallback;
  }
  if (url.origin !== PLACEHOLDER_ORIGIN) return fallback;
  return `${url.pathname}${url.search}${url.hash}`;
}
