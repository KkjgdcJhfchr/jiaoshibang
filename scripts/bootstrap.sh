#!/usr/bin/env bash
set -Eeuo pipefail

REPOSITORY_URL="${JIAOSHIBANG_REPOSITORY_URL:-https://github.com/KkjgdcJhfchr/jiaoshibang.git}"
BRANCH="${JIAOSHIBANG_BRANCH:-main}"
SESSION_NAME="${JIAOSHIBANG_INSTALL_SESSION:-jiaoshibang-install}"
SCRIPT_PATH="$(readlink -f "${BASH_SOURCE[0]}")"
SCRIPT_REPOSITORY="$(cd -- "$(dirname -- "$SCRIPT_PATH")/.." 2>/dev/null && pwd || true)"
STABLE_DIR="/usr/local/libexec/jiaoshibang"
STABLE_SCRIPT="$STABLE_DIR/bootstrap.sh"
LOG_DIR="/var/log/jiaoshibang"
LOG_FILE="$LOG_DIR/install.log"
LOCK_FILE="/run/lock/jiaoshibang-bootstrap.lock"
MODE="controller"
CLONE_TMP=""

if [[ "${1:-}" == "--worker" ]]; then
  MODE="worker"
  shift
fi
if (($#)); then
  echo "未知参数：$1" >&2
  exit 2
fi

cleanup_clone() {
  if [[ -n "$CLONE_TMP" && -d "$CLONE_TMP" ]]; then
    rm -rf -- "$CLONE_TMP"
  fi
}
trap cleanup_clone EXIT HUP INT TERM

if [[ "$(id -u)" -ne 0 ]]; then
  echo "请使用 root 账号执行公开一键安装命令。" >&2
  exit 1
fi
if [[ ! "$SESSION_NAME" =~ ^[A-Za-z0-9_-]+$ ]]; then
  echo "JIAOSHIBANG_INSTALL_SESSION 只能包含大小写字母、数字、下划线和连字符。" >&2
  exit 2
fi

if [[ -n "${JIAOSHIBANG_DIR:-}" ]]; then
  INSTALL_DIR="$JIAOSHIBANG_DIR"
elif [[ -d "$SCRIPT_REPOSITORY/.git" ]]; then
  INSTALL_DIR="$SCRIPT_REPOSITORY"
else
  INSTALL_DIR="/opt/jiaoshibang"
fi

case "$INSTALL_DIR" in
  /|/root|/home|/usr|/opt|/var) echo "JIAOSHIBANG_DIR 不能指向系统目录：$INSTALL_DIR" >&2; exit 2 ;;
esac
if [[ -L "$INSTALL_DIR" ]]; then
  echo "安装目录不能是符号链接：$INSTALL_DIR" >&2
  exit 2
fi

install_apt_packages() {
  local packages=("$@")
  ((${#packages[@]})) || return 0
  command -v apt-get >/dev/null 2>&1 || {
    echo "缺少 ${packages[*]}；自动准备目前仅支持 Ubuntu/Debian。" >&2
    exit 1
  }
  echo "正在准备安装依赖：${packages[*]}"
  export DEBIAN_FRONTEND=noninteractive
  export NEEDRESTART_MODE=l
  apt-get -o Acquire::Retries=3 update
  apt-get -o Acquire::Retries=3 install -y --no-install-recommends "${packages[@]}"
}

install_controller_dependencies() {
  local packages=()
  command -v tmux >/dev/null 2>&1 || packages+=(tmux)
  command -v flock >/dev/null 2>&1 || packages+=(util-linux)
  install_apt_packages "${packages[@]}"
}

install_worker_dependencies() {
  local packages=()
  command -v git >/dev/null 2>&1 || packages+=(git)
  [[ -r /etc/ssl/certs/ca-certificates.crt ]] || packages+=(ca-certificates)
  install_apt_packages "${packages[@]}"
}

handle_existing_installation() {
  if ! tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
    return 1
  fi
  local pane_target="${SESSION_NAME}:0.0" pane_dead previous_status
  pane_dead="$(tmux display-message -p -t "$pane_target" '#{pane_dead}')"
  if [[ "$pane_dead" == "1" ]]; then
    previous_status="$(tmux display-message -p -t "$pane_target" '#{pane_dead_status}')"
    echo "检测到上一次安装已经结束，状态码：${previous_status:-未知}；正在清理结果会话并重新执行。"
    tmux kill-session -t "$SESSION_NAME"
    return 1
  fi
  if [[ -n "${TMUX:-}" ]]; then
    echo "当前已经位于另一个 tmux 会话，正在切换到教师帮安装会话。"
    flock -u 9
    exec 9>&-
    exec tmux switch-client -t "$SESSION_NAME"
  fi
  echo "检测到已有安装会话，正在重新接入，不会在安装期间更新代码。"
  echo "如果终端再次断开，重新登录后执行：tmux attach -t $SESSION_NAME"
  flock -u 9
  exec 9>&-
  exec tmux attach-session -t "$SESSION_NAME"
}

update_source() {
  if [[ -d "$INSTALL_DIR/.git" ]]; then
    local origin dirty local_head remote_head merge_base
    origin="$(git -C "$INSTALL_DIR" remote get-url origin 2>/dev/null || true)"
    case "$origin" in
      "$REPOSITORY_URL"|"${REPOSITORY_URL%.git}") ;;
      *)
        echo "已有目录的 GitHub 地址与教师帮不一致：$origin" >&2
        echo "为保护现有文件，安装器不会覆盖 $INSTALL_DIR。" >&2
        exit 2
        ;;
    esac
    dirty="$(git -C "$INSTALL_DIR" status --porcelain --untracked-files=all)"
    if [[ -n "$dirty" ]]; then
      echo "$INSTALL_DIR 存在未提交的代码修改，已停止自动更新以避免覆盖。" >&2
      exit 2
    fi
    echo "正在从公开 GitHub 仓库自动更新教师帮..."
    git -C "$INSTALL_DIR" checkout "$BRANCH"
    git -C "$INSTALL_DIR" fetch --prune origin "$BRANCH"
    local_head="$(git -C "$INSTALL_DIR" rev-parse HEAD)"
    remote_head="$(git -C "$INSTALL_DIR" rev-parse FETCH_HEAD)"
    merge_base="$(git -C "$INSTALL_DIR" merge-base "$local_head" "$remote_head" 2>/dev/null || true)"
    if [[ "$merge_base" != "$local_head" ]]; then
      echo "$INSTALL_DIR 包含远端 main 没有的提交或历史已分叉，已停止自动更新。" >&2
      exit 2
    fi
    git -C "$INSTALL_DIR" merge --ff-only "$remote_head"
    return
  fi

  if [[ -e "$INSTALL_DIR" ]] && [[ -n "$(find "$INSTALL_DIR" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null)" ]]; then
    echo "$INSTALL_DIR 已存在且不是教师帮 Git 仓库；为保护文件，安装器不会覆盖它。" >&2
    exit 2
  fi
  if [[ -e "$INSTALL_DIR" && ! -d "$INSTALL_DIR" ]]; then
    echo "$INSTALL_DIR 已存在且不是目录；为保护文件，安装器不会覆盖它。" >&2
    exit 2
  fi
  if [[ -d "$INSTALL_DIR" ]]; then
    rmdir -- "$INSTALL_DIR"
  fi

  local install_parent install_name
  install_parent="$(dirname -- "$INSTALL_DIR")"
  install_name="$(basename -- "$INSTALL_DIR")"
  mkdir -p "$install_parent"
  CLONE_TMP="$(mktemp -d "$install_parent/.${install_name}.clone.XXXXXX")"
  echo "正在从公开 GitHub 仓库匿名拉取教师帮，无需验证码..."
  git clone --depth 1 --branch "$BRANCH" --single-branch "$REPOSITORY_URL" "$CLONE_TMP"
  mv -- "$CLONE_TMP" "$INSTALL_DIR"
  CLONE_TMP=""
}

run_worker() {
  if [[ ! -t 0 || ! -t 1 ]]; then
    echo "安装工作进程必须在 tmux 终端中运行。" >&2
    exit 1
  fi
  export DEBIAN_FRONTEND=noninteractive
  export NEEDRESTART_MODE=l
  install_worker_dependencies
  update_source
  chmod +x "$INSTALL_DIR/scripts/install.sh" "$INSTALL_DIR/scripts/bootstrap.sh"
  cd -- "$INSTALL_DIR"

  local install_status=0
  ./scripts/install.sh || install_status=$?
  echo
  echo "教师帮安装进程已结束，状态码：$install_status"
  echo "输出日志：$LOG_FILE"
  echo "会话会保留本次结果；需要更新或重试时，重新运行一键安装命令。"
  return "$install_status"
}

start_worker_session() {
  local pane_target="${SESSION_NAME}:0.0" worker_command

  install -d -m 0700 "$STABLE_DIR" "$LOG_DIR"
  install -m 0700 "$SCRIPT_PATH" "$STABLE_SCRIPT"
  touch "$LOG_FILE"
  chmod 0600 "$LOG_FILE"

  tmux new-session -d -s "$SESSION_NAME" -c / bash
  tmux set-option -w -t "${SESSION_NAME}:0" remain-on-exit on
  tmux pipe-pane -o -t "$pane_target" "cat >> $LOG_FILE"
  printf -v worker_command \
    'exec env JIAOSHIBANG_DIR=%q JIAOSHIBANG_REPOSITORY_URL=%q JIAOSHIBANG_BRANCH=%q JIAOSHIBANG_INSTALL_SESSION=%q %q --worker' \
    "$INSTALL_DIR" "$REPOSITORY_URL" "$BRANCH" "$SESSION_NAME" "$STABLE_SCRIPT"
  tmux send-keys -l -t "$pane_target" "$worker_command"
  tmux send-keys -t "$pane_target" C-m
}

run_controller() {
  if [[ ! -t 0 || ! -t 1 ]]; then
    echo "安装需要交互输入域名、管理员账号和密码，请在可交互终端中运行。" >&2
    exit 1
  fi
  install_controller_dependencies

  install -d -m 0755 /run/lock
  exec 9>"$LOCK_FILE"
  if ! flock -n 9; then
    echo "另一个教师帮安装入口正在准备持久会话，请稍后重试。" >&2
    exit 1
  fi
  handle_existing_installation || true
  start_worker_session
  flock -u 9
  exec 9>&-

  echo "公开仓库拉取和正式安装已进入持久会话 $SESSION_NAME。"
  echo "SSH 或网页终端断开后，重新登录并执行：tmux attach -t $SESSION_NAME"
  echo "私密安装日志：$LOG_FILE"
  if [[ -n "${TMUX:-}" ]]; then
    exec tmux switch-client -t "$SESSION_NAME"
  fi
  exec tmux attach-session -t "$SESSION_NAME"
}

if [[ "$MODE" == "worker" ]]; then
  run_worker
else
  run_controller
fi
