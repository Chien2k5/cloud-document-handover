# Frontend Portal — tích hợp backend Dũng

Nguồn: `origin/dung` tại `e58a382`, nhập có kiểm soát `frontend/` và `docs/pilot/`
từ nhánh Nam `00bc97b`. `app.js` cũ rỗng. Chuyển HTML sang React + Vite theo
kế hoạch hiện hành; tận dụng CSS/bố cục của Nam. Nam cần review trước merge.
Contract: OpenAPI `0.5.0-backend-integration`; không sửa backend/API/Lambda.

## Cài và chạy

Cần Node 22.12+ (đã kiểm bằng Node 24), npm và Chrome cho browser tests.
Từ `frontend/`:

```powershell
npm ci
npm run dev
```

Mở http://127.0.0.1:5173. Backend chạy cổng 8080 theo `backend/README.md`, với
PostgreSQL riêng. Proxy Vite chuyển `/api/v1` tới `http://127.0.0.1:8080`.
Đổi đích bằng `API_PROXY_TARGET` trong môi trường hoặc `.env.local` (xem `.env.example`).
Không đưa secret vào biến `VITE_*`: chúng có thể nằm trong bundle trình duyệt.

```powershell
npm run lint
npm test
npm run build
npm run test:e2e
```

Unit tests dùng mock fetch. Browser tests trong `e2e/` dùng fixture,
không phải test backend hay AWS thật. Playwright dùng Chrome có sẵn; đặt
`PW_CHANNEL` theo môi trường nếu dùng browser khác được hỗ trợ.
Không thu trace/video/cookie/token. Không lưu mật khẩu hoặc CSRF vào web storage.

Nếu 5173 đang được worktree khác sử dụng, giữ server đó và chọn cổng trống riêng
cho browser fixture tests: `$env:PW_PORT='5189'; npm run test:e2e` (PowerShell).
Playwright tự chạy Vite từ worktree hiện tại với strictPort/reuseExistingServer=false;
không thay đích proxy production. `PW_PORT` chỉ cấu hình test, live/business runners
vẫn dùng cổng riêng do runner cấp. Không chạy hai lượt fixture tests cùng cổng.

## Chạy cùng backend thật

Tạo database PostgreSQL **portal riêng** theo `backend/README.md`; không dùng
database/volume Nextcloud hoặc database có dữ liệu thật cho test. Trong terminal
backend, đặt `DB_URL`, `DB_USERNAME`, `DB_PASSWORD`, `SPRING_PROFILES_ACTIVE=local`,
`SERVER_PORT=8080`. Spring Boot không tự đọc `.env`.

Để có tài khoản thử, đặt `LOCAL_DEMO_PASSWORD` bằng mật khẩu tự chọn ít nhất 12
ký tự, tối đa 72 byte UTF-8, trước lần seed đầu tiên. Có thể nhập bằng PowerShell:

```powershell
$inputPassword = Read-Host 'Local demo password' -AsSecureString
$env:LOCAL_DEMO_PASSWORD = [System.Net.NetworkCredential]::new('', $inputPassword).Password
```

Chạy `backend/mvnw.cmd spring-boot:run` từ thư mục backend (Linux: `sh mvnw ...`).
Tài khoản local: `dung@example.test`, `editor@example.test`, `viewer@example.test`,
`outsider@example.test`. Seed chỉ tạo user chưa có, không đặt lại mật khẩu cũ.
Không bật seed hoặc profile local trên AWS. Mở frontend bằng địa chỉ HTTP loopback
ở trên; frontend và `/api/v1` có cùng origin nhờ proxy. Đăng nhập bằng **email**.

Mặc định S3 tắt: auth/project/membership chạy thật, upload trả 503 fail closed.
Muốn thử S3 thật phải cấu hình `UPLOAD_S3_ENABLED=true`, `UPLOAD_BUCKET`,
`AWS_REGION`, credentials/role cho backend và deploy Lambda mới của Đăng.
Bucket cần Versioning, CORS đúng origin, cho phép signed headers và expose
`x-amz-version-id`. Không đưa AWS credentials vào frontend. Các bước đó chưa được
thực hiện bởi bộ test local này.

## Luồng sử dụng và quyền

- Chọn dự án từ danh sách phân trang; backend trả vai trò hiện tại.
- Owner thêm/cập nhật/gỡ thành viên bằng UUID tài khoản enabled; không đổi Owner.
- Owner/Editor chọn file, trình duyệt tính SHA-256 thật, init upload rồi PUT trực tiếp
  S3 với toàn bộ signed headers. Cookie/CSRF không gửi sang S3.
- Chỉ complete với Version ID nhận được từ response PUT. Thiếu ID/mất response:
  không đoán latest/ETag; chờ phiên cũ hết hạn rồi tạo phiên mới khi quota cho phép.
