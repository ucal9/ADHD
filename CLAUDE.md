# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 这是什么

INS_Reader —— 一个 Chrome MV3 插件，在任意网页上叠加一层无干扰阅读层。它定位正文，在页面的*克隆体*上剥离干扰元素（广告/侧边栏/评论/弹窗），再把结果渲染进一个隔离的 Shadow DOM 浮层。原始页面 DOM 从不被修改，因此退出阅读模式是瞬时且安全的。

没有构建步骤，没有 package.json，没有打包工具——这是纯原生 JS，由 manifest 的 `content_scripts` 数组直接加载。没有配置测试套件或 linter。

## 运行 / 测试改动

- **在 Chrome 中**：通过 `chrome://extensions` → 开启开发者模式 → "加载已解压的扩展程序" → 选择仓库根目录，作为未打包插件加载。修改 `src/` 下任意文件或 `manifest.json` 后需要重新加载插件。
- **不用 Chrome**：直接在浏览器打开 `demo.html`。它 mock 了 `chrome.*` API（`chrome.storage.sync`、`chrome.runtime.onMessage` 等）并内置一个假文章页面，因此 `src/content.js` 和所有模块无需修改即可运行。这是除 popup/background 相关改动外最快的迭代方式。
- Chrome 内置页面（`chrome://...`）永远无法注入内容脚本——这是预期限制，不是 bug。

## 架构

**模块加载顺序很重要。** 所有内容脚本模块都挂载到共享的全局命名空间 `window.INS_Reader`（每个文件先 `window.INS_Reader = window.INS_Reader || {}`，再赋值一个属性，例如 `window.INS_Reader.prefsStore`）。模块内部的具名函数统一使用 `INS_` 前缀（如 `INS_render`、`INS_toggle`），挂载到命名空间上的属性名则保持原有的 camelCase（如 `render`、`toggle`）不变。它们作为 `manifest.json` 的 `content_scripts.js` 数组中的独立条目按依赖顺序加载：

```
vendor/readability.js       → 全局 Readability（Mozilla 的库，vendored，不要编辑）
modules/prefs-store.js      → INS_Reader.prefsStore     （无依赖——最底层）
modules/article-locator.js  → INS_Reader.articleLocator （依赖全局 Readability）
modules/noise-filter.js     → INS_Reader.noiseFilter    （依赖 prefsStore）
modules/dom-path.js         → INS_Reader.domPath         （纯函数工具，无依赖）
modules/reader-layer.js     → INS_Reader.readerLayer    （依赖 prefsStore/articleLocator/noiseFilter/domPath）
modules/panel-ui.js         → INS_Reader.panelUI        （依赖 prefsStore/noiseFilter/readerLayer/appController）
content.js                  → INS_Reader.appController  （顶层编排器，把一切串联起来，唯一调用 chrome.runtime.onMessage 的文件）
```

新增模块时，需要把文件加入 `manifest.json` 的 `content_scripts[0].js` 数组中正确的依赖位置——模块加载顺序不是自动处理的。

各模块之间不直接互相调用，只通过这条明确的依赖链；`content.js` 是唯一负责跨模块回调绑定的地方（例如 `readerLayer.setOnHiddenCountChange(panelUI.updateNoiseCount)`）。

**核心渲染流程**（见 `modules/reader-layer.js` 的 `render()`）：
1. `articleLocator.findArticleRoot()` 在*真实*页面 DOM 中找到正文节点（只读，首次运行后缓存）——优先用 Readability.js（解析整个文档的克隆体，再把其输出文本匹配回真实节点，这样原始 class/结构才能保留），如果 Readability 失败或不可信，则降级为语义标签 + 文本密度算法。
2. 克隆**整个 `document.body`**（而不只是正文节点）——这是有意为之：广告、侧边栏、评论组件等干扰元素与正文在 DOM 树中是平级关系，必须存在于克隆体里，降噪选择器才能命中它们。
3. `domPath.getChildIndexPath()` / `resolveChildIndexPath()` 在克隆*之前*把正文节点的位置记录为一条 childNode 下标路径，克隆之后再在清理过的克隆体里重新定位出等价节点（因为克隆会产生全新的节点身份）。
4. `noiseFilter.stripNoiseFromClone()` 按当前启用的降噪选择器分组移除元素——只作用于克隆体，绝不触碰真实页面。
5. 清理后的正文子树被挂载进一个 Shadow DOM 浮层（`:host { all: initial; }` 实现完整样式隔离），主题/字号/宽度设置以内联 `<style>` 应用。

