"""Copyright (c) 2026 Insta360. All rights reserved.

缓读 · AI 内容助手路由
POST /v1/ai/summarize：接收正文文本，按 mode 返回 LLM 结果。
- mode=summary    → result 为纯文本要点摘要；
- mode=simplify   → data 为 {"paragraphs":[{"i":编号,"text":"改写后段落"}]}；
- mode=keyinfo    → data 为 {"spans":["原文片段", ...]}；
- mode=imagenoise → data 为 {"keep":[编号, ...]}，编号对应请求里的图片。
result 与 data 互斥：前者给纯文本模式，后者给结构化模式，
这样 background.js 不必按 mode 分支解析，直接把整个 body 回传给 ai-client.js。
按 device_id 限流，不落地正文内容（不写数据库、不记日志正文）。
调用者：background.js 的 handleSummarize()。本文件依次调用
ratelimit.is_allowed() 做限流判断，再调用 services/llm_client.py 的 generate()
实际请求 LLM。
"""

from typing import Any, Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ratelimit import is_allowed
from services.llm_client import LLMError, generate

router = APIRouter(prefix="/v1/ai", tags=["ai"])


class SummarizeRequest(BaseModel):
    device_id: str = Field(min_length=1, max_length=100)
    text: str = Field(min_length=1)
    mode: Literal["summary", "simplify", "keyinfo", "imagenoise"] = "summary"


class SummarizeResponse(BaseModel):
    result: str | None = None
    data: dict[str, Any] | None = None


@router.post("/summarize", response_model=SummarizeResponse, response_model_exclude_none=True)
async def summarize_endpoint(body: SummarizeRequest) -> SummarizeResponse:
    if not is_allowed(body.device_id):
        raise HTTPException(status_code=429, detail="请求过于频繁，请稍后再试")

    try:
        result = await generate(body.text, body.mode)
    except LLMError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc

    if isinstance(result, str):
        return SummarizeResponse(result=result)
    return SummarizeResponse(data=result)
