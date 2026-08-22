"""Copyright (c) 2026 Insta360. All rights reserved.

缓读 · AI 摘要路由
POST /v1/ai/summarize：接收正文文本，返回 LLM 生成的要点摘要。
按 device_id 限流，不落地正文内容（不写数据库、不记日志正文）。
调用者：background.js 的 handleSummarize()。本文件依次调用
ratelimit.is_allowed() 做限流判断，再调用 services/llm_client.py 的 summarize()
实际请求 LLM。
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ratelimit import is_allowed
from services.llm_client import LLMError, summarize

router = APIRouter(prefix="/v1/ai", tags=["ai"])


class SummarizeRequest(BaseModel):
    device_id: str = Field(min_length=1, max_length=100)
    text: str = Field(min_length=1)
    mode: str = "summary"


class SummarizeResponse(BaseModel):
    result: str


@router.post("/summarize", response_model=SummarizeResponse)
async def summarize_endpoint(body: SummarizeRequest) -> SummarizeResponse:
    if body.mode != "summary":
        raise HTTPException(status_code=400, detail="当前只支持 mode=summary")

    if not is_allowed(body.device_id):
        raise HTTPException(status_code=429, detail="请求过于频繁，请稍后再试")

    try:
        result = await summarize(body.text)
    except LLMError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc

    return SummarizeResponse(result=result)
