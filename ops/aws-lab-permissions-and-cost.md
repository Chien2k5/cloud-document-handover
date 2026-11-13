# AWS demo MVP — inventory, chi phí và cleanup (TV1 / F013)

**Ngày kiểm tra nguồn: 2026-11-12 (Asia/Saigon). Region: us-east-1 / US East (N. Virginia). Currency: USD.**
Đích hiện tại là **AWS personal account**, không phải Academy Lab. Tài liệu này
đối chiếu source tại HEAD `6b761c19f5415dce45c1eecb493d0c55c6453074`;
không phải bằng chứng đã deploy, đo usage hay kiểm tra billing tài khoản.

| Claim | Trạng thái |
|---|---|
| Inventory/defaults đối chiếu hai CloudFormation templates | VERIFIED_SOURCE_CONFIG, không phải deployed inventory |
| Unit rates từ AWS public price lists/pages, ghi nguồn/ngày bên dưới | TIME_SENSITIVE / PUBLIC_REFERENCE_RATE |
| Usage, giờ cấp phát, root EBS size/type và tổng dự toán | ESTIMATED; phải thay bằng usage/configuration thực |
| Credit, Free Tier eligibility và available budget | UNVERIFIED / ACCOUNT_DEPENDENT |
| Actual AWS spend và quyền/quota/session account | UNVERIFIED / ACCOUNT_DEPENDENT |
| AWS E2E (V001) | NOT_RUN |

Không khẳng định đã có $100 credit, credit còn hạn, dịch vụ miễn phí tuyệt đối,
hay dự toán chắc chắn nằm trong budget. Số cũ $14.63/$39.07 không còn là dự toán
hiện hành. Model có thể kiểm tra lại ở
[`F013-cost-model.json`](../docs/tv1/F013-cost-model.json); bảng đó là dữ liệu tài liệu,
không thay đổi cấu hình hoặc tạo resource.

## 1. Resource inventory từ source

Nguồn: [`00-storage.yaml`](../infra/cloudformation/00-storage.yaml),
[`01-rds-beanstalk-cloudfront.yaml`](../infra/cloudformation/01-rds-beanstalk-cloudfront.yaml),
[`deploy_aws.ps1`](../deploy/deploy_aws.ps1). Model lưu đủ **26 logical resources**
(16 storage + 10 app) cùng type/condition/deletion policy để phát hiện drift.

