"""缓读 · LLM 客户端
职责：封装对 Anthropic Messages API（或兼容网关）的调用，密钥从环境变量读取，从不暴露给前端。

支持两种鉴权方式（二选一，优先使用网关模式）：
- ANTHROPIC_BASE_URL + ANTHROPIC_AUTH_TOKEN：走内部/自建网关，用 Authorization: Bearer 传token
- ANTHROPIC_API_KEY：走 Anthropic 官方 API，用 x-api-key 传密钥
"""

import os

import httpx

DEFAULT_API_URL = "https://api.anthropic.com/v1/messages"
MODEL = "claude-haiku-4-5-20251001"
MAX_TEXT_CHARS = 20000  # 超长正文直接截断，避免单次请求过大

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

    payload = {
        "model": MODEL,
        "max_tokens": 512,
        "system": SUMMARY_SYSTEM_PROMPT,
        "messages": [{"role": "user", "content": truncated}],
    }

    try:
        async with httpx.AsyncClient(timeout=30.0, trust_env=trust_env) as client:
            resp = await client.post(endpoint, json=payload, headers=headers)
    except httpx.RequestError as exc:
        raise LLMError(f"调用 LLM 服务失败：{exc!r}") from exc

    if resp.status_code != 200:
        raise LLMError(f"LLM 服务返回错误：{resp.status_code}", status_code=502)

    data = resp.json()
    blocks = data.get("content") or []
    text_blocks = [b.get("text", "") for b in blocks if b.get("type") == "text"]
    result = "\n".join(text_blocks).strip()
    if not result:
        raise LLMError("LLM 服务返回内容为空", status_code=502)
    return result

