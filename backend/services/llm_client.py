"""Copyright (c) 2026 Insta360. All rights reserved.

缓读 · LLM 客户端
职责：封装对 Anthropic Messages API（或兼容网关）的调用，密钥从环境变量读取，从不暴露给前端。
调用者：仅 routers/ai.py 的 summarize_endpoint()，限流通过后调用本模块的 generate()。

支持四种任务模式（mode），共用同一次 Messages API 调用路径，只有 system prompt 与
输出校验不同：
- summary    → 纯文本要点摘要，直接展示；
- simplify   → 段落改写，返回 {"paragraphs":[{"i":编号,"text":"..."}]} 的 JSON 文本；
- keyinfo    → 核心片段抽取，返回 {"spans":["原文片段", ...]} 的 JSON 文本；
- imagenoise → 图片去留，返回 {"keep":[编号, ...]} 的 JSON 文本。
结构化模式在服务端就做 JSON 解析与形状校验，模型输出跑偏时直接回 502，
避免把不可解析的内容丢给前端，让前端只需处理"成功/失败"两种情况。

支持两种鉴权方式（二选一，优先使用网关模式）：
- ANTHROPIC_BASE_URL + ANTHROPIC_AUTH_TOKEN：走内部/自建网关，用 Authorization: Bearer 传token
- ANTHROPIC_API_KEY：走 Anthropic 官方 API，用 x-api-key 传密钥
"""

import json
import os
import re
import time

import httpx

DEFAULT_API_URL = "https://api.anthropic.com/v1/messages"
MODEL = "claude-haiku-4-5-20251001"
DEFAULT_TIMEOUT_SECONDS = float(os.environ.get("LLM_TIMEOUT_SECONDS", "45"))
MAX_TEXT_CHARS = int(os.environ.get("LLM_MAX_TEXT_CHARS", "20000"))  # 超长正文直接截断，避免单次请求过大

PLACEHOLDER_SECRETS = {
    "your-gateway-token",
    "your_gateway_token_here",
    "your-anthropic-api-key-here",
    "your_anthropic_api_key_here",
    "sk-ant-xxxxxxxx",
}

SUMMARY_SYSTEM_PROMPT = (
    "你是一个帮助注意力容易分散的读者快速抓重点的助手。"
    "请用简洁的中文，输出3-5条要点摘要（每条一行，前面加“- ”），不要输出多余的开头或结尾语。"
)

# 前端按 [编号] 段落原文 的格式逐段编号后发来；编号必须原样回传，
# 前端要靠它把改写结果对回具体段落。
SIMPLIFY_SYSTEM_PROMPT = (
    "你是一个帮助阅读困难读者理解长文的助手。"
    "用户会给你一组带编号的段落，每段格式为“[编号] 段落原文”。"
    "请把每个段落改写得更易读：拆分长句、去掉冗余修饰、必要时分成多句，"
    "但必须保留原文的全部事实、数字和结论，不得添加原文没有的信息，不得输出你的评论。"
    "改写后的段落用中文，长度不超过原文。"
    '只输出 JSON，格式为 {"paragraphs":[{"i":编号,"text":"改写后的段落"}]}，'
    "不要输出 JSON 以外的任何内容，不要用代码块包裹。"
    "段落文本里如果需要引号，必须用中文书名号《》或直角引号「」，"
    "绝对不要使用半角双引号或全角双引号，否则会破坏 JSON 结构。"
)

# spans 必须逐字取自原文：前端是用字符串查找把它们标记到已渲染的文本节点上，
# 一旦模型改写或合并了片段，前端就找不到落点，功能表现为"点了没反应"。
KEYINFO_SYSTEM_PROMPT = (
    "你是一个帮助读者快速定位重点的助手。"
    "请从用户给出的正文里挑选 8 到 20 个最关键的词语或短语，优先选结论、数字、定义和因果关系。"
    "每个片段必须是原文中连续出现的原始文本，逐字复制，"
    "不得改写、不得合并不相邻的内容、不得跨段落，每个片段长度控制在 3 到 20 个字。"
    "不要返回完整句子，不要包含逗号、句号、分号、冒号等标点。"
    '只输出 JSON，格式为 {"spans":["原文片段", ...]}，'
    "不要输出 JSON 以外的任何内容，不要用代码块包裹。"
)

