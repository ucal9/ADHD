"""Copyright (c) 2026 Insta360. All rights reserved.

缓读 · AI 摘要/高亮路由
POST /v1/ai/summarize：接收正文文本，按 mode 转发给对应的 LLM 处理：
- mode=summary（默认）：返回 LLM 生成的要点摘要。
- mode=highlight：返回处理后的正文 HTML（拆分长段落/简化复杂长句/标记核心信息，
  由 options 里的三个布尔开关决定实际生效哪些）。
按 device_id 限流，不落地正文内容（不写数据库、不记日志正文）。
调用者：background.js 的 handleSummarize()。本文件依次调用
ratelimit.is_allowed() 做限流判断，再调用 services/llm_client.py 的 summarize()/rewrite()
实际请求 LLM。
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ratelimit import is_allowed
from services.llm_client import LLMError, rewrite, summarize

router = APIRouter(prefix="/v1/ai", tags=["ai"])


class SummarizeRequest(BaseModel):
    device_id: str = Field(min_length=1, max_length=100)
    text: str = Field(min_length=1)
    mode: str = "summary"
    options: dict = Field(default_factory=dict)  # mode=highlight 时生效：三个布尔子开关


class SummarizeResponse(BaseModel):
    result: str


@router.post("/summarize", response_model=SummarizeResponse)
async def summarize_endpoint(body: SummarizeRequest) -> SummarizeResponse:
    if body.mode not in ("summary", "highlight"):
        raise HTTPException(status_code=400, detail="当前只支持 mode=summary 或 mode=highlight")

    if not is_allowed(body.device_id):
        raise HTTPException(status_code=429, detail="请求过于频繁，请稍后再试")

    try:
        if body.mode == "highlight":
            result = await rewrite(body.text, body.options)
        else:
            result = await summarize(body.text)
    except LLMError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc

    return SummarizeResponse(result=result)
