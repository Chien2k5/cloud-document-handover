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

## Trạng thái checkpoint

Giai đoạn 1: React/Vite, session cookie, login form email/password, CSRF theo header
backend trả về và token mới sau login/logout. Không JWT. Tích hợp backend thật
sẽ được ghi riêng khi đã chạy; các checkpoint sau bổ sung project/file/bàn giao.

## Tham chiếu

- [React + Vite](https://react.dev/learn/build-a-react-app-from-scratch)
- [Vite](https://vite.dev/guide/)
- [Playwright web server](https://playwright.dev/docs/test-webserver)
