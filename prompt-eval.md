# Prompt Evaluation

Tài liệu này ghi lại cách nhóm thử và điều chỉnh prompt cho ScamCheck.

## Mục tiêu prompt

- Phân biệt rõ `An toàn`, `Nghi ngờ`, `Lừa đảo`.
- Không đánh dấu cảnh báo chính thức là lừa đảo nếu nội dung chỉ khuyến cáo phòng tránh.
- Khi có link rút gọn, phân tích link sau khi mở rộng nhưng không tự suy đoán nội dung bên trong Drive, Docs hoặc Forms.
- Trả về JSON hợp lệ để frontend hiển thị ổn định.
- Giữ giọng văn dễ hiểu cho người từ 40 tuổi trở lên.

## Các nhóm test chính

- Tin giả mạo ngân hàng yêu cầu đăng nhập/xác minh.
- Tin giả mạo công an, viện kiểm sát, phạt nguội.
- Tin trúng thưởng hoặc nhận quà cần nộp phí.
- Tin giao hàng giả, hoàn tiền giả.
- Tin cảnh báo chính thức từ cơ quan nhà nước.
- Tin có link rút gọn dẫn tới YouTube, Google Drive hoặc link không mở rộng được.

## Điều chỉnh quan trọng

- Không dùng ví dụ trong prompt để tránh AI bắt chước cứng.
- Yêu cầu `actions` rỗng khi tin nhắn an toàn và không có hành động chống lừa đảo thật sự cần làm.
- Đổi nhãn rủi ro cao thành `Lừa đảo` để rõ nghĩa hơn với người dùng.
- Tăng giới hạn lời khuyên của Cô tâm lý để câu trả lời bớt cụt.
- Thêm bộ phân tích dự phòng khi Gemini lỗi, hết quota hoặc trả JSON không đầy đủ.