# Checklist remediation findings — 2026-09-25

- [x] Kiểm tra Git root và tránh parent `Documents` vì project untracked + working tree có thay đổi ngoài scope.
- [x] Backup code/test/release-only trước khi sửa.
- [x] Lập kế hoạch và acceptance criteria trong `plan-review-findings-remediation-2026-09-25.md`.
- [x] Tạo 3 worktree riêng trong snapshot Git tạm.
- [x] A: timeout `select` → cancel; regression test.
- [x] B: deny sensitive path components; regression test.
- [x] C: mock server loopback/no wildcard CORS; regression test.
- [x] Review/integrate agent branches, không stage/commit parent Documents repo.
- [x] Đồng bộ 6 runtime assets source → `product-release/`; bump manifest date-version.
- [x] Source checks pass; sau khi Síp xác nhận đã deploy/restart LaunchAgent, health và runtime security smoke pass; không gửi prompt thật/share hoặc phát sinh quota.
- [x] Rà diff cuối, kiểm tra SHA và báo cáo thay đổi/evidence/giới hạn.