| Thành phần | Cấu hình source và billing cần kiểm tra |
|---|---|
| EB application/version/environment | SingleInstance, default t3.small Linux; 1 EC2 và ASG do EB tạo, không có ALB trong cấu hình này. ASG vẫn có thể thay EC2 lỗi. Không coi dừng thủ công EC2 là lịch tắt môi trường đáng tin cậy. [EB_SINGLE] |
| Public IPv4 | AssociatePublicIpAddress=true; EB SingleInstance có EIP. Tính theo thời gian **địa chỉ được cấp phát**, gồm idle, không chỉ EC2 running hours. RDS private nên không gán thêm public IP cho DB trong inventory này. [IPV4, EB_SINGLE] |
| Root EBS | Template **không pin size/type**. 10 GB gp3 chỉ là input ví dụ, không phải default đã kiểm chứng của EB platform. Thay bằng volume thực; cộng provisioned IOPS/throughput vượt baseline hoặc volume phụ nếu có. EBS tồn tại lúc stop vẫn tính phí. |
| RDS | PostgreSQL default 17.2, db.t3.micro, Single-AZ, private, 20 GB gp3 encrypted; automated backup retention 7 ngày; DeletionPolicy/UpdateReplacePolicy Snapshot. Availability engine/CA/platform phải kiểm lại trước deploy. |
| S3 UploadBucket | Versioning Enabled, Retain; chỉ abort incomplete multipart sau 1 ngày, **không tự xóa completed/noncurrent versions**. Dữ liệu ghim trong handover còn phải giữ. |
| S3 BackupBucket | Versioning Enabled, Retain; postgres/ current expiration default 30 ngày, noncurrent 7 ngày. Expiration trong versioned bucket không bảo đảm bucket hết dữ liệu ngay. |
| Artifact và EB bucket | Deploy script tạo/dùng artifact bucket ngoài CFN; không cấu hình lifecycle/versioning cho nó. Kiểm trạng thái thực nếu bucket đã tồn tại. EB còn có bucket elasticbeanstalk-<region>-<account> và source bundles/configuration/log objects riêng, có dữ liệu cần dọn thủ công. [EB_S3] |
| Checksum Lambda | python3.12, x86_64, 512 MB default, timeout 120s; S3 event uploads/; include requests, billed duration, failed/retried/duplicate invocations và S3 GET/PUT checksum/results. Không có provisioned concurrency trong source. |
| Logs | 1 explicit Lambda log group Retain, retention 14 ngày; EB StreamLogs=true, retention 14 ngày, DeleteOnTerminate=false tạo nhiều log groups. RDS export postgresql tạo log group riêng; **retention RDS không được pin** và mặc định có thể giữ vô thời hạn. Không còn giả định chỉ có 2 groups hay mọi log đều 14 ngày. [EB_LOGS, RDS_LOGS] |
| Alarms/SNS | 3 Lambda + 2 RDS standard metric alarms, 5 metrics; SNS topic/policy chỉ khi AlarmEmail nonempty. Subscription confirmed/delivery vẫn PENDING_AWS_VERIFICATION theo F010. Bật SNS phải cộng publish/request và email deliveries. |
| CloudFront | 1 distribution, PriceClass_100, default cloudfront.net certificate; viewer HTTPS không làm EC2/CDN/transfer miễn phí. Quote dùng edge Europe (US HTTPS rate khác). Origin hiện http-only; F005 không được đóng trong F013. [CF_PRICING] |
| IAM/profile/SG/subnet group/policies/permission | Đã ánh xạ đủ logical IDs trong model; không thêm priced compute row riêng. Policy SSM không tự tạo VPN/bastion/endpoint. Tính phí usage của các service liên quan nếu được bật. |
| Network ngoài stacks | VPC/subnets/routes và EB service role được cung cấp sẵn. Templates không tạo NAT Gateway, ALB, bastion, VPC interface endpoints hoặc domain riêng. Nếu account/VPC có chúng và project dùng/chịu phí, thêm giờ/GB/LCU/endpoint/domain thực; không tự tạo hoặc gán chi phí bằng 0 cho tài nguyên chưa kiểm. |

## 2. Đơn giá và giả định tính

Tất cả là **gross paid reference rates** trước thuế/support/FX, không trừ credit,
Free Tier hay included allowances (kể cả backup/transfer/SNS). Đây là dự toán bảo thủ
cho sample usage, không phải invoice hoặc trần giá. Nếu console xác nhận allowance,
bill có thể thấp hơn; usage hoặc resources khác có thể làm bill cao hơn.

