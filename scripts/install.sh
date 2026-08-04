#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT_DIR/.env.production"
DOMAIN="${DOMAIN:-}"
ADMIN_USERNAME="${ADMIN_USERNAME:-}"
ADMIN_PASSWORD_FILE="${ADMIN_PASSWORD_FILE:-}"
ADMIN_PASSWORD=""
RESET_ADMIN=false
trap 'unset ADMIN_PASSWORD' EXIT

usage() {
  cat <<'USAGE'
用法：sudo ./scripts/install.sh [--domain teacher.example.com] [--admin admin] [--password-file /安全路径/password] [--reset-admin]

首次安装时，未提供的管理员账号和密码会以交互方式询问。密码不会写入环境文件或命令历史。
重复部署会保留已有管理员；只有明确传入 --reset-admin 才会重新初始化管理员账号和密码。
USAGE
}

while (($#)); do
  case "$1" in
    --domain) DOMAIN="${2:-}"; shift 2 ;;
    --admin) ADMIN_USERNAME="${2:-}"; shift 2 ;;
    --password-file) ADMIN_PASSWORD_FILE="${2:-}"; shift 2 ;;
    --reset-admin) RESET_ADMIN=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "未知参数：$1" >&2; usage >&2; exit 2 ;;
  esac
done

if [[ -z "$DOMAIN" ]]; then
  read -r -p "域名（已解析到本机，例如 teacher.example.com）：" DOMAIN
fi
DOMAIN="${DOMAIN#http://}"
DOMAIN="${DOMAIN#https://}"
DOMAIN="${DOMAIN%/}"
if [[ ! "$DOMAIN" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ ]] || [[ "$DOMAIN" != *.* ]]; then
  echo "域名格式无效，请只输入域名，不要包含路径或端口。" >&2
  exit 2
fi

