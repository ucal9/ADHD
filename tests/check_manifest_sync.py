#!/usr/bin/env python3
"""Copyright (c) 2026 Insta360. All rights reserved.

校验 manifest.json 的 content_scripts.js 与 background.js 的 CONTENT_SCRIPT_FILES 一致。

两份列表职责不同但必须完全相同（含顺序）：manifest 管页面加载时的自动注入，
background 管对扩展安装前就已打开的页面做按需补注入。任一处漏了模块，
表现为"部分页面功能正常、部分页面报 undefined"，很难定位，所以在 CI 里卡住。
模块之间通过 window.INS_Reader 互相取用，顺序错了同样会拿到 undefined。
"""

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def main() -> int:
    manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
    scripts = manifest["content_scripts"][0]["js"]

    bg = (ROOT / "src" / "background.js").read_text(encoding="utf-8")
    match = re.search(r"CONTENT_SCRIPT_FILES\s*=\s*\[(.*?)\]", bg, re.DOTALL)
    if not match:
        print("      background.js 里找不到 CONTENT_SCRIPT_FILES", file=sys.stderr)
        return 1
    injected = re.findall(r"['\"]([^'\"]+)['\"]", match.group(1))

    if scripts == injected:
        return 0

    print(f"      manifest ({len(scripts)} 项) 与 background ({len(injected)} 项) 不一致", file=sys.stderr)
    for name in [s for s in scripts if s not in injected]:
        print(f"      background.js 缺少：{name}", file=sys.stderr)
    for name in [s for s in injected if s not in scripts]:
        print(f"      manifest.json 缺少：{name}", file=sys.stderr)
    if sorted(scripts) == sorted(injected):
        print("      两侧内容相同但顺序不同：", file=sys.stderr)
        print(f"        manifest:   {scripts}", file=sys.stderr)
        print(f"        background: {injected}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
