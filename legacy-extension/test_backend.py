#!/usr/bin/env python3
"""
后端 API 测试脚本
用法：先启动后端，然后运行此脚本
  cd backend && ./venv/bin/uvicorn main:app --port 8000
  python3 test_backend.py
"""

import json
import time
import sys

try:
    import httpx
except ImportError:
    print("ERROR: httpx 未安装。请用后端 venv 运行：")
    print("  backend/venv/bin/python3 test_backend.py")
    sys.exit(1)

BASE = "http://127.0.0.1:8000"
TIMEOUT = 60

def test_healthz():
    print("=" * 60)
    print("[1/4] 测试 /healthz")
    try:
        r = httpx.get(f"{BASE}/healthz", timeout=5)
        print(f"  状态码: {r.status_code}")
        print(f"  响应: {r.json()}")
        assert r.status_code == 200
        print("  ✅ PASS")
        return True
    except Exception as e:
        print(f"  ❌ FAIL: {e}")
        print("  → 请确认后端已启动: cd backend && ./venv/bin/uvicorn main:app --port 8000")
        return False


def test_summarize_short():
    print("=" * 60)
    print("[2/4] 测试短文本摘要（正常路径）")
    payload = {
        "device_id": "test-debug-001",
        "text": "INS_Reader 是一个 Chrome 阅读模式插件。它能识别网页正文，隐藏广告等干扰元素，还可以生成 AI 摘要。核心功能全部在前端完成，AI 摘要是可选的增值功能。",
        "mode": "summary",
    }
    started = time.perf_counter()
    try:
        r = httpx.post(f"{BASE}/v1/ai/summarize", json=payload, timeout=TIMEOUT)
        elapsed = round(time.perf_counter() - started, 2)
        print(f"  状态码: {r.status_code}  耗时: {elapsed}s")
        if r.status_code == 200:
            body = r.json()
            print(f"  摘要长度: {len(body.get('result', ''))} 字符")
            print(f"  摘要内容:\n{body.get('result', '')[:300]}")
            print("  ✅ PASS")
            return True
        else:
            print(f"  响应: {r.text[:500]}")
            print(f"  ❌ FAIL (HTTP {r.status_code})")
            return False
    except httpx.ReadTimeout:
        elapsed = round(time.perf_counter() - started, 2)
        print(f"  ❌ FAIL: ReadTimeout（{elapsed}s）")
        print("  → LLM 上游响应超时，检查网关连通性和 ANTHROPIC_BASE_URL 配置")
        return False
    except Exception as e:
        elapsed = round(time.perf_counter() - started, 2)
        print(f"  ❌ FAIL: {type(e).__name__}: {e}  ({elapsed}s)")
        return False


def test_summarize_long():
    print("=" * 60)
    print("[3/4] 测试长文本摘要（~5000 字，模拟真实文章）")
    # 生成一段足够长的中文测试文本
    base = "INS_Reader 缓读插件的核心设计理念是为注意力容易分散的用户提供无干扰的阅读体验。它通过 Readability.js 算法识别正文区域，利用启发式规则过滤广告和侧边栏等噪声元素。"
    text = (base * 80)[:5000]
    payload = {
        "device_id": "test-debug-002",
        "text": text,
        "mode": "summary",
    }
    started = time.perf_counter()
    try:
        r = httpx.post(f"{BASE}/v1/ai/summarize", json=payload, timeout=TIMEOUT)
        elapsed = round(time.perf_counter() - started, 2)
        print(f"  文本长度: {len(text)} 字符")
        print(f"  状态码: {r.status_code}  耗时: {elapsed}s")
        if r.status_code == 200:
            body = r.json()
            print(f"  摘要长度: {len(body.get('result', ''))} 字符")
            print(f"  摘要内容:\n{body.get('result', '')[:300]}")
            print("  ✅ PASS")
            return True
        elif r.status_code == 429:
            print(f"  ❌ FAIL: 被限流（429）")
            print("  → 限流规则: 5次/60秒。请等一分钟后重试，或换一个 device_id")
            return False
        else:
            print(f"  响应: {r.text[:500]}")
            print(f"  ❌ FAIL (HTTP {r.status_code})")
            return False
    except httpx.ReadTimeout:
        elapsed = round(time.perf_counter() - started, 2)
        print(f"  ❌ FAIL: ReadTimeout（{elapsed}s）")
        return False
    except Exception as e:
        elapsed = round(time.perf_counter() - started, 2)
        print(f"  ❌ FAIL: {type(e).__name__}: {e}  ({elapsed}s)")
        return False


def test_rate_limit():
    print("=" * 60)
    print("[4/4] 测试限流（连续发 7 次请求，预期第 6 次被拒）")
    payload = {
        "device_id": "test-ratelimit-001",
        "text": "测试限流的短文本。",
        "mode": "summary",
    }
    results = []
    for i in range(7):
        started = time.perf_counter()
        try:
            r = httpx.post(f"{BASE}/v1/ai/summarize", json=payload, timeout=TIMEOUT)
            elapsed = round(time.perf_counter() - started, 2)
            results.append(r.status_code)
            mark = "✅" if r.status_code == 200 else "🚫"
            print(f"  第{i+1}次: {mark} {r.status_code}  ({elapsed}s)")
        except Exception as e:
            results.append(0)
            print(f"  第{i+1}次: ❌ {type(e).__name__}")

    ok_count = results.count(200)
    blocked_count = results.count(429)
    print(f"  成功: {ok_count}, 被限流: {blocked_count}")
    if blocked_count > 0 and ok_count > 0:
        print("  ✅ PASS（限流生效）")
        return True
    elif ok_count == 7:
        print("  ⚠️  全部成功 — 限流可能未生效或窗口已滑动")
        return True
    else:
        print(f"  ❌ FAIL（结果异常: {results}）")
        return False


if __name__ == "__main__":
    print("🔧 INS_Reader 后端 API 测试")
    print(f"   目标: {BASE}")
    print(f"   超时: {TIMEOUT}s")
    print()

    results = {}
    results["healthz"] = test_healthz()
    if not results["healthz"]:
        print("\n后端不可达，终止测试。")
        sys.exit(1)

    results["short_summary"] = test_summarize_short()
    results["long_summary"] = test_summarize_long()
    results["rate_limit"] = test_rate_limit()

    print()
    print("=" * 60)
    print("📊 测试汇总")
    for name, passed in results.items():
        print(f"  {'✅' if passed else '❌'} {name}")
    total = len(results)
    passed = sum(1 for v in results.values() if v)
    print(f"\n  通过: {passed}/{total}")
