"""Copyright (c) 2026 Insta360. All rights reserved.

缓读 · 简单限流工具
职责：按 device_id 做滑动窗口限流，内存实现，单进程 MVP 够用。
不依赖数据库；进程重启后计数清零，这是当前 MVP 阶段可接受的取舍。
调用者：仅 routers/ai.py 的 summarize_endpoint()，在调用 LLM 前先判断 is_allowed()。
"""

import time
from collections import defaultdict, deque

WINDOW_SECONDS = 60
MAX_REQUESTS_PER_WINDOW = 20

_hits: dict[str, deque] = defaultdict(deque)


def is_allowed(device_id: str) -> bool:
    now = time.monotonic()
    window = _hits[device_id]
    while window and now - window[0] > WINDOW_SECONDS:
        window.popleft()
    if len(window) >= MAX_REQUESTS_PER_WINDOW:
        return False
    window.append(now)
    return True
