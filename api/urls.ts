const URL_SHORTENER_DOMAINS = new Set([
  "bit.ly",
  "tinyurl.com",
  "t.co",
  "goo.gl",
  "ow.ly",
  "is.gd",
  "buff.ly",
  "cutt.ly",
  "s.id",
  "rebrand.ly",
  "shorturl.at",
  "tiny.cc",
  "rb.gy",
  "lnkd.in",
  "urlvn.net",
  "cpmlink.net",
  "shrtslug.biz",
  "link-center.net",
  "direct-link.net",
  "link-to.net",
  "linkvertise.com",
]);

type UrlAnalysis = {
  original: string;
  expanded: string;
  isShortened: boolean;
  resolved: boolean;
  invalidTarget?: boolean;
};

function getUrlHostname(rawUrl: string) {
  try {
    const normalizedUrl = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
    return new URL(normalizedUrl).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function normalizeUrlForFetch(rawUrl: string) {
  return /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
}

function isShortenedUrl(rawUrl: string) {
  return URL_SHORTENER_DOMAINS.has(getUrlHostname(rawUrl));
}

function extractUrlsFromText(text: string) {
  const urlPattern = /\b(?:(?:https?:\/\/|www\.)[^\s<>()"']+|(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com\.vn|edu\.vn|gov\.vn|com|net|org|vn|info|biz|io|co|me|app|dev|cc|top|xyz|click|shop|live|site|online|vip|ly|gl|gd|id|at|to|link|page|cloud|store|website)\b(?:\/[^\s<>()"']*)?)/gi;
  const trailingPunctuation = /[.,;:!?)]$/;
  const seen = new Set<string>();

  return Array.from(text.matchAll(urlPattern))
    .map((match) => match[0].replace(trailingPunctuation, ""))
    .filter((url) => {
      const key = url.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return Boolean(getUrlHostname(url));
    });
}

function isBlockedRedirectHost(rawUrl: string) {
  try {
    const hostname = new URL(normalizeUrlForFetch(rawUrl)).hostname.toLowerCase();
    return hostname === "localhost"
      || hostname === "127.0.0.1"
      || hostname === "0.0.0.0"
      || hostname === "::1"
      || /^10\./.test(hostname)
      || /^192\.168\./.test(hostname)
      || /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname)
      || /^169\.254\./.test(hostname);
  } catch {
    return true;
  }
}

const REDIRECT_HEADERS = {
  "User-Agent": "Mozilla/5.0 ScamCheck/1.0",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
};

async function fetchRedirectLocation(url: string, method: "HEAD" | "GET") {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);

  try {
    const response = await fetch(url, {
      method,
      redirect: "manual",
      signal: controller.signal,
      headers: REDIRECT_HEADERS,
    });

    return response.headers.get("location");
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function decodeHtmlAttribute(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\\\//g, "/");
}

function tryDecodeURIComponent(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}


function looksLikeTemplateUrl(value: string) {
  const decoded = tryDecodeURIComponent(decodeHtmlAttribute(value)).toLowerCase();
  return /[{}]/.test(decoded)
    || /%7b|%7d/i.test(value)
    || /\b(docid|resourcekeyparam|resourcekey|authuser|template|placeholder)\b/.test(decoded)
    || /\$\{|<%|%>/.test(decoded);
}

function normalizeCandidateUrl(value: string, baseUrl: string) {
  const cleaned = tryDecodeURIComponent(decodeHtmlAttribute(value.trim()))
    .replace(/^url=/i, "")
    .replace(/^['\"]|['\"]$/g, "");

  if (looksLikeTemplateUrl(cleaned)) return "";

  try {
    const candidate = new URL(cleaned, baseUrl).toString();
    return looksLikeTemplateUrl(candidate) ? "" : candidate;
  } catch {
    return "";
  }
}

function scoreExpandedCandidate(candidate: string, sourceHost: string) {
  const hostname = getUrlHostname(candidate);
  if (!hostname || hostname === sourceHost || looksLikeTemplateUrl(candidate) || isBlockedRedirectHost(candidate) || isShortenedUrl(candidate)) return -100;
  return 10;
}

function findExpandedUrlInHtml(html: string, baseUrl: string) {
  const sourceHost = getUrlHostname(baseUrl);
  const decodedHtml = decodeHtmlAttribute(html);
  const candidates = new Set<string>();

  const valuePatterns = [
    /<meta[^>]+http-equiv=["']?refresh["']?[^>]+content=["'][^"']*url=([^"']+)["']/gi,
    /(?:window\.)?location(?:\.href|\.replace|\.assign)?\s*(?:=|\()\s*["']([^"']+)["']/gi,
    /(?:data-url|data-href|data-link|data-target|data-destination|data-redirect|redirect(?:_url)?|go(?:_url)?)\s*[:=]\s*["']([^"']+)["']/gi,
  ];

  for (const pattern of valuePatterns) {
    for (const match of decodedHtml.matchAll(pattern)) {
      if (match[1]) candidates.add(match[1]);
    }
  }


  return Array.from(candidates)
    .map((candidate) => normalizeCandidateUrl(candidate, baseUrl))
    .filter(Boolean)
    .map((candidate) => ({ candidate, score: scoreExpandedCandidate(candidate, sourceHost) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)[0]?.candidate || null;
}
async function followRedirectUrl(url: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: REDIRECT_HEADERS,
    });

    const finalUrl = response.url || url;
    if (finalUrl !== url) return finalUrl;

    const html = await response.text().catch(() => "");
    return html ? findExpandedUrlInHtml(html, finalUrl) || finalUrl : finalUrl;
  } catch {
    return url;
  } finally {
    clearTimeout(timer);
  }
}

async function unshortenUrl(rawUrl: string): Promise<string> {
  const firstUrl = normalizeUrlForFetch(rawUrl);
  let currentUrl = firstUrl;

  for (let i = 0; i < 5; i += 1) {
    if (isBlockedRedirectHost(currentUrl)) return rawUrl;

    const location = await fetchRedirectLocation(currentUrl, "HEAD")
      || await fetchRedirectLocation(currentUrl, "GET");

    if (!location) {
      const followedUrl = await followRedirectUrl(currentUrl);
      return isBlockedRedirectHost(followedUrl) ? rawUrl : followedUrl;
    }

    currentUrl = new URL(location, currentUrl).toString();
  }

  return currentUrl;
}
async function analyzeUrls(message: string): Promise<UrlAnalysis[]> {
  const urls = extractUrlsFromText(message).slice(0, 6);

  return Promise.all(urls.map(async (url) => {
    const isShortened = isShortenedUrl(url);
    const expanded = isShortened ? await unshortenUrl(url) : url;
    const invalidTarget = isShortened && looksLikeTemplateUrl(expanded);

    return {
      original: url,
      expanded: invalidTarget ? url : expanded,
      isShortened,
      resolved: isShortened && !invalidTarget && expanded !== url,
      invalidTarget,
    };
  }));
}

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const message = req.body?.message;
  if (!message || typeof message !== "string") {
    return res.status(400).json({ error: "Missing message" });
  }

  try {
    return res.status(200).json({ urls: await analyzeUrls(message) });
  } catch {
    return res.status(200).json({ urls: [] });
  }
}


