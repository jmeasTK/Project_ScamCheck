import { config } from "dotenv";

declare const process: {
  env: Record<string, string | undefined>;
};

config({ path: ".env.local", quiet: true });
config({ quiet: true });

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";
const MAX_MESSAGE_LENGTH = 4000;

type GeminiAnalysis = {
  risk?: string;
  detective?: string;
  indicators?: Array<{ quote?: string; reason?: string }>;
  actions?: string[];
  psychology?: {
    manipulation?: string;
    advice?: string;
  } | null;
};

function extractJsonObject(text: string) {
  const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");

  if (firstBrace === -1 || lastBrace <= firstBrace) {
    throw new Error("Gemini did not return a JSON object");
  }

  return cleaned.slice(firstBrace, lastBrace + 1);
}

function normalizeAnalysis(data: GeminiAnalysis) {
  const allowedRisks = new Set(["An toàn", "Nghi ngờ", "Lừa đảo", "Nguy hiểm"]);
  const rawRisk = String(data.risk);
  const risk = rawRisk === "Nguy hiểm" ? "Lừa đảo" : allowedRisks.has(rawRisk) ? rawRisk : "Nghi ngờ";

  return {
    risk,
    detective: typeof data.detective === "string" ? data.detective.trim() : "",
    indicators: Array.isArray(data.indicators)
      ? data.indicators
          .filter((item) => item && typeof item.quote === "string" && item.quote.trim())
          .slice(0, 4)
          .map((item) => ({
            quote: String(item.quote).trim(),
            reason: typeof item.reason === "string" ? item.reason.trim() : "",
          }))
      : [],
    actions: Array.isArray(data.actions)
      ? data.actions.filter((item) => typeof item === "string" && item.trim()).slice(0, 3)
      : [],
    psychology: data.psychology && typeof data.psychology === "object"
      ? {
          manipulation: typeof data.psychology.manipulation === "string" ? data.psychology.manipulation.trim() : "",
          advice: typeof data.psychology.advice === "string" ? data.psychology.advice.trim() : "",
        }
      : null,
  };
}
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
  const hostname = getUrlHostname(rawUrl);
  return URL_SHORTENER_DOMAINS.has(hostname);
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

function isPrivateIPv4(hostname: string) {
  const parts = hostname.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;

  return parts[0] === 0
    || parts[0] === 10
    || parts[0] === 127
    || (parts[0] === 169 && parts[1] === 254)
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168);
}