| Khoản | USD / đơn vị | Nguồn |
|---|---|---|
| EC2 Linux/shared/Used t3.small | $0.0208 / instance-hour | EC2_CSV: QA3NBPZEQKZ2K9AR |
| EBS gp3 capacity | $0.08 / GB-month, chưa tính excess performance | EC2_CSV: JG3KUJMBRGHV3N8G |
| Public IPv4 in-use hoặc idle | $0.005 / IP-hour | IPV4 |
| RDS PostgreSQL db.t3.micro Single-AZ | $0.018 / instance-hour | RDS_CSV: TGN7QDJF2AGFU9XA; không dùng unused reservation row |
| RDS gp3 capacity | $0.115 / GB-month | RDS_CSV: KYVYY29G957PKY3B |
| RDS billed backup/snapshot | $0.095 / GB-month | RDS_CSV: 6W8ECRFVDATCER7J; chưa trừ included backup allocation |
| S3 Standard capacity (current + mọi version) | $0.023 / GB-month, first paid storage tier | S3_CSV |
| S3 PUT/COPY/POST/LIST; GET/HEAD | $0.005 / 1,000; $0.0004 / 1,000 requests | S3_CSV; phải tách hai loại request |
| Lambda x86 compute | $0.0000166667 / GB-second | LAMBDA; 512 MB nhân 0.5 GB trong công thức, không chia đôi rate lần nữa |
| Lambda requests | $0.20 / 1,000,000 | LAMBDA; không phải Lambda Managed Instances/Arm/provisioned concurrency |
| CloudFront Europe edge viewer DTO; HTTPS | $0.085 / GB; $0.012 / 10,000 requests | CF_CSV; US HTTPS $0.010/10,000, geography matters |
| CloudFront data gửi về origin | $0.020 / GB | CF_CSV; quote 0.1 GB request bodies |
| S3 direct internet download | $0.09 / GB, first paid transfer tier | S3_DTO; không trừ account-wide included transfer |
| EC2/RDS cross-AZ | $0.01 / GB trên mỗi endpoint-side bị tính | NETWORK; ví dụ 10 GB flow × 2 charged sides = 20 GB-sides |
| CloudWatch Standard logs ingest; compressed storage | $0.50 / GB; $0.03 / GB-month | CW; mọi Lambda/EB/RDS stream, không tính theo số group |
| Standard alarm | $0.10 / metric-month | CW; 5 single-metric alarms, không anomaly/composite |
| SNS standard publish; email delivery | $0.50 / 1M billable requests; $2 / 100k billable deliveries | SNS_CSV; ví dụ payload nhỏ, include retries/chunks nếu có |
| Excess T3 CPU credits EC2 Linux; RDS PostgreSQL | $0.05; $0.075 / excess vCPU-hour | EC2_CREDITS; RDS_PRICING; không giả định luôn bằng 0 |

### Công thức Lambda

`GB-s = tổng(invocations × billed_duration_ms làm tròn lên 1ms / 1000 × memory_MB / 1024)`.
`USD = GB-s × 0.0000166667 + requests × 0.20 / 1,000,000`.
N phải gồm failed/retried/duplicate executions, không chỉ số file upload. Dùng billed
duration AWS đo, không chỉ thời gian business code; input 2s dưới đây **chưa được đo**.

10,000 × 2s × (512/1024) = 10,000 GB-s → compute $0.166667,
requests $0.002 → **$0.168667** trước allowances. Rate $0.0000083/GB-s và
claim < $0.05 cũ sai hệ số/giả định. Timeout 120s không phải average duration;
10,000 executions đều billed 120s sẽ khoảng **$10.00202**, chưa gồm logs/S3.

### Clock và storage

`IPv4 = addresses × allocated_hours × 0.005`: 210 giờ là $1.05, nhưng EIP giữ
suốt 840 giờ là $4.20 dù compute chỉ chạy 210 giờ. Không áp giờ chạy EC2 cho IP/EBS.
`Storage = avg_or_provisioned_GB × retained_or_allocated_hours / 720 × GB-month rate`.
720 là quy ước tháng 30 ngày của **model estimate**, không lời hứa proration invoice;
35 ngày = 840 giờ = 35/30 tháng trong model, không mặc định 1.25 tháng.
Capacity (RDS/EBS) khác actual bytes; S3 tính các full versions, không chỉ latest/diff.
Delete marker còn tính dung lượng key; incomplete multipart còn chiếm storage đến lúc abort. [S3_VERSIONS, S3_MARKERS]

## 3. Hai kịch bản tham chiếu cho demo

A: giữ môi trường liên tục **48 giờ** cho rehearsal/demo; B: giữ liên tục **35 ngày /
840 giờ** nếu cần chờ đánh giá. Không giả định có lịch stop/start 6h/ngày đã triển khai.
Mọi resource clock là độc lập trong model; ví dụ này đặt bằng nhau đến lúc cleanup.