- Complete lỗi nhưng còn Version ID trong trang: nút retry chỉ complete cùng ID,
  không gửi PUT lần nữa. Sau reload, chỉ các version đã AVAILABLE được đối soát qua
  uploadId bền vững lấy từ list; PENDING mất Version ID không tự phục hồi complete.
- Poll upload tối đa 15 lần, cách 2 giây. Recovery list tối đa 60 giây, tối đa 3
  version song song; có nút kiểm tra lại. FAILED có thể kiểm tra lại khi kết quả muộn
  hợp lệ xuất hiện; MISMATCH khác FAILED và không được tải/bàn giao.
- Thêm version từ file hiện có, giữ nguyên filename. File ID, FileVersion ID,
  Upload ID và S3 Version ID có nhãn riêng. Download gọi API cho đúng FileVersion ID.
- Owner chọn AVAILABLE + VERIFIED từ các trang, nhập title, UUID người nhận và hạn
  tương lai để tạo DRAFT. Thời gian trên máy được chuyển thành ISO UTC khi gửi.
- Mở gói bằng UUID; người nhận ngoài dự án cũng có thể mở trực tiếp. Owner publish;
  chỉ người nhận ACTIVE chưa xác nhận được confirm. Sau confirm luôn đọc lại gói:
  một người xác nhận chưa chắc workflow tổng đã CONFIRMED.
- Revoke giữ lịch sử, chặn URL mới. URL cấp trước có thể còn dùng tới TTL.
- UI hỗ trợ 401/403/404/409/503, mất quyền và lỗi mạng. 403 có nút làm mới CSRF;
  không tự retry request ghi. Backend luôn quyết định quyền và trạng thái thật.

Backend chưa có API liệt kê tất cả gói hoặc tìm mọi tài khoản. UI dùng UUID gói được
Owner chia sẻ, thành viên dự án và trường UUID người nhận; không giả API danh bạ.
Danh sách gói đã tạo không bền qua reload; giữ UUID gói để mở lại. Đây không phải
ứng dụng Nextcloud, không đồng bộ file/quyền Nextcloud.

## Kiểm thử phân lớp

1. `npm test`: unit với fetch/S3 fixture; SHA-256 dùng Web Crypto thật trên bytes mẫu.
2. `npm run test:e2e`: Chrome thật nhưng API/S3 bị chặn bằng fixture. Kiểm auth,
   role, upload/version/reload, 401/403/404/409/503, DRAFT/publish/confirm/revoke/expiry.
3. `python tools/run_live_check.py`: tạo PostgreSQL 17 container riêng, chạy toàn bộ
   backend tests, build JAR rồi chạy React qua Vite proxy tới Spring Boot thật.
   Ba browser test live không mock API; kiểm auth/session/CSRF/project/membership
   và S3-disabled fail closed. Backend storage tests vẫn là fake/mock, không AWS.
4. AWS S3/Lambda E2E: **NOT_RUN**, cần tài nguyên/IAM/CORS/credentials của nhóm.
5. Pilot người dùng: **NOT_RUN**, không tự suy từ test tự động.

Runner live cần Docker đang chạy, JDK 21+, npm ci, Chrome, Maven Central hoặc cache.
Chạy từ frontend: `python tools/run_live_check.py`; thêm `--offline` khi cache Maven
đã đủ. Có thể dùng `--maven <đường dẫn mvn>` thay wrapper. Windows hạn chế self-attach:
runner dùng Mockito agent 5.17.0 nếu đã có cache; có thể chỉ định `MOCKITO_AGENT_JAR`.
Không tắt các test để che lỗi; lần đầu có thể cần tải dependency rồi chạy lại.

Runner tự tạo password trong bộ nhớ, hai DB mới, port ngẫu nhiên trên loopback;
không dùng DB_URL/DB_PASSWORD có sẵn. Tự dừng JAR và xóa container thử trong finally.
Nextcloud và database người dùng giữ nguyên. Log mặc định trong `runtime-data/`
bị ignore; không chia sẻ raw log/cookie/trace. Summary không có secret. Xem
`docs/pilot/checkpoints.json`, `docs/pilot/live-verification.json` và test report.

## Local business integration (PRE_AWS A13)

Run `python tools/run_live_check.py --business` after `npm ci`. This launches real
Spring Boot and a new PostgreSQL container, with an HTTPS `StoragePort` fixture on
the **test classpath only**. JDK `keytool` creates a temporary self-signed certificate;
only the isolated Playwright business configuration ignores that certificate error.
The fixture class is outside production component scanning and is checked to be
absent from the packaged production JAR. No production test endpoint/profile is added.

