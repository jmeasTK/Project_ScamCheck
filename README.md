# Project ScamCheck

ScamCheck là dự án Hackathon tại trại hè FCT 2026, giúp người dùng Việt Nam, đặc biệt là người lớn tuổi, nhận diện dấu hiệu lừa đảo trực tuyến và nhận hướng xử lý an toàn.

## Demo

- Link demo sản phẩm: https://project-scam-check.vercel.app
- Nền tảng deploy: Vercel

Dự án dùng Vercel thay cho GitHub Pages vì ứng dụng cần serverless API để gọi Gemini mà không làm lộ API key trên trình duyệt.

## Tính năng chính

- Phân tích nội dung tin nhắn bằng Gemini.
- Nhận biết các kịch bản lừa đảo phổ biến.
- Soi và mở rộng đường dẫn rút gọn trước khi phân tích.
- Hiển thị mức độ rủi ro: An toàn, Nghi ngờ, Lừa đảo.
- Giải thích dấu hiệu đáng ngờ bằng nhân vật Thám tử.
- Trấn an và hướng dẫn người dùng bằng nhân vật Cô tâm lý.
- Bộ phân tích dự phòng sẽ hoạt động khi không thể kết nối hoặc gặp sự cố với Gemini.
- Lịch sử kiểm tra lưu trên trình duyệt.

Model Gemini mặc định: `gemini-3.1-flash-lite`

Model Gemini dự phòng: `gemini-2.5-flash`

## Cách chạy local

Cài dependencies (nếu cần):

```bash
npm install
```

Tạo file `.env.local` từ `.env.example`, điền API key và model:

```env
GEMINI_API_KEY=api_key
GEMINI_MODEL=gemini_model
```

Chạy bằng Vercel Dev để frontend gọi được serverless API:

```bash
vercel dev
```

Không dùng `npm run dev` để test AI, vì nó chỉ chạy Vite frontend và không chạy các API trong thư mục `api/`.

## Cấu trúc chính

```text
api/analyze.ts        API phân tích tin nhắn bằng Gemini
api/urls.ts           API tách và mở rộng đường dẫn rút gọn
src/app/App.tsx       Giao diện và bộ phân tích dự phòng
index.html            Metadata, title, favicon
vercel.json           Cấu hình build/deploy Vercel
```

## Bảo mật API key

API key Gemini không được đưa lên GitHub. File `.env.local` bị bỏ qua bởi `.gitignore`.

**Note**: File `.env.example` là file ví dụ, không chứa API key.

## Lưu ý pháp lý

ScamCheck là công cụ giáo dục do nhóm học viên phát triển, và đánh giá của ứng dụng không thay thế cảnh báo chính thức từ ngân hàng hoặc cơ quan chức năng. Nếu nghi ngờ, người dùng nên gọi tổng đài chính thức của ngân hàng được in trên thẻ ngân hàng.
