import { config } from "dotenv";

declare const process: {
  env: Record<string, string | undefined>;
};

config({ path: ".env.local", quiet: true });
config({ quiet: true });

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";

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
  const allowedRisks = new Set(["An toàn", "Nghi ngờ", "Nguy hiểm"]);
  const risk = allowedRisks.has(String(data.risk)) ? String(data.risk) : "Nghi ngờ";

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

function formatUrlReport(urls: UrlAnalysis[]) {
  if (!urls.length) return "Không phát hiện đường dẫn.";

  return urls.map((item) => {
    if (!item.isShortened) return `- ${item.original}`;
    if (!item.resolved) return `- ${item.original} -> không mở rộng được trong thời gian cho phép`;
    return `- ${item.original} -> ${item.expanded}`;
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

  const analyzedUrls = await analyzeUrls(message);
  const urlReport = formatUrlReport(analyzedUrls);
const prompt = `
Bạn là ScamCheck, công cụ giáo dục và chống lừa đảo online cho người lớn tuổi Việt Nam.

Hãy phân tích tin nhắn sau:
"""${message}"""

Các đường dẫn được ScamCheck tách từ tin nhắn:
${urlReport}

Yêu cầu bắt buộc:
- Xưng hô bằng "bạn", "tôi"
- Trả lời bằng tiếng Việt rõ ràng, dễ hiểu cho người từ 40 tuổi trở lên.
- Không bịa thông tin ngoài nội dung tin nhắn.
- risk chỉ được là một trong ba giá trị: "An toàn", "Nghi ngờ", "Nguy hiểm".
- Không đánh giá "Nghi ngờ" chỉ vì tin nhắn có khuyến mãi, tài khoản, nạp tiền, ưu đãi, hoặc thời hạn "hôm nay".
- Nếu tin nhắn chỉ thông báo ưu đãi và hướng người dùng xem trong app chính thức/website chính thức đã biết, không có link lạ, số điện thoại cá nhân, Zalo/Telegram, OTP, mật khẩu, CCCD, phí trước, hoặc chuyển tiền ngoài kênh chính thức, hãy ưu tiên "An toàn".
- Nếu nội dung là cảnh báo/phòng tránh lừa đảo, có các cụm như "cảnh báo", "khuyến cáo", "chiêu trò", "tuyệt đối không", "không làm theo", và không yêu cầu người đọc bấm link, gọi số lạ, cung cấp thông tin, đăng nhập hoặc chuyển tiền, hãy đánh giá "An toàn". Đây là nội dung giáo dục, không phải tin lừa đảo.
- Đánh giá "Nghi ngờ" hoặc "Nguy hiểm" khi có bằng chứng rõ như link/domain lạ, link rút gọn (bit.ly, tinyurl, t.co, goo.gl, is.gd, cutt.ly, rebrand.ly,...), yêu cầu đăng nhập ngoài app chính thức, gửi OTP/mật khẩu/CCCD, chuyển tiền/đóng phí, liên hệ số cá nhân/Zalo/Telegram, đe dọa khóa tài khoản, hoặc tạo áp lực bất thường. Khi phần "Các đường dẫn" có dạng "link rút gọn -> link sau khi mở rộng", hãy phân tích domain sau khi mở rộng và nhắc rõ domain đó trong detective/reason nếu liên quan. Nếu mở rộng ra Google Drive/Docs/Forms, không tự động coi là an toàn: hãy đánh giá theo ngữ cảnh, vì file/form chia sẻ vẫn có thể dùng để phát tán mã độc, thu thông tin hoặc dụ đăng nhập. Nếu không mở rộng được link rút gọn, coi đó là dấu hiệu che giấu đích đến; nếu đi kèm nhận thưởng, xác minh tài khoản, đăng nhập, chuyển tiền hoặc thời hạn gấp thì ít nhất phải là "Nghi ngờ".
- Ưu tiên nguyên tắc tổng quát thay vì khớp ví dụ: tin nhắn an toàn thường chỉ thông báo/hướng dẫn qua kênh chính thức và không yêu cầu hành động rủi ro; tin nhắn nguy hiểm thường yêu cầu bấm link lạ, đăng nhập, cung cấp thông tin nhạy cảm, chuyển tiền, liên hệ kênh cá nhân hoặc hành động gấp.
- detective là lời của nhân vật "Thám tử phân tích": 1 đoạn tối đa 80 chữ, đi thẳng vào bằng chứng chính.
- indicators là tối đa 5 dấu hiệu nghi ngờ. quote phải là đoạn có thật trong tin nhắn. Nếu risk là "An toàn", indicators là mảng rỗng.
- actions là tối đa 4 việc nên làm, mỗi việc tối đa 40 chữ, cụ thể và an toàn. Chỉ đưa actions khi có rủi ro lừa đảo hoặc có bước an toàn thật sự quan trọng. Nếu risk là "An toàn" và không có việc phòng tránh lừa đảo cần làm, actions phải là mảng rỗng []. Không đưa lời khuyên đời sống không liên quan đến lừa đảo.
- psychology là lời của nhân vật "Cô tâm lý": nếu có rủi ro, manipulation ngắn gọn và advice có thể dài tối đa 100 chữ, trấn an người dùng, không làm họ xấu hổ. Nếu risk là "An toàn", psychology là null.
- Chỉ trả về đúng một JSON object hợp lệ bắt đầu bằng { và kết thúc bằng }. Không markdown, không code fence, không giải thích ngoài JSON.

Cấu trúc JSON:
{
  "risk": "An toàn | Nghi ngờ | Nguy hiểm",
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
    "việc nên làm 3"
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
        maxOutputTokens: 1500,
        responseMimeType: "application/json",
      },
    }),
  });

  const raw = await geminiResponse.text();

  if (!geminiResponse.ok) {
    return res.status(502).json({ error: "Gemini API error", detail: raw });
  }

  const geminiData = JSON.parse(raw);
  const text = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text;

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