Cùng sample traffic **tổng cả cửa sổ**, không phải mỗi ngày: 10k Lambda × 2s, 10k S3
write/list và 40k read/head; 10 GB CloudFront viewer + 100k HTTPS requests + 0.1 GB
request bodies; 2 GB download trực tiếp S3; 20 GB cross-AZ charged endpoint-sides.
Presigned document download đi trực tiếp S3; 10 GB UI/API qua CloudFront là traffic
khác, không tính hai lần cùng bytes. AWS-origin fetch về CloudFront không thêm
internet-origin egress charge theo CF pricing; reverse request bodies có dòng riêng.

Root EBS giả định 10 GB gp3 (phải kiểm lại thực tế). Avg S3 = 2 GB current + 3 GB
noncurrent + 1 GB backups + 1 GB artifact/EB support + 0.000001 GB delete markers;
incomplete multipart avg 0 trong ví dụ, không mặc định luôn 0. ProjectQuotaBytes
không giới hạn tổng S3 versions/artifacts/backup. Logs tổng ingest 2 GB, average
compressed stored 0.2 GB; không phải 2 GB cho từng group.

Billed backup/snapshot giả định avg 20 GB trong lúc DB tồn tại + 20 GB final snapshot
giữ **7 ngày thêm sau** cửa sổ. Đó là assumed billed/incremental bytes, không đo từ
allocated DB size. Chưa trừ included regional backup allocation. Mặc định không SNS;
excess CPU credits giả định 0 trong sample, phải cộng nếu phát sinh. Ví dụ 100 small
SNS requests + 100 emails thêm $0.00205 theo gross paid rates.

| Khoản | A: 48h USD | B: 840h USD |
|---|---:|---:|
| EC2 t3.small Linux | 0.9984 | 17.4720 |
| Root EBS (giả định 10 GB gp3) | 0.0533 | 0.9333 |
| 1 public IPv4/EIP | 0.2400 | 4.2000 |
| RDS db.t3.micro Single-AZ | 0.8640 | 15.1200 |
| RDS 20 GB gp3 | 0.1533 | 2.6833 |
| Backup/snapshot trong cửa sổ chạy | 0.1267 | 2.2167 |
| Snapshot giữ thêm 7 ngày sau demo | 0.4433 | 0.4433 |
| S3 current + noncurrent + backup + artifacts | 0.0107 | 0.1878 |
| S3 PUT/COPY/POST/LIST + GET/HEAD | 0.0660 | 0.0660 |
| Lambda compute x86 512 MB | 0.1667 | 0.1667 |
| Lambda requests | 0.0020 | 0.0020 |
| CloudFront viewer + HTTPS + request body về origin | 0.9720 | 0.9720 |
| S3 presigned download ra internet | 0.1800 | 0.1800 |
| EC2/RDS khác AZ (20 GB-endpoint-side) | 0.2000 | 0.2000 |
| Logs ingestion tổng Lambda/EB/RDS | 1.0000 | 1.0000 |
| Logs stored/compressed | 0.0004 | 0.0070 |
| 5 standard metric alarms | 0.0333 | 0.5833 |
| SNS tùy chọn (mặc định không bật) | 0.0000 | 0.0000 |
| Excess CPU credits (giả định không phát sinh) | 0.0000 | 0.0000 |
| **Tổng estimate (round sau khi cộng)** | **$5.51** | **$46.43** |
| **Có planning reserve 25%** | **$6.89** | **$58.04** |

Reserve 25% **không phải cap** và không chứng minh budget đủ. Chưa gồm account
support/tax/FX, NAT/endpoints/ALB/shared-network resources nếu có, excess EBS
performance, EBS snapshots tự tạo, paid custom metrics/Logs Insights/data exports,
CloudFront optional functions/real-time logs/invalidation vượt allowance hoặc
cross-Region transfer ngoài assumptions. Cần thêm quantity/rate nếu bật chúng.

Giả định sau cửa sổ: dọn các resource billable khác ngay, chỉ giữ example snapshot
7 ngày; nếu giữ S3/logs/EBS/EIP lâu hơn, sửa retained/allocated hours và tính tiếp.
Giá trị trong model không phải dữ liệu đo; bill/account credit vẫn UNVERIFIED.

## 4. Personal account và Academy Lab