**为什么是"克隆后重新定位"而不是"就地隐藏"：** 直接在真实页面上隐藏兄弟元素（例如给广告加 `display:none`）有可能打乱原网页的 grid/flex 布局。克隆方式则完全不触碰真实 DOM——详见 README 的"设计取舍"一节。

**状态/设置**：`prefsStore` 是用户偏好的唯一数据源，通过 `chrome.storage.sync` 持久化（`STORAGE_KEY = 'ins_reader_prefs_v1'`），使设置能跨设备同步。所有模块都通过 `prefsStore.get()`（同步、内存中）读取当前偏好，而不是把偏好当参数传递。任何对偏好的写入之后，必须调用 `prefsStore.save()`，并重新触发 `appController.applyAll()`（重新渲染阅读层）和/或 `panelUI.render()`（重新渲染设置面板）——这些不是自动响应式的。

**两个独立的 Shadow DOM host** 被挂载到 `document.documentElement`（而不是 `document.body`，以在 body 被替换时依然存活）：`#ins-reader-host`（阅读浮层，z-index `2147483646`）和 `#ins-reader-panel-host`（设置面板，z-index `2147483647`，始终在最上层）。两者被有意设计为独立的 host，这样阅读层重新渲染时面板依然可以保持打开和可交互。

**content.js 的入口**：
- `chrome.runtime.onMessage` 监听 `INS_READER_TOGGLE_PANEL` 消息（由 `popup.js` 在点击工具栏图标/弹出页按钮时通过 `chrome.tabs.sendMessage` 发送）——如果阅读模式尚未启用则先启用，再切换面板显示。
- 脚本加载时，`prefsStore.load()` 从 storage 里解析出偏好，如果之前 `prefs.enabled` 为 true 则自动应用（这样用户开启阅读模式后，翻页/跳转仍能保持开启状态）。

**`background.js` 承担 AI 摘要请求的转发**（不再是空壳）：content script（`ai-client.js`）不会直接 `fetch` 后端，而是通过 `chrome.runtime.sendMessage({ type: 'INS_READER_AI_SUMMARIZE', payload })` 把请求交给 background service worker，由它代为向 `http://localhost:8000/v1/ai/summarize` 发起请求并把结果通过 `sendResponse` 传回。这样做是为了避开部分站点对 content script 发起跨域请求的额外限制，让请求统一从插件自己的特权上下文发出。`background.js` 里的 `onMessage` 监听器返回 `true` 以支持异步 `sendResponse`。popup 的 `default_popup` 仍然优先于 `chrome.action.onClicked`，除了转发 AI 请求之外不需要其他 background 逻辑。

**AI 摘要功能的完整链路**：`content script (ai-client.js)` → `background.js`（转发）→ `backend/`（FastAPI，见 `backend/` 下的 Python 代码）→ 公司内部 LLM 网关或 Anthropic 官方 API。后端只做转发和限流，不落地正文内容。`llm_client.py` 支持两种鉴权模式（网关优先）：网关模式的目标是内网地址，必须显式 `trust_env=False` 绕开本机系统代理直连，否则代理会在给内网目标做 TLS 握手时中途断连（表现为 `httpx.ConnectError(EndOfStream())`，而 `curl` 默认不读系统代理所以"看起来正常"，排查时容易被这个差异误导）；官方 API 模式则保留 `trust_env=True`，因为通常需要代理才能连通境外服务。

