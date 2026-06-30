import { useState, useEffect, useRef } from "react";
import { Sun, Moon, WifiOff, ShieldAlert } from "lucide-react";
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

type Situation = "nothing" | "clicked" | "transferred" | "otp" | "installed" | "personalInfo" | null;

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
  installed: {
    title: "Bạn đã tải hoặc cài đặt ứng dụng lạ",
    steps: [
      "Ngắt mạng tạm thời nếu ứng dụng yêu cầu quyền nhạy cảm hoặc điều khiển thiết bị.",
      "Gỡ ứng dụng lạ vừa cài và không mở lại tệp tải xuống.",
      "Kiểm tra quyền truy cập tin nhắn, danh bạ, ảnh, trợ năng và thông báo.",
      "Đổi mật khẩu email, ngân hàng và mạng xã hội trên một thiết bị an toàn khác.",
      "Nhờ người tin cậy kiểm tra điện thoại nếu máy có biểu hiện lạ.",
    ],
  },
  personalInfo: {
    title: "Bạn đã nhập thông tin cá nhân",
    steps: [
      "Chụp lại trang đã nhập thông tin để lưu bằng chứng.",
      "Đổi mật khẩu các tài khoản có liên quan ngay lập tức.",
      "Không gửi thêm CCCD, ảnh thẻ, số tài khoản hoặc thông tin gia đình.",
      "Theo dõi cuộc gọi lạ và tin nhắn giả danh trong vài ngày tới.",
      "Liên hệ ngân hàng nếu đã nhập thông tin thẻ hoặc tài khoản.",
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
type AnalyzeErrorCode = "invalid_json" | "truncated" | "overloaded" | "quota" | "auth" | "network" | "server" | "ai_error";

class AnalyzeError extends Error {
  code: AnalyzeErrorCode;
  status?: number;

  constructor(code: AnalyzeErrorCode, message: string, status?: number) {
    super(message);
    this.name = "AnalyzeError";
    this.code = code;
    this.status = status;
  }
}

function getAnalyzeErrorToast(error: unknown) {
  if (error instanceof AnalyzeError) {
    if (error.code === "invalid_json") {
      return {
        title: "AI trả kết quả chưa đúng định dạng",
        description: "Gemini phản hồi không đúng cấu trúc JSON. ScamCheck đã sử dụng bộ phân tích dự phòng cho lần kiểm tra này.",
      };
    }

    if (error.code === "truncated") {
      return {
        title: "AI trả về kết quả lỗi",
        description: "ScamCheck đã sử dụng bộ phân tích dự phòng cho lần kiểm tra này.",
      };
    }

    if (error.code === "overloaded") {
      return {
        title: "AI đang bị quá tải",
        description: "Máy chủ AI hiện phản hồi chậm hoặc báo quá tải. ScamCheck đã sử dụng bộ phân tích dự phòng cho lần kiểm tra này.",
      };
    }

    if (error.code === "quota") {
      return {
        title: "AI bị giới hạn lượt gọi",
        description: "API key có thể đã bị giới hạn tạm thời. ScamCheck đã sử dụng bộ phân tích dự phòng cho lần kiểm tra này.",
      };
    }

    if (error.code === "auth") {
      return {
        title: "API key không hợp lệ",
        description: "Máy chủ không xác thực được API key. ScamCheck đã sử dụng bộ phân tích dự phòng cho lần kiểm tra này.",
      };
    }

    if (error.code === "network") {
      return {
        title: "Không thể kết nối tới máy chủ AI",
        description: "Mạng hoặc máy chủ phản hồi không ổn định. ScamCheck đã sử dụng bộ phân tích dự phòng cho lần kiểm tra này.",
      };
    }

    if (error.code === "server") {
      return {
        title: "Máy chủ AI gặp lỗi",
        description: error.status ? `API trả về lỗi ${error.status}. ScamCheck đã sử dụng bộ phân tích dự phòng cho lần kiểm tra này.` : "ScamCheck đã sử dụng bộ phân tích dự phòng cho lần kiểm tra này.",
      };
    }
  }

  return {
    title: "Không thể dùng AI lúc này",
    description: "ScamCheck đã sử dụng bộ phân tích dự phòng cho lần kiểm tra này.",
  };
}

type Indicator = {
  quote: string;
  reason: string;
};

type PromptInjectionWarning = {
  detected: boolean;
  quote?: string;
  reason?: string;
};

type UrlAnalysis = {
  original: string;
  expanded: string;
  isShortened: boolean;
  resolved: boolean;
  invalidTarget?: boolean;
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
  promptInjection?: PromptInjectionWarning | null;
}

function getIndicatorBaseQuote(quote: string) {
  return quote
    .split("->")[0]
    ?.replace(/\s+\(https?:\/\/.*\)\s*$/i, "")
    .trim()
    .toLowerCase() || quote.trim().toLowerCase();
}

function detectPromptInjection(text: string): PromptInjectionWarning | null {
  const patterns = [
    /(?:ignore|disregard|forget|bypass|override)[^\n.]{0,120}(?:previous|above|prior|system|developer|instructions?|rules?|prompt)/i,
    /(?:do not|don't|never)[^\n.]{0,80}(?:return|output|respond)[^\n.]{0,40}(?:json|JSON)/i,
    /(?:return|output|respond)[^\n.]{0,80}(?:only|just)[^\n.]{0,80}(?:safe|not suspicious|no risk|json|JSON)/i,
    /(?:you are now|act as|pretend to be|developer mode|jailbreak|system prompt)/i,
    /(?:bỏ qua|bo qua|phớt lờ|phot lo|quên|quen|ghi đè|ghi de|vượt qua|vuot qua)[^\n.]{0,120}(?:hướng dẫn|huong dan|lệnh|lenh|quy tắc|quy tac|prompt|system|hệ thống|he thong|trước đó|truoc do)/i,
    /(?:không|khong|đừng|dung)[^\n.]{0,80}(?:trả về|tra ve|xuất|xuat)[^\n.]{0,40}(?:json|JSON)/i,
    /(?:chỉ|chi)[^\n.]{0,60}(?:trả về|tra ve|nói|noi)[^\n.]{0,80}(?:an toàn|an toan|không đáng ngờ|khong dang ngo|không có rủi ro|khong co rui ro)/i,
  ];

  for (const pattern of patterns) {
    const quote = text.match(pattern)?.[0]?.trim();
    if (quote) {
      return {
        detected: true,
        quote: quote.slice(0, 180),
        reason: "Tin nhắn có câu chữ giống yêu cầu điều khiển AI hoặc thay đổi cách ScamCheck trả lời. ScamCheck đã bỏ qua phần này khi phân tích.",
      };
    }
  }

  return null;
}

function isPromptInjectionIndicator(indicator: Indicator, warning?: PromptInjectionWarning | null) {
  const quote = indicator.quote.trim();
  const text = `${indicator.quote} ${indicator.reason}`;
  const warningQuote = warning?.quote?.trim().toLowerCase();

  if (warningQuote && quote.toLowerCase() === warningQuote) return true;

  return [
    /(?:developer|admin|system prompt|prompt|instruction|hÆ°á»›ng dáº«n|huong dan|quy táº¯c|quy tac)[^\n.]{0,120}(?:given|project|ignore|bá» qua|bo qua|lá»‡nh|lenh|rule|whole prompt|toÃ n bá»™ prompt|toan bo prompt)/i,
    /(?:json|output|detective|risk)[^\n.]{0,120}(?:date|time|high|safe|an toÃ n|an toan|change|say|tráº£ vá»|tra ve)/i,
    /(?:change|set|modify|alter)[^\n.]{0,80}(?:risk|json|output|answer|response)/i,
    /(?:try to|if you see this|if you are required)[^\n.]{0,120}(?:say|answer|change|output|json)/i,
  ].some((pattern) => pattern.test(text));
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
  return /\b(khong lam theo|khong chuyen tien|khong cung cap|khong bam|khong nhap|khong dang nhap|khong goi lai|khong tham gia|khong to chuc|khong danh bac|khong ca do|khong tiep tay|dung bam|dung cung cap|canh giac|phong tranh)\b/i.test(normalized)
    || /\b(khong|dung)\b.{0,60}\b(lam theo|bam vao|nhan vao|truy cap|dang nhap|xac minh|cung cap|gui otp|doc ma otp|chuyen tien|nap tien|dong phi|lien he so la|goi so la|tham gia|to chuc danh bac|danh bac|ca do|tiep tay)\b/i.test(normalized);
}

function getActionableText(normalized: string) {
  return normalized
    .replace(/\b(tuyet doi khong|khong|dung|khong nen|canh bao khong)\b.{0,120}\b(lam theo|bam vao|nhan vao|truy cap|dang nhap|xac minh|cung cap|gui otp|doc ma otp|chuyen tien|nap tien|dong phi|lien he so la|goi so la|tham gia|to chuc danh bac|danh bac|ca do|tiep tay|cai dat ung dung la)\b/gi, " ")
    .replace(/\b(khuyen cao|canh bao|de nghi nguoi dan|tuyet doi)\b.{0,140}\b(khong tham gia|khong lam theo|khong chuyen tien|khong cung cap|khong bam|khong nhap|bao ngay cho co quan|lien he co quan cong an)\b/gi, " ");
}

function hasRiskyActionRequest(normalized: string) {
  const actionableText = getActionableText(normalized);
  const requestToSensitiveInfo = /\b(vui long|hay|can|yeu cau|bat buoc|de nghi|nhap|gui|doc|cung cap|xac minh|dang nhap|cap nhat)\b.{0,90}\b(otp|ma xac thuc|mat khau|password|pin|cccd|cmnd|can cuoc|thong tin ca nhan|tai khoan ngan hang|so tai khoan|sinh trac hoc)\b/i.test(actionableText);
  const requestToMoney = /\b(vui long|hay|can|yeu cau|bat buoc|de nghi|chuyen|nap|dong|thanh toan|nop|dat coc|ung truoc)\b.{0,90}\b(tien|phi|coc|thue|ho so|van chuyen|xac minh|tai khoan ca nhan|rut tien|nhan tien)\b/i.test(actionableText);
  const requestToUnsafeChannel = /\b(vui long|hay|can|yeu cau|bat buoc|de nghi|lien he|goi|nhan tin|ket ban)\b.{0,90}\b(zalo|telegram|whatsapp|so dien thoai|so la|tai khoan ca nhan)\b/i.test(actionableText);
  const requestToUnsafeLink = /\b(vui long|hay|can|yeu cau|bat buoc|de nghi|bam|nhan vao|truy cap|mo link|vao link|dang nhap|xac minh|cap nhat|tai file|tai app)\b.{0,90}\b(link|duong dan|website|trang web|tai khoan|nhan thuong|mo khoa|bao mat|ung dung|file)\b/i.test(actionableText);

  return requestToSensitiveInfo || requestToMoney || requestToUnsafeChannel || requestToUnsafeLink;
}

function isOfficialInfoHost(hostname: string) {
  return hostname.endsWith(".gov.vn")
    || hostname.endsWith(".edu.vn")
    || hostname === "chinhphu.vn"
    || hostname === "bocongan.gov.vn"
    || hostname === "mic.gov.vn"
    || hostname === "khonggianmang.vn"
    || hostname === "antoanthongtin.vn"
    || hostname === "ncsc.gov.vn"
    || hostname === "vncert.vn"
    || hostname === "dichvucong.gov.vn"
    || hostname === "sbv.gov.vn"
    || hostname === "moh.gov.vn"
    || hostname === "moet.gov.vn"
    || hostname === "vss.gov.vn"
    || hostname === "gdt.gov.vn"
    || hostname === "customs.gov.vn"
    || hostname === "vtv.vn"
    || hostname === "vneconomy.vn";
}

function isTrustedInfoHost(hostname: string) {
  const trustedHosts = new Set([
    "google.com",
    "drive.google.com",
    "docs.google.com",
    "forms.gle",
    "youtube.com",
    "youtu.be",
    "microsoft.com",
    "office.com",
    "teams.microsoft.com",
    "zoom.us",
    "vietcombank.com.vn",
    "vcbdigibank.vietcombank.com.vn",
    "bidv.com.vn",
    "techcombank.com",
    "mbbank.com.vn",
    "agribank.com.vn",
    "viettel.vn",
    "myviettel.vn",
    "mobifone.vn",
    "vinaphone.com.vn",
    "momo.vn",
    "zalopay.vn",
  ]);

  return isOfficialInfoHost(hostname)
    || trustedHosts.has(hostname)
    || hostname.endsWith(".google.com")
    || hostname.endsWith(".youtube.com")
    || hostname.endsWith(".microsoft.com")
    || hostname.endsWith(".office.com");
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

function getResolvedShortUrlIndicators(text: string, resolvedUrls: UrlAnalysis[] = []) {
  return extractUrlsFromText(text)
    .map((url): Indicator | null => {
      const resolvedInfo = resolvedUrls.find((item) => item.original.toLowerCase() === url.toLowerCase());
      const isShortened = resolvedInfo?.isShortened ?? isShortenedUrl(url);
      if (!isShortened) return null;

      const expandedUrl = resolvedInfo?.expanded || url;
      const expandedHost = getUrlHostname(expandedUrl);
      const resolvedShortUrl = Boolean(resolvedInfo?.resolved && expandedUrl !== url);

      return {
        quote: resolvedShortUrl ? `${url} (${expandedUrl})` : url,
        reason: resolvedShortUrl
          ? `Đường dẫn rút gọn đã được mở rộng tới ${expandedHost || expandedUrl}. Tin nhắn có thể vẫn an toàn nếu bạn tin nguồn gửi, nhưng nên kiểm tra domain đích trước khi mở.`
          : "Đây là đường dẫn rút gọn, nhưng ScamCheck chưa mở rộng được trong thời gian cho phép. Nếu cần mở, hãy kiểm tra lại nguồn gửi trước.",
      };
    })
    .filter((item): item is Indicator => Boolean(item));
}
function analyzeText(text: string, resolvedUrls: UrlAnalysis[] = []): Analysis {
  if (!text.trim()) return { risk: null, label: "", highlights: [], indicators: [] };

  const promptInjection = detectPromptInjection(text);
  const normalized = normalizeVietnamese(text);
  const actionableText = getActionableText(normalized);
  const urls = extractUrlsFromText(text);
  const getResolvedInfo = (url: string) => resolvedUrls.find((item) => item.original.toLowerCase() === url.toLowerCase());
  const urlFacts = urls.map((url) => {
    const resolvedInfo = getResolvedInfo(url);
    const expandedUrl = resolvedInfo?.expanded || url;
    const originalHost = getUrlHostname(url);
    const expandedHost = getUrlHostname(expandedUrl);
    const shortened = resolvedInfo?.isShortened ?? isShortenedUrl(url);
    const resolvedShort = Boolean(shortened && resolvedInfo?.resolved && expandedUrl !== url);
    const suspiciousDomain = /\.(cc|top|xyz|click|shop|live|site|online|vip)\b/i.test(expandedUrl);
    const typoBrand = /vietcorn|vietcombank-login|bidv-?secure|techcombank-?verify|mbbank-?secure|momo-?gift|zalopay-?bonus/i.test(expandedUrl);
    const trustedHost = Boolean(expandedHost && isTrustedInfoHost(expandedHost));

    return {
      original: url,
      expanded: expandedUrl,
      originalHost,
      expandedHost,
      shortened,
      resolvedShort,
      suspiciousDomain,
      typoBrand,
      trustedHost,
    };
  });

  const onlyTrustedOrNoUrls = !urlFacts.length || urlFacts.every((item) => item.trustedHost && !item.suspiciousDomain && !item.typoBrand);
  const hasDangerousAsk = hasRiskyActionRequest(normalized)
    || /\b(otp|ma xac thuc|mat khau|password|pin)\b/i.test(actionableText)
    || /\b(chuyen|nap|dong|thanh toan|nop|dat coc|ung truoc)\b.{0,90}\b(tien|phi|coc|thue|tai khoan ca nhan)\b/i.test(actionableText);
  const looksLikeInformationalNotice = /\b(thong bao|khuyen cao|canh bao|lich|nhac lich|tai lieu|on thi|chi tiet xem tai app|xem tai ung dung|huong ung|phong chong|de nghi cong dan)\b/i.test(normalized);
  const looksLikeTrustedSource = /\b(bo cong an|cong an|cuc an toan thong tin|co quan chuc nang|ubnd|uy ban nhan dan|nha truong|giao vien|thay|co giao|ban quan ly|to dan pho|viettel|mobifone|vinaphone|ngan hang nha nuoc)\b/i.test(normalized);
  const safeNotice = isPublicSafetyWarning(text)
    || isRoutineSafeNotice(text)
    || isCommunitySafetyNotice(text)
    || (looksLikeInformationalNotice && looksLikeTrustedSource && onlyTrustedOrNoUrls && !hasDangerousAsk);

  if (safeNotice) {
    const safeUrlIndicators = getResolvedShortUrlIndicators(text, resolvedUrls);

    return {
      risk: "low",
      label: "An toàn",
      highlights: getIndicatorQuotes(safeUrlIndicators),
      indicators: safeUrlIndicators,
      detective: "Bộ phân tích dự phòng nhận thấy đây là nội dung thông báo/cảnh báo an toàn, không phải tin nhắn đang dụ bạn cung cấp thông tin nhạy cảm hay chuyển tiền.",
      actions: [],
      usedFallback: true,
      psychology: null,
      promptInjection,
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

  const quoteFrom = (pattern: RegExp, fallback: string) => text.match(pattern)?.[0] || fallback;

  for (const info of urlFacts) {
    const displayUrl = info.resolvedShort ? `${info.original} (${info.expanded})` : info.original;
    const urlPoints = info.typoBrand || info.suspiciousDomain
      ? 35
      : info.shortened && !info.resolvedShort
        ? 25
        : info.shortened && info.resolvedShort && !info.trustedHost
          ? 14
          : info.shortened && info.resolvedShort && info.trustedHost
            ? 4
            : info.trustedHost
              ? 0
              : 8;

    if (info.shortened || urlPoints > 0) {
      addIndicator(
        displayUrl,
        info.resolvedShort
          ? info.trustedHost
            ? `Đường dẫn rút gọn đã được mở rộng tới ${info.expandedHost || info.expanded}. Đây chưa đủ để kết luận lừa đảo, nhưng vẫn nên kiểm tra nguồn gửi trước khi mở.`
            : `Đường dẫn rút gọn dẫn tới ${info.expandedHost || info.expanded}. Đích đến không thuộc nhóm kênh chính thức quen thuộc nên cần kiểm chứng.`
          : info.shortened
            ? "ScamCheck chưa mở rộng được đường dẫn rút gọn này, có thể do mất mạng, máy chủ URL không phản hồi hoặc dịch vụ rút gọn chặn tự động kiểm tra. Khi chưa biết đích đến thật, hãy xem đây là điểm cần xác minh trước khi bấm."
            : info.suspiciousDomain || info.typoBrand
              ? "Đường dẫn dùng tên miền lạ hoặc gần giống thương hiệu thật, thường gặp trong lừa đảo giả mạo."
              : "Tin nhắn có đường dẫn ngoài. Cần tự mở kênh chính thức để kiểm chứng, không bấm trực tiếp.",
        urlPoints,
      );
    }
  }

  const checks: Array<{ pattern: RegExp; originalPattern: RegExp; fallback: string; reason: string; points: number }> = [
    { pattern: /\b(otp|ma otp|ma xac thuc|mat khau|password|pin)\b/i, originalPattern: /(OTP|mã OTP|ma OTP|mã xác thực|ma xac thuc|mật khẩu|mat khau|password|PIN)/i, fallback: "OTP", reason: "Tin nhắn nhắc tới mã OTP, mật khẩu hoặc mã PIN trong phần yêu cầu hành động. Đây là thông tin tuyệt đối không được cung cấp qua tin nhắn.", points: 30 },
    { pattern: /\b(cccd|cmnd|can cuoc|so tai khoan|thong tin ca nhan|sinh trac hoc)\b/i, originalPattern: /(CCCD|CMND|căn cước|can cuoc|số tài khoản|so tai khoan|thông tin cá nhân|thong tin ca nhan|sinh trắc học|sinh trac hoc)/i, fallback: "thông tin cá nhân", reason: "Tin nhắn nhắm tới thông tin định danh hoặc tài khoản cá nhân, chỉ an toàn khi được thực hiện qua kênh chính thức đã biết.", points: 20 },
    { pattern: /\b(chuyen tien|nap tien vao|nap tien de|phi xac minh|phi ho so|phi van chuyen|dong phi|thanh toan phi|rut het tien|dat coc|ung truoc)\b/i, originalPattern: /(chuyển tiền|chuyen tien|nạp tiền|nap tien|phí xác minh|phi xac minh|phí hồ sơ|phi ho so|phí vận chuyển|phi van chuyen|đóng phí|dong phi|thanh toán phí|thanh toan phi|đặt cọc|dat coc|ứng trước|ung truoc)/i, fallback: "chuyển tiền", reason: "Có yêu cầu chuyển tiền, nạp tiền, đặt cọc hoặc đóng phí trước. Đây là thủ đoạn phổ biến trong lừa đảo trực tuyến.", points: 26 },
    { pattern: /\b(vu an|co quan dieu tra|vien kiem sat|toa an|bat giam|bat giu|rua tien|trach nhiem hinh su|lenh bat|truy to|phong toa tai san)\b/i, originalPattern: /(vụ án|vu an|cơ quan điều tra|co quan dieu tra|viện kiểm sát|vien kiem sat|tòa án|toa an|bắt giam|bat giam|bắt giữ|bat giu|rửa tiền|rua tien|trách nhiệm hình sự|trach nhiem hinh su|lệnh bắt|lenh bat|truy tố|truy to|phong tỏa tài sản|phong toa tai san)/i, fallback: "vụ án", reason: "Tin nhắn dùng cáo buộc pháp lý/hình sự để gây sợ hãi. Đây chỉ là rủi ro cao khi đi kèm yêu cầu gọi số lạ, chuyển tiền hoặc cung cấp thông tin.", points: 20 },
    { pattern: /\b(tai khoan bi khoa|dang nhap la|bao mat tai khoan|xac minh tai khoan|mo khoa tai khoan|cap nhat sinh trac hoc)\b/i, originalPattern: /(tài khoản bị khóa|tai khoan bi khoa|đăng nhập lạ|dang nhap la|bảo mật tài khoản|bao mat tai khoan|xác minh tài khoản|xac minh tai khoan|mở khóa tài khoản|mo khoa tai khoan|cập nhật sinh trắc học|cap nhat sinh trac hoc)/i, fallback: "xác minh tài khoản", reason: "Tin nhắn nói về cảnh báo tài khoản hoặc yêu cầu xác minh. Đây chỉ đáng ngờ khi đi kèm đường dẫn/kênh không chính thức hoặc yêu cầu thông tin nhạy cảm.", points: 10 },
    { pattern: /\b(trung thuong|trung giai|nhan qua|phan thuong|iphone|xe sh|tri an khach hang)\b/i, originalPattern: /(trúng thưởng|trung thuong|trúng giải|trung giai|nhận quà|nhan qua|phần thưởng|phan thuong|iPhone|xe SH|tri ân khách hàng|tri an khach hang)/i, fallback: "trúng thưởng", reason: "Nội dung trúng thưởng/quà tặng bất ngờ thường được dùng để dụ nộp phí hoặc lấy thông tin cá nhân.", points: 20 },
    { pattern: /\b(khan cap|ngay lap tuc|truoc 24h|sau 2 gio|60 phut|het han|se bi khoa|se bi bat)\b/i, originalPattern: /(khẩn cấp|khan cap|ngay lập tức|ngay lap tuc|trước 24h|truoc 24h|sau 2 giờ|sau 2 gio|60 phút|60 phut|hết hạn|het han|sẽ bị khóa|se bi khoa|sẽ bị bắt|se bi bat)/i, fallback: "khẩn cấp", reason: "Tin nhắn tạo áp lực thời gian hoặc đe dọa hậu quả để người nhận hành động vội.", points: 12 },
    { pattern: /\b(telegram|zalo|whatsapp|goi ngay|lien he ngay|ket ban|nhan tin rieng|tai khoan ca nhan)\b/i, originalPattern: /(Telegram|Zalo|WhatsApp|gọi ngay|goi ngay|liên hệ ngay|lien he ngay|kết bạn|ket ban|nhắn tin riêng|nhan tin rieng|tài khoản cá nhân|tai khoan ca nhan)/i, fallback: "liên hệ ngay", reason: "Tin nhắn kéo người dùng sang kênh liên hệ cá nhân thay vì kênh chính thức.", points: 10 },
    { pattern: /\b(khong thong bao|khong ke cho ai|bao mat tuyet doi|o mot minh|khong cup may)\b/i, originalPattern: /(không thông báo|khong thong bao|không kể cho ai|khong ke cho ai|bảo mật tuyệt đối|bao mat tuyet doi|ở một mình|o mot minh|không cúp máy|khong cup may)/i, fallback: "bảo mật tuyệt đối", reason: "Yêu cầu giữ bí mật hoặc cô lập người nhận là thủ đoạn kiểm soát tâm lý thường gặp.", points: 24 },
    { pattern: /\b(giao hang|don hang|shipper|thieu phi|hai quan|hoan tien|cod|buu pham)\b/i, originalPattern: /(giao hàng|giao hang|đơn hàng|don hang|shipper|thiếu phí|thieu phi|hải quan|hai quan|hoàn tiền|hoan tien|COD|bưu phẩm|buu pham)/i, fallback: "giao hàng", reason: "Nội dung liên quan giao hàng/phí phát sinh/hoàn tiền có thể là giả mạo đơn vị vận chuyển.", points: 10 },
  ];

  for (const check of checks) {
    const match = actionableText.match(check.pattern);
    if (match?.[0]) {
      addIndicator(quoteFrom(check.originalPattern, check.fallback), check.reason, check.points);
    }
  }

  const hasShortLink = urlFacts.some((item) => item.shortened);
  const hasUnresolvedShortLink = urlFacts.some((item) => item.shortened && !item.resolvedShort);
  const hasUntrustedLink = urlFacts.some((item) => !item.trustedHost || item.suspiciousDomain || item.typoBrand);
  const hasRiskyLink = urlFacts.some((item) => item.suspiciousDomain || item.typoBrand || (!item.trustedHost && !item.resolvedShort));
  const hasAnyRiskyOrHiddenLink = hasUntrustedLink || hasShortLink;
  const hasBankBrand = /\b(ngan hang|vietcombank|bidv|techcombank|mb bank|mbbank|vpbank|agribank|acb|sacombank|tpbank|vp bank|momo|zalopay)\b/i.test(normalized);
  const hasBankSecurityContext = /\b(tai khoan|the|internet banking|dang nhap|bao mat|xac minh|mo khoa|khoa|sinh trac hoc|otp|mat khau|pin|cccd|can cuoc|giao dich)\b/i.test(normalized);
  const hasSensitiveCredentialRequest = /\b(nhap|gui|doc|cung cap|xac minh|dang nhap|cap nhat)\b.{0,90}\b(otp|ma xac thuc|mat khau|password|pin|cccd|can cuoc|so tai khoan|thong tin ca nhan|sinh trac hoc)\b/i.test(actionableText);
  const asksMoneyOrFee = /\b(chuyen|nap|dong|thanh toan|nop|dat coc|ung truoc|rut)\b.{0,90}\b(tien|phi|coc|thue|ho so|van chuyen|tai khoan ca nhan|hoa hong)\b/i.test(actionableText);
  const hasBankThreat = /\b(se bi khoa|khoa tai khoan|tam khoa|phong toa|huy dich vu|ngung dich vu|khoa the)\b/i.test(actionableText);
  const asksToOpenOrLogin = /\b(bam|nhan vao|truy cap|mo link|vao link|dang nhap|xac minh|cap nhat|tai file|tai app|tai ve)\b/i.test(actionableText);
  const requiresDepositOrTopup = /\b(nap|chuyen|dat coc|ung truoc|dong)\b.{0,40}\b(\d{2,}|k|nghin|trieu|tien|phi|coc)\b/i.test(actionableText);
  const hasConditionalThreat = /\b(neu khong|neu ban khong)\b.{0,100}\b(se bi khoa|bi khoa|khoa|phat|bat|huy|tam ngung|phong toa|mat quyen|xu ly|truy to)\b/i.test(actionableText);
  const hasPrivateContactChannel = /\b(goi ngay|lien he ngay|nhan tin ngay|ket ban|zalo|telegram|whatsapp|tai khoan ca nhan|0\d{9,10})\b/i.test(actionableText);

  if (hasBankBrand && hasBankSecurityContext && (hasAnyRiskyOrHiddenLink || hasSensitiveCredentialRequest || hasBankThreat)) {
    addIndicator(
      quoteFrom(/(Vietcombank|BIDV|Techcombank|MB Bank|MBBank|VPBank|Agribank|Momo|ZaloPay|ngân hàng|ngan hang|tài khoản|tai khoan|xác minh|xac minh|sinh trắc học|sinh trac hoc)/i, "ngân hàng"),
      "Tên ngân hàng hoặc ví điện tử chỉ trở thành dấu hiệu rủi ro khi đi kèm yêu cầu xác minh, khóa tài khoản, thông tin nhạy cảm hoặc đường dẫn/kênh không chính thức.",
      hasSensitiveCredentialRequest || hasRiskyLink ? 22 : 12,
    );
  }

  if (hasSensitiveCredentialRequest && (hasAnyRiskyOrHiddenLink || hasPrivateContactChannel || hasBankBrand)) {
    addIndicator(
      quoteFrom(/(OTP|mã xác thực|ma xac thuc|mật khẩu|mat khau|PIN|CCCD|căn cước|can cuoc|thông tin cá nhân|thong tin ca nhan)/i, "thông tin nhạy cảm"),
      "Tin nhắn vừa yêu cầu thông tin nhạy cảm vừa dùng link/kênh không chính thức. Đây là tổ hợp rủi ro cao.",
      22,
    );
  }

  if (hasConditionalThreat && (hasAnyRiskyOrHiddenLink || hasSensitiveCredentialRequest || hasPrivateContactChannel || asksMoneyOrFee)) {
    addIndicator(
      quoteFrom(/(nếu không|neu khong|nếu bạn không|neu ban khong).{0,90}/i, "nếu không"),
      "Cụm điều kiện kiểu 'nếu không...' đáng ngờ khi đi kèm link/kênh không chính thức, số lạ, yêu cầu tiền hoặc thông tin nhạy cảm.",
      14,
    );
  }

  const hasLegalAuthorityImpersonation = /\b(cong an|bo cong an|co quan dieu tra|vien kiem sat|toa an|canh sat)\b/i.test(normalized);
  const hasCriminalAccusation = /\b(vu an|rua tien|ma tuy|hinh su|bat giam|bat giu|trach nhiem hinh su|lenh bat|truy to|phong toa tai san)\b/i.test(actionableText);
  const asksPrivateUrgentContact = /\b(goi ngay|lien he ngay|nhan tin ngay)\b.{0,50}\b(0\d{9,10}|zalo|telegram|whatsapp)\b/i.test(actionableText)
    || /\b(0\d{9,10})\b/i.test(actionableText);
  const threatensArrestOrPenalty = /\b(tranh bi bat|se bi bat|bi bat giu|bat giam|truy to|chiu trach nhiem hinh su|phong toa tai san|xu ly hinh su|nop phat)\b/i.test(actionableText);

  const hasDirectLegalPhoneTrap = /\b(cong an|bo cong an|co quan dieu tra|canh sat)\b/i.test(normalized)
    && /\b(vu an|rua tien|ma tuy|hinh su|bat giam|bat giu|trach nhiem hinh su|truy to)\b/i.test(normalized)
    && /\b(goi ngay|lien he ngay|0\d{9,10}|zalo|telegram)\b/i.test(normalized);

  if (hasLegalAuthorityImpersonation && hasCriminalAccusation && (asksPrivateUrgentContact || asksMoneyOrFee || threatensArrestOrPenalty || hasDirectLegalPhoneTrap)) {
    addIndicator(
      quoteFrom(/(vụ án|vu an|rửa tiền|rua tien|bắt giữ|bat giu|trách nhiệm hình sự|trach nhiem hinh su|0\d{9,10}|nộp phạt|nop phat)/i, "cơ quan pháp luật"),
      "Tổ hợp giả danh cơ quan pháp luật, cáo buộc hình sự và yêu cầu hành động qua số/kênh lạ là kịch bản lừa đảo phổ biến, rủi ro cao.",
      hasDirectLegalPhoneTrap ? 36 : 26,
    );
  }

  if (hasLegalAuthorityImpersonation && threatensArrestOrPenalty && !hasProtectiveInstruction(normalized)) {
    addIndicator(
      quoteFrom(/(tránh bị bắt|tranh bi bat|sẽ bị bắt|se bi bat|bắt giữ|bat giu|bắt giam|bat giam|trách nhiệm hình sự|trach nhiem hinh su|nộp phạt|nop phat)/i, "tránh bị bắt"),
      "Tin nhắn dùng đe dọa bắt giữ, xử lý hình sự hoặc nộp phạt để tạo sợ hãi và ép người nhận làm theo ngay.",
      16,
    );
  }

  const hasPrizeOrReward = /\b(trung thuong|trung giai|nhan qua|phan thuong|tri an|qua tang|voucher|mien phi|iphone|xe sh)\b/i.test(normalized);
  if (hasPrizeOrReward && (asksMoneyOrFee || hasSensitiveCredentialRequest || hasAnyRiskyOrHiddenLink)) {
    addIndicator(
      quoteFrom(/(trúng thưởng|trung thuong|nhận quà|nhan qua|phần thưởng|phan thuong|tri ân|tri an|voucher|iPhone|xe SH)/i, "phần thưởng"),
      "Quà tặng/trúng thưởng trở nên rủi ro cao khi yêu cầu phí, thông tin cá nhân hoặc dẫn tới link/kênh không chính thức.",
      22,
    );
  }

  const hasDeliveryContext = /\b(giao hang|don hang|shipper|buu pham|hai quan|cod|hoan tien|phi van chuyen|kien hang)\b/i.test(normalized);
  if (hasDeliveryContext && (asksMoneyOrFee || hasAnyRiskyOrHiddenLink || hasSensitiveCredentialRequest)) {
    addIndicator(
      quoteFrom(/(giao hàng|giao hang|đơn hàng|don hang|bưu phẩm|buu pham|hải quan|hai quan|COD|hoàn tiền|hoan tien|phí vận chuyển|phi van chuyen)/i, "đơn hàng"),
      "Thông báo giao hàng/hoàn tiền có rủi ro khi yêu cầu đóng phí, nhập thông tin hoặc mở link không chính thức.",
      16,
    );
  }

  const hasJobTaskInvestment = /\b(viec nhe luong cao|cong tac vien|nhiem vu|hoa hong|dau tu|loi nhuan|crypto|tien ao|san giao dich|nap de rut|lam viec online)\b/i.test(normalized);
  if (hasJobTaskInvestment && (asksMoneyOrFee || requiresDepositOrTopup || hasPrivateContactChannel || /\b(telegram|zalo|whatsapp|nhom kin)\b/i.test(normalized))) {
    addIndicator(
      quoteFrom(/(việc nhẹ lương cao|viec nhe luong cao|cộng tác viên|cong tac vien|nhiệm vụ|nhiem vu|hoa hồng|hoa hong|đầu tư|dau tu|lợi nhuận|loi nhuan|Telegram|Zalo)/i, "việc nhẹ lương cao"),
      "Việc nhẹ lương cao, nhiệm vụ nhận hoa hồng hoặc đầu tư online thường là lừa đảo khi yêu cầu nạp tiền hoặc kéo sang nhóm riêng.",
      requiresDepositOrTopup || asksMoneyOrFee ? 46 : 24,
    );
  }

  const hasFamilyOrRomanceEmergency = /\b(nguoi than|con dang|me dang|bo dang|cap cuu|tai nan|nam vien|nguoi yeu|ban trai|ban gai|ket hon|qua hai quan)\b/i.test(normalized);
  if (hasFamilyOrRomanceEmergency && (asksMoneyOrFee || hasPrivateContactChannel)) {
    addIndicator(
      quoteFrom(/(người thân|nguoi than|cấp cứu|cap cuu|tai nạn|tai nan|nằm viện|nam vien|người yêu|nguoi yeu|hải quan|hai quan)/i, "người thân"),
      "Tin nhắn lợi dụng tình cảm hoặc tình huống khẩn cấp để yêu cầu tiền/kênh liên hệ riêng là dấu hiệu rủi ro cao.",
      22,
    );
  }

  const hasEmailContext = /\b(from:|subject:|reply-to|dear|kinh gui|thu dien tu|email|hoa don|invoice|bien lai|dinh kem|attachment|file|tai lieu)\b/i.test(normalized);
  const hasAttachmentRisk = /\.(exe|apk|bat|cmd|scr|js|vbs|zip|rar|7z|docm|xlsm)\b/i.test(text) || /\b(file dinh kem|tep dinh kem|attachment|tai file|tai ve)\b/i.test(actionableText);
  if (hasEmailContext && hasAttachmentRisk && (asksToOpenOrLogin || asksMoneyOrFee || hasRiskyLink)) {
    addIndicator(
      quoteFrom(/(file đính kèm|file dinh kem|tệp đính kèm|tep dinh kem|attachment|\.exe|\.apk|\.zip|\.rar|\.docm|\.xlsm)/i, "file đính kèm"),
      "Email có tệp/link cần mở tải xuống là rủi ro, đặc biệt khi đi kèm hóa đơn, thanh toán hoặc yêu cầu đăng nhập.",
      20,
    );
  }

  if (hasEmailContext && hasAnyRiskyOrHiddenLink && (hasSensitiveCredentialRequest || asksToOpenOrLogin)) {
    addIndicator(
      quoteFrom(/(đăng nhập|dang nhap|xác minh|xac minh|cập nhật|cap nhat|hóa đơn|hoa don|invoice|link|đường dẫn|duong dan)/i, "xác minh"),
      "Email yêu cầu đăng nhập/xác minh qua link lạ hoặc link rút gọn có nguy cơ là phishing.",
      18,
    );
  }

  if (hasUnresolvedShortLink && (asksToOpenOrLogin || hasPrizeOrReward || hasBankSecurityContext || hasDeliveryContext)) {
    score += 8;
  }

  if (urls.length > 0 && indicators.some((item) => /otp|mat khau|password|pin|tai khoan|xac minh|cccd|can cuoc/i.test(normalizeVietnamese(item.quote + " " + item.reason)))) {
    score += 14;
  }

  if (hasProtectiveInstruction(normalized) && looksLikeTrustedSource && !hasDangerousAsk && !hasRiskyLink) {
    score = Math.max(0, score - 24);
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
    promptInjection,
    psychology: risk === "low" ? null : {
      manipulation: risk === "high" ? "Tin nhắn có thể đang tạo sợ hãi hoặc áp lực gấp." : "Tin nhắn có thể khiến người nhận phân vân và mất cảnh giác.",
      advice: getFallbackPsychology(risk),
    },
  };
}function highlightText(text: string, highlights: string[], risk?: Risk) {
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

function PromptInjectionBanner({ warning }: { warning?: PromptInjectionWarning | null }) {
  if (!warning?.detected) return null;

  return (
    <div className="rounded-2xl border border-amber-300 dark:border-amber-600 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/60 text-amber-700 dark:text-amber-200">
          <ShieldAlert className="h-4 w-4" aria-hidden="true" />
        </div>
        <div className="min-w-0 space-y-2">
          <div>
            <p className="text-sm font-bold text-amber-900 dark:text-amber-100">Cảnh báo điều khiển AI</p>
            <p className="text-sm text-amber-900/80 dark:text-amber-100/80 leading-relaxed">
              Tin nhắn có phần giống yêu cầu thao túng cách ScamCheck trả lời. Phần này đã được tách riêng và không được xem là lệnh thật.
            </p>
          </div>
          {warning.quote && (
            <div className="rounded-lg border border-amber-200 dark:border-amber-700 bg-white/70 dark:bg-gray-900/50 px-3 py-2">
              <p className="text-xs font-mono text-amber-800 dark:text-amber-200 break-words">{warning.quote}</p>
              {warning.reason && (
                <p className="mt-1 text-xs text-slate-600 dark:text-slate-300 leading-relaxed">{warning.reason}</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

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
  promptInjection?: PromptInjectionWarning | null;
  time: Date;
};

function getFallbackDetective(risk: Risk) {
  if (risk === "high") return "Tôi phát hiện dấu hiệu lừa đảo rõ ràng trong tin nhắn này. Nội dung có yếu tố thúc ép, giả danh hoặc dẫn dụ người nhận hành động ngay.";
  if (risk === "medium") return "Tin nhắn này có một số yếu tố đáng ngờ. Chưa đủ bằng chứng để kết luận chắc chắn, nhưng người nhận nên xác minh qua kênh chính thức trước khi làm theo.";
  if (risk === "low") return "Qua phân tích, tôi chưa thấy dấu hiệu lừa đảo rõ ràng trong tin nhắn này. Tuy vậy, vẫn nên giữ thói quen bảo vệ thông tin cá nhân.";
  return "";
}

function getFallbackActions(risk: Risk) {
  if (risk === "high") {
    return [
      "Không nhấp vào đường dẫn hoặc làm theo yêu cầu trong tin nhắn.",
      "Không cung cấp mã OTP, mật khẩu hoặc thông tin cá nhân.",
      "Gọi ngân hàng, cơ quan chức năng hoặc người thân tin cậy để xác minh.",
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
  if (risk === "high") return "Cảm giác lo lắng là bình thường vì kẻ lừa đảo thường tạo áp lực rất mạnh. Hãy dừng lại, hít thở và xác minh với người thân hoặc kênh chính thức trước khi làm gì.";
  if (risk === "medium") return "Cảm giác phân vân là tín hiệu tốt để bạn chậm lại. Không có việc an toàn nào bắt buộc phải quyết định trong vài phút.";
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
  const [isTabPinned, setIsTabPinned] = useState(false);
  const tabsRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    try { localStorage.setItem("scamcheck-dark", String(dark)); } catch {}
  }, [dark]);

  useEffect(() => {
    const updateTabPinnedState = () => {
      const top = tabsRef.current?.getBoundingClientRect().top ?? Number.POSITIVE_INFINITY;
      setIsTabPinned(window.scrollY > 0 && top <= 9);
    };

    updateTabPinnedState();
    window.addEventListener("scroll", updateTabPinnedState, { passive: true });
    window.addEventListener("resize", updateTabPinnedState);
    return () => {
      window.removeEventListener("scroll", updateTabPinnedState);
      window.removeEventListener("resize", updateTabPinnedState);
    };
  }, []);

  useEffect(() => {
    try { localStorage.setItem("scamcheck-history", JSON.stringify(history)); } catch {}
  }, [history]);

  function getLocalUrlFallbacks(text: string): UrlAnalysis[] {
    return extractUrlsFromText(text).map((url) => ({
      original: url,
      expanded: url,
      isShortened: isShortenedUrl(url),
      resolved: false,
    }));
  }

  async function resolveUrlsForFallback(text: string): Promise<UrlAnalysis[]> {
    const localUrls = getLocalUrlFallbacks(text);
    if (!localUrls.length) return [];

    try {
      const response = await fetch("/api/urls", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ message: text }),
      });

      if (!response.ok) return localUrls;

      const data = await response.json().catch(() => null);
      const remoteUrls: UrlAnalysis[] = Array.isArray(data?.urls) ? data.urls : [];
      if (!remoteUrls.length) return localUrls;

      const remoteByOriginal = new Map(remoteUrls.map((item) => [item.original.toLowerCase(), item]));
      const mergedUrls = localUrls.map((item) => remoteByOriginal.get(item.original.toLowerCase()) || item);

      for (const remoteUrl of remoteUrls) {
        if (!mergedUrls.some((item) => item.original.toLowerCase() === remoteUrl.original.toLowerCase())) {
          mergedUrls.push(remoteUrl);
        }
      }

      return mergedUrls;
    } catch {
      return localUrls;
    }
  }
  async function analyzeWithAI(text: string): Promise<Analysis> {
    let response: Response;

    try {
      response = await fetch("/api/analyze", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ message: text }),
      });
    } catch {
      throw new AnalyzeError("network", "Không kết nối được tới máy chủ AI");
    }

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      const detail = typeof data?.detail === "string" ? data.detail : "";
      const errorText = `${data?.error ?? ""} ${detail}`.toLowerCase();

      if (data?.error === "Gemini response truncated") {
        throw new AnalyzeError("truncated", "Gemini bị cắt ngắn kết quả", response.status);
      }

      if (data?.error === "Gemini returned invalid JSON") {
        throw new AnalyzeError("invalid_json", "Gemini trả sai định dạng JSON", response.status);
      }

      if (response.status === 401 || errorText.includes("unauthenticated") || errorText.includes("api key") || errorText.includes("authentication")) {
        throw new AnalyzeError("auth", "Gemini API key không hợp lệ", response.status);
      }

      if (response.status === 429 || errorText.includes("quota") || errorText.includes("rate limit") || errorText.includes("resource_exhausted")) {
        throw new AnalyzeError("quota", "Gemini bị giới hạn lượt gọi", response.status);
      }

      if (response.status === 503 || errorText.includes("overload") || errorText.includes("overloaded") || errorText.includes("unavailable") || errorText.includes("try again later")) {
        throw new AnalyzeError("overloaded", "Gemini đang quá tải", response.status);
      }

      if (response.status >= 500) {
        throw new AnalyzeError("server", "Máy chủ AI gặp lỗi", response.status);
      }

      throw new AnalyzeError("ai_error", "Không gọi được AI", response.status);
    }


    const riskMap: Record<string, Risk> = {
      "Lừa đảo": "high",
      "Nghi ngờ": "medium",
      "An toàn": "low",
    };

    const risk = riskMap[data.risk] ?? "medium";
    const promptInjection = data.promptInjection && typeof data.promptInjection === "object" && data.promptInjection.detected
      ? {
          detected: true,
          quote: typeof data.promptInjection.quote === "string" ? data.promptInjection.quote : undefined,
          reason: typeof data.promptInjection.reason === "string" ? data.promptInjection.reason : undefined,
        }
      : detectPromptInjection(text);
    const rawAiIndicators = Array.isArray(data.indicators)
      ? mergeRelatedIndicators(
          data.indicators
            .filter((item: { quote?: string; reason?: string }) => Boolean(item.quote))
            .map((item: { quote?: string; reason?: string }) => ({
              quote: item.quote ?? "",
              reason: item.reason ?? "",
            })),
        )
      : [];
    const aiIndicators = promptInjection?.detected
      ? rawAiIndicators.filter((indicator) => !isPromptInjectionIndicator(indicator, promptInjection))
      : rawAiIndicators;
    const promptInjectionOnly = Boolean(promptInjection?.detected && aiIndicators.length === 0);

    return {
      risk,
      label: data.risk ?? "Nghi ngờ",
      highlights: getIndicatorQuotes(aiIndicators),
      indicators: aiIndicators,
      detective: typeof data.detective === "string" && data.detective.trim()
        ? data.detective.trim()
        : getFallbackDetective(risk),
      actions: promptInjectionOnly
        ? []
        : Array.isArray(data.actions)
        ? data.actions.filter((action: unknown): action is string => typeof action === "string" && Boolean(action.trim()))
        : getFallbackActions(risk),
      usedFallback: false,
      promptInjection,
      psychology: promptInjectionOnly
        ? null
        : data.psychology && typeof data.psychology === "object"
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
            promptInjection: result.promptInjection,
            usedFallback: result.usedFallback,
            time: new Date(),
          },
          ...prev.slice(0, 49),
        ]);
      }
    } catch (error) {
      const errorToast = getAnalyzeErrorToast(error);
      toast.warning(errorToast.title, {
        description: errorToast.description,
        duration: 7000,
        icon: <WifiOff className="h-4 w-4" />,
      });

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
            promptInjection: fallbackResult.promptInjection,
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
        <div ref={tabsRef} className="sticky top-2 z-30 relative mx-[3px]">
          <div className={`pointer-events-none absolute -left-3 -right-3 -top-2 h-32 bg-gradient-to-b from-[#f0f4ff] via-[#f0f4ff]/95 via-45% to-transparent dark:from-gray-900 dark:via-gray-900/95 transition-opacity duration-150 ${isTabPinned ? "opacity-100" : "opacity-0"}`} />
          <div className="relative z-10 flex gap-1 bg-white dark:bg-gray-800 rounded-xl p-1 shadow-sm border border-gray-100 dark:border-gray-700">
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
        </div>

        {/* Tab: Check */}
        {tab === "check" && (
          <div className="space-y-4">
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-5 space-y-4 lg:self-start">
              <div>
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Thử tính năng:</p>
                <div className="flex flex-wrap gap-2">
                  {SAMPLES.map((s) => (
                    <button
                      key={s.label}
                      disabled={loading}
                      onClick={() => {
                        setInput(s.text);
                        setAnalysis({ risk: null, label: "", highlights: [] });
                        setSituation(null);
                      }}
                      className="text-xs border border-gray-200 dark:border-gray-600 rounded-full px-3 py-1.5 text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-700 hover:bg-blue-50 dark:hover:bg-blue-900/30 hover:border-blue-300 hover:text-blue-700 dark:hover:text-blue-400 hover:shadow-sm hover:scale-105 active:scale-95 disabled:opacity-45 disabled:grayscale disabled:cursor-not-allowed disabled:hover:bg-gray-50 dark:disabled:hover:bg-gray-700 disabled:hover:border-gray-200 dark:disabled:hover:border-gray-600 disabled:hover:text-gray-700 dark:disabled:hover:text-gray-300 disabled:hover:shadow-none disabled:hover:scale-100 transition-all duration-150"
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
                disabled={loading}
                placeholder="Dán hoặc gõ nội dung tin nhắn nghi ngờ vào đây..."
                rows={5}
                className="w-full resize-y rounded-xl border border-gray-200 dark:border-gray-600 bg-[#f8f9ff] dark:bg-gray-900 px-4 py-3 text-sm text-gray-700 dark:text-gray-200 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-[#2563eb]/30 focus:border-[#2563eb] disabled:cursor-not-allowed disabled:resize-none disabled:bg-[#f8f9ff] dark:disabled:bg-gray-900 disabled:text-gray-700 dark:disabled:text-gray-200 disabled:placeholder:text-gray-400 dark:disabled:placeholder:text-gray-500 transition min-h-[120px] lg:min-h-[140px]"
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
                <PromptInjectionBanner warning={analysis.promptInjection} />
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
                          { value: "installed", label: "Đã tải/cài đặt ứng dụng lạ" },
                          { value: "personalInfo", label: "Đã nhập thông tin cá nhân" },
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
                <p className="text-xs mt-1">Hãy nhập một tin nhắn để bắt đầu!</p>
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
                    ScamCheck đã sử dụng bộ phân tích dự phòng cho lần kiểm tra này.
                  </div>
                )}

                <PromptInjectionBanner warning={item.promptInjection} />

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
                        <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Điểm đánh dấu</p>
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

        {/* Legal notice */}
        <div className="rounded-xl border border-blue-100 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/40 px-5 py-4 text-xs text-blue-800 dark:text-blue-300 leading-relaxed text-center">
          <span className="font-bold">Lưu ý pháp lý:</span> ScamCheck là công cụ giáo dục do nhóm học viên FCT Club phát triển. Đánh giá của ứng dụng không thay thế cảnh báo chính thức từ ngân hàng hoặc cơ quan chức năng. Nếu nghi ngờ, người dùng nên gọi tổng đài chính thức của ngân hàng được in trên thẻ ngân hàng.
		</div>
		
		<p className="text-center text-xs text-gray-400 dark:text-gray-300">
          ScamCheck · Bảo vệ bạn khỏi lừa đảo trực tuyến
        </p>
      </div>
    </div>
  );
}
