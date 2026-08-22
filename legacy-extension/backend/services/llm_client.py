"""Copyright (c) 2026 Insta360. All rights reserved.

缓读 · LLM 客户端
职责：封装对 Anthropic Messages API（或兼容网关）的调用，密钥从环境变量读取，从不暴露给前端。
调用者：仅 routers/ai.py 的 summarize_endpoint()，限流通过后调用本模块的 summarize()。

支持两种鉴权方式（二选一，优先使用网关模式）：
- ANTHROPIC_BASE_URL + ANTHROPIC_AUTH_TOKEN：走内部/自建网关，用 Authorization: Bearer 传token
- ANTHROPIC_API_KEY：走 Anthropic 官方 API，用 x-api-key 传密钥
"""

import os
import time

import httpx

DEFAULT_API_URL = "https://api.anthropic.com/v1/messages"
MODEL = "claude-haiku-4-5-20251001"
DEFAULT_TIMEOUT_SECONDS = float(os.environ.get("LLM_TIMEOUT_SECONDS", "45"))
MAX_TEXT_CHARS = int(os.environ.get("LLM_MAX_TEXT_CHARS", "20000"))  # 超长正文直接截断，避免单次请求过大

SUMMARY_SYSTEM_PROMPT = (
    "你是一个帮助注意力容易分散的读者快速抓重点的助手。"
    "请用简洁的中文，输出3-5条要点摘要（每条一行，前面加“- ”），不要输出多余的开头或结尾语。"
)


class LLMError(Exception):
    def __init__(self, message: str, status_code: int = 502):
        super().__init__(message)
        self.status_code = status_code


def _resolve_endpoint_and_headers() -> tuple[str, dict, bool]:
    """返回 (endpoint, headers, trust_env)。

    trust_env 控制是否走本机系统/环境代理：网关模式的目标是公司内网地址，
    若本机配了系统代理（如 Clash），代理会把内网 CONNECT 隧道在 TLS 阶段直接断开
    （表现为 httpx 报 ConnectError(EndOfStream())，而 curl 因不读系统代理而"看起来正常"），
    因此网关模式必须绕开代理直连；官方 API 模式则相反，通常需要代理才能连通境外服务。
    """
    base_url = os.environ.get("ANTHROPIC_BASE_URL", "").rstrip("/")
    auth_token = os.environ.get("ANTHROPIC_AUTH_TOKEN")
    if base_url and auth_token:
        return (
            f"{base_url}/v1/messages",
            {
                "authorization": f"Bearer {auth_token}",
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            False,
        )

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if api_key:
        return (
            DEFAULT_API_URL,
            {
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            True,
        )

    raise LLMError(
        "服务端未配置密钥：请设置 ANTHROPIC_API_KEY，或 ANTHROPIC_BASE_URL + ANTHROPIC_AUTH_TOKEN",
        status_code=500,
    )


async def summarize(text: str) -> str:
    endpoint, headers, trust_env = _resolve_endpoint_and_headers()

    truncated = text.strip()[:MAX_TEXT_CHARS]
    if not truncated:
        raise LLMError("正文内容为空", status_code=400)

    started_at = time.perf_counter()
    timeout = httpx.Timeout(DEFAULT_TIMEOUT_SECONDS, connect=10.0)

    payload = {
        "model": MODEL,
        "max_tokens": 512,
        "system": SUMMARY_SYSTEM_PROMPT,
        "messages": [{"role": "user", "content": truncated}],
    }

    print(
        "[INS_Reader][llm_client] 准备调用 LLM",
        {
            "endpoint": endpoint,
            "model": MODEL,
            "text_length": len(truncated),
            "max_text_chars": MAX_TEXT_CHARS,
            "timeout_seconds": DEFAULT_TIMEOUT_SECONDS,
            "trust_env": trust_env,
        },
        flush=True,
    )

    try:
        async with httpx.AsyncClient(timeout=timeout, trust_env=trust_env) as client:
            resp = await client.post(endpoint, json=payload, headers=headers)
    except httpx.ReadTimeout as exc:
        elapsed = time.perf_counter() - started_at
        print(
            "[INS_Reader][llm_client] 上游 LLM 响应超时",
            {
                "elapsed_seconds": round(elapsed, 2),
                "timeout_seconds": DEFAULT_TIMEOUT_SECONDS,
                "endpoint": endpoint,
                "text_length": len(truncated),
                "exception": repr(exc),
            },
            flush=True,
        )
        raise LLMError(
            f"上游 LLM 网关响应超时（{DEFAULT_TIMEOUT_SECONDS:g}s，文本长度 {len(truncated)}）"
        ) from exc
    except httpx.RequestError as exc:
        elapsed = time.perf_counter() - started_at
        print(
            "[INS_Reader][llm_client] 调用 LLM 网络异常",
            {
                "elapsed_seconds": round(elapsed, 2),
                "endpoint": endpoint,
                "text_length": len(truncated),
                "exception_type": type(exc).__name__,
                "exception": repr(exc),
            },
            flush=True,
        )
        raise LLMError(f"调用 LLM 服务失败：{type(exc).__name__}: {exc}") from exc

    if resp.status_code != 200:
        elapsed = time.perf_counter() - started_at
        body_preview = resp.text[:500]
        print(
            "[INS_Reader][llm_client] LLM 返回非 200",
            {
                "elapsed_seconds": round(elapsed, 2),
                "status_code": resp.status_code,
                "body_preview": body_preview,
            },
            flush=True,
        )
        raise LLMError(f"LLM 服务返回错误：{resp.status_code}", status_code=502)

    try:
        data = resp.json()
    except ValueError as exc:
        raise LLMError("LLM 服务返回内容不是合法 JSON", status_code=502) from exc

    if not isinstance(data, dict):
        raise LLMError("LLM 服务返回结构异常", status_code=502)

    blocks = data.get("content") or []
    text_blocks = [b.get("text", "") for b in blocks if b.get("type") == "text"]
    result = "\n".join(text_blocks).strip()
    elapsed = time.perf_counter() - started_at
    print(
        "[INS_Reader][llm_client] LLM 调用完成",
        {
            "elapsed_seconds": round(elapsed, 2),
            "status_code": resp.status_code,
            "result_length": len(result),
        },
        flush=True,
    )
    if not result:
        raise LLMError("LLM 服务返回内容为空", status_code=502)
    return result