IMAGENOISE_SYSTEM_PROMPT = (
    "你是一个帮助注意力容易分散的读者过滤网页噪音图片的助手。"
    "用户会给你一组带编号的图片元数据（地址、尺寸、alt、图注、所在 DOM 上下文），不会给你图片像素。"
    "请判断哪些图片是帮助理解正文的配图、图表或信息图，应保留。"
    "广告、相关推荐缩略图、装饰图标、追踪像素、推销横幅应隐藏，不要放入 keep。"
    '只输出 JSON，格式为 {"keep":[编号, ...]}，编号必须来自输入。'
    '若没有应保留的图片，输出 {"keep":[]}。'
    "不要输出 JSON 以外的任何内容，不要用代码块包裹。"
)

SYSTEM_PROMPTS = {
    "summary": SUMMARY_SYSTEM_PROMPT,
    "simplify": SIMPLIFY_SYSTEM_PROMPT,
    "keyinfo": KEYINFO_SYSTEM_PROMPT,
    "imagenoise": IMAGENOISE_SYSTEM_PROMPT,
}

# 结构化模式要输出整篇改写，512 tokens 会被截断成不合法 JSON。
MAX_TOKENS = {"summary": 512, "simplify": 4096, "keyinfo": 1024, "imagenoise": 512}

SUPPORTED_MODES = tuple(SYSTEM_PROMPTS)

# 模型有时会无视"不要用代码块包裹"，输出 ```json\n{...}\n``` 。用捕获组整段抓取
# 而不是首尾分别 sub：后者对只有半边围栏的截断输出会把残缺内容剥成"看起来合法"，
# 掩盖掉本该暴露的解析失败。
_CODE_FENCE_RE = re.compile(r"^\s*```(?:json)?\s*(.*?)\s*```\s*$", re.DOTALL)


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
    if base_url and _is_configured_secret(auth_token):
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
    if _is_configured_secret(api_key):
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


def _is_configured_secret(value: str | None) -> bool:
    """判断环境变量是否是真实配置，避免示例占位符被当成密钥发送。"""
    if not value:
        return False
    normalized = value.strip().lower()
    return bool(normalized) and normalized not in PLACEHOLDER_SECRETS


def _strip_code_fence(raw: str) -> str:
    """去掉模型有时自作主张加上的 ```json 围栏，再交给 json.loads。"""
    match = _CODE_FENCE_RE.match(raw.strip())
    return match.group(1).strip() if match else raw.strip()


def _escape_inner_quotes(raw: str) -> str:
    """修复模型在 JSON 字符串内部留下的未转义双引号。

    实测模型改写中文段落时会写出 {"text":"这样"已隐藏N个"的计数才对得上"}，
    裸引号让整个响应不是合法 JSON（报 Expecting ',' delimiter）。这里按状态机
    扫一遍：处于字符串内部时，只有紧跟结构字符（, : } ] 或串尾）的引号才算真正
    的结束引号，其余一律转义。改不动的情况原样返回，交由上层报错。
    """
    out = []
    in_string = False
    escaped = False
    for i, ch in enumerate(raw):
        if escaped:
            out.append(ch)
            escaped = False
            continue
        if ch == "\\":
            out.append(ch)
            escaped = True
            continue
        if ch == '"':
            if not in_string:
                in_string = True
                out.append(ch)
                continue
            # 向后找第一个非空白字符，判断这个引号是不是真的结束引号。
            nxt = next((c for c in raw[i + 1 :] if not c.isspace()), "")
            if nxt in (",", ":", "}", "]", ""):
                in_string = False
                out.append(ch)
            else:
                out.append('\\"')  # 串内裸引号，补上转义
            continue
        out.append(ch)
    return "".join(out)


