import { useState, useEffect } from "react";
import { Sun, Moon, WifiOff } from "lucide-react";
import { Toaster, toast } from "sonner";

// Official hotline database
const HOTLINES = {
  banks: [
    { name: "Vietcombank", phone: "1800 1235" },
    { name: "Techcombank", phone: "1800 6868" },
    { name: "BIDV", phone: "1900 9247" },
    { name: "Agribank", phone: "1900 558818" },
    { name: "MB Bank", phone: "1800 0003" },
    { name: "VPBank", phone: "1900 9482" },
    { name: "ACB", phone: "1800 6868" },
    { name: "TPBank", phone: "1900 5888 85" },
    { name: "Sacombank", phone: "1800 5858 88" },
    { name: "VIB", phone: "1800 8192" },
  ],
  police: { name: "Công an", phone: "113" },
  attt: { name: "Cục An toàn thông tin", phone: "1800 1540" },
};

type Situation = "nothing" | "clicked" | "transferred" | "otp" | null;

const SITUATION_SCRIPTS: Record<Exclude<Situation, "nothing" | null>, { title: string; steps: string[] }> = {
  clicked: {
    title: "Bạn đã bấm vào đường dẫn lạ",
    steps: [
      "Tắt ngay Wi-Fi (mạng không dây) và dữ liệu di động trên điện thoại.",
      "Xóa lịch sử trình duyệt và các ứng dụng lạ vừa cài.",
      "Đổi mật khẩu tài khoản ngân hàng và email ngay lập tức.",
      "Theo dõi biến động số dư tài khoản trong 24 giờ tới.",
      "Gọi ngân hàng để được hỗ trợ kiểm tra tài khoản.",
    ],
  },
  transferred: {
    title: "Bạn đã chuyển khoản cho kẻ lừa đảo",
    steps: [
      "Gọi ngay cho ngân hàng để yêu cầu phong tỏa giao dịch.",
      "Yêu cầu ngân hàng lưu toàn bộ thông tin giao dịch.",
      "Trình báo ngay với Công an để có biên bản tố cáo.",
      "Gọi Cục An toàn thông tin để được hỗ trợ thêm.",
      "Giữ lại tất cả bằng chứng: tin nhắn, số tài khoản, ảnh chụp màn hình.",
    ],
  },
  otp: {
    title: "Bạn đã cung cấp mã OTP (mã xác thực)",
    steps: [
      "Gọi ngay cho ngân hàng để khóa tài khoản khẩn cấp.",
      "Đổi mật khẩu Internet Banking (ngân hàng trực tuyến) và mã PIN ngay lập tức.",
      "Yêu cầu ngân hàng kiểm tra các giao dịch vừa thực hiện.",
      "Trình báo Công an nếu đã có tiền bị rút đi.",
      "Kích hoạt lại tài khoản chỉ sau khi ngân hàng xác nhận an toàn.",
    ],
  },
};

const MAX_MESSAGE_LENGTH = 4000;

const SAMPLES = [
  { label: "🏦 Giả mạo Ngân hàng", text: "[VIETCOMBANK] Tai khoan cua ban dang bi dang nhap la tai thiet bi khac. Neu khong phai ban vui long truy cap vao link http://vietcornbank-login.cc de xac minh danh tinh va bao mat tai khoan ngay lap tuc!" },
  { label: "👮 Giả mạo Công an", text: "Day la Co quan Cong an. Ban co lien quan den vu an rua tien. Goi ngay so 0912345678 de tranh bi bat giu va chiu trach nhiem hinh su." },
  { label: "🎁 Trúng thưởng giả", text: "Chuc mung! Ban da trung iPhone 15 Pro Max. Nhan ngay phan thuong tai: http://nhan-qua-mien-phi.net/claim?id=982341 truoc 24h!" },
];

type Risk = "high" | "medium" | "low" | null;
type AnalyzeErrorCode = "invalid_json" | "ai_error";

class AnalyzeError extends Error {
  code: AnalyzeErrorCode;

  constructor(code: AnalyzeErrorCode, message: string) {
    super(message);
    this.name = "AnalyzeError";
    this.code = code;
  }
}

type Indicator = {
  quote: string;
  reason: string;
};

type UrlAnalysis = {
  original: string;
  expanded: string;
  isShortened: boolean;
  resolved: boolean;
};

interface Analysis {
  risk: Risk;
  label: string;
  highlights: string[];
  indicators?: Indicator[];
  detective?: string;
  actions?: string[];
  psychology?: {
    manipulation?: string;
    advice?: string;
  } | null;
  usedFallback?: boolean;
}

function getIndicatorBaseQuote(quote: string) {
  return quote
    .split("->")[0]
    ?.replace(/\s+\(https?:\/\/.*\)\s*$/i, "")
    .trim()
    .toLowerCase() || quote.trim().toLowerCase();
}

