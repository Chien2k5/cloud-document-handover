# Checklist Quyền AWS Academy Learner Lab, Bảng Chi phí Dự kiến & Kế hoạch Dọn Tài nguyên (TV1 — A01, A05, A06)

> **Lưu ý minh bạch (theo kế hoạch 5 tuần trang 8, 10):**
> Các con số chi phí dưới đây là **dự toán chi phí (Cost Estimate)** theo biểu giá công khai AWS region `us-east-1` cho cấu hình trong [`00-storage.yaml`](../infra/cloudformation/00-storage.yaml) và [`01-rds-beanstalk-cloudfront.yaml`](../infra/cloudformation/01-rds-beanstalk-cloudfront.yaml). Chưa phát sinh chi phí AWS thực tế (`ACTUAL_AWS_SPEND = NOT_RUN`) do hiện tại mới chạy trên môi trường giả lập local (`LocalStack 4.4 + PostgreSQL 17 + Nginx`) và chờ gắn tài khoản AWS Lab của nhóm.

---

## 1. Checklist quyền và giới hạn AWS Academy Learner Lab (A01 / K12)

| Hạng mục | Quy định / Giới hạn của AWS Academy Learner Lab | Giải pháp thiết kế của TV1 trong repo |
| --- | --- | --- |
| **Region được phép** | Thường chỉ cho phép **`us-east-1`** (N. Virginia) và đôi khi `us-west-2` | Mặc định `us-east-1` trong mọi script (`deploy_aws.ps1`, `redeploy_aws.ps1`); truyền biến `AWS_REGION` đồng bộ cho Backend và Lambda. |
| **Tạo IAM Role / Policy (`iam:CreateRole`)** | **Bị chặn** bởi SCP của Learner Lab; chỉ được phép gán role có sẵn **`LabRole`** và Instance Profile **`LabInstanceProfile`** | Template [`00-storage.yaml`](../infra/cloudformation/00-storage.yaml) có tham số `UseLabRole=true` (mặc định) dùng sẵn `LabRole`/`LabInstanceProfile`. Khi chạy trên tài khoản AWS thường (`UseLabRole=false`), template tự tạo 3 role quyền tối thiểu (`LambdaChecksumRole`, `BackendInstanceRole`, `BackupOperatorRole`) khớp với [`infra/iam/`](../infra/iam/). |
| **Thời gian phiên Lab (Session TTL)** | Mỗi phiên Learner Lab tự tắt EC2 sau **4 giờ**; S3 và RDS được giữ lại giữa các phiên (RDS có thể tự dừng sau 7 ngày) | Chọn RDS PostgreSQL độc lập (`DeletionPolicy: Snapshot`) và S3 (`DeletionPolicy: Retain`). Khi bật lại phiên Lab chỉ cần Start lại EC2/Beanstalk mà không mất dữ liệu DB hay các phiên bản file trên S3. |
| **HTTPS / Tên miền riêng & ACM (`acm:RequestCertificate`)** | Learner Lab không cấp domain Route53 miễn phí; Elastic Beanstalk domain mặc định (`*.elasticbeanstalk.com`) không cho đăng ký chứng chỉ ACM của người dùng | Đặt **Amazon CloudFront** (`ViewerCertificate.CloudFrontDefaultCertificate: true`) phía trước Elastic Beanstalk trong [`01-rds-beanstalk-cloudfront.yaml`](../infra/cloudformation/01-rds-beanstalk-cloudfront.yaml). Người dùng truy cập qua `https://<dist>.cloudfront.net/portal/` và gọi `/api/v1` trên **cùng một origin HTTPS**, đảm bảo cookie `Secure; HttpOnly; SameSite=Lax` hoạt động đúng chuẩn mà không cần mua tên miền. |
| **Kích cỡ EC2 & RDS được phép** | Chỉ cho phép họ `t2`/`t3`/`t4g` cỡ nhỏ (`micro`, `small`, `medium`) | Chọn `t3.small` (1 instance duy nhất cho Elastic Beanstalk) và `db.t3.micro` (20 GB `gp3`, `PubliclyAccessible=false`) để tối ưu ngân sách và giữ `HttpSession` trong bộ nhớ một instance. |
| **Ngân sách Lab (Lab Credit Budget)** | Thường **$50.00 – $100.00 USD** cho toàn học kỳ | Tổng chi phí dự kiến 5 tuần (chạy theo ca làm việc/demo 6 giờ/ngày hoặc chạy liên tục) nằm gọn trong ngân sách **$14 – $32 USD** (chi tiết ở Mục 2). |

---

## 2. Bảng dự toán chi phí tài nguyên AWS trong 5 tuần (A01 / A05)

Biểu giá tham chiếu tại region **`us-east-1`** (On-Demand, không tính Free Tier để ước lượng an toàn nhất cho tài khoản Lab):