def _loads_lenient(mode: str, raw: str) -> object:
    """先按原样解析，失败再尝试修复串内裸引号。两次都失败才算上游错误。"""
    text = _strip_code_fence(raw)
    try:
        return json.loads(text)
    except ValueError:
        repaired = _escape_inner_quotes(text)
        if repaired == text:
            raise
        result = json.loads(repaired)  # 仍失败则由调用方捕获
        print(
            "[INS_Reader][llm_client] 已修复模型输出中未转义的引号",
            {"mode": mode},
            flush=True,
        )
        return result


def _parse_structured(mode: str, raw: str) -> dict:
    """把结构化模式的模型输出解析成固定形状的 dict，形状不符即视为上游错误。

    前端拿到的永远是 {"paragraphs": [...]}、{"spans": [...]} 或 {"keep": [...]}，
    单个不合法的条目在这里被丢弃而不是让整次请求失败——模型偶尔多吐一条空串
    不该让用户看到"生成失败"。
    """
    try:
        data = _loads_lenient(mode, raw)
    except ValueError as exc:
        print(
            "[INS_Reader][llm_client] 结构化输出不是合法 JSON",
            {"mode": mode, "raw_preview": raw[:300]},
            flush=True,
        )
        raise LLMError("AI 返回格式异常，请重试", status_code=502) from exc

    if not isinstance(data, dict):
        raise LLMError("AI 返回格式异常，请重试", status_code=502)

    if mode == "simplify":
        items = data.get("paragraphs")
        if not isinstance(items, list):
            raise LLMError("AI 返回格式异常，请重试", status_code=502)
        cleaned = [
            {"i": int(item["i"]), "text": item["text"].strip()}
            for item in items
            if isinstance(item, dict)
            and isinstance(item.get("text"), str)
            and item["text"].strip()
            and isinstance(item.get("i"), (int, float))
            and not isinstance(item.get("i"), bool)
        ]
        if not cleaned:
            raise LLMError("AI 未返回可用的改写结果", status_code=502)
        return {"paragraphs": cleaned}

    if mode == "imagenoise":
        items = data.get("keep")
        if not isinstance(items, list):
            raise LLMError("AI 返回格式异常，请重试", status_code=502)
        cleaned_keep: list[int] = []
        seen: set[int] = set()
        for item in items:
            if isinstance(item, bool) or not isinstance(item, (int, float)):
                continue
            index = int(item)
            if index in seen:
                continue
            seen.add(index)
            cleaned_keep.append(index)
        return {"keep": cleaned_keep}

    items = data.get("spans")
    if not isinstance(items, list):
        raise LLMError("AI 返回格式异常，请重试", status_code=502)
    cleaned_spans = [s.strip() for s in items if isinstance(s, str) and s.strip()]
    if not cleaned_spans:
        raise LLMError("AI 未返回可用的重点片段", status_code=502)
    return {"spans": cleaned_spans}


async def generate(text: str, mode: str = "summary") -> str | dict:
    """按 mode 调用 LLM。summary 返回纯文本，simplify/keyinfo/imagenoise 返回已校验的 dict。"""
    if mode not in SYSTEM_PROMPTS:
        raise LLMError(f"不支持的 mode：{mode}", status_code=400)

    endpoint, headers, trust_env = _resolve_endpoint_and_headers()

    truncated = text.strip()[:MAX_TEXT_CHARS]
    if not truncated:
        raise LLMError("正文内容为空", status_code=400)

    started_at = time.perf_counter()
    timeout = httpx.Timeout(DEFAULT_TIMEOUT_SECONDS, connect=10.0)

    payload = {
        "model": MODEL,
        "max_tokens": MAX_TOKENS[mode],
        "system": SYSTEM_PROMPTS[mode],
        "messages": [{"role": "user", "content": truncated}],
    }

    print(
        "[INS_Reader][llm_client] 准备调用 LLM",
        {
            "endpoint": endpoint,
            "model": MODEL,
            "mode": mode,
            "max_tokens": MAX_TOKENS[mode],
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
            "mode": mode,
            "result_length": len(result),
        },
        flush=True,
    )
    if not result:
        raise LLMError("LLM 服务返回内容为空", status_code=502)
    if mode == "summary":
        return result
    return _parse_structured(mode, result)


async def summarize(text: str) -> str:
    """保留旧签名：等价于 generate(text, "summary")。"""
    return await generate(text, "summary")
