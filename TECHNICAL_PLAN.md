# 缓读 2.0 技术方案

## 1. 目标与范围

本方案解决三个问题：

1. 一级菜单进入二级配置时不跳转页面，改为在同一配置面板内展开，并允许多个模块同时展开，面板高度随内容增长。
2. 将当前只有演示状态的 UI 接入真实的网页阅读能力：正文抽取、排版重构、内容降噪、媒体控制、设置即时生效和可逆恢复。
3. 将模拟文章替换为真实网页运行场景，优先适配新浪页面：
   [`k.sina.com.cn/article_7879849863_1d5acf78706801uwyo.html`](https://k.sina.com.cn/article_7879849863_1d5acf78706801uwyo.html)

本项目仍然是阅读辅助工具，不做医疗诊断、专注力评分、摄像头/眼动识别，也不默认把正文上传给 AI。

## 2. 当前实现与问题定位

### 2.1 菜单交互

当前 `src/App.tsx` 使用 `activeModule` 表示当前二级模块，并通过条件渲染在 `FirstLevelPanel`、`TypographyModule`、`AiModule` 和 `NoiseModule` 之间整体替换。这会造成：

- 二级菜单替换一级菜单，用户失去上下文；
- 返回操作依赖单独的“返回”按钮；
- 面板高度不能随着多个模块同时打开而自然增长。

### 2.2 功能状态

当前文章内容来自 `originalParagraphs` 和 `easyParagraphs` 常量。开关只改变 React state 和模拟文章的 CSS/文案，不读取当前浏览器页面，也不修改真实 DOM。

### 2.3 运行场景

此前根目录是 React/Vite 演示页面。它可以展示产品交互，但无法安全地把任意新浪页面放进 iframe 后操作：跨域页面受到同源策略、响应头、CSP 和站点脚本隔离限制，父页面不能读取或重构 iframe 内的正文。

当前实现已将真实 Chrome Manifest V3 扩展提升到仓库根目录，`demo-app/` 仅保留为可选的 React/Vite 视觉预览。扩展 content script 运行在用户当前页面上下文中，直接完成真实页面接入。

## 3. 目标架构

```text
Chrome 当前页面
    │
    ├─ content script: PageAdapter + ReaderEngine + MediaController
    │      ├─ 读取页面 DOM（只读）
    │      ├─ 克隆 body / article
    │      ├─ 抽取与清理正文
    │      └─ Shadow DOM 渲染阅读层
    │
    ├─ React 面板：AccordionPanel
    │      └─ 通过 chrome.runtime.sendMessage 下发设置
    │
    ├─ background service worker
    │      └─ 转发 AI 请求，避免宿主页面 CSP 影响
    │
    └─ FastAPI AI 服务（可选）
           └─ 仅在用户同意后接收必要文本
```

建议的代码边界：

```text
manifest.json
src/
├── background.js               # MV3 service worker 与 AI 请求转发
├── content.js                  # 页面入口和消息编排
└── modules/
    ├── reader-layer.js         # 阅读层生命周期、撤销和滚动同步
    ├── sina-adapter.js         # 新浪文章页规则
    ├── article-locator.js      # Readability + 选择器兜底
    ├── noise-filter.js         # 克隆体降噪
    ├── panel-ui.js             # Shadow DOM 设置面板与内嵌下拉菜单
    └── ...                     # 设置、媒体、AI、统计等模块
```

根目录就是接入真实网站后的可发布扩展产物；`demo-app/` 可以继续独立运行作为开发预览，避免把“演示页面 DOM”误当成真实网页适配层。

## 4. 一级/二级菜单改造

### 4.1 状态模型

删除 `activeModule` 的“单页路由”语义，改为可同时展开的状态：

```ts
type ModuleId = "typography" | "ai" | "noise";
type ExpandedModules = Record<ModuleId, boolean>;

const [expanded, setExpanded] = useState<ExpandedModules>({
  typography: false,
  ai: false,
  noise: false,
});
```

点击一级行只切换对应值，不替换面板：

```ts
const toggleModule = (id: ModuleId) => {
  setExpanded(current => ({ ...current, [id]: !current[id] }));
};
```

### 4.2 组件结构

`FirstLevelPanel` 继续负责面板头部、总开关、预设和底部操作；每个 `ModuleRow` 下方直接渲染自己的 `ModuleSection`：

```tsx
<ModuleRow
  expanded={expanded.typography}
  onClick={() => toggleModule("typography")}
  aria-controls="module-typography"
/>
{expanded.typography && (
  <ModuleSection id="module-typography">
    <TypographyControls ... />
  </ModuleSection>
)}
```

`TypographyModule`、`AiModule`、`NoiseModule` 应拆成“控制内容组件”，不再返回带有独立返回按钮的完整 `aside`。这样一级行、开关和二级配置始终在同一滚动容器内。

### 4.3 可访问性与布局

- 一级行使用 `button` 或 `role="button"`，提供 `aria-expanded` 和 `aria-controls`；
- 二级区域使用 `role="region"`，标题通过 `aria-labelledby` 关联；
- CSS 使用 `max-height`、`overflow: clip` 和 `transition: max-height 160ms ease`；内容高度变化时由 `scrollHeight` 或 CSS `grid-template-rows: 0fr/1fr` 控制；
- `.plugin-panel` 保留固定宽度和 `max-height: min(760px, calc(100vh - 96px))`，超出视口时只滚动面板，不推动网页布局；
- 展开/收起不改变页面文章滚动位置；
- 键盘 Enter/Space 可展开，Tab 焦点不能被隐藏内容截断；
- 同时展开三个模块时，面板仍能滚动到当前获得焦点的控件。

## 5. 真实网页阅读引擎

### 5.1 页面接入方式

使用 Chrome MV3 content script，而不是 iframe：

```json
{
  "content_scripts": [{
    "matches": ["https://*.sina.com.cn/*", "https://*.sina.cn/*"],
    "js": ["src/content/content.js"],
    "run_at": "document_idle"
  }]
}
```

开发阶段可增加用户指定域名的通用匹配，但发布版本应尽量收窄权限。页面入口、插件面板和阅读层使用两个独立 Shadow DOM host，避免页面 CSS 污染插件 UI，也避免插件样式污染原网页。

### 5.2 正文抽取流水线

```text
document.cloneNode(true)
    ↓
站点适配器定位候选正文
    ↓ 未命中
Readability 解析克隆体
    ↓ 未命中
<article>/<main>/文本密度算法兜底
    ↓
保留标题、段落、列表、表格、图片、引用、免责声明
    ↓
生成 ArticleModel + 原文节点映射
```

必须只在克隆体上删除节点。原页面 DOM 不做 `remove()` 或 `display:none`，这样关闭阅读模式可以立即恢复，且不会破坏原站点的 grid/flex 布局。

`ArticleModel` 至少包含：

```ts
type ArticleModel = {
  url: string;
  title: string;
  author?: string;
  publishedAt?: string;
  source: "sina" | "generic";
  blocks: ArticleBlock[];
  sourceSelector: string;
};
```

每个 block 保存 `sourceIndex` 或 `data-reader-block-id`，为“缓读版/原文”切换、对应原文和错误恢复提供映射，不允许 AI 静默删除事实、价格、单位、引用或免责声明。

## 6. 新浪页面适配方案

对给定页面的只读结构检查显示：

- 页面标题：`.main-title`；
- 文章外层：`#article_content`；
- 正文主体：`#article`，位于 `.article-content-left`；
- 正文包含大量 `<p>`、粗体段落、引用编号、图片和比较表格；
- 广告位：`.sinaads`、`.ad`、`.right-side-ad`；
- 右侧模块：`.article-content-right`、`.news-read-comment`、视频和推荐内容；
- 评论区：`.blk-comment`、`#bottom_sina_comment`；
- 页面浮动工具栏：`.page-right-bar`；
- 原文免责声明位于正文末尾的 `.article-notice`，必须保留。

适配器伪代码：

```ts
const sinaArticleSelectors = {
  root: ["#article", ".article-content-left .article"],
  title: [".main-title", "h1"],
  author: [".author", "[data-sudaclick*=author]"],
  noise: [
    ".sinaads", ".ad", ".right-side-ad", ".article-content-right",
    ".blk-comment", "#bottom_sina_comment", ".page-right-bar",
  ],
  media: ["video", "audio", "iframe", ".news-video-miaopai"],
};
```

处理原则：

1. 文章正文默认从 `#article` 提取，不复制整页导航、广告和右侧推荐到阅读层；
2. 表格 `table`、图片和正文末尾的特别声明作为内容 block 保留；
3. `cms-style="font-L strong-Bold"` 只转换为标题/强调语义，不依赖新浪私有 CSS；
4. 参考链接和外链默认保留，但在阅读层中使用 `target="_blank"` 和 `rel="noopener noreferrer"`；
5. 评论、右侧推荐、广告和浮动工具不进入正文阅读层；
6. 页面通过 `MutationObserver` 动态插入广告或推荐时，只更新阅读层的克隆体，不扫描并删除原页面节点。

## 7. 真实设置功能

### 7.1 排版

- 使用 CSS custom properties 控制字号、行高、段间距、字间距、最大阅读宽度和字体；
- 在阅读层中重写正文基础样式，保留标题、表格、图片和引用的语义层级；
- 通过 `ResizeObserver` 和滚动位置锚点保持切换前后的阅读位置；
- 内容宽度改变时，以当前可见 block 的 `data-reader-block-id` 和相对偏移量恢复位置。

### 7.2 动态降噪

- “隐藏侧边栏/评论/广告/浮层”只作用于阅读层克隆体；
- “暂停自动播放”调用可控媒体的 `pause()`，并在阅读模式关闭时不强制恢复用户未主动播放的媒体；
- “屏蔽动画”注入 `prefers-reduced-motion` 等价 CSS，关闭 transition、animation 和自动轮播；
- 视频保留封面和主动播放按钮，不默认删除视频内容；
- 每个降噪类别独立开关，并回报实际隐藏节点数量和失败原因。

### 7.3 AI 内容助手

本地规则先完成拆段、标题识别、重复标点和空白清理；只有用户明确同意后才发送文章片段到 AI 服务。

调用链：

```text
React 面板
  → chrome.runtime.sendMessage
  → background service worker
  → POST /v1/ai/summarize
  → 返回摘要/改写结果
  → 按 block 映射回阅读层
```

AI 响应必须包含来源 block id，失败时保留原文并显示可重试状态。后端不得持久化文章正文；请求日志只记录耗时、状态码和匿名 request id。

## 8. 数据模型与消息协议

```ts
type ReaderSettings = {
  enabled: boolean;
  typography: {
    fontSize: number;
    lineHeight: number;
    paragraphGap: number;
    contentWidth: "narrow" | "medium" | "wide";
    fontFamily: string;
    background: string;
  };
  ai: {
    enabled: boolean;
    simplify: boolean;
    summarize: boolean;
    highlight: boolean;
    consentVersion?: string;
  };
  noise: {
    enabled: boolean;
    sidebar: boolean;
    comments: boolean;
    ads: boolean;
    autoplay: boolean;
    animation: boolean;
  };
};
```

最小消息集合：

```text
READER_ENABLE
READER_DISABLE
READER_SET_SETTINGS
READER_TOGGLE_PANEL
READER_REFRESH_ARTICLE
READER_REQUEST_SUMMARY
READER_GET_STATUS
```

设置保存到 `chrome.storage.sync`；文章正文和 AI 结果只存在当前页面会话内，关闭阅读层后释放引用。

## 9. 安全、隐私与合规

- 不使用跨域 iframe 读取新浪正文；
- 只在用户当前页面执行内容脚本，发布时收窄 `matches` 权限；
- 所有外部 HTML 进入阅读层前进行 DOM 白名单清理，禁止执行脚本、事件属性和未知 URL 协议；
- 外链仅允许 `http:`/`https:`，禁止 `javascript:`、`data:` 导航；
- AI 默认关闭，发送前显示数据说明、目的和取消入口；
- 不记录完整 URL 查询参数、正文、评论或用户身份；
- 保留新浪页面的作者信息、引用、价格和免责声明，不改变文章立场或限定条件；
- 增加内容来源标识：这是阅读辅助重排，不是新浪原页面，也不是事实核验结果。

## 10. 分阶段实施

### Phase 0：菜单交互（1 天）

- `activeModule` 改为 `expandedModules`；
- 把三个二级组件改成内嵌 section；
- 完成 `aria-expanded`、键盘操作、面板滚动和展开动画；
- 验收：三个模块可同时展开，面板不跳页、不改变文章滚动位置。

### Phase 1：真实页面接入（2–3 天）

- 整理根目录 MV3 extension shell 和 content script；
- 实现通用 extractor、Shadow DOM 阅读层和滚动锚点；
- 实现 `SinaAdapter`，覆盖给定新浪页面；
- 验收：在该 URL 上能够抽取 `#article`，保留表格/图片/免责声明，关闭后原页面无 DOM 变化。

### Phase 2：本地功能引擎（2–3 天）

- 接入排版 CSS、降噪克隆、媒体暂停、动画屏蔽和设置持久化；
- 增加 MutationObserver 和失败回退；
- 验收：每个开关即时生效，原文/缓读版可切换，刷新或关闭模式可恢复。

### Phase 3：AI（2–4 天）

- 接入 background → FastAPI 链路；
- 增加同意弹窗、超时、429、网络失败和结果来源映射；
- 验收：未同意不联网，失败不破坏阅读层，摘要和改写可以撤销。

### Phase 4：发布与回归（1–2 天）

- Chrome MV3 打包、权限审查和 README 更新；
- 在新浪、普通博客、新闻站和无正文页面上回归；
- 运行 TypeScript、单元测试和 Playwright 浏览器测试。

## 11. 验收标准

- 菜单：同一面板内展开/收起，支持多项同时展开，窄屏不溢出；
- 页面：给定新浪页面正文抽取成功率 ≥ 95%，标题、段落、表格、图片、免责声明完整；
- 可逆：阅读模式关闭后原页面 DOM、滚动位置和媒体状态不被破坏；
- 降噪：广告、评论、右侧推荐、浮动工具与正文内容独立控制；
- 媒体：自动播放可暂停，用户主动播放的视频不被静默删除；
- AI：无用户同意不发送正文，失败有提示且原文可恢复；
- 工程：`pnpm typecheck`、`pnpm build` 和自动化测试通过，扩展权限仅覆盖产品所需站点。

## 12. 主要风险与决策

| 风险 | 决策 |
|---|---|
| 用 iframe 加载新浪页面无法可靠读取 DOM | 使用 content script + Shadow DOM |
| 新浪 DOM/CSS 可能变更 | 通用 extractor + 站点适配器 + 选择器健康检查 |
| 动态广告不断插入 | 只观察原页面变化，重新生成阅读层克隆，不修改原页面 |
| AI 改写改变语义 | block 级来源映射、原文切换、显式同意和失败回退 |
| 面板展开遮挡内容 | 固定宽度、最大高度、内部滚动和焦点自动滚动 |