The two business browser cases use real API calls (no route interception), real
bytes and cookie/CSRF authentication: upload v1/v2, delayed checksum reconciliation,
MISMATCH rejection, DRAFT/publish, two recipients, exact v1 download, revoke and
expiry. The test-only checksum producer hashes the uploaded bytes; it is **not**
the Python Lambda or AWS S3. Classification: `LOCAL_REAL_BACKEND_WITH_TEST_STORAGE`.
The original `python tools/run_live_check.py` still checks production JAR startup
with storage disabled. Both runners clean their owned container/server; raw logs
remain ignored. Explicit `--evidence` paths must be new paths inside the repository.

## Deploy cùng origin/HTTPS

`npm run build` sinh `frontend/dist/`. Chiến phục vụ thư mục này cùng hostname HTTPS
với `/api/v1`; Vite dev server không phải production server. Ví dụ định tuyến Nginx
**để review**, chưa được deploy:

```nginx
location /api/v1/ {
    proxy_pass http://127.0.0.1:8080;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
location / {
    root /srv/handover/frontend/dist;
    try_files $uri $uri/ /index.html;
}
```

Đặt trong server HTTPS đã có chứng chỉ/TLS. Giữ Secure cookie của backend ngoài local;
không dùng `SESSION_COOKIE_SECURE=false` trên AWS. Production bundle gọi `/api/v1`,
không nhúng hostname backend hoặc secret. Origin S3 CORS phải khớp hostname frontend.

## Troubleshooting và giới hạn

| Hiện tượng | Kiểm tra |
| --- | --- |
| Network/proxy error | Backend/DB chưa chạy, API_PROXY_TARGET sai hoặc cổng bị chiếm |
| 401 | Phiên hết hạn/account disabled; đăng nhập lại |
| 403 | Role hiện tại và CSRF; lấy token mới, không tự gửi lại thao tác ghi |
| 404 | ID sai, đã bị gỡ membership hoặc không phải người nhận |
| 409 | Quota, file chưa VERIFIED, expiry hoặc trạng thái đổi; tải lại dữ liệu |
| 503 STORAGE_UNAVAILABLE | S3 tắt, IAM/credentials/network hoặc adapter không truy cập được |
| PUT 412/409/timeout | Không tự retry PUT; không suy Version ID từ latest |
| Không đọc được Version ID | Versioning và CORS ExposeHeaders trên S3 |
| Không chuyển CONFIRMED | Xem từng người nhận; có thể còn người chưa xác nhận |

Không có đăng ký/reset password, chuyển Owner, sửa gói hoặc tìm người dùng toàn hệ
thống vì backend không cung cấp API đó. Không có multipart/upload tiếp tục, hard
quota byte S3 hoặc vô hiệu URL tức thì. Chưa deploy AWS/production, chưa chạy pilot.
ESLint 9.39.5 là dev dependency được khóa vì audit ở lần kiểm phát hiện minimatch
trong ESLint 10; bản 9 đã hết hỗ trợ upstream. npm audit hiện không có finding;
cần Nam review việc nâng toolchain khi bản hỗ trợ có dependency đã vá, không dùng force.

## Tham chiếu

### C09 Batch 02: thành viên và phiên bản tài liệu

Trong workspace dự án, mục Thành viên hiển thị tên và role thực tế; UUID nằm trong
Thông tin kỹ thuật. OWNER có thể thêm/cập nhật EDITOR hoặc VIEWER bằng UUID tài khoản
đang hoạt động, và phải xác nhận trước khi gỡ. Backend xác minh quyền cuối cùng;
giao diện không cung cấp chuyển OWNER hoặc tìm kiếm tài khoản toàn hệ thống.

Mục Tài liệu hiển thị riêng từng FileVersion, kể cả khi hai tài liệu trùng tên.
Thông tin kỹ thuật phân biệt File ID, FileVersion ID, Upload ID và S3 Version ID.
Chỉ AVAILABLE + VERIFIED mới đủ điều kiện tải/chọn bàn giao. Lựa chọn của OWNER
giữ theo FileVersion qua phân trang và điều hướng cùng dự án, không tự chuyển sang
phiên bản mới hơn. Upload và tạo bàn giao vẫn dùng giao thức hiện hành.

Link tải lấy từ backend theo đúng FileVersion ID, phải khớp S3 Version ID, HTTPS
và còn hạn. Link hiển thị bị gỡ khi hết expiresAt; nếu còn quyền, người dùng có thể
bấm Lấy link tải để xin link mới. Đây là kiểm tra UI, không phải bằng chứng kiểm thử
S3 thật. Đổi dự án/tài khoản hoặc phản hồi mất quyền sẽ xóa giao diện bảo vệ.

Browser mock kiểm tra role, identity, pagination, lỗi, keyboard, responsive và thời
gian bằng fixture/clock. Live backend và business browser được phân loại riêng ở
trên; không được coi các bài này là AWS_REAL_E2E.

- [React + Vite](https://react.dev/learn/build-a-react-app-from-scratch)
- [Vite](https://vite.dev/guide/)
- [Playwright web server](https://playwright.dev/docs/test-webserver)
