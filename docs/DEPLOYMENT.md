# 教师帮部署说明

生产部署由一个 Node 应用容器和一个 Caddy 网关组成。Node 同时提供已构建的 React 页面与 `/api`；Caddy 只暴露 80/443，并自动申请、保存和续期 HTTPS 证书。

## 部署前准备

- 一台具有公网 IPv4/IPv6 的 Linux 服务器，推荐 Ubuntu 22.04/24.04 或 Debian 12。
- 防火墙与云安全组放行 TCP 80、TCP 443；如需 HTTP/3，再放行 UDP 443。
- Cloudflare 中的 A/AAAA 记录已经指向服务器。
- 首次签发证书时建议将 Cloudflare 记录暂设为 **DNS only**。证书签发后可改为 **Proxied**，SSL/TLS 模式使用 **Full (strict)**。

没有 Cloudflare API Token 时，安装器无法替你修改 Cloudflare 的代理或 SSL 模式；这也是“只输入域名、管理员账号和密码”之外唯一需要提前完成的外部配置。

## Linux 一键安装

```bash
chmod +x scripts/install.sh
sudo ./scripts/install.sh
```

脚本只询问域名、管理员账号和管理员密码。若 Debian/Ubuntu 尚未安装 Docker，脚本会尝试自动安装。非交互安装必须通过权限受控的密码文件，避免密码出现在 shell 历史中：

```bash
sudo ./scripts/install.sh \
  --domain teacher.example.com \
  --admin admin \
  --password-file /root/jiaoshibang-admin-password
```

密码只通过标准输入交给一次性管理员初始化命令，最终保存的是带随机盐的 scrypt 哈希；`.env.production` 不保存管理员账号或密码。

## Windows / Docker Desktop

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\install.ps1
```

Windows 脚本不会静默安装 Docker Desktop；请先安装并启动 Docker Desktop。生产服务器仍推荐 Linux。

## OpenAI 配置

本地开发读取仓库根目录的 `.env.local`。若安装时该文件已有 `OPENAI_API_KEY`，安装器会安全复制该值到权限受控的 `.env.production`，不会在终端打印。

若使用 Docker/Kubernetes Secret，可将 `OPENAI_API_KEY_FILE` 设为容器内只读文件路径，并通过 Compose override 或编排平台把 Secret 挂载到该路径；不要仅填写宿主机路径，因为容器无法直接读取宿主机文件。

若没有密钥，网站和健康检查仍能启动，但生成接口会明确返回：

```json
{
  "ok": false,
  "error": {
    "code": "AI_NOT_CONFIGURED",
    "message": "尚未配置可用模型通道或 OPENAI_API_KEY，请管理员配置后重试"
  }
}
```

添加或更换密钥后重建应用环境：

```bash
chmod 600 .env.production
docker compose --env-file .env.production up -d --force-recreate app
```

默认使用 `gpt-5.6`，可通过 `OPENAI_MODEL` 覆盖。`OPENAI_BASE_URL` 可配置为兼容 Responses API 的端点；兼容端点还必须支持 `input_image` data URL 与 `text.format` JSON Schema。

## 管理员登录、用户账号与额度

- 安装器会初始化一个管理员账号；密码只在初始化时通过标准输入传递，数据卷中保存的是带随机盐的 scrypt 哈希。部署完成后从 `https://你的域名/admin` 登录，服务端接口为 `POST /api/admin/login`。
- 管理员和普通用户使用相互隔离的 HttpOnly 会话 Cookie。HTTPS 下 Cookie 带 `Secure`、`SameSite=Strict`，默认管理员会话 8 小时、用户会话 7 天，可分别通过 `ADMIN_SESSION_TTL_SECONDS`、`USER_SESSION_TTL_SECONDS` 调整。
- 用户可通过 `/api/auth/register`、`/api/auth/login`、`/api/auth/logout` 和 `/api/auth/session` 完成账号注册、登录与会话检查。新账号默认获得 `DEFAULT_FREE_CREDITS=3` 次额度。
- AI 请求会先预占 1 次额度，模型成功返回并通过结构校验后才正式扣除；上游失败时释放预占额度。默认还启用登录 IP 限流、用户/IP 生成限流与全局 AI 并发上限。
- `TRUST_PROXY=true` 只适用于 Caddy 等由你控制的反向代理。若将应用端口直接暴露到不可信网络，应设为 `false`，防止伪造转发 IP 绕过限流。

当前限流和并发计数位于单个 Node 进程内。横向扩容为多个应用实例时，应迁移到 Redis 或同类共享存储，否则各实例会分别计数。

## 模型通道与密钥保护

管理员可以在后台添加多个兼容 Responses API 的模型通道、设置优先级并启停通道。通道 API Key 使用由 `SESSION_SECRET` 派生的密钥进行 AES-256-GCM 加密，管理接口只返回脱敏状态，不回传明文。

请注意：

1. `SESSION_SECRET` 和 `SAFETY_ID_SALT` 在生产环境必须是彼此不同、至少 32 字符的随机值；一键安装器会自动生成。
2. 更换或丢失 `SESSION_SECRET` 会导致已保存的模型通道密钥无法解密。轮换前应先导出通道清单并准备重新录入密钥；不要把密钥、生产环境文件或数据卷提交到代码仓库。
3. 默认拒绝非 HTTPS，以及显式填写的环回、私网或链路本地模型地址，以降低 SSRF 与密钥明文传输风险。只有在受控内网部署并理解风险时，才考虑调整 `ALLOW_INSECURE_PROVIDER_URLS` 或 `ALLOW_PRIVATE_PROVIDER_NETWORKS`。
4. URL 校验只是第一道防线；正式生产还应使用出站防火墙或域名/IP 白名单，防范 DNS 重绑定及跳转到内网地址。
5. 更高安全等级的正式部署应把主密钥迁入云 KMS、Docker Secret 或专用密钥管理服务，并记录管理员通道变更审计日志。

