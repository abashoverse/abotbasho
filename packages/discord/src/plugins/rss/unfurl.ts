export interface Unfurled {
  url: string;
  title?: string;
  description?: string;
  imageUrl?: string;
  siteName?: string;
}

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

const ipv4Pattern = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

const isPrivateHost = (host: string): boolean => {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h === "0.0.0.0" || h === "::" || h === "::1") return true;
  if (h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80:")) return true;

  const m = h.match(ipv4Pattern);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a === 0 || a === 127 || a === 10) return true;
    if (a === 169 && b === 254) return true; // link-local + cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
  }
  return false;
};

const assertSafeUrl = (urlStr: string): URL => {
  let url: URL;
  try {
    url = new URL(urlStr);
  } catch {
    throw new UnsafeUrlError("invalid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UnsafeUrlError(`disallowed protocol: ${url.protocol}`);
  }
  if (isPrivateHost(url.hostname)) {
    throw new UnsafeUrlError(`refusing to fetch internal/private host: ${url.hostname}`);
  }
  return url;
};

const decodeEntities = (s: string): string =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");

const matchMeta = (
  html: string,
  name: string,
  attr: "property" | "name",
): string | undefined => {
  const re1 = new RegExp(
    `<meta[^>]+${attr}=["']${name}["'][^>]*content=["']([^"']+)["']`,
    "i",
  );
  const m1 = html.match(re1);
  if (m1?.[1]) return decodeEntities(m1[1]);
  const re2 = new RegExp(
    `<meta[^>]+content=["']([^"']+)["'][^>]*${attr}=["']${name}["']`,
    "i",
  );
  const m2 = html.match(re2);
  if (m2?.[1]) return decodeEntities(m2[1]);
  return undefined;
};

const extractH1 = (html: string): string | undefined => {
  const m = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (!m?.[1]) return undefined;
  const text = m[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  return text.length > 0 ? decodeEntities(text) : undefined;
};

const extractTitle = (html: string): string | undefined => {
  const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return m?.[1] ? decodeEntities(m[1].trim()) : undefined;
};

interface JsonLdArticle {
  "@type"?: string | string[];
  headline?: string;
  description?: string;
  image?: string | string[];
}

const extractJsonLdArticle = (html: string): JsonLdArticle | undefined => {
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    const body = match[1];
    if (!body) continue;
    try {
      const parsed = JSON.parse(body.trim()) as JsonLdArticle | JsonLdArticle[];
      const items = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of items) {
        const t = item["@type"];
        const isArticle =
          (typeof t === "string" && /article|blogposting|newsarticle/i.test(t)) ||
          (Array.isArray(t) && t.some((x) => /article|blogposting|newsarticle/i.test(x)));
        if (isArticle && item.headline) return item;
      }
    } catch {
      continue;
    }
  }
  return undefined;
};

export const unfurl = async (url: string, userAgent: string): Promise<Unfurled> => {
  assertSafeUrl(url);

  const res = await fetch(url, {
    headers: {
      accept: "text/html,application/xhtml+xml",
      "user-agent": userAgent,
    },
    signal: AbortSignal.timeout(10000),
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`unfurl ${res.status} ${res.statusText}`);

  // The redirect chain may have landed on a private host - re-validate.
  const finalUrl = res.url || url;
  assertSafeUrl(finalUrl);

  const html = await res.text();

  const ld = extractJsonLdArticle(html);
  const ogTitle = matchMeta(html, "og:title", "property");
  const ogDescription = matchMeta(html, "og:description", "property");
  const ogImage = matchMeta(html, "og:image", "property");

  const title = ld?.headline ?? extractH1(html) ?? ogTitle ?? extractTitle(html);
  const description = ld?.description ?? ogDescription ?? matchMeta(html, "description", "name");
  const ldImage = Array.isArray(ld?.image) ? ld?.image[0] : ld?.image;

  return {
    url: finalUrl,
    title,
    description,
    imageUrl: ldImage ?? ogImage,
    siteName: matchMeta(html, "og:site_name", "property"),
  };
};