function mergeRelatedIndicators(indicators: Indicator[]) {
  const merged = new Map<string, Indicator>();

  for (const indicator of indicators) {
    const quote = indicator.quote.trim();
    if (!quote) continue;

    const key = getIndicatorBaseQuote(quote);
    const existing = merged.get(key);

    if (!existing) {
      merged.set(key, { quote, reason: indicator.reason.trim() });
      continue;
    }

    const quoteHasTarget = quote.includes("->") || /\s+\(https?:\/\//i.test(quote);
    const existingHasTarget = existing.quote.includes("->") || /\s+\(https?:\/\//i.test(existing.quote);
    const preferredQuote = quoteHasTarget && !existingHasTarget ? quote : existing.quote;
    const reasons = [existing.reason, indicator.reason.trim()].filter(Boolean);
    const uniqueReasons = Array.from(new Set(reasons));

    merged.set(key, {
      quote: preferredQuote,
      reason: uniqueReasons.join(" "),
    });
  }

  return Array.from(merged.values());
}

function getIndicatorQuotes(indicators: Indicator[]) {
  return mergeRelatedIndicators(indicators).map((item) => getIndicatorBaseQuote(item.quote));
}
function normalizeVietnamese(text: string) {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase();
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

function getUrlHostname(rawUrl: string) {
  try {
    const normalizedUrl = rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`;
    return new URL(normalizedUrl).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function isShortenedUrl(rawUrl: string) {
  const hostname = getUrlHostname(rawUrl);
  return URL_SHORTENER_DOMAINS.has(hostname);
}

function extractUrlsFromText(text: string) {
  const urlPattern = /\b(?:(?:https?:\/\/|www\.)[^\s<>()"']+|(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|net|org|vn|com\.vn|edu\.vn|gov\.vn|info|biz|io|co|me|app|dev|cc|top|xyz|click|shop|live|site|online|vip|ly|gl|gd|id|at|to|link|page|cloud|store|website)\b(?:\/[^\s<>()"']*)?)/gi;
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

function hasProtectiveInstruction(normalized: string) {
  return /\b(khong lam theo|khong chuyen tien|khong cung cap|khong bam|khong nhap|khong dang nhap|khong goi lai|khong tham gia|khong to chuc|khong danh bac|khong ca do|khong tiep tay|dung bam|dung cung cap|canh giac|phong tranh|tranh bi)\b/i.test(normalized)
    || /\b(khong|dung)\b.{0,60}\b(lam theo|bam vao|nhan vao|truy cap|dang nhap|xac minh|cung cap|gui otp|doc ma otp|chuyen tien|nap tien|dong phi|lien he so la|goi so la|tham gia|to chuc danh bac|danh bac|ca do|tiep tay)\b/i.test(normalized);
}

function hasRiskyActionRequest(normalized: string) {
  const actionableText = normalized.replace(/\b(tuyet doi khong|khong|dung)\b.{0,90}\b(lam theo|bam vao|nhan vao|truy cap|dang nhap|xac minh|cung cap|gui otp|doc ma otp|chuyen tien|nap tien|dong phi|lien he so la|goi so la|tham gia|to chuc danh bac|danh bac|ca do|tiep tay)\b/gi, "");
  const requestToSensitiveInfo = /\b(vui long|hay|can|yeu cau|bat buoc|de nghi|nhap|gui|doc|cung cap|xac minh|dang nhap)\b.{0,80}\b(otp|ma xac thuc|mat khau|password|pin|cccd|cmnd|can cuoc|thong tin ca nhan|tai khoan ngan hang|so tai khoan)\b/i.test(actionableText);
  const requestToMoney = /\b(vui long|hay|can|yeu cau|bat buoc|de nghi|chuyen|nap|dong|thanh toan|nop)\b.{0,80}\b(tien|phi|coc|thue|ho so|van chuyen|xac minh|tai khoan ca nhan)\b/i.test(actionableText);
  const requestToUnsafeChannel = /\b(vui long|hay|can|yeu cau|bat buoc|de nghi|lien he|goi|nhan tin|ket ban)\b.{0,80}\b(zalo|telegram|whatsapp|so dien thoai|so la|tai khoan ca nhan)\b/i.test(actionableText);
  const requestToUnsafeLink = /\b(vui long|hay|can|yeu cau|bat buoc|de nghi|bam|nhan vao|truy cap|mo link|vao link|dang nhap|xac minh)\b.{0,80}\b(link|duong dan|website|trang web|tai khoan|nhan thuong|mo khoa|bao mat)\b/i.test(actionableText);

  return requestToSensitiveInfo || requestToMoney || requestToUnsafeChannel || requestToUnsafeLink;
}

function isOfficialInfoHost(hostname: string) {
  return hostname.endsWith(".gov.vn")
    || hostname.endsWith(".edu.vn")
    || hostname === "chinhphu.vn"
    || hostname === "bocongan.gov.vn"
    || hostname === "mic.gov.vn"
    || hostname === "khonggianmang.vn"
    || hostname === "vtv.vn"
    || hostname === "vneconomy.vn";
}

function hasOnlyLowRiskWarningUrls(text: string) {
  const urls = extractUrlsFromText(text);
  if (!urls.length) return true;

  return urls.every((url) => {
    const hostname = getUrlHostname(url);
    return Boolean(hostname) && !isShortenedUrl(url) && isOfficialInfoHost(hostname);
  });
}

function isPublicSafetyWarning(text: string) {
  const normalized = normalizeVietnamese(text);
  const hasWarningContext = /\b(canh bao|khuyen cao|luu y|chieu tro|thu doan|lua dao|gia mao|chiem doat|mao danh|thu doan moi|dau hieu lua dao|phong tranh)\b/i.test(normalized);
  const hasPublicSafetySource = /\b(bo cong an|cong an|cuc an toan thong tin|co quan chuc nang|cuc an ninh mang|pctp su dung cong nghe cao|ngan hang nha nuoc|ubnd|chinh phu|bao chi|truyen hinh|nha truong|ban quan ly|tong dai chinh thuc)\b/i.test(normalized);
  const protective = hasProtectiveInstruction(normalized);
  const riskyRequest = hasRiskyActionRequest(normalized);
  const describedScam = /\b(chieu tro|thu doan|lua dao|gia mao|mao danh|doi tuong|ke xau|chiem doat)\b.{0,140}\b(yeu cau|du do|ep|goi dien|nhan tin|dan du|thong bao|de doa)\b/i.test(normalized);
  const activeRiskyRequest = riskyRequest && !describedScam;
  const hasUnsafeLink = extractUrlsFromText(text).some((url) => isShortenedUrl(url) || !isOfficialInfoHost(getUrlHostname(url)));
  const hasRewardOrThreatToReader = /\b(tai khoan cua ban|ban da trung|ban nhan duoc|ban dang bi|se khoa tai khoan cua ban|neu ban khong|hoan tat ngay|xac minh ngay)\b/i.test(normalized);

  return hasWarningContext
    && protective
    && !activeRiskyRequest
    && !hasRewardOrThreatToReader
    && (!hasUnsafeLink || protective || hasOnlyLowRiskWarningUrls(text))
    && (hasPublicSafetySource || /\b(khong lam theo|khong chuyen tien|khong cung cap|khong tham gia|khong to chuc|khong danh bac|khong ca do|canh giac)\b/i.test(normalized));
}
function isRoutineSafeNotice(text: string) {
  const normalized = normalizeVietnamese(text);
  const urls = extractUrlsFromText(text);
  const hasRoutineContext = /\b(thong bao|lich|nhac lich|bao tri|cap nhat|tam ngung|phun thuoc|ve sinh|khuyen mai|uu dai|giam gia|chuong trinh|chi tiet xem tai app|xem tai ung dung)\b/i.test(normalized);
  const hasOfficialChannel = /\b(app chinh thuc|ung dung chinh thuc|website chinh thuc|tong dai chinh thuc|tai quay|cua hang|myviettel|viettel money|bidv smartbanking|vcb digibank|mb bank|momo|zalopay)\b/i.test(normalized);
  const hasSensitiveData = /\b(otp|ma xac thuc|mat khau|password|pin|cccd|cmnd|can cuoc|thong tin ca nhan|so tai khoan)\b/i.test(normalized);
  const hasUnsafeChannel = /\b(zalo|telegram|whatsapp|ket ban|nhan tin rieng|tai khoan ca nhan)\b/i.test(normalized);
  const hasSuspiciousUrl = urls.some((url) => isShortenedUrl(url) || /\.(cc|top|xyz|click|shop|live|site|online|vip)\b/i.test(url));

  return hasRoutineContext
    && !hasRiskyActionRequest(normalized)
    && !hasSensitiveData
    && !hasUnsafeChannel
    && !hasSuspiciousUrl
    && (!urls.length || hasOfficialChannel || urls.every((url) => isOfficialInfoHost(getUrlHostname(url))))
    && !/\b(trung thuong|trung giai|nhan qua|phan thuong|phi xac minh|phi ho so|dong phi|chuyen tien vao tai khoan ca nhan)\b/i.test(normalized);
}
function isCommunitySafetyNotice(text: string) {
  const normalized = normalizeVietnamese(text);
  const urls = extractUrlsFromText(text);
  const hasAuthoritySource = /\b(bo cong an|cong an|cuc canh sat|co quan cong an|co quan chuc nang|ubnd|uy ban nhan dan|nha truong|ban quan ly|to dan pho)\b/i.test(normalized);
  const asksToReport = /\b(phat hien|to giac|bao tin|bao ngay|lien he|goi|hotline|duong day nong)\b.{0,140}\b(co quan cong an|cong an|co quan chuc nang|hotline|duong day nong)\b/i.test(normalized);
  const givesPublicAdvice = /\b(khuyen cao|de nghi|yeu cau|van dong)\b.{0,140}\b(khong tham gia|khong to chuc|khong danh bac|khong ca do|khong tiep tay|canh giac|phong tranh)\b/i.test(normalized);
  const publicSafetyTopic = /\b(phong chong|phong, chong|huong ung|thang hanh dong|vi pham phap luat|toi pham|ma tuy|bao luc|xam hai|an ninh trat tu|phong chay|chua chay|dich benh|danh bac|ca do|cong nghe cao|an ninh mang)\b/i.test(normalized);
  const hasSuspiciousUrl = urls.some((url) => isShortenedUrl(url) || !isOfficialInfoHost(getUrlHostname(url)));
  const asksSensitiveData = /\b(otp|ma xac thuc|mat khau|password|pin|cccd|cmnd|can cuoc|so tai khoan|tai khoan ngan hang)\b/i.test(normalized);
  const asksMoney = /\b(chuyen tien|nap tien|dong phi|thanh toan phi|phi xac minh|phi ho so|dat coc|nop tien)\b/i.test(normalized);
  const unsafePrivateChannel = /\b(zalo|telegram|whatsapp|tai khoan ca nhan|ket ban|nhan tin rieng)\b/i.test(normalized);

  return hasAuthoritySource
    && (asksToReport || givesPublicAdvice)
    && publicSafetyTopic
    && !hasRiskyActionRequest(normalized)
    && !asksSensitiveData
    && !asksMoney
    && !unsafePrivateChannel
    && (!urls.length || !hasSuspiciousUrl);
}

function analyzeText(text: string, resolvedUrls: UrlAnalysis[] = []): Analysis {
  if (!text.trim()) return { risk: null, label: "", highlights: [], indicators: [] };

  const normalized = normalizeVietnamese(text);

  if (isPublicSafetyWarning(text) || isRoutineSafeNotice(text) || isCommunitySafetyNotice(text)) {
    return {
      risk: "low",
      label: "An toàn",
      highlights: [],
      indicators: [],
      detective: "Bộ phân tích dự phòng nhận thấy đây là nội dung thông báo/cảnh báo an toàn, không phải tin nhắn đang dụ bạn cung cấp thông tin nhạy cảm hay chuyển tiền.",
      actions: [],
      usedFallback: true,
      psychology: null,
    };
  }

  const indicators: Indicator[] = [];
  let score = 0;

  const addIndicator = (quote: string, reason: string, points: number) => {
    const cleanQuote = quote.trim();
    if (!cleanQuote) return;
    const exists = indicators.some((item) => item.quote.toLowerCase() === cleanQuote.toLowerCase());
    if (!exists) indicators.push({ quote: cleanQuote, reason });
    score += points;
  };

  const urls = extractUrlsFromText(text);
  for (const url of urls) {
    const resolvedInfo = resolvedUrls.find((item) => item.original.toLowerCase() === url.toLowerCase());
    const expandedUrl = resolvedInfo?.expanded || url;
    const expandedHost = getUrlHostname(expandedUrl);
    const shortenedUrl = resolvedInfo?.isShortened ?? isShortenedUrl(url);
    const resolvedShortUrl = shortenedUrl && resolvedInfo?.resolved;
    const suspiciousDomain = /\.(cc|top|xyz|click|info|shop|live|site|online|vip|net)\b/i.test(expandedUrl);
    const typoBank = /vietcorn|vietcombank-login|bidv-?secure|techcombank-?verify|mbbank-?secure/i.test(expandedUrl);
    addIndicator(
      resolvedShortUrl ? `${url} (${expandedUrl})` : url,
      resolvedShortUrl
        ? `Đường dẫn rút gọn dẫn tới ${expandedHost || expandedUrl}. Không cần mở nội dung bên trong; chỉ cần kiểm tra nguồn gửi và xem đường dẫn đích có hợp lý không.`
        : shortenedUrl
          ? "Đường dẫn rút gọn che giấu địa chỉ thật. Với tin nhắn lạ, đây là dấu hiệu cần kiểm chứng trước khi bấm."
          : suspiciousDomain || typoBank
            ? "Đường dẫn dùng tên miền lạ hoặc gần giống thương hiệu thật, thường gặp trong lừa đảo giả mạo."
            : "Tin nhắn có đường dẫn ngoài. Cần tự mở kênh chính thức để kiểm chứng, không bấm trực tiếp.",
      resolvedShortUrl ? 24 : shortenedUrl ? 28 : suspiciousDomain || typoBank ? 35 : 18,
    );
  }

  const checks: Array<{ pattern: RegExp; reason: string; points: number }> = [
    { pattern: /\b(otp|ma otp|ma xac thuc|mat khau|password|pin)\b/i, reason: "Yêu cầu mã OTP, mật khẩu hoặc mã PIN là dấu hiệu rủi ro cao. Tổ chức thật không hỏi các thông tin này qua tin nhắn.", points: 35 },
    { pattern: /\b(cccd|cmnd|can cuoc|so tai khoan|thong tin ca nhan)\b/i, reason: "Tin nhắn nhắm tới thông tin định danh hoặc tài khoản cá nhân, có thể dùng để chiếm đoạt danh tính.", points: 25 },
    { pattern: /\b(chuyen tien|nap tien vao|nap tien de|phi xac minh|phi ho so|phi van chuyen|dong phi|thanh toan phi|rut het tien)\b/i, reason: "Có yêu cầu chuyển tiền hoặc đóng phí trước. Đây là thủ đoạn phổ biến trong lừa đảo trực tuyến.", points: 30 },
    { pattern: /\b(cong an|bo cong an|co quan dieu tra|vien kiem sat|toa an|bat giam|bat giu|rua tien|ma tuy|hinh su)\b/i, reason: "Nội dung giả danh cơ quan pháp luật hoặc dùng cáo buộc hình sự để gây sợ hãi.", points: 28 },
    { pattern: /\b(ngan hang|vietcombank|bidv|techcombank|mb bank|vpbank|agribank|tai khoan bi|dang nhap la|bao mat tai khoan)\b/i, reason: "Tin nhắn giả danh ngân hàng hoặc cảnh báo tài khoản để thúc ép người nhận xác minh gấp.", points: 22 },
    { pattern: /\b(trung thuong|trung giai|nhan qua|phan thuong|iphone|xe sh|tri an khach hang)\b/i, reason: "Nội dung trúng thưởng/quà tặng bất ngờ thường được dùng để dụ nộp phí hoặc lấy thông tin cá nhân.", points: 24 },
    { pattern: /\b(khan cap|ngay lap tuc|truoc 24h|sau 2 gio|60 phut|het han|neu khong|se bi khoa|se bi bat)\b/i, reason: "Tin nhắn tạo áp lực thời gian hoặc đe dọa hậu quả để người nhận hành động vội.", points: 20 },
    { pattern: /\b(telegram|zalo|whatsapp|goi ngay|lien he ngay|091|092|093|094|096|097|098|099|03\d|05\d|07\d|08\d)\b/i, reason: "Tin nhắn kéo người dùng sang kênh liên hệ cá nhân hoặc số lạ thay vì kênh chính thức.", points: 14 },
    { pattern: /\b(khong thong bao|khong ke cho ai|bao mat tuyet doi|o mot minh|khong cup may)\b/i, reason: "Yêu cầu giữ bí mật hoặc cô lập người nhận là thủ đoạn kiểm soát tâm lý thường gặp.", points: 25 },
    { pattern: /\b(giao hang|don hang|shipper|thieu phi|hai quan|hoan tien)\b/i, reason: "Nội dung liên quan giao hàng/phí phát sinh/hoàn tiền có thể là giả mạo đơn vị vận chuyển.", points: 16 },
  ];

  for (const check of checks) {
    const match = normalized.match(check.pattern);
    if (match?.[0]) {
      const originalMatch = text.slice(match.index ?? 0, (match.index ?? 0) + match[0].length);
      addIndicator(originalMatch, check.reason, check.points);
    }
  }

  if (urls.length > 0 && indicators.some((item) => /otp|mat khau|password|pin|tai khoan|xac minh/i.test(normalizeVietnamese(item.quote + " " + item.reason)))) {
    score += 18;
  }

  const risk: Exclude<Risk, null> = score >= 55 ? "high" : score >= 25 ? "medium" : "low";
  const label = risk === "high" ? "Lừa đảo" : risk === "medium" ? "Nghi ngờ" : "An toàn";
  const mergedIndicators = mergeRelatedIndicators(indicators);
  const highlights = getIndicatorQuotes(mergedIndicators);

  return {
    risk,
    label,
    highlights,
    indicators: mergedIndicators,
    detective: risk === "high"
      ? "Bộ phân tích dự phòng phát hiện nhiều dấu hiệu rủi ro trong tin nhắn này, đặc biệt là yêu cầu hành động gấp, giả danh hoặc dẫn tới kênh không chính thức."
      : risk === "medium"
        ? "Bộ phân tích dự phòng thấy một số điểm cần kiểm chứng. Bạn chưa nên làm theo tin nhắn cho đến khi xác minh qua kênh chính thức."
        : "Bộ phân tích dự phòng chưa thấy dấu hiệu lừa đảo rõ ràng, nhưng bạn vẫn nên cẩn thận với mọi yêu cầu cung cấp thông tin cá nhân.",
    actions: getFallbackActions(risk),
    usedFallback: true,
    psychology: risk === "low" ? null : {
      manipulation: risk === "high" ? "Tin nhắn có thể đang tạo sợ hãi hoặc áp lực gấp." : "Tin nhắn có thể khiến người nhận phân vân và mất cảnh giác.",
      advice: getFallbackPsychology(risk),
    },
  };
}
function highlightText(text: string, highlights: string[], risk?: Risk) {
  if (!highlights.length) return <span>{text}</span>;

  const escaped = highlights.map((h) => h.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const regex = new RegExp(`(${escaped.join("|")})`, "gi");
  const parts = text.split(regex);

  return (
    <>
      {parts.map((part, i) => {
        const isMatch = highlights.some((h) => h.toLowerCase() === part.toLowerCase());
        return isMatch ? (
          <mark key={i} className={`${risk === "high" ? "bg-red-200 dark:bg-red-900/60 text-red-900 dark:text-red-200" : "bg-yellow-200 dark:bg-yellow-700/50 text-yellow-900 dark:text-yellow-200"} rounded px-0.5`}>
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        );
      })}
    </>
  );
}

const riskConfig = {
  high: {
    bg: "bg-red-100 dark:bg-red-950/60",
    border: "border-red-200 dark:border-red-800",
    text: "text-red-700 dark:text-red-300",
    bar: "bg-red-500",
    barBg: "bg-white/60 dark:bg-red-900/40",
    pct: "85%",
    badge: "bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-300 border-red-200 dark:border-red-700",
    histBorder: "border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40",
    footerBg: "bg-red-50 dark:bg-red-950/40 border-t border-red-100 dark:border-red-800",
    footerText: "text-red-600 dark:text-red-300",
  },
  medium: {
    bg: "bg-yellow-50 dark:bg-yellow-950/40",
    border: "border-yellow-200 dark:border-yellow-800",
    text: "text-yellow-700 dark:text-yellow-300",
    bar: "bg-yellow-400",
    barBg: "bg-white/60 dark:bg-yellow-900/30",
    pct: "48%",
    badge: "bg-yellow-100 dark:bg-yellow-900/50 text-yellow-700 dark:text-yellow-300 border-yellow-200 dark:border-yellow-700",
    histBorder: "border-yellow-200 dark:border-yellow-800 bg-yellow-50 dark:bg-yellow-950/30",
    footerBg: "bg-yellow-50 dark:bg-yellow-950/40 border-t border-yellow-100 dark:border-yellow-800",
    footerText: "text-yellow-700 dark:text-yellow-300",
  },
  low: {
    bg: "bg-green-50 dark:bg-green-950/40",
    border: "border-green-200 dark:border-green-800",
    text: "text-green-700 dark:text-green-300",
    bar: "bg-green-500",
    barBg: "bg-white/60 dark:bg-green-900/30",
    pct: "8%",
    badge: "bg-green-100 dark:bg-green-900/50 text-green-700 dark:text-green-300 border-green-200 dark:border-green-700",
    histBorder: "border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/30",
    footerBg: "bg-green-50 dark:bg-green-950/40 border-t border-green-100 dark:border-green-800",
    footerText: "text-green-700 dark:text-green-300",
  },
};

type HistoryItem = {
  id: string;
  text: string;
  risk: "high" | "medium" | "low";
  label: string;
  highlights: string[];
  indicators?: Indicator[];
  detective?: string;
  actions?: string[];
  psychology?: {
    manipulation?: string;
    advice?: string;
  } | null;
  usedFallback?: boolean;
  time: Date;
};

function getFallbackDetective(risk: Risk) {
  if (risk === "high") return "Toi phat hien dau hieu lua dao ro rang trong tin nhan nay. Noi dung co yeu to thuc ep, gia danh hoac dan du nguoi nhan hanh dong ngay.";
  if (risk === "medium") return "Tin nhan nay co mot so yeu to dang ngo. Chua du bang chung ket luan chac chan, nhung nguoi nhan nen xac minh qua kenh chinh thuc truoc khi lam theo.";
  if (risk === "low") return "Qua phan tich, toi chua thay dau hieu lua dao ro rang trong tin nhan nay. Tuy vay, van nen giu thoi quen bao ve thong tin ca nhan.";
  return "";
}

function getFallbackActions(risk: Risk) {
  if (risk === "high") {
    return [
      "Khong nhap vao duong dan hoac lam theo yeu cau trong tin nhan.",
      "Khong cung cap ma OTP, mat khau hoac thong tin ca nhan.",
      "Goi ngan hang, co quan chuc nang hoac nguoi than tin cay de xac minh.",
    ];
  }
  if (risk === "medium") {
    return [
      "Xác minh danh tính người gửi qua kênh chính thức.",
      "Không chuyển tiền hoặc cung cấp thông tin khi còn nghi ngờ.",
      "Hỏi thêm người thân hoặc người tin cậy trước khi hành động.",
    ];
  }
  return [];
}

function getFallbackPsychology(risk: Risk) {
  if (risk === "high") return "Cam giac lo lang la binh thuong vi ke lua dao thuong tao ap luc rat manh. Hay dung lai, hit tho va xac minh voi nguoi than hoac kenh chinh thuc truoc khi lam gi.";
  if (risk === "medium") return "Cam giac phan van la tin hieu tot de ban cham lai. Khong co viec an toan nao bat buoc phai quyet dinh trong vai phut.";
  return "";
}

const FOLDERS = [
  {
    id: "bank",
    title: "Giả mạo ngân hàng",
    color: "blue",
    icon: "🏦",
    summary: "Kẻ gian mạo danh tổ chức tài chính để đánh cắp thông tin đăng nhập và mã OTP (mã xác thực) nhằm chiếm đoạt tài sản.",
    examples: [
      { name: "Tin nhắn thương hiệu giả", desc: 'Tin nhắn mang tên thương hiệu lớn (Vietcombank, Techcombank...) thông báo tài khoản bị đăng nhập trái phép, yêu cầu xác minh tại đường dẫn giả: vietcornbank-login.cc.' },
      { name: "Tổng đài tự động giả", desc: 'Gọi điện bằng giọng AI (trí tuệ nhân tạo) thông báo có giao dịch đáng ngờ, yêu cầu nhấn phím hoặc đọc mã OTP (mã xác thực) để hủy.' },
      { name: "Thư điện tử lừa đảo", desc: 'Thư điện tử có giao diện giống hệt ngân hàng thông báo tài khoản bị khóa, yêu cầu nhấn vào đường dẫn giả (bidv-secure.net) để mở khóa.' },
    ],
    tips: [
      "Địa chỉ trang web sai lệch vài ký tự, tên miền lạ, không chính thống (như .cc, .net, .top) hoặc viết sai chính tả (như \"vietcornbank\" thay vì \"vietcombank\").",
      "Ngân hàng không bao giờ hỏi mật khẩu, mã OTP (mã xác thực) hay mã PIN qua điện thoại hoặc đường dẫn lạ.",
      "Luôn thúc ép hành động ngay trong vài phút để tạo tâm lý hoảng loạn.",
    ],
  },
  {
    id: "police",
    title: "Giả mạo cơ quan công an",
    color: "red",
    icon: "👮",
    summary: "Kẻ gian lợi dụng tâm lý sợ luật pháp để uy hiếp, ép buộc chuyển tiền phục vụ điều tra giả.",
    examples: [
      { name: "Cáo buộc hình sự qua điện thoại", desc: 'Xưng là cán bộ Bộ Công an, Viện kiểm sát, thông báo số điện thoại/tài khoản liên quan đến đường dây rửa tiền hoặc buôn lậu ma túy.' },
      { name: "Giấy lệnh bắt giam giả", desc: 'Gửi lệnh bắt giam, giấy triệu tập có con dấu đỏ giả mạo qua các ứng dụng nhắn tin như Zalo, Telegram để đe dọa.' },
      { name: '"Bắt cóc" người thân', desc: 'Gọi điện báo người thân đang bị giam giữ hoặc tai nạn cấp cứu, yêu cầu chuyển tiền gấp vào tài khoản "phong tỏa" và cấm liên lạc ai.' },
    ],
    tips: [
      "Công an, tòa án không làm việc hay gửi lệnh triệu tập qua điện thoại, Zalo hay bất kỳ ứng dụng nhắn tin nào.",
      "Không có tài khoản phong tỏa nào yêu cầu người dân tự chuyển tiền vào để chứng minh vô tội.",
      "Luôn ép nạn nhân ở một mình, không cúp máy và không kể cho người thân biết.",
    ],
  },
  {
    id: "prize",
    title: "Trúng thưởng giả mạo",
    color: "yellow",
    icon: "🎁",
    summary: "Kẻ lừa đảo đánh vào lòng tham bằng phần thưởng có giá trị cao, sau đó thu phí thủ tục hoặc đánh cắp thông tin.",
    examples: [
      { name: "Trúng hiện vật lớn", desc: 'Thông báo trúng iPhone 15 Pro Max, xe SH qua tin nhắn hoặc web quay số, yêu cầu vào nhan-qua-mien-phi.net để làm thủ tục.' },
      { name: "Vé máy bay / Phiếu ưu đãi miễn phí", desc: 'Trang mạng xã hội giả mạo hãng hàng không hoặc siêu thị chạy quảng cáo tặng vé, phiếu ưu đãi 5 triệu, yêu cầu điền mẫu thông tin cá nhân.' },
      { name: "Làm nhiệm vụ nhận quà", desc: 'Mời xem video, thả tim trên mạng xã hội để nhận quà, sau đó dẫn vào nhóm đầu tư tài chính lừa đảo.' },
    ],
    tips: [
      'Luôn đòi nộp phí trước: "phí vận chuyển", "thuế trước bạ" hoặc "phí hồ sơ" trước khi nhận quà.',
      "Nhận thông báo trúng thưởng từ chương trình bạn chưa từng đăng ký hay mua hàng.",
      "Trang nhận thưởng bắt đăng nhập mạng xã hội hoặc tài khoản ngân hàng kèm mã OTP (mã xác thực) để xác minh.",
    ],
  },
  {
    id: "shipper",
    title: "Giả mạo đơn vị giao hàng",
    color: "orange",
    icon: "📦",
    summary: "Lợi dụng thói quen mua sắm trực tuyến để lừa đảo qua đơn hàng giả hoặc đường dẫn thanh toán chiếm đoạt tiền.",
    examples: [
      { name: "Giao hàng giả (Boom hàng)", desc: 'Shipper giả báo có đơn hàng nhỏ của người thân, ép chuyển khoản trước. Khi mở ra bên trong là rác hoặc đồ không có giá trị.' },
      { name: "Lỗi đơn hàng / Thiếu phí", desc: 'Tin nhắn giả mạo đơn vị giao hàng GHN/GHTK: "Đơn hàng bị giữ tại kho do thiếu phí hải quan, vui lòng thanh toán tại ghn-pay.cc".' },
      { name: "Hoàn tiền đơn hàng lỗi", desc: 'Nhân viên giao hàng giả báo qua Zalo rằng đơn thất lạc, yêu cầu nhấp đường dẫn nhập thông tin ngân hàng để nhận hoàn tiền (thực chất là trang chiếm đoạt tài khoản).' },
    ],
    tips: [
      "Số tiền hoặc mã đơn hàng không khớp với bất kỳ đơn nào bạn đang chờ nhận.",
      "Shipper liên tục giục chuyển khoản mà không cho kiểm tra hàng hoặc không đợi gặp trực tiếp.",
      "Trang thanh toán phí hoặc nhận hoàn tiền dùng tên miền lạ (ghn-pay.cc thay vì ghn.vn).",
    ],
  },
];

const folderColors: Record<string, { bg: string; border: string; text: string; tag: string; iconBg: string }> = {
  blue:   { bg: "bg-blue-50 dark:bg-blue-950/40",   border: "border-blue-200 dark:border-blue-800",   text: "text-blue-700 dark:text-blue-300",   tag: "bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300",   iconBg: "bg-blue-100 dark:bg-blue-900/50" },
  red:    { bg: "bg-red-50 dark:bg-red-950/40",    border: "border-red-200 dark:border-red-800",    text: "text-red-700 dark:text-red-300",    tag: "bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-300",    iconBg: "bg-red-100 dark:bg-red-900/50" },
  yellow: { bg: "bg-yellow-50 dark:bg-yellow-950/30", border: "border-yellow-200 dark:border-yellow-800", text: "text-yellow-700 dark:text-yellow-300", tag: "bg-yellow-100 dark:bg-yellow-900/50 text-yellow-700 dark:text-yellow-300", iconBg: "bg-yellow-100 dark:bg-yellow-900/50" },
  orange: { bg: "bg-orange-50 dark:bg-orange-950/30", border: "border-orange-200 dark:border-orange-800", text: "text-orange-700 dark:text-orange-300", tag: "bg-orange-100 dark:bg-orange-900/50 text-orange-700 dark:text-orange-300", iconBg: "bg-orange-100 dark:bg-orange-900/50" },
};

function ExposeTab({ openFolder, setOpenFolder }: { openFolder: string | null; setOpenFolder: (id: string | null) => void }) {
  const active = FOLDERS.find((f) => f.id === openFolder);

  if (active) {
    const c = folderColors[active.color];
    return (
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
        <div className={`${c.bg} ${c.border} border-b px-5 py-4 flex items-center gap-3`}>
          <button
            onClick={() => setOpenFolder(null)}
            className={`w-8 h-8 rounded-full border-2 ${c.border} hover:bg-black/10 dark:hover:bg-white/20 active:scale-95 transition-all duration-150 flex items-center justify-center shrink-0`}
            aria-label="Quay lại"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className={c.text}>
              <path d="M10 12L6 8L10 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <span className={`text-xl ${c.iconBg} w-9 h-9 rounded-lg flex items-center justify-center`}>{active.icon}</span>
          <h2 className={`font-bold text-base ${c.text}`}>{active.title}</h2>
        </div>
        <div className="px-5 py-4 space-y-5">
          {/* Summary */}
          <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{active.summary}</p>

          {/* Examples */}
          <div className="space-y-2">
            <p className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Ví dụ thực tế</p>
            <div className="space-y-2">
              {active.examples.map((ex, i) => (
                <div key={i} className={`rounded-xl px-4 py-3 ${c.bg} border ${c.border}`}>
                  <p className={`text-xs font-semibold ${c.text} mb-1`}>{ex.name}</p>
                  <p className="text-xs text-gray-700 dark:text-gray-300 leading-relaxed">{ex.desc}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Tips */}
          <div className="space-y-2">
            <p className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Cách nhận biết nhanh</p>
            <ul className="space-y-1.5">
              {active.tips.map((tip, i) => (
                <li key={i} className="flex gap-2 text-xs text-gray-700 dark:text-gray-300 leading-relaxed">
                  <span className={`font-bold shrink-0 ${c.text}`}>✓</span>
                  {tip}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-5 space-y-3">
      <div className="mb-1">
        <h2 className="text-sm font-bold text-gray-800 dark:text-gray-100">Nhận biết lừa đảo bằng cách nào?</h2>
        <p className="text-xs text-gray-600 dark:text-gray-300 mt-0.5">Chọn một danh mục để xem các chiêu trò phổ biến</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
      {FOLDERS.map((folder) => {
        const c = folderColors[folder.color];
        return (
          <button
            key={folder.id}
            onClick={() => setOpenFolder(folder.id)}
            className={`w-full flex items-center gap-4 px-4 py-3.5 rounded-xl border ${c.border} ${c.bg} hover:brightness-95 hover:shadow-md hover:-translate-y-0.5 active:translate-y-0 active:shadow-sm transition-all duration-150 text-left`}
          >
            <span className={`text-2xl w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${c.iconBg}`}>
              {folder.icon}
            </span>
            <div className="flex-1 min-w-0">
              <p className={`text-sm font-semibold ${c.text}`}>{folder.title}</p>
            </div>
            <span className="text-gray-300 dark:text-gray-600 text-lg">›</span>
          </button>
        );
      })}
      </div>
    </div>
  );
}

export default function App() {
  const [dark, setDark] = useState(() => {
    try { return localStorage.getItem("scamcheck-dark") === "true"; } catch { return false; }
  });
  const [tab, setTab] = useState<"check" | "history" | "expose">("check");
  const [openFolder, setOpenFolder] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [analysis, setAnalysis] = useState<Analysis>({ risk: null, label: "", highlights: [] });
  const [history, setHistory] = useState<HistoryItem[]>(() => {
    try {
      const saved = localStorage.getItem("scamcheck-history");
      if (!saved) return [];
      const parsed = JSON.parse(saved);
      return parsed.map((item: HistoryItem) => ({ ...item, time: new Date(item.time) }));
    } catch { return []; }
  });
  const [loading, setLoading] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [selectedHistory, setSelectedHistory] = useState<HistoryItem | null>(null);
  const [situation, setSituation] = useState<Situation>(null);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    try { localStorage.setItem("scamcheck-dark", String(dark)); } catch {}
  }, [dark]);

  useEffect(() => {
    try { localStorage.setItem("scamcheck-history", JSON.stringify(history)); } catch {}
  }, [history]);

  async function resolveUrlsForFallback(text: string): Promise<UrlAnalysis[]> {
    try {
      const response = await fetch("/api/urls", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ message: text }),
      });

      const data = await response.json().catch(() => null);
      return Array.isArray(data?.urls) ? data.urls : [];
    } catch {
      return [];
    }
  }
  async function analyzeWithAI(text: string): Promise<Analysis> {
    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ message: text }),
    });

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      if (data?.error === "Gemini returned invalid JSON") {
        throw new AnalyzeError("invalid_json", "Gemini chưa trả xong kết quả phân tích");
      }

      throw new AnalyzeError("ai_error", "Không gọi được AI");
    }


    const riskMap: Record<string, Risk> = {
      "Lừa đảo": "high",
      "Nguy hiểm": "high",
      "Nghi ngờ": "medium",
      "An toàn": "low",
    };

    const risk = riskMap[data.risk] ?? "medium";
    const aiIndicators = Array.isArray(data.indicators)
      ? mergeRelatedIndicators(
          data.indicators
            .filter((item: { quote?: string; reason?: string }) => Boolean(item.quote))
            .map((item: { quote?: string; reason?: string }) => ({
              quote: item.quote ?? "",
              reason: item.reason ?? "",
            })),
        )
      : [];

    return {
      risk,
      label: data.risk ?? "Nghi ngờ",
      highlights: getIndicatorQuotes(aiIndicators),
      indicators: aiIndicators,
      detective: typeof data.detective === "string" && data.detective.trim()
        ? data.detective.trim()
        : getFallbackDetective(risk),
      actions: Array.isArray(data.actions)
        ? data.actions.filter((action: unknown): action is string => typeof action === "string" && Boolean(action.trim()))
        : getFallbackActions(risk),
      usedFallback: false,
      psychology: data.psychology && typeof data.psychology === "object"
        ? {
            manipulation: typeof data.psychology.manipulation === "string" ? data.psychology.manipulation : undefined,
            advice: typeof data.psychology.advice === "string" ? data.psychology.advice : undefined,
          }
        : null,
    };
  }

  const handleCheck = async () => {
    if (!input.trim() || loading) return;

    setLoading(true);
    setAnalysis({ risk: null, label: "", highlights: [] });

    try {
      const result = await analyzeWithAI(input);

      setAnalysis(result);

      if (result.risk) {
        setHistory((prev) => [
          {
            id: Date.now().toString(),
            text: input,
            risk: result.risk,
            label: result.label,
            highlights: result.highlights,
            indicators: result.indicators,
            detective: result.detective,
            actions: result.actions,
            psychology: result.psychology,
            usedFallback: result.usedFallback,
            time: new Date(),
          },
          ...prev.slice(0, 49),
        ]);
      }
    } catch (error) {
      let fallbackResult: Analysis;

      try {
        const fallbackUrls = await resolveUrlsForFallback(input);
        fallbackResult = analyzeText(input, fallbackUrls);
      } catch {
        fallbackResult = analyzeText(input);
      }

      setAnalysis(fallbackResult);

      if (fallbackResult.risk) {
        setHistory((prev) => [
          {
            id: Date.now().toString(),
            text: input,
            risk: fallbackResult.risk,
            label: fallbackResult.label,
            highlights: fallbackResult.highlights,
            indicators: fallbackResult.indicators,
            detective: fallbackResult.detective,
            actions: fallbackResult.actions,
            psychology: fallbackResult.psychology,
            usedFallback: true,
            time: new Date(),
          },
          ...prev.slice(0, 49),
        ]);
      }

    } finally {
      setLoading(false);
    }
  };

  const formatTime = (d: Date) =>
    d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" }) +
    " · " +
    d.toLocaleDateString("vi-VN");

  const cfg = analysis.risk ? riskConfig[analysis.risk] : null;
  const detectiveText = analysis.detective || getFallbackDetective(analysis.risk);
  const actionItems = analysis.actions?.length ? analysis.actions : getFallbackActions(analysis.risk);
  const psychologyText = analysis.psychology?.advice || getFallbackPsychology(analysis.risk);

  return (
    <div className="min-h-screen bg-[#f0f4ff] dark:bg-gray-900 transition-colors duration-300 flex flex-col items-center py-6 sm:py-10 px-3 sm:px-6">
      <Toaster position="top-center" theme={dark ? "dark" : "light"} richColors pauseWhenPageIsHidden={false} toastOptions={{ style: { borderRadius: "14px" }, closeButton: true }} />
      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4" onClick={() => setShowConfirm(false)}>
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
          <div
            className="relative bg-white dark:bg-gray-800 rounded-2xl shadow-xl border border-gray-100 dark:border-gray-700 p-6 w-full max-w-sm space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-950/60 flex items-center justify-center shrink-0">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6"/>
                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                  <path d="M10 11v6"/>
                  <path d="M14 11v6"/>
                  <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                </svg>
              </div>
              <div>
                <p className="text-sm font-bold text-gray-800 dark:text-gray-100">Xóa toàn bộ lịch sử?</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Hành động này không thể hoàn tác.</p>
              </div>
            </div>
            <div className="flex gap-2 justify-end pt-1">
              <button
                onClick={() => setShowConfirm(false)}
                className="px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-600 text-sm font-semibold text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600 active:scale-95 transition-all duration-150"
              >
                Hủy
              </button>
              <button
                onClick={() => { setHistory([]); setShowConfirm(false); }}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-red-600 hover:bg-red-700 active:scale-95 transition-all duration-150"
              >
                Xóa
              </button>
            </div>
          </div>
        </div>
      )}


      {/* Dark mode toggle — fixed top right */}
      <button
        onClick={() => setDark((d) => !d)}
        className="fixed top-4 right-4 z-50 w-9 h-9 rounded-full flex items-center justify-center bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 shadow-sm hover:shadow-md transition-all duration-150 text-gray-600 dark:text-yellow-300"
        aria-label="Chuyển chế độ sáng/tối"
      >
        {dark ? <Sun size={16} /> : <Moon size={16} />}
      </button>

      <div className="w-full max-w-xl lg:max-w-3xl space-y-4 sm:space-y-5">
        {/* Header */}
        <div className="text-center">
          <div className="flex items-center justify-center gap-2 mb-1">
            <svg width="34" height="34" viewBox="0 0 38 38" fill="none" xmlns="http://www.w3.org/2000/svg" className="sm:w-[38px] sm:h-[38px]">
              <path d="M19 3L6 8.5V19C6 26.5 11.5 33.4 19 35C26.5 33.4 32 26.5 32 19V8.5L19 3Z" fill="#2563eb"/>
              <path d="M19 3L6 8.5V19C6 26.5 11.5 33.4 19 35C26.5 33.4 32 26.5 32 19V8.5L19 3Z" fill="url(#shield-grad)"/>
              <path d="M14 19.5L17.5 23L24 16" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
              <defs>
                <linearGradient id="shield-grad" x1="6" y1="3" x2="32" y2="35" gradientUnits="userSpaceOnUse">
                  <stop offset="0%" stopColor="#3b82f6"/>
                  <stop offset="100%" stopColor="#1d4ed8"/>
                </linearGradient>
              </defs>
            </svg>
            <h1 className="text-3xl sm:text-4xl font-extrabold text-[#2563eb] tracking-tight">ScamCheck</h1>
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Bảo vệ bạn khỏi lừa đảo trực tuyến
          </p>
        </div>

        {/* Tabs — sticky on mobile */}
        <div className="sticky top-2 z-30 flex gap-1 bg-white dark:bg-gray-800 rounded-xl p-1 shadow-sm border border-gray-100 dark:border-gray-700 mx-[3px]">
          {(["check", "expose", "history"] as const).map((t) => {
            const labels = { check: "Kiểm tra", expose: "Nhận biết lừa đảo", history: "Lịch sử" };
            return (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`flex-1 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-all duration-150 ${
                  tab === t
                    ? "bg-[#2563eb] text-white shadow"
                    : "text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700 active:scale-95"
                }`}
              >
                {labels[t]}
              </button>
            );
          })}
        </div>

        {/* Tab: Check */}
        {tab === "check" && (
          <div className="space-y-4">
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-5 space-y-4 lg:self-start">
              <div>
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Thử nghiệm tính năng:</p>
                <div className="flex flex-wrap gap-2">
                  {SAMPLES.map((s) => (
                    <button
                      key={s.label}
                      onClick={() => setInput(s.text)}
                      className="text-xs border border-gray-200 dark:border-gray-600 rounded-full px-3 py-1.5 text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-700 hover:bg-blue-50 dark:hover:bg-blue-900/30 hover:border-blue-300 hover:text-blue-700 dark:hover:text-blue-400 hover:shadow-sm hover:scale-105 active:scale-95 transition-all duration-150"
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-end justify-between gap-3">
                  <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Kiểm tra tin nhắn lừa đảo bằng cách dán nội dung tin nhắn dưới đây:</p>
                  <span className="text-xs text-gray-400 dark:text-gray-500 shrink-0">{input.length}/{MAX_MESSAGE_LENGTH}</span>
                </div>
              <textarea
                value={input}
                onChange={(e) => { setInput(e.target.value.slice(0, MAX_MESSAGE_LENGTH)); setAnalysis({ risk: null, label: "", highlights: [] }); setSituation(null); }}
                maxLength={MAX_MESSAGE_LENGTH}
                placeholder="Dán hoặc gõ nội dung tin nhắn nghi ngờ vào đây..."
                rows={5}
                className="w-full resize-y rounded-xl border border-gray-200 dark:border-gray-600 bg-[#f8f9ff] dark:bg-gray-900 px-4 py-3 text-sm text-gray-700 dark:text-gray-200 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-[#2563eb]/30 focus:border-[#2563eb] transition min-h-[120px] lg:min-h-[140px]"
              />
              </div>

              <button
                onClick={handleCheck}
                disabled={!input.trim() || loading}
                className="w-full flex items-center justify-center gap-2 bg-[#2563eb] hover:bg-[#1d4ed8] disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold text-base rounded-xl py-3 transition-all duration-150 active:scale-[0.98]"
              >
                {loading ? (
                  <svg className="animate-spin" width="20" height="20" viewBox="0 0 20 20" fill="none">
                    <circle cx="10" cy="10" r="7" stroke="white" strokeWidth="2" strokeOpacity="0.3"/>
                    <path d="M10 3a7 7 0 0 1 7 7" stroke="white" strokeWidth="2" strokeLinecap="round"/>
                  </svg>
                ) : (
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                    <circle cx="8.5" cy="8.5" r="5" stroke="white" strokeWidth="2"/>
                    <path d="M13 13L17 17" stroke="white" strokeWidth="2" strokeLinecap="round"/>
                  </svg>
                )}
                {loading ? "Đang kiểm tra..." : "Kiểm tra"}
              </button>
            </div>

            {/* Live result panel */}
            {cfg && input.trim() && (
              <div className="space-y-3">
                {analysis.usedFallback && (
                  <div className="rounded-xl border border-yellow-200 dark:border-yellow-700 bg-yellow-50 dark:bg-yellow-900/20 px-4 py-3 text-sm text-yellow-800 dark:text-yellow-200 leading-relaxed">
                    Không kết nối được tới máy chủ AI, ScamCheck sẽ sử dụng bộ phân tích dự phòng.
                  </div>
                )}
                <div className={`rounded-2xl border ${cfg.border} overflow-hidden shadow-sm`}>
                  <div className={`${cfg.bg} px-5 pt-4 pb-3 text-center border-b ${cfg.border}`}>
                    <p className={`text-xs font-bold uppercase tracking-widest ${cfg.text} mb-0.5`}>
                      Mức độ rủi ro
                    </p>
                    <p className={`text-3xl font-extrabold ${cfg.text}`}>{analysis.label}</p>
                    </div>
                  <div className="bg-white dark:bg-gray-800 px-5 py-4 space-y-2">
                    <p className="text-xs font-semibold text-gray-500 dark:text-gray-400">Nội dung tin nhắn gốc:</p>
                    <p className="text-sm text-gray-700 dark:text-gray-200 leading-relaxed whitespace-pre-wrap">
                      {highlightText(input, analysis.highlights, analysis.risk)}
                    </p>
                  </div>
                </div>

                {/* Detective card */}
                <div className="rounded-2xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-gray-800 overflow-hidden shadow-sm">
                  <div className="bg-slate-800 dark:bg-slate-900 px-4 py-2.5 flex items-center gap-2">
                    <span className="text-lg">🕵️</span>
                    <span className="text-xs font-bold text-slate-100 uppercase tracking-wider">Thám tử phân tích</span>
                  </div>
                  <div className="px-5 py-4 space-y-3">
                    <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">{detectiveText}</p>
                    {analysis.highlights.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Điểm đánh dấu</p>
                        <div className="space-y-2">
                          {mergeRelatedIndicators(analysis.indicators?.length
                            ? analysis.indicators
                            : analysis.highlights.map((quote) => ({ quote, reason: "" }))
                          ).map((indicator, i) => (
                            <div key={i} className={`rounded-lg border ${analysis.risk === "high" ? "border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-950/30" : "border-yellow-200 dark:border-yellow-700 bg-yellow-50 dark:bg-yellow-900/20"} px-3 py-2 space-y-1`}>
                              <p className={`text-xs ${analysis.risk === "high" ? "text-red-800 dark:text-red-300" : "text-yellow-800 dark:text-yellow-300"} font-mono`}>{indicator.quote}</p>
                              {indicator.reason && (
                                <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">{indicator.reason}</p>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {actionItems.length > 0 && (
                      <div className="space-y-1">
                        <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Hành động cần làm</p>
                        <ul className="space-y-1">
                          {actionItems.map((action, i) => (
                            <li key={i} className="text-xs text-slate-700 dark:text-slate-300 flex gap-2">
                              <span className="text-blue-500 font-bold shrink-0">-</span>{action}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>

                {/* Psychologist card */}
                {(analysis.risk === "high" || analysis.risk === "medium") && (
                  <div className="rounded-2xl border border-purple-200 dark:border-purple-700 bg-white dark:bg-gray-800 overflow-hidden shadow-sm">
                    <div className="bg-purple-600 dark:bg-purple-800 px-4 py-2.5 flex items-center gap-2">
                      <span className="text-lg">🧠</span>
                      <span className="text-xs font-bold text-white uppercase tracking-wider">Cô tâm lý</span>
                    </div>
                    <div className="px-5 py-4">
                      <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">{psychologyText}</p>
                    </div>
                  </div>
                )}

                {/* Người ứng cứu — situation question */}
                {(analysis.risk === "high" || analysis.risk === "medium") && (
                  <div className="rounded-2xl border border-orange-200 dark:border-orange-700 bg-white dark:bg-gray-800 overflow-hidden shadow-sm">
                    <div className="bg-orange-500 dark:bg-orange-700 px-4 py-2.5 flex items-center gap-2">
                      <span className="text-lg">🚨</span>
                      <span className="text-xs font-bold text-white uppercase tracking-wider">Người ứng cứu</span>
                    </div>
                    <div className="px-5 py-4 space-y-3">
                      <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">Bạn đã làm gì?</p>
                      <div className="grid grid-cols-1 gap-2">
                        {([
                          { value: "nothing", label: "Chưa làm gì" },
                          { value: "clicked", label: "Đã bấm vào đường dẫn" },
                          { value: "transferred", label: "Đã chuyển khoản" },
                          { value: "otp", label: "Đã cung cấp mã OTP (mã xác thực)" },
                        ] as { value: Situation; label: string }[]).map((opt) => (
                          <button
                            key={opt.value}
                            onClick={() => setSituation(situation === opt.value ? null : opt.value)}
                            className={`text-left px-4 py-2.5 rounded-xl border text-sm font-medium transition-all duration-150 active:scale-[0.98] ${
                              situation === opt.value
                                ? "bg-orange-500 dark:bg-orange-600 border-orange-500 text-white"
                                : "border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-700 hover:border-orange-300 hover:bg-orange-50 dark:hover:bg-orange-900/20"
                            }`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>

                      {/* L5-05: Nothing done — short praise */}
                      {situation === "nothing" && (
                        <div className="bg-green-50 dark:bg-green-950/40 border border-green-200 dark:border-green-800 rounded-xl px-4 py-3">
                          <p className="text-sm text-green-700 dark:text-green-300 font-medium">Bạn đã làm đúng! Hãy giữ nguyên và không thực hiện bất kỳ hành động nào theo yêu cầu trong tin nhắn đó.</p>
                        </div>
                      )}

                      {/* L5-03/04: Action steps for other situations */}
                      {situation && situation !== "nothing" && (() => {
                        const script = SITUATION_SCRIPTS[situation];
                        return (
                          <div className="space-y-3">
                            <p className="text-xs font-bold text-orange-600 dark:text-orange-400 uppercase tracking-wide">{script.title}</p>
                            <ol className="space-y-2">
                              {script.steps.map((step, i) => (
                                <li key={i} className="flex gap-3 text-sm text-gray-700 dark:text-gray-200">
                                  <span className="w-5 h-5 rounded-full bg-orange-500 text-white text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>
                                  {step}
                                </li>
                              ))}
                            </ol>

                            {/* Hotlines */}
                            <div className="space-y-2 pt-1">
                              <p className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Số điện thoại chính thức cần gọi</p>
                              <div className="grid grid-cols-2 sm:grid-cols-2 gap-2">
                                <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800">
                                  <span className="text-base">👮</span>
                                  <div>
                                    <p className="text-xs font-bold text-red-700 dark:text-red-300">{HOTLINES.police.phone}</p>
                                    <p className="text-xs text-red-500 dark:text-red-400">{HOTLINES.police.name}</p>
                                  </div>
                                </div>
                                <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800">
                                  <span className="text-base">🛡️</span>
                                  <div>
                                    <p className="text-xs font-bold text-blue-700 dark:text-blue-300">{HOTLINES.attt.phone}</p>
                                    <p className="text-xs text-blue-500 dark:text-blue-400">{HOTLINES.attt.name}</p>
                                  </div>
                                </div>
                              </div>
                              <p className="text-xs font-semibold text-gray-600 dark:text-gray-300 mt-1">Hotline ngân hàng:</p>
                              <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                                {HOTLINES.banks.map((b) => (
                                  <div key={b.name} className="flex items-center justify-between px-3 py-1.5 rounded-lg bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600">
                                    <span className="text-xs text-gray-600 dark:text-gray-300 font-medium">{b.name}</span>
                                    <span className="text-xs font-bold text-[#2563eb] dark:text-blue-400">{b.phone}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Tab: History */}
        {tab === "history" && !selectedHistory && (
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-5">
            {history.length === 0 ? (
              <div className="text-center py-12 text-gray-600 dark:text-gray-300">
                <div className="text-4xl mb-3">📭</div>
                <p className="text-sm">Chưa có lịch sử kiểm tra nào.</p>
                <p className="text-xs mt-1">Hãy nhập một tin nhắn nghi ngờ để bắt đầu!</p>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between mb-4">
                  <span className="text-sm font-bold text-gray-800 dark:text-gray-100">Lịch sử kiểm tra</span>
                  <button
                    onClick={() => setShowConfirm(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 text-xs font-semibold hover:bg-red-100 dark:hover:bg-red-900/50 active:scale-95 transition-all duration-150"
                  >
                    <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M2 3.5h9M5 3.5V2.5h3v1M10 3.5l-.5 7H3.5l-.5-7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    Xóa tất cả
                  </button>
                </div>
                {history.map((item) => {
                  const c = riskConfig[item.risk];
                  return (
                    <div
                      key={item.id}
                      className={`rounded-xl border p-3.5 space-y-2 cursor-pointer hover:shadow-md hover:-translate-y-0.5 active:translate-y-0 active:shadow-sm transition-all duration-150 ${c.histBorder}`}
                      onClick={() => setSelectedHistory(item)}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm text-gray-700 dark:text-gray-200 line-clamp-2 flex-1">{item.text}</p>
                        <span className={`shrink-0 text-xs font-semibold px-2 py-0.5 rounded-full border ${c.badge}`}>
                          {item.label}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        {item.usedFallback ? (
                          <span className="rounded-full border border-yellow-200 dark:border-yellow-700 bg-yellow-50 dark:bg-yellow-900/20 px-2 py-0.5 text-xs font-semibold text-yellow-800 dark:text-yellow-200">
                            Dùng bộ phân tích dự phòng
                          </span>
                        ) : <span />}
                        <span className="text-xs text-gray-400 dark:text-gray-300">{formatTime(item.time)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* History detail submenu */}
        {tab === "history" && selectedHistory && (() => {
          const item = selectedHistory;
          const c = riskConfig[item.risk];
          const itemDetectiveText = item.detective || getFallbackDetective(item.risk);
          const itemActionItems = item.actions?.length ? item.actions : getFallbackActions(item.risk);
          const itemPsychologyText = item.psychology?.advice || getFallbackPsychology(item.risk);
          return (
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
              {/* Header */}
              <div className={`${c.bg} ${c.border} border-b px-5 py-4 flex items-center gap-3`}>
                <button
                  onClick={() => setSelectedHistory(null)}
                  className={`w-8 h-8 rounded-full border-2 ${c.border} hover:bg-black/10 dark:hover:bg-white/20 active:scale-95 transition-all duration-150 flex items-center justify-center shrink-0`}
                  aria-label="Quay lại"
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className={c.text}>
                    <path d="M10 12L6 8L10 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>
                <div>
                  <p className={`text-xs font-bold uppercase tracking-widest ${c.text}`}>Mức độ rủi ro</p>
                  <p className={`text-xl font-extrabold ${c.text}`}>{item.label}</p>
                </div>
                <span className="text-xs text-gray-400 dark:text-gray-300 ml-auto shrink-0">{formatTime(item.time)}</span>
              </div>

              <div className="p-5 space-y-4">
                {item.usedFallback && (
                  <div className="rounded-xl border border-yellow-200 dark:border-yellow-700 bg-yellow-50 dark:bg-yellow-900/20 px-4 py-3 text-sm text-yellow-800 dark:text-yellow-200 leading-relaxed">
                    Lần kiểm tra này sử dụng bộ phân tích dự phòng vì ScamCheck không kết nối được tới máy chủ AI.
                  </div>
                )}

                {/* Original message */}
                <div className="space-y-1.5">
                  <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Nội dung tin nhắn gốc</p>
                  <div className="bg-gray-50 dark:bg-gray-900 rounded-xl px-4 py-3 text-sm text-gray-700 dark:text-gray-200 leading-relaxed whitespace-pre-wrap">
                    {highlightText(item.text, item.highlights, item.risk)}
                  </div>
                </div>

                {/* Detective card */}
                <div className="rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-gray-800 overflow-hidden">
                  <div className="bg-slate-800 dark:bg-slate-900 px-4 py-2.5 flex items-center gap-2">
                    <span className="text-base">🕵️</span>
                    <span className="text-xs font-bold text-slate-100 uppercase tracking-wider">Thám tử phân tích</span>
                  </div>
                  <div className="px-4 py-3 space-y-3">
                    <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">{itemDetectiveText}</p>
                    {item.highlights.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Điểm đánh dấu nghi ngờ</p>
                        <div className="space-y-2">
                          {mergeRelatedIndicators(item.indicators?.length
                            ? item.indicators
                            : item.highlights.map((quote) => ({ quote, reason: "" }))
                          ).map((indicator, i) => (
                            <div key={i} className={`rounded-lg border ${item.risk === "high" ? "border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-950/30" : "border-yellow-200 dark:border-yellow-700 bg-yellow-50 dark:bg-yellow-900/20"} px-3 py-2 space-y-1`}>
                              <p className={`text-xs ${item.risk === "high" ? "text-red-800 dark:text-red-300" : "text-yellow-800 dark:text-yellow-300"} font-mono`}>{indicator.quote}</p>
                              {indicator.reason && (
                                <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">{indicator.reason}</p>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {itemActionItems.length > 0 && (
                      <div className="space-y-1">
                        <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Hành động cần làm</p>
                        <ul className="space-y-1">
                          {itemActionItems.map((action, i) => (
                            <li key={i} className="text-xs text-slate-700 dark:text-slate-300 flex gap-2">
                              <span className="text-blue-500 font-bold shrink-0">-</span>{action}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>

                {/* Psychologist card */}
                {(item.risk === "high" || item.risk === "medium") && (
                  <div className="rounded-xl border border-purple-200 dark:border-purple-700 bg-white dark:bg-gray-800 overflow-hidden">
                    <div className="bg-purple-600 dark:bg-purple-800 px-4 py-2.5 flex items-center gap-2">
                      <span className="text-base">🧠</span>
                      <span className="text-xs font-bold text-white uppercase tracking-wider">Cô tâm lý</span>
                    </div>
                    <div className="px-4 py-3">
                      <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">{itemPsychologyText}</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })()}

        {/* Tab: Expose */}
        {tab === "expose" && (
          <ExposeTab openFolder={openFolder} setOpenFolder={setOpenFolder} />
        )}

        <p className="text-center text-xs text-gray-400 dark:text-gray-300">
          ScamCheck · Bảo vệ bạn khỏi lừa đảo trực tuyến
        </p>

        {/* Legal notice */}
        <div className="rounded-xl border border-blue-100 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/40 px-5 py-4 text-xs text-blue-800 dark:text-blue-300 leading-relaxed text-center">
          <span className="font-bold">Lưu ý pháp lý:</span> ScamCheck là công cụ giáo dục do nhóm học viên phát triển và đánh giá của ứng dụng không thay thế cảnh báo chính thức từ ngân hàng hoặc cơ quan chức năng. Nếu nghi ngờ, người dùng nên gọi tổng đài chính thức của ngân hàng được in trên thẻ ngân hàng.
        </div>
      </div>
    </div>
  );
}






























