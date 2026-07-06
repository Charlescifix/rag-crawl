export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

const ALLOWED_SCHEMES = new Set(["http:", "https:"]);

const TRACKING_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "fbclid",
  "gclid",
]);

export function validateAndNormalizeUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    throw new ValidationError(`Invalid URL: ${raw}`);
  }

  if (!ALLOWED_SCHEMES.has(parsed.protocol)) {
    throw new ValidationError(`Unsupported scheme: ${parsed.protocol}`);
  }

  if (!parsed.hostname) {
    throw new ValidationError("URL has no hostname");
  }

  // Strip fragment
  parsed.hash = "";

  // Remove tracking query params
  for (const key of TRACKING_PARAMS) {
    parsed.searchParams.delete(key);
  }

  return parsed.toString();
}

export function isSameDomain(url: string, rootUrl: string): boolean {
  try {
    const apex = (h: string) => h.replace(/^www\./, "");
    return apex(new URL(url).hostname) === apex(new URL(rootUrl).hostname);
  } catch {
    return false;
  }
}

export function isAllowedScheme(url: string): boolean {
  try {
    return ALLOWED_SCHEMES.has(new URL(url).protocol);
  } catch {
    return false;
  }
}
