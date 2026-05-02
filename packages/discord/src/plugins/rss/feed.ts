import { XMLParser } from "fast-xml-parser";

export interface FeedEntry {
  id: string;
  title: string;
  link: string;
  description?: string;
  author?: string;
  publishedAt?: Date;
  imageUrl?: string;
}

interface RssEnclosure {
  "@_url"?: string;
  "@_type"?: string;
}

interface RssMediaContent {
  "@_url"?: string;
  "@_type"?: string;
  "@_medium"?: string;
}

interface RssItem {
  title?: string;
  link?: string;
  guid?: string | { "#text"?: string };
  description?: string;
  author?: string;
  pubDate?: string;
  enclosure?: RssEnclosure | RssEnclosure[];
  "media:content"?: RssMediaContent | RssMediaContent[];
}

interface AtomLink {
  "@_href"?: string;
  "@_rel"?: string;
}

interface AtomEntry {
  id?: string;
  title?: string | { "#text"?: string };
  link?: AtomLink | AtomLink[];
  summary?: string;
  content?: string | { "#text"?: string };
  author?: { name?: string };
  published?: string;
  updated?: string;
  "media:thumbnail"?: { "@_url"?: string };
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  parseTagValue: true,
});

const stripHtml = (html: string | undefined): string | undefined => {
  if (!html) return undefined;
  const clean = html
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  return clean.length > 0 ? clean : undefined;
};

const firstUrlOfArray = <T extends { "@_url"?: string }>(
  v: T | T[] | undefined,
): string | undefined => {
  if (!v) return undefined;
  if (Array.isArray(v)) return v[0]?.["@_url"];
  return v["@_url"];
};

const fromRssItem = (item: RssItem): FeedEntry | null => {
  const title = item.title?.toString().trim();
  const link = item.link?.toString().trim();
  if (!title || !link) return null;
  const guidValue =
    typeof item.guid === "object" ? item.guid["#text"] : item.guid;
  const id = (guidValue ?? link).toString();
  const imageUrl =
    firstUrlOfArray(item.enclosure) ?? firstUrlOfArray(item["media:content"]);
  return {
    id,
    title,
    link,
    description: stripHtml(item.description),
    author: item.author?.toString(),
    publishedAt: item.pubDate ? new Date(item.pubDate) : undefined,
    imageUrl,
  };
};

const fromAtomEntry = (entry: AtomEntry): FeedEntry | null => {
  const title =
    typeof entry.title === "object" ? entry.title["#text"] : entry.title;
  const links = Array.isArray(entry.link) ? entry.link : entry.link ? [entry.link] : [];
  const link =
    links.find((l) => l["@_rel"] === "alternate" || !l["@_rel"])?.["@_href"] ??
    links[0]?.["@_href"];
  if (!title || !link) return null;
  const id = entry.id ?? link;
  const content =
    typeof entry.content === "object" ? entry.content["#text"] : entry.content;
  const description = stripHtml(content) ?? stripHtml(entry.summary);
  const dateStr = entry.published ?? entry.updated;
  return {
    id,
    title: title.toString().trim(),
    link,
    description,
    author: entry.author?.name,
    publishedAt: dateStr ? new Date(dateStr) : undefined,
    imageUrl: entry["media:thumbnail"]?.["@_url"],
  };
};

export const fetchFeed = async (url: string): Promise<FeedEntry[]> => {
  const res = await fetch(url, {
    headers: { accept: "application/rss+xml, application/xml, text/xml, */*" },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`feed ${res.status} ${res.statusText}`);
  const xml = await res.text();
  const parsed = parser.parse(xml) as Record<string, unknown>;

  if (parsed.rss) {
    const channel = (parsed.rss as { channel?: { item?: RssItem | RssItem[] } }).channel;
    const items = channel?.item;
    const list = Array.isArray(items) ? items : items ? [items] : [];
    return list
      .map(fromRssItem)
      .filter((e): e is FeedEntry => e !== null);
  }
  if (parsed.feed) {
    const entries = (parsed.feed as { entry?: AtomEntry | AtomEntry[] }).entry;
    const list = Array.isArray(entries) ? entries : entries ? [entries] : [];
    return list
      .map(fromAtomEntry)
      .filter((e): e is FeedEntry => e !== null);
  }
  throw new Error("unrecognized feed format (expected RSS 2.0 or Atom)");
};
