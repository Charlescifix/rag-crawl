import { assertSafeHost, SsrfError } from "../security/ssrf";
import { validateAndNormalizeUrl, ValidationError } from "../security/validate";

export const USER_AGENT =
  "LightweightCrawlerBot/0.1 (+https://github.com/lightweight-crawler/bot)";

const ALLOWED_CONTENT_TYPES = ["text/html", "application/xhtml+xml"];

const MAX_HTML_BYTES = 2_000_000;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 5;

export interface FetchResult {
  html: string;
  finalUrl: string;
  statusCode: number;
  contentType: string;
}

export class FetchError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number
  ) {
    super(message);
    this.name = "FetchError";
  }
}

export async function fetchPage(rawUrl: string): Promise<FetchResult> {
  let currentUrl = validateAndNormalizeUrl(rawUrl);
  let redirectCount = 0;

  while (true) {
    const parsed = new URL(currentUrl);
    await assertSafeHost(parsed.hostname);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(currentUrl, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "text/html,application/xhtml+xml",
        },
      });
    } catch (err: unknown) {
      if (err instanceof SsrfError || err instanceof ValidationError) throw err;
      if (err instanceof Error && err.name === "AbortError") {
        throw new FetchError(`Request timed out after ${REQUEST_TIMEOUT_MS}ms`);
      }
      throw new FetchError(`Fetch failed: ${(err as Error).message}`);
    } finally {
      clearTimeout(timer);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new FetchError("Redirect with no Location header");
      if (redirectCount >= MAX_REDIRECTS) {
        throw new FetchError(`Too many redirects (max ${MAX_REDIRECTS})`);
      }
      currentUrl = new URL(location, currentUrl).toString();
      redirectCount++;
      continue;
    }

    if (response.status < 200 || response.status >= 400) {
      throw new FetchError(`HTTP ${response.status}`, response.status);
    }

    const rawContentType = response.headers.get("content-type") ?? "";
    const contentType = rawContentType.split(";")[0].trim().toLowerCase();

    if (!ALLOWED_CONTENT_TYPES.includes(contentType)) {
      throw new FetchError(`Skipped content type: ${contentType}`);
    }

    const contentLength = response.headers.get("content-length");
    if (contentLength && parseInt(contentLength, 10) > MAX_HTML_BYTES) {
      throw new FetchError(`Response too large: ${contentLength} bytes`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new FetchError("No response body");

    const chunks: Uint8Array[] = [];
    let totalBytes = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_HTML_BYTES) {
        await reader.cancel();
        throw new FetchError(`Response body exceeded ${MAX_HTML_BYTES} bytes`);
      }
      chunks.push(value);
    }

    const html = Buffer.concat(chunks).toString("utf-8");

    return {
      html,
      finalUrl: currentUrl,
      statusCode: response.status,
      contentType: rawContentType,
    };
  }
}
