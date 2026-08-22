#!/usr/bin/env python3
"""Copyright (c) 2026 Insta360. All rights reserved.

在 headless Chrome 里跑一个测试页，读取页面自报的结果。

不引入 Playwright/Selenium：这些测试页只需要"打开、等完成、读两个全局变量"，
用 Chrome DevTools Protocol 直连即可，省掉一整套依赖和浏览器下载。

被测页面的约定（tests/browser/*.html 都要遵守）：
- 跑完把 window.__done 置 true；
- 有断言失败时把 window.__failed 置 true；
- 把逐条结果写进 #log 的 textContent，供失败时打印。

用法：run_browser_case.py <chrome 可执行文件> <页面 URL>
"""

import json
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

READY_TIMEOUT = 20  # 秒，等 Chrome 起来并暴露调试端口
CASE_TIMEOUT = 60  # 秒，等页面把 __done 置 true


def _debug_port_url(port: int, path: str) -> str:
    return f"http://127.0.0.1:{port}/json{path}"


def _wait_for_page(port: int) -> str | None:
    """等 Chrome 就绪，返回目标页的 WebSocket 调试地址。"""
    deadline = time.time() + READY_TIMEOUT
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(_debug_port_url(port, "/list"), timeout=2) as resp:
                for target in json.load(resp):
                    if target.get("type") == "page" and target.get("webSocketDebuggerUrl"):
                        return target["webSocketDebuggerUrl"]
        except (urllib.error.URLError, OSError, ValueError):
            pass
        time.sleep(0.3)
    return None


def _eval_via_ws(ws_url: str, expression: str) -> object:
    """通过 CDP 求值。websockets 不一定装了，所以用最小手写帧实现。"""
    import base64
    import os
    import socket
    import struct
    from urllib.parse import urlparse

    parsed = urlparse(ws_url)
    sock = socket.create_connection((parsed.hostname, parsed.port), timeout=10)
    key = base64.b64encode(os.urandom(16)).decode()
    sock.sendall(
        f"GET {parsed.path} HTTP/1.1\r\nHost: {parsed.hostname}:{parsed.port}\r\n"
        f"Upgrade: websocket\r\nConnection: Upgrade\r\n"
        f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n".encode()
    )
    buf = b""
    while b"\r\n\r\n" not in buf:
        chunk = sock.recv(4096)
        if not chunk:
            raise RuntimeError("CDP 握手失败")
        buf += chunk

    payload = json.dumps(
        {
            "id": 1,
            "method": "Runtime.evaluate",
            "params": {"expression": expression, "returnByValue": True, "awaitPromise": True},
        }
    ).encode()
    # 客户端帧必须掩码；单帧文本消息足够，不做分片。
    mask = os.urandom(4)
    masked = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
    header = b"\x81"
    n = len(payload)
    if n < 126:
        header += struct.pack("!B", 0x80 | n)
    elif n < 65536:
        header += struct.pack("!BH", 0x80 | 126, n)
    else:
        header += struct.pack("!BQ", 0x80 | 127, n)
    sock.sendall(header + mask + masked)

    def recv_exact(count: int) -> bytes:
        data = b""
        while len(data) < count:
            chunk = sock.recv(count - len(data))
            if not chunk:
                raise RuntimeError("CDP 连接中断")
            data += chunk
        return data

    while True:
        first = recv_exact(2)
        length = first[1] & 0x7F
        if length == 126:
            length = struct.unpack("!H", recv_exact(2))[0]
        elif length == 127:
            length = struct.unpack("!Q", recv_exact(8))[0]
        body = recv_exact(length)
        if first[0] & 0x0F != 1:  # 只关心文本帧
            continue
        msg = json.loads(body)
        if msg.get("id") == 1:
            sock.close()
            return msg.get("result", {}).get("result", {}).get("value")


def main() -> int:
    if len(sys.argv) != 3:
        print("用法：run_browser_case.py <chrome> <url>", file=sys.stderr)
        return 2
    chrome, url = sys.argv[1], sys.argv[2]

    port = 9223
    profile = tempfile.mkdtemp(prefix="ins-reader-test-")
    proc = subprocess.Popen(
        [
            chrome,
            "--headless=new",
            f"--remote-debugging-port={port}",
            f"--user-data-dir={profile}",
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-gpu",
            "--disable-extensions",
            url,
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        ws_url = _wait_for_page(port)
        if not ws_url:
            # Chrome 存在但起不来（沙箱/CI 常见：无法创建 socket 目录或 Crashpad 文件）。
            # 用退出码 3 与"断言失败"区分开，让上层报跳过而不是失败——
            # 否则受限环境里每次都误报成代码有问题。
            print("      Chrome 未能就绪（调试端口无响应，可能是环境限制）", file=sys.stderr)
            return 3

        deadline = time.time() + CASE_TIMEOUT
        while time.time() < deadline:
            if _eval_via_ws(ws_url, "window.__done === true"):
                break
            time.sleep(0.4)
        else:
            print(f"      页面 {CASE_TIMEOUT}s 内未完成", file=sys.stderr)
            return 1

        failed = _eval_via_ws(ws_url, "window.__failed === true")
        log = _eval_via_ws(ws_url, "(document.getElementById('log')||{}).textContent || ''") or ""
        if failed:
            # 只打印失败行和结尾，避免几十行全过的输出淹没真正的问题。
            for line in str(log).splitlines():
                if line.startswith("❌") or "FAILED" in line or "THREW" in line:
                    print(f"      {line}", file=sys.stderr)
            return 1
        count = len(re.findall(r"^✅", str(log), re.MULTILINE))
        print(f"      {count} 项断言通过")
        return 0
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
        shutil.rmtree(profile, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
