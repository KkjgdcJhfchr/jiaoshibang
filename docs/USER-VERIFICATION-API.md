# 用户验证码与短信配置接口

## 用户接口

`POST /api/auth/verification-codes`

请求：`{ "identifier": "手机号或邮箱", "purpose": "register|login|reset_password|checkout" }`

成功返回 HTTP 202，包含一次性的 `verificationId`、脱敏目标、通道、到期时间与可重发时间。注册、登录和找回密码请求均使用不暴露账号存在性的 202 响应；账号不符合相应用途或通信通道临时不可用时不会实际发信。`checkout` 必须登录且目标必须是当前账号。

`POST /api/auth/login/code`

请求：`{ "identifier": "...", "verificationId": "vfy_...", "code": "123456" }`。成功后签发与密码登录相同的安全 Cookie。

`POST /api/auth/password-reset/request`

请求：`{ "identifier": "..." }`，响应契约同验证码申请，固定用途为 `reset_password`。

`POST /api/auth/password-reset/confirm`

请求：`{ "identifier": "...", "verificationId": "vfy_...", "code": "123456", "newPassword": "..." }`。验证码只能使用一次；成功后清除当前用户 Cookie，并使该账号此前签发的其他用户会话在下次请求时失效。注册和重置密码的服务端规则与前端一致：至少 8 位，且至少包含一个字母和一个数字。

注册接口可提交 `verificationId` 与 `verificationCode`。生产环境默认必须验证；通过 `REGISTRATION_VERIFICATION_REQUIRED=false` 可显式关闭。开发与测试环境默认关闭以兼容离线开发。

## 管理员短信接口

- `GET /api/admin/communication/sms`：仅返回脱敏配置。
- `PUT /api/admin/communication/sms`：保存阿里云或腾讯云短信配置。
- `POST /api/admin/communication/sms/test`：请求 `{ "phone": "13800138000" }`，只有服务商真实接受请求才返回 `sent: true`。

保存字段：

- 通用：`provider`、`enabled`、`accessKeyId`、`accessKeySecret`、`signName`、`templateCode`。
- 腾讯云额外：`sdkAppId`、`region`。

访问密钥使用 `SESSION_SECRET` 加密后落盘，管理接口永不回显明文。替换密钥时提交新 `accessKeySecret`；保留原密钥时省略该字段。

## 安全约束

- 6 位验证码默认 5 分钟有效、60 秒后可重发、每目标每用途每小时最多 6 次、最多尝试 5 次。
- 验证码仅以 HMAC 摘要保存在进程内存，不落盘，成功后立即销毁。
- 多实例部署必须把验证码状态与限流迁移至共享的 Redis 等存储；当前进程内实现适用于单实例首发部署。
- 短信或 SMTP 未配置、未启用、服务商拒绝或超时时不会伪造发送成功。
- 切换短信服务商时必须重新填写对应服务商的访问密钥，不会复用上一家服务商的凭据。