function isBlockedRedirectHost(rawUrl: string) {
  try {
    const rawHostname = new URL(normalizeUrlForFetch(rawUrl)).hostname.toLowerCase();
    const hostname = rawHostname.replace(/^\[/, "").replace(/\]$/, "");
    const isPrivateIPv6 = hostname.includes(":") && (
      hostname === "::1"
      || hostname.startsWith("fc")
      || hostname.startsWith("fd")
      || hostname.startsWith("fe80:")
    );

    return hostname === "localhost"
      || hostname.endsWith(".localhost")
      || hostname.endsWith(".local")
      || isPrivateIPv4(hostname)
      || isPrivateIPv6;
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

function formatUrlReport(urls: UrlAnalysis[]) {
  if (!urls.length) return "Không phát hiện đường dẫn.";

  return urls.map((item) => {
    if (!item.isShortened) return `- ${item.original}`;
    if (item.invalidTarget) return `- ${item.original} -> mở ra trang/tệp không hợp lệ hoặc URL mẫu, không có đích rõ ràng`;
    if (!item.resolved) return `- ${item.original} -> không mở rộng được trong thời gian cho phép`;
    return `- ${item.original} (${item.expanded})`;
  }).join("\n");
}

async function analyzeHandler(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "Missing GEMINI_API_KEY" });
  }

  const message = req.body?.message;
  if (!message || typeof message !== "string") {
    return res.status(400).json({ error: "Missing message" });
  }

  if (message.length > MAX_MESSAGE_LENGTH) {
    return res.status(413).json({ error: "Message too long" });
  }

  const analyzedUrls = await analyzeUrls(message);
  const urlReport = formatUrlReport(analyzedUrls);
  const prompt = `
Bạn là ScamCheck, công cụ giáo dục và chống lừa đảo online cho người lớn tuổi Việt Nam.

Hãy phân tích tin nhắn sau:
"""${message}"""

Các đường dẫn được ScamCheck tách từ tin nhắn:
${urlReport}

Yêu cầu bắt buộc:
- Xưng hô bằng "bạn", "tôi".
- Trả lời bằng tiếng Việt rõ ràng, dễ hiểu cho người từ 40 tuổi trở lên.
- Không bịa thông tin ngoài nội dung tin nhắn và danh sách đường dẫn ScamCheck đã tách được.
- risk chỉ được là một trong ba giá trị: "An toàn", "Nghi ngờ", "Lừa đảo".
- Không dùng ví dụ, không khớp máy móc theo từ khóa riêng lẻ. Hãy đánh giá theo mục đích của tin nhắn, hành động nó yêu cầu người nhận làm, kênh thực hiện, mức độ khẩn cấp, danh tính người gửi, đường dẫn/domain và loại thông tin/tài sản có nguy cơ bị mất.
- Chọn "An toàn" khi nội dung chủ yếu là thông báo, nhắc lịch, cảnh báo/phòng tránh, hoặc hướng dẫn qua kênh chính thức; không yêu cầu bấm link lạ, đăng nhập ngoài kênh chính thức, cung cấp thông tin nhạy cảm, chuyển tiền, nộp phí, liên hệ kênh cá nhân, hoặc hành động gấp có rủi ro.
- Chọn "Nghi ngờ" khi có dấu hiệu cần xác minh nhưng chưa đủ kết luận lừa đảo: link rút gọn/đường dẫn không minh bạch, người gửi không rõ, lời mời/ưu đãi thiếu nguồn, file/form chia sẻ chưa xác minh được, yêu cầu bấm link nhưng chưa yêu cầu thông tin nhạy cảm hoặc tiền, hoặc ngữ cảnh còn thiếu.
- Chọn "Lừa đảo" khi có bằng chứng rõ về ý đồ chiếm đoạt hoặc đánh cắp thông tin: yêu cầu OTP/mật khẩu/PIN/CCCD/tài khoản ngân hàng, đăng nhập qua link đáng ngờ, chuyển tiền/nộp phí/đặt cọc, đe dọa khóa tài khoản/phạt/bắt giữ, giả danh cơ quan/ngân hàng/người quen để tạo áp lực, nhận thưởng kèm phí hoặc thông tin cá nhân, hướng sang Zalo/Telegram/số cá nhân, yêu cầu giữ bí mật, hoặc domain giả mạo thương hiệu.
- Nếu phần "Các đường dẫn" có dạng "link rút gọn (link sau khi mở rộng)", phải phân tích domain sau khi mở rộng làm bằng chứng chính. Không được viết như thể chưa biết link dẫn tới đâu.
- Link rút gọn là dấu hiệu giảm minh bạch, không tự động là "Lừa đảo". Nếu link mở rộng tới nền tảng quen thuộc như youtube.com, drive.google.com, docs.google.com, hãy nói đúng domain đích và đánh giá theo ngữ cảnh tin nhắn. Không truy cập hay suy đoán nội dung bên trong Drive/Docs/Forms; chỉ phân tích URL/domain và nội dung tin nhắn.
- Nếu không mở rộng được link rút gọn, coi đó là dấu hiệu cần xác minh. Chỉ nâng lên "Lừa đảo" khi đi kèm yêu cầu rủi ro như đăng nhập, cung cấp thông tin, tải file lạ, chuyển tiền, nhận thưởng, hoặc áp lực gấp.
- detective là lời của nhân vật "Thám tử phân tích": 1 đoạn tối đa 80 chữ, đi thẳng vào kết luận và bằng chứng chính.
- indicators là tối đa 5 dấu hiệu nghi ngờ. quote phải là đoạn có thật trong tin nhắn. Nếu có link rút gọn đã được mở rộng trong phần "Các đường dẫn", quote phải gộp thành đúng dạng "link rút gọn (link sau khi mở rộng)" trong một indicator duy nhất, không tách thành hai indicator. Nếu risk là "An toàn", indicators là mảng rỗng.
- actions là tối đa 4 việc nên làm, mỗi việc tối đa 40 chữ, cụ thể và an toàn. Chỉ đưa actions khi có rủi ro lừa đảo hoặc có bước an toàn thật sự quan trọng. Nếu risk là "An toàn" và không có việc phòng tránh lừa đảo cần làm, actions phải là mảng rỗng []. Không đưa lời khuyên đời sống không liên quan đến lừa đảo.
- psychology là lời của nhân vật "Cô tâm lý": nếu có rủi ro, manipulation ngắn gọn và advice có thể dài tối đa 100 chữ, trấn an người dùng, không làm họ xấu hổ. Nếu risk là "An toàn", psychology là null.
- Chỉ trả về đúng một JSON object hợp lệ bắt đầu bằng { và kết thúc bằng }. Không markdown, không code fence, không giải thích ngoài JSON.
Cấu trúc JSON:
{
  "risk": "An toàn | Nghi ngờ | Lừa đảo",
  "detective": "lời phân tích của Thám tử",
  "indicators": [
    {
      "quote": "đoạn đáng ngờ có thật trong tin nhắn",
      "reason": "lý do đáng ngờ"
    }
  ],
  "actions": [
    "việc nên làm 1",
    "việc nên làm 2",
    "việc nên làm 3",
    "việc nên làm 4 (nếu có))",
  ],
  "psychology": {
    "manipulation": "thủ đoạn tâm lý",
    "advice": "lời khuyên bình tĩnh của Cô tâm lý"
  }
}
`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

  const geminiResponse = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }],
        },
      ],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 3000,
        responseMimeType: "application/json",
      },
    }),
  });

  const raw = await geminiResponse.text();

  if (!geminiResponse.ok) {
    return res.status(502).json({ error: "Gemini API error", detail: raw });
  }

  const geminiData = JSON.parse(raw);
  const candidate = geminiData?.candidates?.[0];
  const finishReason = candidate?.finishReason;
  const text = candidate?.content?.parts?.[0]?.text;

  if (finishReason === "MAX_TOKENS") {
    return res.status(502).json({ error: "Gemini response truncated" });
  }

  if (!text || typeof text !== "string") {
    return res.status(502).json({ error: "Gemini returned empty result" });
  }

  try {
    try {
      return res.status(200).json(normalizeAnalysis(JSON.parse(text)));
    } catch {
      return res.status(200).json(normalizeAnalysis(JSON.parse(extractJsonObject(text))));
    }
  } catch (error) {
    console.error("Could not parse Gemini response", {
      error: error instanceof Error ? error.message : String(error),
      preview: text.slice(0, 500),
    });

    return res.status(502).json({
      error: "Gemini returned invalid JSON",
      detail: text.slice(0, 500),
    });
  }
}
export default async function handler(req: any, res: any) {
  try {
    return await analyzeHandler(req, res);
  } catch (error) {
    console.error("Analyze API crashed", error);
    return res.status(500).json({
      error: "Analyze API crashed",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}





