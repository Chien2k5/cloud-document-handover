# A02 — Endpoint traceability

Contract: OpenAPI 0.5.0-backend-integration. Không đổi endpoint/field/migration.

| Method / endpoint | Controller | Frontend caller | Backend coverage |
| --- | --- | --- | --- |
| GET `/api/v1/health` | `HealthController.java.health` | Health check/runner, không có UI caller | `BackendIntegrationTest.java` |
| GET `/api/v1/auth/csrf` | `AuthController.java.csrf` | `api.js.refreshCsrf` | `BackendIntegrationTest.java` |
| POST `/api/v1/auth/login` | `SecurityConfig.java.security` | `api.js.login` | `BackendIntegrationTest.java` |
| GET `/api/v1/auth/me` | `AuthController.java.me` | `App.jsx.App` | `BackendIntegrationTest.java` |
| POST `/api/v1/auth/logout` | `SecurityConfig.java.security` | `api.js.logout` | `BackendIntegrationTest.java` |
| POST `/api/v1/projects` | `ProjectController.java.create` | `Projects.jsx.create` | `BackendIntegrationTest.java` |
| GET `/api/v1/projects` | `ProjectController.java.list` | `Projects.jsx.Projects` | `BackendIntegrationTest.java` |
| GET `/api/v1/projects/{id}` | `ProjectController.java.get` | `Projects.jsx.ProjectDetail` | `BackendIntegrationTest.java` |
| GET `/api/v1/projects/{id}/members` | `ProjectController.java.members` | `Projects.jsx.ProjectDetail` | `BackendIntegrationTest.java` |
| PUT `/api/v1/projects/{id}/members/{userId}` | `ProjectController.java.put` | `Projects.jsx.changeMember` | `BackendIntegrationTest.java` |
| DELETE `/api/v1/projects/{id}/members/{userId}` | `ProjectController.java.delete` | `Projects.jsx.changeMember` | `BackendIntegrationTest.java` |
| POST `/api/v1/projects/{id}/files/uploads` | `UploadController.java.init` | `upload.js.startUpload` | `UploadIntegrationTest.java` |
| POST `/api/v1/projects/{id}/files/uploads/{uploadId}/complete` | `UploadController.java.complete` | `upload.js.completeUpload` | `UploadIntegrationTest.java` |
| GET `/api/v1/projects/{id}/files/uploads/{uploadId}` | `UploadController.java.state` | `upload.js.pollUpload` | `UploadIntegrationTest.java` |
| GET `/api/v1/projects/{id}/files` | `UploadController.java.list` | `Files.jsx.Files` | `UploadIntegrationTest.java` |
| GET `/api/v1/projects/{id}/files/{fileVersionId}/download` | `UploadController.java.download` | `Files.jsx.prepareDownload` | `UploadIntegrationTest.java` |
| POST `/api/v1/projects/{id}/handovers` | `HandoverController.java.create` | `Handovers.jsx.submit` | `HandoverIntegrationTest.java` |
| GET `/api/v1/handovers/{handoverId}` | `HandoverController.java.get` | `Handovers.jsx.read` | `HandoverIntegrationTest.java` |
| POST `/api/v1/handovers/{handoverId}/publish` | `HandoverController.java.publish` | `Handovers.jsx.action` | `HandoverIntegrationTest.java` |
| POST `/api/v1/handovers/{handoverId}/confirm` | `HandoverController.java.confirm` | `Handovers.jsx.action` | `HandoverIntegrationTest.java` |
| GET `/api/v1/handovers/{handoverId}/items/{fileVersionId}/download` | `HandoverController.java.download` | `Handovers.jsx.action` | `HandoverIntegrationTest.java` |
| POST `/api/v1/handovers/{handoverId}/revoke` | `HandoverController.java.revoke` | `Handovers.jsx.action` | `HandoverIntegrationTest.java` |

Ma trận JSON: `frontend/tests/endpoint-trace.json`. Test đọc trực tiếp YAML contract,
kiểm đủ operation và source method/caller có thật. Test payload chạy ApiClient.login,
startUpload/complete/poll và createHandoverBody thật với fetch/storage mock rồi đối
chiếu required/allowed field với schema. Không coi việc tìm symbol là chứng minh
toàn bộ runtime UI; browser MOCK và backend integration kiểm riêng.

Quyền: Owner quản lý membership và tạo/publish/revoke; Owner/Editor upload; thành viên
đọc file project; recipient ACTIVE được chỉ định confirm/download gói theo state/hạn.
Client UUID không thay server authorization. Auth email/password form; cookie + CSRF
theo header server trả, không JWT. API lỗi code/message/requestId; 401/403/404/409/503
có phản hồi UI và test riêng. page>=0, size1..100; UI size20; expiresAt gửi ISO UTC.

Không thấy endpoint frontend gọi mà backend thiếu trong 22 operation này. Backend
không cung cấp listing handover hoặc user directory; UI dùng UUID, không giả API.
Schema FileVersion yêu cầu uploadId bền vững. Upload status khác integrity status;
Lambda SUCCEEDED không tự đồng nghĩa VERIFIED. Các phát hiện sau được lưu ở checkpoint
tương ứng; không sửa âm thầm tài liệu lịch sử hoặc contract.