| Nội dung | Personal account (đích demo) | Academy Lab (chỉ khi nhóm đổi môi trường) |
|---|---|---|
| IAM | Quyền thực phụ thuộc identity/SCP/quota; không mặc định được CreateRole/PassRole. UseLabRole=false tạo 3 roles + instance profile theo template; cần BackupOperatorPrincipalArn hợp lệ và EB service role đã có. | UseLabRole=true dùng role/profile có sẵn; phải xác nhận chúng tồn tại và quyền theo course hiện tại. Không mặc định LabRole least privilege. |
| Region/session | Chọn us-east-1 cho quote, kiểm allowed Region. Không có Lab session TTL áp dụng tự động. | Region, TTL (không mặc định 4h), allowed services/classes/IAM restrictions cần tài liệu course/Console hiện tại; ACCOUNT_DEPENDENT. |
| Credit/budget | Credits/Free Tier/plan/date/expiry/services còn áp dụng đều UNVERIFIED; không trừ chúng trong estimate. | Lab balance/session và retention do course quản lý; không lấy $50–$100 hoặc behavior EC2/RDS làm fact chung. |
| Khi hết phiên/dừng app | Không tự dừng billing của storage/network/managed services. | Kết thúc Lab session không chứng minh toàn bộ resources/billing đã dừng; kiểm từng service và dashboard Lab. |

Template và script hiện còn default UseLabRole=true vì backward compatibility;
**personal-account operator phải chọn false rõ ràng**, không đổi template trong F013.
Xem preflight [`deploy/README.md`](../deploy/README.md). Không gửi access key/secret
vào Git/chat/log. Không cần cung cấp credentials để chạy validation tài liệu.

## 5. RDS stop/start và demo readiness

**RDS tự khởi động lại sau 7 ngày dừng liên tiếp**, không phải tự dừng sau 7 ngày.
Stop tạm ngừng DB-instance-hours khi đã stopped, nhưng allocated storage,
provisioned performance nếu có và backup/manual snapshots vẫn tính phí. Start có
thể cần thời gian recovery; không hứa tức thì, phải khởi động/kiểm health trước demo. [RDS_STOP]

EC2 stop vẫn để EBS, EIP đã cấp phát, S3 versions, logs, RDS/backup và CloudFront
usage tiếp tục có phí. EB SingleInstance có ASG: manual stop EC2 có thể bị thay thế;
repo không có scheduler đảm bảo kịch bản 210h. Không tự triển khai scheduler/NAT/VPN.
Muốn giảm giờ thực phải xác nhận lifecycle của environment và account; không giả
định Start EC2 đơn lẻ là phục hồi EB hoàn chỉnh.

F005 origin HTTPS và F006 DB credential/provisioning decision vẫn BLOCKED;
F010 SNS delivery vẫn PENDING_AWS_VERIFICATION; V001 NOT_RUN. Tài liệu F013 không
đóng các blocker này hoặc khẳng định AWS deployment đã sẵn sàng/đã chạy.

## 6. Billing preflight và kiểm soát trong demo

Các bước dưới đây là **owner-run Console checklist**, chưa thực hiện trên account:

1. Xác nhận đúng personal account/Region/identity, quyền Billing; mở **Billing →
   Credits** xem remaining balance, expiry và applicable services. Mở Free Tier xem
   eligibility/plan/usage; lưu evidence đã che account/payment/secret. Chưa có
   evidence thì giữ credit/free-tier/budget/actual spend UNVERIFIED. [BILLING, FREE_TIER]
2. Xác nhận budget tự chi trả và thời gian cần giữ live với owner/giảng viên; nhập
   actual root EBS/type/IP allocations/DB/usage vào model hoặc AWS Pricing Calculator.
   Kiểm các account resources dùng chung; không suy ra ngân sách từ Lab cũ.
3. Nếu owner đồng ý, cấu hình AWS Budgets notifications actual + forecast ở 50/80/100%
   mức owner chọn và người nhận thực sự theo dõi. **Budget alerts không phải hard cap**;
   dữ liệu cập nhật có độ trễ (AWS mô tả up to 3 lần/ngày, thường 8–12h), có thể phát
   sinh phí trước khi alert đến. Không có budget/resource nào được tạo trong task. [BUDGETS]