## 管理员验证码、域名邮箱、短信与支付

一键安装仍只要求域名、管理员账号和管理员密码；Caddy 会自动申请并续期 HTTPS 证书。安装完成后使用管理员账号进入后台：

1. 在“安全与通信”保存 SMTP TLS/STARTTLS 配置并发送真实测试邮件。
2. 需要手机号验证码时，选择阿里云或腾讯云短信，填写已审核签名、模板及最小权限访问密钥，保存后向测试手机号发送真实测试。
3. 管理员登录验证码默认关闭。先正常使用账号密码登录，再主动配置身份验证器或邮箱验证码；开启后下一次登录才要求验证码。
4. 在“支付与订单”维护在售套餐/限时优惠，并录入微信支付 API v3 或支付宝正式商户凭据。本地校验通过不代表网关已联调，必须再使用商户测试方案验证公网 HTTPS 回调、签名、金额、幂等、权益发放和异常查单。

生产默认要求新用户通过手机号或邮箱验证码完成注册，并在创建支付订单前再次验证当前绑定账号。未配置短信/SMTP 时注册和支付确认会明确失败，不会假发送；因此上线开放注册与售卖前至少配置一个通信通道。服务端套餐、限时直减、订单和会员权益发放已经闭环；主动查单/对账、退款、发票和独立优惠码仍是上线运营边界，详见 [安全、通信与支付接入](SECURITY-COMMUNICATION-PAYMENTS.md)。

## 训练候选的受控入池

训练数据默认不采集。只有用户单独开启训练授权并主动提交最终定稿，系统才会生成一个去标识化的候选样本；用户的素材权利确认会作为审核证据一并记录。候选进入 `pending_review` 状态，无论用户是否已作权利声明，版权、隐私、质量硬门槛仍默认未通过；它不会触发在线训练，也不会直接进入训练集。

管理员只能查看候选状态；审核通过和数据集发布属于后续离线治理流程。真正用于 RAG、SFT、DPO 或蒸馏前，还必须经过人工版权审核、残余隐私风险检查、质量评分、去重、数据集版本冻结、离线评测与人工发布审批。正式流水线还必须支持授权撤回，并按数据血缘从候选池和后续未冻结数据集中清除。完整规范见 [AI 数据闭环设计](AI-TRAINING-PIPELINE.md)。

## 数据持久化与规模化边界

当前后端使用 `app_data` 卷中的 JSON 文件保存管理员、用户、额度、模型通道和训练候选。这适合单机、单进程 MVP 验证，但不适合高并发或多实例生产：它不提供数据库级事务、跨实例锁、增量备份和细粒度审计。

正式规模化前建议迁移为：

- PostgreSQL：账号、会员、订单、额度流水、模型通道元数据、审核状态和审计日志；额度扣减使用事务与幂等键。
- S3、Cloudflare R2 或兼容对象存储：经授权需要保留的教材文件、导出物和数据集工件，并配置生命周期与租户隔离。
- Redis：跨实例会话撤销、限流、并发配额和异步任务队列。
- KMS/Secret Manager：模型通道密钥和平台级主密钥；数据库只存密文和密钥版本。

在迁移前请定期备份 `app_data` 和 `caddy_data`，并做恢复演练。不要把包含用户内容或密钥密文的数据卷打包进应用镜像。

## 常用运维命令

所有生产命令都应显式加载环境文件：

```bash
docker compose --env-file .env.production ps
docker compose --env-file .env.production logs -f --tail=200
docker compose --env-file .env.production pull caddy
docker compose --env-file .env.production build --pull app
docker compose --env-file .env.production up -d
```

Caddy 证书和管理员数据分别保存在 `caddy_data`、`app_data` 命名卷中。升级时不要删除这些卷，也不要使用 `docker compose down -v`。

## 验证

```bash
curl -fsS https://teacher.example.com/api/health
docker compose --env-file .env.production ps
docker compose --env-file .env.production logs caddy --tail=100
```

健康接口返回 `aiConfigured`，但永远不会返回 API Key。还应在浏览器完成以下冒烟验证：

1. 教师端与 `/admin` 均可刷新并正常加载。
2. 上传一张受支持的课本图片或 PDF 后可以生成结构化教案。
3. 断开或移除密钥时，前端能展示服务端的清晰错误，而不是伪造成功结果。
4. 修改教案后仍至少包含 10 道带答案与解析的习题。
5. 重启 Caddy 后 HTTPS 仍有效，说明证书卷已持久化。

构建上下文还应做一次密钥隔离检查：

```bash
docker build --no-cache -t jiaoshibang-app:verify .
docker history --no-trunc jiaoshibang-app:verify
```

仓库根目录的 `.dockerignore` 使用严格允许列表，所有 `.env*`（包括构建不需要的 `.env.example`）、依赖、构建产物、运行数据、上传文件、设计稿、截图和日志都不会进入 build context。`Dockerfile` 只复制构建所需源码以及运行时的 `server`、`shared`；真实 API Key 不应出现在 build context、镜像层或前端资源中。

## 接口限制

- 单次 JSON 请求默认最多 25MB。
- 单张图片默认最多 8MB，单个 PDF 默认最多 16MB，单次最多 12 个文件。
- 图片必须为 PNG、JPEG、WEBP 或 GIF 的 Base64 data URL；PDF 必须为 `data:application/pdf;base64,...`，服务端会按 Responses API 的 `input_file` 规范传递。
- 上游 AI 默认超时 180 秒；超时、限流、拒绝、结构错误均返回明确的非 2xx 错误。
