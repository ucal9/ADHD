# 缓读 Chrome 扩展开发说明

根目录是 Chrome Manifest V3 插件。`manifest.json` 加载 `src/` 下的 content script、Shadow DOM 阅读层、设置面板和 background service worker；不要把根目录当成 Vite 项目运行。

## 安装与验证

- Chrome：`chrome://extensions` → 开发者模式 → 加载根目录；
- 真实网页：打开新浪文章或普通文章，点击工具栏中的缓读图标；
- 语法检查：`node --check src/content.js` 以及逐个检查 `src/modules/*.js`。

## AI 后端

只有四个 AI 功能依赖后端：生成摘要、简化段落长句、高亮核心信息、智能屏蔽里对拿不准图片的二次判定。正文抽取、排版、本地降噪、阅读层完全不需要它。

启动（`uvicorn` 只装在 `backend/venv/` 里，不在系统 PATH 上）：

```bash
cd backend && source venv/bin/activate && uvicorn main:app --port 8000 --reload
```

未激活 venv 时用 `venv/bin/uvicorn main:app --port 8000 --reload`；直接敲 `uvicorn` 会报 `command not found`。

调后端 Python 代码时务必带 `--reload`，否则要手动重启进程才会生效 —— 否则接口会一直返回旧代码的行为，很容易误判成前端 bug。`Address already in use` 表示 8000 被占用，用 `lsof -nP -iTCP:8000 -sTCP:LISTEN` 找到 PID 后停掉。

配置：`backend/.env`（从 `.env.example` 复制）。填 `ANTHROPIC_API_KEY` 走官方 API，或填 `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN` 走内部网关，网关模式优先。密钥只留在后端，绝不能进入插件包或提交到仓库。

接口 `POST /v1/ai/summarize` 按 `mode` 分四种任务：`summary` 返回 `result`（纯文本），`simplify` 返回 `data.paragraphs`（`[{i, text}]`），`keyinfo` 返回 `data.spans`（`[string]`，逐字取自原文），`imagenoise` 返回 `data.keep`（`[number]`，应恢复显示的图片编号）。`result` 与 `data` 互斥。新增 mode 要同时改 `services/llm_client.py` 的 `SYSTEM_PROMPTS`/`MAX_TOKENS`/`_parse_structured()` 和 `routers/ai.py` 的 `Literal`；结构化输出的形状校验放在服务端，前端只处理成功/失败。

## 架构约定

- 所有 content script 模块挂载到 `window.INS_Reader`，加载顺序由 `manifest.json` 控制，`src/background.js` 的 `CONTENT_SCRIPT_FILES` 必须与之逐项一致；`image-classifier.js` 必须在 `noise-filter.js` 之前；
- `reader-layer.js` 只在 Shadow DOM 中渲染克隆内容，不能修改真实页面 DOM 结构；
- `sina-adapter.js` 只做新浪页面只读定位和选择器提供，删除动作必须由 `noise-filter.js` 在克隆体执行；
- `panel-ui.js` 的排版、AI、降噪配置在同一个面板中展开，不使用二级页面路由；
- AI 默认关闭，发送正文前必须有用户同意，失败必须保留原文和恢复入口，并把开关回滚成关闭态，不允许出现「开关显示已开启但页面无效果」；智能屏蔽的 AI 二次判定失败时例外：降噪开关保持开启，拿不准的图维持隐藏。
- `ai-enhance.js` 的段落改写必须可逐字撤销（保存原始子节点数组还原），高亮走 CSS Highlight API、不插入 `<mark>` 或切分文本节点；
- AI 结果按段落文本缓存，阅读层重建克隆体后调 `reapply()` 走缓存重新落地，改字号/换配色不得触发新的 LLM 请求；
- 新站点优先新增适配器，不要把站点选择器散落到通用模块。

`demo-app/` 是独立的 React/Vite 视觉演示，不是插件运行时。
