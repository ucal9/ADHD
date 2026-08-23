# 缓读 Chrome 扩展

本仓库的默认项目是一个可安装到 Google Chrome 的 Manifest V3 插件，不是 React/Vite 演示页面。插件会在真实网页上抽取正文，使用 Shadow DOM 渲染低干扰阅读层，并保留恢复原网页的能力。

## 安装到 Chrome

1. 克隆仓库并切换到 `develop` 分支：

   ```bash
   git clone https://github.com/ucal9/ADHD.git
   cd ADHD
   git checkout develop
   ```

2. 打开 Chrome，访问 `chrome://extensions`。
3. 打开右上角“开发者模式”。
4. 点击“加载已解压的扩展程序”。
5. 选择本仓库根目录（包含 `manifest.json` 的目录），或先解压发布 ZIP 后选择解压目录。
6. 打开新浪文章或其他普通文章页面，点击工具栏中的“缓读”图标。

Chrome 内置页面（`chrome://`、Chrome Web Store 等）不能注入 content script，这是浏览器的安全限制。

## 真实功能

- MV3 content script 运行在当前网页，不使用跨域 iframe；
- Readability + 站点适配器抽取真实正文；
- 新浪文章页优先定位 `#article`，阅读层保留标题、日期来源、段落和表格；文末特别声明随弹窗横幅隐藏；
- 排版、字体、底色、内容宽度和间距实时生效；
- 广告、侧栏、评论、浮层，以及视频/动画/无意义图片可独立降噪；
- 自动播放媒体可以暂停，关闭阅读模式后恢复记录的播放状态；
- “排版 / AI 内容助手 / 动态降噪”在同一详细面板中展开，不跳转新页面；
- AI 摘要、简化段落长句、高亮核心信息、智能屏蔽拿不准的图片均需用户主动开启，且通过 background service worker 转发；
- 简化段落长句会改写正文并保留逐字撤销，高亮核心信息用 CSS Highlight API 实现、不改动任何 DOM。

## AI 后端（可选）

核心阅读功能（正文抽取、排版、降噪、阅读层）完全不依赖后端。只有 AI 功能需要它：**生成摘要**、**简化段落长句**、**高亮核心信息**、以及智能屏蔽里对拿不准图片的二次判定。后端不启动时这些会报连接失败；摘要/改写/高亮会回滚开关，图片智能屏蔽则保持本地已藏住的无意义图，不把开关关掉。其余功能不受影响。

密钥只存在后端，插件前端从不接触 —— 所有请求由 background service worker 转发到 `http://localhost:8000`。

### 首次配置

```bash
cd backend
cp .env.example .env
```

编辑 `.env`，二选一填写鉴权方式：填 `ANTHROPIC_API_KEY` 走 Anthropic 官方 API，或同时填 `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN` 走内部/自建网关（网关模式优先）。占位符原样留着等于没配置，启动后调用会返回 500。

创建虚拟环境并安装依赖：

```bash
python3 -m venv venv && source venv/bin/activate && pip install -r requirements.txt
```

### 日常启动

```bash
cd backend && source venv/bin/activate && uvicorn main:app --port 8000 --reload
```

`uvicorn` 只装在 `backend/venv/` 里，不在系统 PATH 上。新开终端窗口不继承激活状态，直接敲 `uvicorn` 会报 `command not found`。没激活时用完整路径：

```bash
cd backend && venv/bin/uvicorn main:app --port 8000 --reload
```

`--reload` 让改完后端代码自动重启。**不加这个参数时，改了 Python 代码必须手动重启进程**，否则跑的还是旧代码 —— 典型症状是接口一直返回早已删掉的旧报错。

看到 `Application startup complete` 表示就绪。报 `Address already in use` 说明 8000 已被占用，先停掉旧进程：

```bash
lsof -nP -iTCP:8000 -sTCP:LISTEN
```

拿到 PID 后 `kill <PID>`，或者在原来那个终端按 `Ctrl-C`。

### 验证

```bash
curl -s http://127.0.0.1:8000/healthz
```

接口连通性（不消耗 LLM 额度的形状检查请查 `/docs`）：

```bash
curl -s -X POST http://127.0.0.1:8000/v1/ai/summarize -H 'Content-Type: application/json' -d '{"device_id":"local-test","text":"这是一段用于连通性验证的测试正文。","mode":"summary"}'
```

### 接口说明

`POST /v1/ai/summarize` 按 `mode` 分四种任务，共用同一条 LLM 调用路径：

| mode | 用途 | 响应字段 |
| --- | --- | --- |
| `summary` | 要点摘要 | `result`：纯文本 |
| `simplify` | 简化段落长句 | `data.paragraphs`：`[{i, text}]`，`i` 是请求里的段落编号 |
| `keyinfo` | 高亮核心信息 | `data.spans`：`[string]`，逐字取自原文的片段 |
| `imagenoise` | 智能屏蔽拿不准的图片 | `data.keep`：`[number]`，应恢复显示的图片编号 |

`result` 与 `data` 互斥。结构化模式在服务端就完成 JSON 解析和形状校验，模型输出跑偏时直接返回 502，前端只需处理成功/失败两种情况。按 `device_id` 限流，超限返回 429。正文内容不落地：不写数据库，日志里也只记长度不记内容。

不要把 `.env` 或任何密钥提交到仓库。

## 目录结构

```text
manifest.json          # Chrome MV3 入口
src/                    # content script、面板、阅读层和站点适配器
vendor/readability.js   # 正文抽取依赖
backend/                # 可选 AI 服务（摘要 / 简化段落 / 高亮核心信息）
demo-app/               # 原 React/Vite 演示，不参与插件安装
legacy-extension/       # 历史归档，不参与当前插件运行
```

`demo-app/` 仍可独立运行用于 UI 开发：

```bash
cd demo-app
pnpm install
pnpm dev
```

## 打包发布

发布包只包含 Chrome 扩展运行所需的根目录文件，不包含 React 演示、历史归档、本地虚拟环境或 AI 密钥。可使用：

```bash
./scripts/package-extension.sh
```

生成的 ZIP 位于 `release/`，解压后即可按上面的方式加载到 Chrome。
