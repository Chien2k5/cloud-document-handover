# BÁO CÁO KIỂM THỬ THÀNH VIÊN 4 (TV4)
- **Hệ thống:** Backend Integration (OpenAPI 0.5.0)
- **Phạm vi kiểm thử:** Checksum SHA-256 & Luồng DRAFT -> READY -> CONFIRMED

## Kết quả các ca kiểm thử
| Mã Ca Test | Nội dung kiểm thử | Kết quả |
| :--- | :--- | :---: |
| **T01** | Khởi chạy môi trường frontend kết nối Spring Boot Backend | **PASS** |
| **T02** | Tính mã SHA-256 của file phía Client và đối soát với Server | **PASS** |
| **T03** | Tạo yêu cầu bàn giao ở trạng thái nháp (DRAFT) | **PASS** |
| **T04** | Chuyển trạng thái bàn giao từ DRAFT sang READY | **PASS** |
| **T05** | Xác nhận hoàn tất bàn giao thành công (CONFIRMED) | **PASS** |