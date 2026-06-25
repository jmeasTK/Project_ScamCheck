# Vibe Evidence

Tài liệu này ghi lại minh chứng nhóm dùng AI để hỗ trợ xây dựng giao diện và cải tiến sản phẩm.

## Công cụ đã dùng

- Figma Make/Figma AI để dựng giao diện ban đầu.
- Codex để đọc source, chuyển logic Gemini sang bản TypeScript, sửa lỗi deploy và cải thiện UX.
- Gemini để phân tích nội dung tin nhắn trong sản phẩm.

## Các phần được AI hỗ trợ

- Rebuild giao diện ScamCheck từ bản UI-only sang ứng dụng có AI.
- Tạo API serverless để giấu Gemini API key thay vì gọi trực tiếp từ frontend.
- Thiết kế prompt cho các vai Thám tử và Cô tâm lý.
- Thêm bộ phân tích dự phòng khi AI không khả dụng.
- Sửa lỗi encoding tiếng Việt, lỗi JSON thiếu, lỗi deploy Vercel.
- Tối ưu hiển thị trên desktop/mobile và lịch sử kiểm tra.

## Phần nhóm tự kiểm thử

- Test nhiều tin nhắn thật/giả theo các nhóm ngân hàng, công an, trúng thưởng, giao hàng.
- Test link rút gọn như bit.ly và các dịch vụ rút gọn khác.
- Test trường hợp Gemini lỗi, hết quota hoặc quá tải.
- Điều chỉnh prompt để giảm cảnh báo quá mức với tin nhắn an toàn/chính thức.