# 管理员二次验证与 SMTP 接口

## 登录协议

未启用二次验证时，`POST /api/admin/login` 保持原行为：账号密码正确后直接签发管理员 HttpOnly Cookie。

启用后，账号密码正确只返回 HTTP `202`，并清除可能存在的旧登录 Cookie：

```json
{
  "ok": true,
  "data": {
    "authenticated": false,
    "mfaRequired": true,
    "challenge": {
      "id": "mfa_...",
      "channel": "totp",
      "expiresAt": "2026-08-01T00:00:00.000Z",
      "recoveryCodeAccepted": true
    }
  }
}
```

邮件通道还会返回脱敏后的 `destination`。前端第二阶段只需展示一个“验证码”输入框；同一个 `code` 字段接受 6 位 TOTP、6 位邮件码或恢复码。

`POST /api/admin/mfa/verify`：

```json
{ "challengeId": "mfa_...", "code": "123456" }
```

只有该接口验证成功才签发管理员 Cookie。challenge 与发起登录的 IP/浏览器绑定，限时、限次且只能使用一次。

## 管理员安全设置

以下接口均要求已有管理员会话：

- `GET /api/admin/security/mfa`：返回启用状态、首选通道、脱敏邮箱和剩余恢复码数量。
- `POST /api/admin/security/mfa/totp/enroll`：提交 `currentPassword`，返回 `enrollmentId`、人工输入密钥、`otpauthUri` 和本地生成的 `qrCodeDataUrl`。
- `POST /api/admin/security/mfa/totp/confirm`：提交 `enrollmentId`、当前验证码；首次启用时返回只展示一次的恢复码。
- `POST /api/admin/security/mfa/email/enroll`：提交 `currentPassword`、`email`，向邮箱发送绑定验证码。
- `POST /api/admin/security/mfa/email/confirm`：提交 `enrollmentId`、`code` 完成绑定。
- `POST /api/admin/security/mfa/preferred`：提交 `{ "method": "totp" }` 或 `{ "method": "email" }`。
- `POST /api/admin/security/mfa/email/code`：提交 `currentPassword`，为禁用/重置等敏感设置发送邮件验证码。
- `POST /api/admin/security/mfa/disable`：提交 `currentPassword`、`method` 及 TOTP/恢复码；邮件通道使用上一步的 `challengeId` 和邮件码。
- `POST /api/admin/security/mfa/recovery/regenerate`：提交 `currentPassword` 及二次验证码，废止旧恢复码并返回一组新码。

## SMTP 通信配置

- `GET /api/admin/communication/smtp`：只返回脱敏配置状态，不返回密码或密文。
- `POST|PUT /api/admin/communication/smtp`：保存 `host`、`port`、`security`、`username`、`password`、`fromName`、`fromEmail`。更新时不传 `password` 会保留原凭据。
- `POST /api/admin/communication/smtp/test`：提交可选的 `recipient` 发送测试邮件；成功后更新 `testedAt`。

`security` 支持 `tls`、`starttls`，仅在显式设置 `ALLOW_INSECURE_SMTP=true` 时允许 `plain`。生产环境应始终保持该开关为 `false`。

SMTP 密码和 TOTP 密钥使用现有 AES-256-GCM 信封加密；恢复码只保存带服务器密钥的 HMAC 摘要；邮件验证码及 challenge 不落盘。

SMTP 发信由 `server/message-service.mjs` 提供，未绑定管理员语义，后续用户注册、邮箱验证和找回密码可直接复用。
