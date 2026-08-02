# 教师帮

教师帮是一套面向 K12 教师的“教案—知识点—组卷”一体化智能平台与可部署基础工程。教师上传课本章节图片或 PDF 后，可生成结构化教案、继续用自然语言修改，并把教学意图沉淀为知识点关系，进一步完成选题、排序、试卷预览和导出。

## 已实现

- 教师端：首页、注册登录、会员与优惠、教案创建向导、生成进度、教案库、素材库、账户设置。
- 教案工作台：教学目标、重难点、逐分钟课堂流程、教师讲稿、情绪与互动策略、分层教学、课堂预案及不少于 10 道带答案解析的习题。
- 连续修改：用户可提出修改要求，服务端携带当前教案再次调用模型并返回严格结构化结果。
- 教学认知图谱：从教案重难点和题目标注生成教案—知识点—题目关系，展示认知层级、教学环节、关联题目与健康度。
- 智能组卷：按知识点、难度和题型筛选，支持解释型推荐分数、易中难排序、重复检查、试卷篮、学生版与答案版导出。
- 备课组工作台：共享教案、评审队列、版本标识、批注、退回与通过的交互式 MVP。
- 导出：打印/PDF、Word 兼容文档与 JSON 数据。
- 管理后台：模型通道、用户、会员套餐、订单、优惠活动、内容审核、训练素材、系统设置等页面。
- 账号与通信：手机号/邮箱验证码注册与登录、完整密码重置、可选管理员登录验证码、SMTP 域名邮箱、阿里云/腾讯云短信配置。
- 正规支付闭环：管理员维护权威套餐与限时直减，微信支付 Native API v3、支付宝电脑网站支付、支付验证码、加密凭据、服务端金额校验、通知验签、幂等订单和会员/点数发放。
- AI 服务：兼容 OpenAI Responses API 的图片/PDF 输入、严格 JSON Schema 输出、超时与错误处理。
- 数据演进方案：授权、脱敏、版权审核、人工质检、数据集版本、RAG、SFT/DPO、蒸馏、评测、灰度和回滚。
- 一键部署：Docker Compose + Caddy，自动申请并续期 HTTPS 证书。

## 本地运行

要求 Node.js 20 或更高版本。

```powershell
if (-not (Test-Path .env.local)) { Copy-Item .env.example .env.local }
pnpm install
pnpm run dev
```

打开 `http://127.0.0.1:5188`。开发服务首次启动会生成 40 位随机管理入口并打印完整网址；该值保存在 `data/.development-secrets.json`，`/admin` 不再可用。

```powershell
pnpm run build
pnpm run check
pnpm run test:integration
```

`.env.local` 中至少配置 `OPENAI_API_KEY`；模型、API 地址、图片精度和超时均可通过环境变量调整。密钥只由服务端读取，不会发送到浏览器或健康检查接口。

## 生产部署

仓库公开测试期间，全新的 Ubuntu/Debian 服务器使用 `root` 一次性粘贴下面整条命令。它先把公开引导器下载到 root 专属目录再执行，通过公开 HTTPS 地址匿名拉取，不安装 GitHub CLI、不要求登录，也不会显示一次性验证码：

```bash
apt-get -o Acquire::Retries=3 update \
  && DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=l apt-get -o Acquire::Retries=3 install -y ca-certificates curl tmux \
  && install -d -m 0700 /root/.cache/jiaoshibang \
  && curl --proto '=https' --tlsv1.2 -fL --retry 5 --retry-all-errors -o /root/.cache/jiaoshibang/bootstrap.sh https://raw.githubusercontent.com/KkjgdcJhfchr/jiaoshibang/main/scripts/bootstrap.sh \
  && chmod 0700 /root/.cache/jiaoshibang/bootstrap.sh \
  && JIAOSHIBANG_DIR=/opt/jiaoshibang /root/.cache/jiaoshibang/bootstrap.sh
```

公开仓库拉取、Docker 安装、镜像构建和部署都会进入名为 `jiaoshibang-install` 的 `tmux` 持久会话。SSH 或网页终端断开不会终止这些任务；安装仍在运行时重复执行一键命令会直接接回原会话，已结束时则按上次退出码清理结果会话并开始更新/重试。重新登录服务器后可执行：

```bash
tmux attach -t jiaoshibang-install
```

如果连接在看到“公开仓库拉取和正式安装已进入持久会话”之前断开，重新登录后原样重跑上面的整条命令即可。`tmux` 能防终端断线，不能跨服务器重启续跑；服务器重启后同样重跑入口命令。私密日志保存在 `/var/log/jiaoshibang/install.log`，其中包含部署结果和随机管理员入口，文件权限仅允许 `root` 读取。已安装在服务器上的 `gh` 可以保留，但本项目不再调用它。将仓库重新改为私有后，匿名拉取会失效，届时必须另行设计安全的只读部署凭据。

安装程序首次部署时交互式收集域名、管理员账号和管理员密码，并启动应用与 Caddy。重复部署默认保留已有管理员账号、密码与验证设置，不会因断线重试而重置；只有手动执行底层安装器并明确传入 `--reset-admin` 才会重新初始化管理员。Cloudflare 首次签发证书时需将记录暂设为 **DNS only**；签发成功后可切回代理并使用 **Full (strict)**。

完整步骤见 [部署说明](docs/DEPLOYMENT.md)，安全/通信/支付边界见 [接入说明](docs/SECURITY-COMMUNICATION-PAYMENTS.md)，训练与蒸馏路线见 [AI 数据闭环设计](docs/AI-TRAINING-PIPELINE.md)，立项书与当前版本的取舍见 [立项书需求对齐说明](docs/WORD-REQUIREMENTS-ALIGNMENT.md)。

安装器会生成并在结束时打印 `https://你的域名/<40位随机入口>`，使用安装时设置的管理员账号登录。请私密保存完整网址；可在服务器 `.env.production` 的 `ADMIN_ENTRY_PATH` 中找回，重跑安装器会保留原值。旧 `/admin`、`/admin.html` 和没有入口凭证的管理接口均返回 404。普通用户注册默认赠送 3 次生成额度；生成请求先预占额度，只有模型成功返回并通过校验后才扣除。登录、用户/IP 生成频率和全局 AI 并发均有服务端限制，可在 `.env.production` 中调整。

后台新增的模型通道 API Key 由服务端使用 AES-256-GCM 加密保存，管理接口不返回明文。`SESSION_SECRET` 同时参与通道密钥派生，必须安全备份且不能随意更换；生产环境默认只允许公网 HTTPS 模型地址。

## 产品边界

当前交付是可运行的 MVP 基础：核心 AI 生成/修改、账号与验证码、额度扣减、管理员初始化与可选登录验证码、模型通道、训练候选，以及微信/支付宝下单至会员权益发放均已具备。短信、邮箱和支付需要部署后录入经过审核的企业服务凭据；正式售卖前仍需用真实商户环境完成公网回调联调，并补齐主动查单/对账、退款发票、独立优惠码、风控和正式法律文本。

MVP 使用持久化卷中的 JSON 文件保存账号、额度、模型通道和训练候选，只适合单机单进程验证。规模化前应迁移到 PostgreSQL（账号、订单、额度流水与审计）、对象存储（经授权的教材与导出物）、Redis（跨实例限流和任务队列）以及 KMS/Secret Manager（平台与通道密钥）。

训练数据默认不采集。只有用户单独授权并主动提交最终定稿后，去标识化样本才会以 `pending_review` 状态进入候选池，素材权利声明会作为审核证据记录；它仍需版权、隐私、质量人工审核，不会自动在线训练，也不会未经审批直接进入训练集。
