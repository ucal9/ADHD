#!/usr/bin/env bash
# Copyright (c) 2026 Insta360. All rights reserved.
# 缓读 · 自动化测试总入口
#
# 分三层，从快到慢，任一层失败即整体失败（可用 --only 单跑某层）：
#   syntax   所有 content script + background 过 node --check，backend 过 ast.parse；
#            manifest.json 的模块列表与 background.js 的 CONTENT_SCRIPT_FILES 逐项比对
#   backend  纯函数单元测试，不联网、不消耗 LLM 额度
#   browser  在 headless Chrome 里跑 tests/browser/*.html，用 mock 的 chrome API
#            验证 AI 增强模块在真实 DOM 上的行为
#
# 用法：
#   tests/run-tests.sh                 跑全部
#   tests/run-tests.sh --only syntax   只跑某一层
#   tests/run-tests.sh --list          列出可用层级

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PY="backend/venv/bin/python"
[ -x "$PY" ] || PY="python3"

PASS=0
FAIL=0
SKIP=0

ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; PASS=$((PASS+1)); }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$1"; FAIL=$((FAIL+1)); }
skip() { printf '  \033[33m-\033[0m %s (跳过：%s)\n' "$1" "$2"; SKIP=$((SKIP+1)); }
head_() { printf '\n\033[1m%s\033[0m\n' "$1"; }

# ---------------- syntax ----------------
run_syntax() {
  head_ "syntax · 语法与清单一致性"

  local f
  for f in src/content.js src/background.js src/modules/*.js; do
    if node --check "$f" 2>/dev/null; then ok "node --check $f"; else
      bad "node --check $f"; node --check "$f" 2>&1 | sed 's/^/      /'
    fi
  done

  for f in backend/main.py backend/ratelimit.py backend/routers/*.py backend/services/*.py; do
    [ -f "$f" ] || continue
    if "$PY" -c "import ast,sys; ast.parse(open(sys.argv[1]).read())" "$f" 2>/dev/null; then
      ok "ast.parse $f"
    else
      bad "ast.parse $f"; "$PY" -c "import ast,sys; ast.parse(open(sys.argv[1]).read())" "$f" 2>&1 | tail -3 | sed 's/^/      /'
    fi
  done

  # manifest 与 background 的注入列表必须完全一致（含顺序）：
  # 前者管页面加载时注入，后者管对已打开页面的按需补注入，漏一个会只在部分页面出问题。
  if "$PY" tests/check_manifest_sync.py; then ok "manifest.json 与 background.js 模块列表一致"
  else bad "manifest.json 与 background.js 模块列表不一致"; fi

  if grep -rn '^<<<<<<<\|^>>>>>>>' --include='*.js' --include='*.py' --include='*.json' --include='*.md' \
      src backend tests *.json *.md 2>/dev/null | grep -v venv >/dev/null; then
    bad "存在未解决的冲突标记"
  else
    ok "无冲突标记"
  fi
}

# ---------------- backend ----------------
run_backend() {
  head_ "backend · 后端纯函数单元测试（不联网）"
  if "$PY" tests/test_llm_parsing.py; then ok "LLM 输出解析与容错"
  else bad "LLM 输出解析与容错"; fi
}

# ---------------- browser ----------------
run_browser() {
  head_ "browser · 浏览器行为测试"

  local chrome=""
  local candidate
  for candidate in \
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
    "/Applications/Chromium.app/Contents/MacOS/Chromium" \
    "$(command -v google-chrome 2>/dev/null)" \
    "$(command -v chromium 2>/dev/null)"; do
    [ -n "$candidate" ] && [ -x "$candidate" ] && { chrome="$candidate"; break; }
  done

  if [ -z "$chrome" ]; then
    skip "tests/browser/*.html" "未找到 Chrome/Chromium"
    return
  fi

  # CSS Custom Highlight API 和 Shadow DOM 都需要真实浏览器；用 file:// 打不开
  # （file URL 各自是独立 origin），所以起一个临时 HTTP 服务。
  local port=4271
  "$PY" -m http.server "$port" --bind 127.0.0.1 >/dev/null 2>&1 &
  local server_pid=$!
  trap 'kill $server_pid 2>/dev/null' RETURN
  sleep 1

  local page rc
  for page in tests/browser/*.html; do
    [ -f "$page" ] || continue
    "$PY" tests/run_browser_case.py "$chrome" "http://127.0.0.1:$port/$page"
    rc=$?
    case "$rc" in
      0) ok "$(basename "$page")" ;;
      # 3 = 浏览器起不来（环境限制），与断言失败区分，不判定为失败。
      3) skip "$(basename "$page")" "浏览器无法启动" ;;
      *) bad "$(basename "$page")" ;;
    esac
  done
}

# ---------------- 参数解析 ----------------
ONLY=""
while [ $# -gt 0 ]; do
  case "$1" in
    --only) ONLY="${2:-}"; shift 2 ;;
    --list) echo "可用层级：syntax backend browser"; exit 0 ;;
    -h|--help) sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "未知参数：$1（用 --help 查看用法）" >&2; exit 2 ;;
  esac
done

case "$ONLY" in
  "")        run_syntax; run_backend; run_browser ;;
  syntax)    run_syntax ;;
  backend)   run_backend ;;
  browser)   run_browser ;;
  *)         echo "未知层级：$ONLY（可用：syntax backend browser）" >&2; exit 2 ;;
esac

printf '\n\033[1m结果\033[0m  通过 %d  失败 %d  跳过 %d\n' "$PASS" "$FAIL" "$SKIP"
[ "$FAIL" -eq 0 ] || exit 1
