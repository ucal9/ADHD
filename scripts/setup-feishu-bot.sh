#!/usr/bin/env bash
# 部署 feishu-claude-code（飞书机器人 ↔ 本机 Claude Code CLI 的长连接桥）。
# 需要联网，因此必须在你自己的终端里跑，Claude 的沙箱访问不了 github/pypi。
# 幂等：重复执行只会更新代码和依赖，不会覆盖已有的会话数据。
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEPLOY_DIR="$REPO_ROOT/tools/feishu-claude-code"
CRED_FILE="$REPO_ROOT/tools/feishu-bot.env"
UPSTREAM="https://github.com/joewongjc/feishu-claude-code.git"

# --- 前置检查 ---------------------------------------------------------------
command -v git >/dev/null || { echo "缺少 git" >&2; exit 1; }
command -v python3 >/dev/null || { echo "缺少 python3" >&2; exit 1; }

PY_OK=$(python3 -c 'import sys; print(1 if sys.version_info >= (3, 11) else 0)')
[ "$PY_OK" = "1" ] || { echo "需要 Python 3.11+，当前 $(python3 --version)" >&2; exit 1; }

CLAUDE_BIN="$(command -v claude || true)"
[ -n "$CLAUDE_BIN" ] || { echo "找不到 claude CLI，先确认它在 PATH 里" >&2; exit 1; }

[ -f "$CRED_FILE" ] || { echo "缺少凭证文件 $CRED_FILE" >&2; exit 1; }
# shellcheck disable=SC1090
source "$CRED_FILE"
: "${FEISHU_APP_ID:?凭证文件里没有 FEISHU_APP_ID}"
: "${FEISHU_APP_SECRET:?凭证文件里没有 FEISHU_APP_SECRET}"

# --- 拉取源码 ---------------------------------------------------------------
if [ -d "$DEPLOY_DIR/.git" ]; then
  echo "==> 更新已有部署 $DEPLOY_DIR"
  git -C "$DEPLOY_DIR" pull --ff-only
else
  echo "==> 克隆 $UPSTREAM"
  git clone --depth 1 "$UPSTREAM" "$DEPLOY_DIR"
fi

# --- 虚拟环境与依赖 ---------------------------------------------------------
cd "$DEPLOY_DIR"
[ -d .venv ] || python3 -m venv .venv
echo "==> 安装依赖"
./.venv/bin/pip install --quiet --upgrade pip
./.venv/bin/pip install --quiet -r requirements.txt

# --- 生成 .env --------------------------------------------------------------
# 以上游的 .env.example 为底，只覆盖我们关心的键，避免漏掉上游新增的必填项。
[ -f .env ] || cp .env.example .env

set_env() {
  local key="$1" value="$2"
  if grep -qE "^[#[:space:]]*${key}=" .env; then
    python3 - "$key" "$value" <<'PY'
import re, sys
key, value = sys.argv[1], sys.argv[2]
with open('.env', encoding='utf-8') as f:
    text = f.read()
text = re.sub(rf'^[#\s]*{re.escape(key)}=.*$', f'{key}={value}', text,
              count=1, flags=re.MULTILINE)
with open('.env', 'w', encoding='utf-8') as f:
    f.write(text)
PY
  else
    printf '%s=%s\n' "$key" "$value" >> .env
  fi
}

set_env FEISHU_APP_ID     "$FEISHU_APP_ID"
set_env FEISHU_APP_SECRET "$FEISHU_APP_SECRET"
set_env CLAUDE_CLI_PATH   "$CLAUDE_BIN"
set_env DEFAULT_CWD       "$REPO_ROOT"
set_env DEFAULT_MODEL     "claude-opus-5"
# 默认的 bypassPermissions 意味着任何能私聊机器人的人都能在本机无确认执行工具调用。
# 先用最严格的 default，链路验证通过后再按需放宽。
set_env PERMISSION_MODE   "default"

chmod 600 .env

echo
echo "==> 完成。部署目录：$DEPLOY_DIR"
echo "    启动：cd $DEPLOY_DIR && ./.venv/bin/python main.py"
