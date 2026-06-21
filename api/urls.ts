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

    return response.url || url;
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
      const followedUrl = await followRedirectUrl(firstUrl);
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

    return {
      original: url,
      expanded,
      isShortened,
      resolved: isShortened && expanded !== url,
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