4. Trong demo, xem **Bills / Cost Explorer** theo service, Region, usage type; kiểm
   EC2-Other/EBS, VPC public IPv4, RDS/backup, S3, CloudWatch, CloudFront, Lambda và SNS.
   Đối chiếu resource IDs với stack/Project/Owner tags; không giả định mọi EB child
   resource đã có cost-allocation tag. Credits có thể che gross cost: xem cả usage
   charges và credits/tax riêng. Không gọi paid Cost Explorer API trong validation này.
5. Mỗi ngày/đến mốc owner chọn, ghi allocated hours, billable bytes/requests, growth
   noncurrent versions và CPU-credit usage; cập nhật estimate. Nếu có resource ngoài
   inventory hoặc usage vượt giả định, dừng tạo thêm workload và yêu cầu owner chọn
   giảm usage/cleanup; không coi planning reserve/budget alert bảo đảm không bị tính tiền.

## 7. Cleanup sau demo/đánh giá — chỉ là kế hoạch, chưa chạy

Giữ môi trường đến khi giảng viên không còn cần truy cập và owner xác nhận được dọn.
Cleanup xóa dữ liệu phải có quyết định retention rõ ràng; không dọn DB/bucket dùng
chung hoặc suy đoán ownership chỉ từ prefix tên.

1. Lập bảng resource IDs/Region/stack/tag và dữ liệu cần giữ; export evidence không
   có secret, backup/final snapshot cần thiết và kế hoạch kiểm restore. DB private
   chưa có operator path/quyền thì **không chạy backup default local rồi coi là AWS
   backup**; dùng runbook đã preflight, hoặc chờ quyết định owner (F006). Không xóa
   bản duy nhất còn cần để chấm bài.
2. Gỡ consumers trước providers: xóa **app stack trước**, chờ CloudFormation và EB/
   CloudFront hoàn tất; đừng clear storage AlarmEmail/export trong khi app còn
   import SNS. RDS DeletionPolicy Snapshot tạo final snapshot cần theo dõi phí; kiểm
   cả retained automated backups/manual snapshots, không chỉ DB đã biến mất. [DELETION]
3. Sau khi không còn cross-stack imports, xóa storage stack. UploadBucket,
   BackupBucket và ChecksumLogGroup **Retain** nên vẫn còn; chúng không tự hết phí
   khi stack DELETE_COMPLETE. Quyết định giữ/xóa chính xác từng object VersionId,
   noncurrent versions, delete markers và incomplete multipart uploads; simple
   delete/latest-object hoặc aws s3 rm không chứng minh versioned bucket đã rỗng.
4. Dọn artifact bucket ngoài CFN và EB service-managed bucket/source bundles/logs
   khi đã xác nhận không phục vụ environment khác. Không xóa cả bucket dùng chung
   chỉ vì một app đã bị xóa. Kiểm app versions và source bundles riêng. [EB_S3]
5. Kiểm EB EC2/ASG đã terminate, **EIP đã release** (idle vẫn phí), EBS volumes/orphan
   volumes và EBS snapshots tự tạo. Kiểm mọi Lambda/EB/RDS log groups còn giữ;
   RDS exported logs không có retention pin, EB DeleteOnTerminate=false. Gỡ SNS/
   alarms còn ngoài stack nếu đúng ownership và không còn cần. Không xóa shared
   VPC/subnets/NAT/endpoints/role; chỉ dọn resource thuộc project khi đã được duyệt.
6. Đặt ngày review/xóa snapshot giữ lại (ví dụ 7 ngày là input estimate, không policy
   AWS tự xóa manual snapshot). Nếu giữ lâu hơn, tính phí tiếp. Sau cleanup, kiểm
   Bills/Cost Explorer ở lần refresh tiếp theo và hóa đơn cuối; charges có thể đến
   chậm, và phí đã phát sinh không bị hoàn lại vì xóa resource. Không ghi spend=0
   chỉ vì console không còn instance running hoặc stack đã bị xóa.