## 完整调用关系图

**模块间调用不是自由的多对多，而是一条被 `content.js` 收拢的星形结构**——除 AI 摘要链路外，各功能模块互不直接调用彼此，只经 `content.js`（编排）或直接读写 `prefsStore`（共享状态）联系：

```
popup.js  ──chrome.tabs.sendMessage(INS_READER_TOGGLE_PANEL)──▶  content.js
                                                                     │
                                              onMessage 收到后调用   │
                          ┌──────────────────────────────────────────┤
                          ▼                                          ▼
                 appController.applyAll()                  panelUI.toggle()/render()
                          │                                          │
              ┌───────────┼───────────┐                    用户操作面板控件触发：
              ▼           ▼           ▼                    - 改设置 → prefsStore.save()
      readerLayer.render() ...   prefsStore.save()                 + appController.applyAll()
              │                                             - 点"生成摘要" → aiClient.summarize()
              │ render() 内部依次调用：                              + readerLayer.setSummary()
              ├─ articleLocator.findArticleRoot()（只调一次，结果缓存）
              ├─ domPath.getChildIndexPath()      （克隆前记录正文位置）
              ├─ document.body.cloneNode(true)    （克隆整个 body）
              ├─ noiseFilter.stripNoiseFromClone()（清理克隆体，回调 onHiddenCountChange → panelUI.updateNoiseCount）
              ├─ domPath.resolveChildIndexPath()  （克隆体里找回正文节点）
              └─ readingStats.estimateMinutes()/computeProgress()（渲染阅读时长/滚动进度）
```

**AI 摘要请求的跨进程/跨服务调用链**（唯一穿过 content script 边界的链路）：

```
panel-ui.js  (用户点"生成摘要")
    │  aiClient.summarize(articleText)
    ▼
ai-client.js
    │  chrome.runtime.sendMessage({ type: 'INS_READER_AI_SUMMARIZE', payload })
    ▼                                    ← 跨执行上下文：content script 无法直接
background.js  (service worker)            fetch 后端，因宿主页面 CSP 限制
    │  fetch('http://localhost:8000/v1/ai/summarize')
    ▼
backend/main.py            （CORS + Local Network Access 中间件放行后）
    ▼
backend/routers/ai.py       summarize_endpoint()
    │  ├─ ratelimit.is_allowed(device_id)     （超限直接 429，不再往下调）
    │  └─ services/llm_client.py.summarize()
    ▼
backend/services/llm_client.py
    │  httpx.AsyncClient.post(endpoint, ...)
    ▼
公司内部 LLM 网关 / Anthropic 官方 API
```

响应沿同一条链路原路返回：`llm_client.py` 解析出文本 → `ai.py` 包成 `SummarizeResponse` → `background.js` 的 `sendResponse` → `ai-client.js` 的 `await chrome.runtime.sendMessage(...)` 返回值 → `panel-ui.js` 拿到摘要文本后调用 `readerLayer.setSummary()` + `appController.applyAll()` 重新渲染阅读层。任意一环失败都不会影响核心阅读功能——`readerLayer`/`noiseFilter`/`articleLocator` 这条本地渲染链路完全不依赖网络。

## 约定

- 全篇使用中文注释和 UI 文案——编辑时保持一致。
- 每个模块文件开头都有一段注释说明其职责和依赖关系（或声明无依赖）——新增模块时延续这个模式。
- 绝不能在 `noiseFilter` 或 `articleLocator` 中修改真实页面 DOM——只能操作克隆体或进行只读查询。这是架构的硬性不变量，不是风格偏好。
- 本仓库代码版权归 Insta360 所有（专有，非开源）。每个自研源文件（`src/`、`backend/`，不含 `vendor/`）开头第一行必须是 `Copyright (c) <年份> Insta360. All rights reserved.`——新增文件时延续这个模式。`vendor/readability.js` 保留其原始 Apache-2.0 版权头，不要改动。