collect_admin_credentials() {
  if [[ -z "$ADMIN_USERNAME" ]]; then
    read -r -p "管理员账号：" ADMIN_USERNAME
  fi
  if ((${#ADMIN_USERNAME} < 3 || ${#ADMIN_USERNAME} > 100)); then
    echo "管理员账号长度必须为 3-100 个字符。" >&2
    exit 2
  fi

  if [[ -n "$ADMIN_PASSWORD_FILE" ]]; then
    [[ ! -L "$ADMIN_PASSWORD_FILE" ]] || { echo "密码文件不能是符号链接" >&2; exit 2; }
    [[ -f "$ADMIN_PASSWORD_FILE" ]] || { echo "密码文件不存在" >&2; exit 2; }
    local file_owner file_mode file_permissions
    file_owner="$(stat -c '%u' "$ADMIN_PASSWORD_FILE")"
    file_mode="$(stat -c '%a' "$ADMIN_PASSWORD_FILE")"
    file_permissions=$((8#$file_mode))
    [[ "$file_owner" == "$(id -u)" ]] || { echo "密码文件必须由当前执行用户拥有" >&2; exit 2; }
    (( (file_permissions & 077) == 0 )) || { echo "密码文件不能允许组用户或其他用户读取，请设置为 chmod 600" >&2; exit 2; }
    IFS= read -r ADMIN_PASSWORD < "$ADMIN_PASSWORD_FILE" || true
  elif [[ -t 0 ]]; then
    read -r -s -p "管理员密码（至少 12 个字符）：" ADMIN_PASSWORD
    echo
  else
    echo "非交互安装请使用 --password-file，禁止通过命令行参数传递密码。" >&2
    exit 2
  fi
  if ((${#ADMIN_PASSWORD} < 12)); then
    echo "管理员密码至少需要 12 个字符。" >&2
    exit 2
  fi
}

ELEVATE=()
if [[ "$(id -u)" -ne 0 ]]; then
  command -v sudo >/dev/null 2>&1 || { echo "请以 root 运行，或安装 sudo。" >&2; exit 1; }
  ELEVATE=(sudo)
fi

install_docker_if_needed() {
  if command -v docker >/dev/null 2>&1; then return; fi
  command -v apt-get >/dev/null 2>&1 || {
    echo "未检测到 Docker；自动安装目前支持 Debian/Ubuntu，请先安装 Docker Engine + Compose v2。" >&2
    exit 1
  }
  [[ -r /etc/os-release ]] || { echo "无法识别 Linux 发行版。" >&2; exit 1; }
  # shellcheck disable=SC1091
  . /etc/os-release
  case "${ID:-}" in
    debian|ubuntu) ;;
    *) echo "自动安装 Docker 目前仅支持 Debian/Ubuntu。" >&2; exit 1 ;;
  esac
  [[ -n "${VERSION_CODENAME:-}" ]] || { echo "无法识别发行版代号。" >&2; exit 1; }

  echo "正在从 Docker 官方软件源安装 Engine 与 Compose..."
  "${ELEVATE[@]}" apt-get update
  "${ELEVATE[@]}" apt-get install -y ca-certificates curl
  "${ELEVATE[@]}" install -m 0755 -d /etc/apt/keyrings
  "${ELEVATE[@]}" curl -fsSL "https://download.docker.com/linux/${ID}/gpg" -o /etc/apt/keyrings/docker.asc
  "${ELEVATE[@]}" chmod a+r /etc/apt/keyrings/docker.asc
  local architecture
  architecture="$(dpkg --print-architecture)"
  printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/%s %s stable\n' \
    "$architecture" "$ID" "$VERSION_CODENAME" | "${ELEVATE[@]}" tee /etc/apt/sources.list.d/docker.list >/dev/null
  "${ELEVATE[@]}" apt-get update
  "${ELEVATE[@]}" apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  if command -v systemctl >/dev/null 2>&1; then
    "${ELEVATE[@]}" systemctl enable --now docker
  else
    "${ELEVATE[@]}" service docker start
  fi
}

install_docker_if_needed

DOCKER=(docker)
if ! docker info >/dev/null 2>&1; then
  if "${ELEVATE[@]}" docker info >/dev/null 2>&1; then
    DOCKER=("${ELEVATE[@]}" docker)
  else
    echo "Docker 服务不可用。" >&2
    exit 1
  fi
fi
"${DOCKER[@]}" compose version >/dev/null

read_env_value() {
  local file="$1" key="$2" line value
  [[ -f "$file" ]] || return 1
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    [[ "$line" == "$key="* ]] || continue
    value="${line#*=}"
    if [[ "$value" == \"*\" && "$value" == *\" ]]; then value="${value:1:${#value}-2}"; fi
    if [[ "$value" == \'*\' && "$value" == *\' ]]; then value="${value:1:${#value}-2}"; fi
    printf '%s' "$value"
    return 0
  done < "$file"
  return 1
}

random_hex() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  else
    od -An -N32 -tx1 /dev/urandom | tr -d ' \n'
  fi
}

is_valid_admin_entry_path() {
  local value="${1:-}" token
  [[ "$value" == /* ]] || return 1
  token="${value:1}"
  ((${#token} == 40)) || return 1
  [[ "$token" =~ ^[A-Za-z0-9_-]{40}$ ]] || return 1
  [[ "${token,,}" != admin* ]] || return 1
  [[ "$token" == *[A-Z]* ]] || return 1
  [[ "$token" == *[a-z]* ]] || return 1
  [[ "$token" == *[0-9]* ]] || return 1
  [[ "$token" == *[-_]* ]] || return 1
}

random_admin_entry_path() {
  local alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_' token line byte
  for _ in {1..100}; do
    token=''
    while IFS= read -r line; do
      for byte in $line; do
        ((${#token} < 40)) || break
        token+="${alphabet:$((byte % 64)):1}"
      done
    done < <(od -An -v -N40 -tu1 /dev/urandom)
    if is_valid_admin_entry_path "/$token"; then
      printf '/%s' "$token"
      return 0
    fi
  done
  echo "无法生成安全的管理员入口地址。" >&2
  return 1
}

SESSION_SECRET="$(read_env_value "$ENV_FILE" SESSION_SECRET || random_hex)"
SAFETY_ID_SALT="$(read_env_value "$ENV_FILE" SAFETY_ID_SALT || random_hex)"
ADMIN_ENTRY_PATH="$(read_env_value "$ENV_FILE" ADMIN_ENTRY_PATH || true)"
if [[ -z "$ADMIN_ENTRY_PATH" ]]; then
  ADMIN_ENTRY_PATH="$(random_admin_entry_path)"
elif ! is_valid_admin_entry_path "$ADMIN_ENTRY_PATH"; then
  echo ".env.production 中的 ADMIN_ENTRY_PATH 无效；为避免意外更换后台入口，安装已停止。" >&2
  exit 2
fi
OPENAI_API_KEY="$(read_env_value "$ENV_FILE" OPENAI_API_KEY || read_env_value "$ROOT_DIR/.env.local" OPENAI_API_KEY || true)"
OPENAI_BASE_URL="$(read_env_value "$ENV_FILE" OPENAI_BASE_URL || read_env_value "$ROOT_DIR/.env.local" OPENAI_BASE_URL || printf '%s' 'https://api.openai.com/v1')"
OPENAI_MODEL="$(read_env_value "$ENV_FILE" OPENAI_MODEL || read_env_value "$ROOT_DIR/.env.local" OPENAI_MODEL || printf '%s' 'gpt-5.6')"

umask 077
ENV_TMP="${ENV_FILE}.tmp.$$"
{
  printf 'DOMAIN=%s\n' "$DOMAIN"
  printf 'PUBLIC_BASE_URL=https://%s\n' "$DOMAIN"
  printf 'OPENAI_API_KEY=%s\n' "$OPENAI_API_KEY"
  printf 'OPENAI_BASE_URL=%s\n' "$OPENAI_BASE_URL"
  printf 'OPENAI_MODEL=%s\n' "$OPENAI_MODEL"
  printf 'OPENAI_REASONING_EFFORT=low\n'
  printf 'OPENAI_IMAGE_DETAIL=high\n'
  printf 'OPENAI_MAX_OUTPUT_TOKENS=24000\n'
  printf 'AI_REQUEST_TIMEOUT_MS=600000\n'
  printf 'MAX_BODY_BYTES=26214400\n'
  printf 'MAX_IMAGE_BYTES=8388608\n'
  printf 'MAX_PDF_BYTES=16777216\n'
  printf 'GENERATION_MAX_SOURCE_BYTES=67108864\n'
  printf 'MATERIAL_UPLOAD_TTL_SECONDS=86400\n'
  printf 'MATERIAL_UPLOAD_MAX_ACTIVE_BYTES=268435456\n'
  printf 'SESSION_SECRET=%s\n' "$SESSION_SECRET"
  printf 'SAFETY_ID_SALT=%s\n' "$SAFETY_ID_SALT"
  printf 'ADMIN_ENTRY_PATH=%s\n' "$ADMIN_ENTRY_PATH"
} > "$ENV_TMP"
chmod 600 "$ENV_TMP"
mv -f "$ENV_TMP" "$ENV_FILE"

compose() {
  "${DOCKER[@]}" compose --project-directory "$ROOT_DIR" --env-file "$ENV_FILE" "$@"
}

echo "正在构建应用镜像..."
compose build app

admin_check_status=0
compose run --rm -T app node --input-type=module -e \
  "import { existsSync } from 'node:fs'; process.exit(existsSync('/app/data/admin.json') ? 0 : 42)" \
  || admin_check_status=$?

case "$admin_check_status" in
  0)
    if [[ "$RESET_ADMIN" == true ]]; then
      collect_admin_credentials
      echo "正在按明确请求重置管理员..."
      printf '%s\n' "$ADMIN_PASSWORD" | compose run --rm -T -e "ADMIN_USERNAME=$ADMIN_USERNAME" app node server/index.mjs --bootstrap-admin
    else
      echo "检测到已有管理员，保留原账号、密码和验证设置。"
    fi
    ;;
  42)
    collect_admin_credentials
    echo "正在安全初始化管理员..."
    printf '%s\n' "$ADMIN_PASSWORD" | compose run --rm -T -e "ADMIN_USERNAME=$ADMIN_USERNAME" app node server/index.mjs --bootstrap-admin
    ;;
  *)
    echo "无法检查管理员初始化状态，Docker 返回状态码：$admin_check_status" >&2
    exit "$admin_check_status"
    ;;
esac
unset ADMIN_PASSWORD

echo "正在启动服务..."
compose up -d --remove-orphans

for _ in {1..30}; do
  if compose exec -T app node -e "fetch('http://127.0.0.1:8787/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then
    echo "部署完成：https://$DOMAIN"
    echo "管理员入口：https://$DOMAIN$ADMIN_ENTRY_PATH"
    echo "请私密保存管理员入口；也可在服务器 .env.production 的 ADMIN_ENTRY_PATH 中找回。"
    echo "Caddy 将自动申请并续期证书；首次签发可能需要约一分钟。"
    exit 0
  fi
  sleep 2
done

echo "容器已启动，但健康检查尚未通过。请运行：docker compose --env-file .env.production logs --tail=200" >&2
exit 1