## 8. Nguồn chính thức và validation

Các ID trong ngoặc tham chiếu bảng sau. CSV là public static Price List không cần
credentials; các SKU/dimensions/effective dates nằm trong model. Effective dates
có thể trước ngày checked; giá vẫn TIME_SENSITIVE, cần kiểm lại trước deployment.
Không coi trang T3 với Region mặc định khác là quote us-east-1.

| ID | AWS official source (checked 2026-11-12) |
|---|---|
| EC2_CSV | [EC2 regional public Price List](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonEC2/current/us-east-1/index.csv) |
| RDS_CSV | [RDS regional public Price List](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonRDS/current/us-east-1/index.csv) |
| S3_CSV | [S3 regional public Price List](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonS3/current/us-east-1/index.csv) |
| CF_CSV | [CloudFront public Price List](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonCloudFront/current/index.csv) |
| SNS_CSV | [SNS regional public Price List](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonSNS/current/us-east-1/index.csv) |
| LAMBDA | [Lambda on-demand x86 pricing](https://aws.amazon.com/lambda/pricing/) |
| IPV4 | [VPC public IPv4 pricing](https://aws.amazon.com/vpc/pricing/) |
| CW | [CloudWatch standard logs/alarms pricing](https://aws.amazon.com/cloudwatch/pricing/) |
| S3_DTO | [AWS Storage Blog: S3 transfer cost example us-east-1](https://aws.amazon.com/blogs/storage/amazon-s3-audit-logging-part-1-analyzing-server-access-logs-with-amazon-athena-for-performance-insights/) |
| NETWORK | [EC2 regional transfer pricing](https://aws.amazon.com/ec2/pricing/on-demand/) |
| EC2_CREDITS | [T3 CPU-credit pricing](https://aws.amazon.com/ec2/instance-types/t3/) |
| RDS_PRICING | [RDS PostgreSQL backup/credit pricing](https://aws.amazon.com/rds/postgresql/pricing/) |
| RDS_STOP | [RDS stop/start behavior](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_StopInstance.html) |
| BILLING | [Billing console features](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/billing-what-is.html) |
| BUDGETS | [Budgets update frequency and scope](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-managing-costs.html) |
| FREE_TIER | [Free Tier terms depend on account](https://aws.amazon.com/free/) |
| EB_SINGLE | [EB SingleInstance includes EC2/EIP/ASG](https://docs.aws.amazon.com/elasticbeanstalk/latest/dg/using-features-managing-env-types.html) |
| EB_S3 | [EB service-managed bucket and retained bundles](https://docs.aws.amazon.com/elasticbeanstalk/latest/dg/AWSHowTo.S3.html) |
| EB_LOGS | [EB service-created log groups](https://docs.aws.amazon.com/elasticbeanstalk/latest/dg/environments-cfg-logging.html) |
| RDS_LOGS | [RDS log export and indefinite retention](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_LogAccess.Procedural.UploadtoCloudWatch.html) |
| S3_VERSIONS | [S3 full-version storage billing](https://docs.aws.amazon.com/AmazonS3/latest/userguide/Versioning.html) |
| S3_MARKERS | [S3 delete-marker storage](https://docs.aws.amazon.com/AmazonS3/latest/userguide/DeleteMarker.html) |
| CF_PRICING | [CloudFront pay-as-you-go by edge location](https://aws.amazon.com/cloudfront/pricing/pay-as-you-go/) |
| DELETION | [CloudFormation retention and snapshots](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-attribute-deletionpolicy.html) |

Validation offline (venv đã có, không cài thêm package):

```powershell
& infra/tests.venv/Scripts/python.exe -B -m unittest discover -s ops/tests -p test_cost_documentation.py -v
```

Tests kiểm inventory/config drift, đơn vị/công thức/tổng, lifetime độc lập,
account-dependent claims, sources và cleanup. Không xác minh billing/credit,
permissions, deployed configuration hay AWS E2E của account.
