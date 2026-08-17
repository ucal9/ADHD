"""缓读 · 后端服务入口
职责：注册路由、配置 CORS（只允许 Chrome 扩展 origin，以及本地 demo.html 调试环境访问）。
后端只做增值（AI 摘要代理），核心阅读功能完全在前端本地完成，不依赖此服务。
"""

from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from routers import ai

app = FastAPI(title="缓读后端", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    # chrome-extension://... 是正式插件环境；file:// 打开 demo.html 时浏览器发送的
    # Origin 是字面上的 "null"，这里放行仅用于本地开发联调，不代表允许任意网页调用。
    allow_origin_regex=r"^(chrome-extension://.*|null)$",
    allow_methods=["POST"],
    allow_headers=["content-type"],
)


@app.middleware("http")
async def allow_private_network_access(request: Request, call_next):
    # Chrome 142+ 的 Local Network Access 机制：网页（含插件、file://）访问
    # localhost 这类私有地址前，会在预检请求里发 Access-Control-Request-Private-Network，
    # 服务器必须回一个 Access-Control-Allow-Private-Network: true 才会放行，
    # 否则请求在浏览器侧被直接拒绝（前端只会看到"无法连接"，后端完全不知道）。
    # CORSMiddleware 对 OPTIONS 预检会直接短路返回，不会经过这里之后注册的中间件，
    # 所以这个中间件必须比 add_middleware(CORSMiddleware, ...) 后注册，才能包在它外层。
    response = await call_next(request)
    if request.headers.get("access-control-request-private-network") == "true":
        response.headers["Access-Control-Allow-Private-Network"] = "true"
    return response


app.include_router(ai.router)


@app.get("/healthz")
def healthz():
    return {"ok": True}