| Thành phần AWS | Cấu hình kỹ thuật | Đơn giá tham chiếu (`us-east-1`) | Kịch bản A: Bật Lab khi làm việc & demo (~6h/ngày × 35 ngày = 210h) | Kịch bản B: Bật 24/7 suốt 5 tuần (840h) |
| --- | --- | --- | --- | --- |
| **EC2 (Elastic Beanstalk)** | `1 × t3.small` (Linux, SingleInstance, không tốn phí ALB $16/tháng) | `$0.0208 / giờ` + 10 GB gp3 (`$0.80 / tháng`) | `$4.37 + $1.00 = $5.37` | `$17.47 + $1.00 = $18.47` |
| **RDS PostgreSQL 17 độc lập** | `1 × db.t3.micro` (Single-AZ, private, 20 GB gp3, backup 7 ngày) | `$0.018 / giờ` + 20 GB gp3 (`$2.30 / tháng`) | `$3.78 + $2.88 = $6.66` | `$15.12 + $2.88 = $18.00` |
| **S3 Upload Bucket + Backup Bucket** | `< 10 GB` tổng dung lượng Versioning (`uploads/`, `results/`, `postgres/`), `~50,000` PUT/GET/HEAD | `$0.023 / GB-tháng` | `~$0.50` | `~$0.50` |
| **AWS Lambda (`nhom5-handover-checksum`)** | `python3.12`, `512 MB`, `< 10,000` lần gọi × `< 2s` | `$0.0000083 / GB-giây` | `< $0.05` | `< $0.05` |
| **CloudFront HTTPS** | `< 10 GB` lưu lượng ra internet, `< 100,000` HTTPS requests | `$0.085 / GB` + `$0.01 / 10k req` | `~$0.90` | `~$0.90` |
| **CloudWatch Logs & Alarms** | 2 Log Groups (retention 14 ngày, `< 2 GB`) + 5 Alarms (`Errors`, `Throttles`, `Duration`, RDS) | `$0.50 / GB` ingest + `$0.10 / alarm-tháng` | `~$1.15` | `~$1.15` |
| **TỔNG DỰ TOÁN 5 TUẦN** | | | **~$14.63 USD** | **~$39.07 USD** |

- **Nhận xét ngân sách:** Với thiết kế `SingleInstance` của Elastic Beanstalk kết hợp CloudFront HTTPS (thay vì bật Application Load Balancer tốn thêm `~$16.20/tháng` cố định), tổng chi phí 5 tuần chỉ khoảng **$14.63 USD** (khi bật theo ca Lab) hoặc **$39.07 USD** (nếu chạy 24/7), hoàn toàn an toàn trong hạn mức **$50 – $100 USD** của AWS Academy Learner Lab.

---

## 3. Kế hoạch dọn tài nguyên sau đánh giá (A06)

> **Quy tắc bắt buộc (trang 7 & 11 kế hoạch):**
> *"Trước khi đánh giá xong phải giữ môi trường hoạt động. Sau đánh giá, Chiến dọn tài nguyên theo kế hoạch và giữ dữ liệu/bằng chứng cần lưu."*

Chỉ thực hiện các bước dưới đây **sau khi giảng viên đã chấm điểm và xác nhận hoàn tất bảo vệ**:

1. **Sao lưu lần cuối trước khi dọn (`ops/backup_db_to_s3.py`):**
   - Chạy `python ops/backup_db_to_s3.py --label final-post-eval` để lưu bản dump cuối cùng.
   - Tải các file bằng chứng không chứa secret (`restore-result.json`, `restore-report.md`, log CloudWatch đã khử secret, bảng chi phí Cost Explorer thực tế) về máy cá nhân.
2. **Xóa stack ứng dụng (`nhom5-handover-app`):**
   ```powershell
   aws cloudformation delete-stack --region us-east-1 --stack-name nhom5-handover-app
   aws cloudformation wait stack-delete-complete --region us-east-1 --stack-name nhom5-handover-app
   ```
   *(Lưu ý: RDS có `DeletionPolicy: Snapshot` nên sẽ tạo 1 final snapshot an toàn; sau khi kiểm tra không còn cần thiết, xóa final snapshot trong RDS Console để không tốn phí lưu trữ).*
3. **Xóa stack lưu trữ (`nhom5-handover-storage`) và dọn S3 Versioning:**
   ```powershell
   aws cloudformation delete-stack --region us-east-1 --stack-name nhom5-handover-storage
   ```
   *(Hai bucket `UploadBucket` và `BackupBucket` có `DeletionPolicy: Retain` để tránh xóa nhầm dữ liệu khi đang chạy dự án. Sau khi đã lưu trữ đủ bằng chứng nộp bài, làm rỗng các object versions/delete markers và xóa bucket thủ công để dừng hoàn toàn chi phí S3).*
