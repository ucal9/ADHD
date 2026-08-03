## 三、技术可行性（How）

### 3.1 技术架构

| 层级 | 技术选型 | 详细信息 |
|---|---|---|
| 前端/客户端 | Chrome Extension Manifest V3（content_scripts + Shadow DOM + chrome.storage.sync） | 已在 demo.html 模拟环境和真实网站（如 ruanyifeng.com 博客文章页）验证：正文定位、降噪清理、主题/字号/宽度切换均正常生效，原页面 DOM 不受污染 |
| 正文抽取 | Mozilla Readability.js v0.5.0（本地引入） | 已验证对文档克隆体调用 `parse()`，取输出内容的特征文本回原始 DOM 定位真实节点；解析失败或匹配不到节点时，自动降级为语义标签（article/main）+ 自研文本密度算法（文本长度 ×(1-链接占比) 打分） |
| 降噪清理 | 本地 4 组选择器规则（广告/侧边栏/评论/弹窗）+ 云端规则库增量下发 | 本地部分已验证：作用于整页 body 克隆体而非原页面，避免隐藏兄弟节点导致 grid/flex 布局跑位；云端下发为新增能力，客户端按站点域名合并规则，网络失败时用本地缓存兜底 |
| 排版渲染 | 原生 CSSOM + Shadow DOM 样式隔离 | 已验证：`:host { all: initial; }` 重置避免宿主页面样式穿透，主题配色/字号/内容宽度调整均实时生效且不触发原页面重排 |
| 后端服务 | Python + FastAPI 单体服务 | 新增：单进程承载三组独立路由（规则下发/AI 代理/埋点），任一模块调用失败不影响另外两个和前端本地核心功能 |
| 数据库 | PostgreSQL（MVP 阶段可用 SQLite 顶替） | 新增：两张核心表——规则表（按 site_host 存选择器 JSON + 版本号）、埋点事件表（device_id/event_type/site_host/时间戳），不落地用户浏览的正文内容 |
| 第三方服务 | LLM API（AI 摘要/拆句代理调用，优先走 Chrome 内置 AI，不可用再降级到此） | 影石 SDK：不适用（本项目为纯软件浏览器插件，不涉及硬件采集或设备接入） |

**后端只做增值，不做必需**：正文定位、降噪清理、排版渲染完全在前端本地完成，断网也能用。

后端解决三件事：规则集中维护免审核更新、LLM API Key 不能放前端只能代理调用、匿名埋点辅助迭代。

### 3.2 核心技术实现路径

**核心逻辑一：正文定位（找到网页里"正文"在哪）**

1. 数据输入：当前标签页的 `document`（原始 DOM，只读不修改）
2. 处理逻辑：
   ```
   findArticleRoot():
     result ← findArticleRootViaReadability()   // 优先：Readability 辅助定位
     if result found: return result
     return pickBestCandidate()                  // 降级路径

   findArticleRootViaReadability():
     clone ← document.cloneNode(true)             // parse() 会改写文档，必须传克隆体
     parsed ← new Readability(clone).parse()
     若解析失败或无内容 → return null
     取 parsed.content 的前 80 字作为特征文本
     在原始 document 中查找包含该特征文本、DOM 深度最深（最贴近正文本体）的节点
     return 该节点（原始 DOM 的真实引用，带完整 class/结构）

   pickBestCandidate():                          // Readability 不可用/未命中时启用
     候选 ← <article>/<main>/[role="main"]
     若有候选 → 取文本最长者
     否则 → findByTextDensity()：遍历 div/section/article，
            按“文本长度 ×（1 − 链接文本占比）”打分，取最高分节点
   ```
3. 输出结果：原页面中真实存在的正文根节点引用（`articleSourceRoot`）。验证方式：在多个真实站点（如 ruanyifeng.com 博客文章页）人工核对定位到的节点是否确为正文容器，且原始 DOM 未被修改。

**核心逻辑二：降噪清理与沉浸展示（隔离渲染，不碰原页面）**

1. 数据输入：`articleSourceRoot`（正文节点引用）+ 用户当前偏好（`prefs.noiseOptions` 四个开关状态、主题、字号、内容宽度）
2. 处理逻辑：
   ```
   renderReaderLayer():
     记录 articleSourceRoot 相对 document.body 的子节点下标路径 path
     bodyClone ← document.body.cloneNode(true)     // 克隆整个 body 而非只克隆正文，
                                                     // 让广告/侧边栏等平级干扰元素一起被克隆进来
     for each 开启的降噪类别 in [ads, sidebar, comments, banners]:
       用对应 CSS 选择器组在 bodyClone 中 querySelectorAll，逐个 remove()
     按 path 在清理后的 bodyClone 中重新定位出正文节点 clone
     在独立 Shadow DOM 宿主（position:fixed 全屏层）中：
       注入主题配色 / 字号 / 内容宽度对应样式
       挂载 clone 展示
     锁定原页面 document.documentElement 的 overflow，防止背后滚动
   ```
3. 输出结果：用户看到完全隔离于原网页的全屏阅读层，只含清理后的正文，按当前主题/字号/宽度渲染；点击"恢复原网页"即销毁阅读层、解锁滚动。验证方式：对比开启/关闭前后原页面 DOM 是否完全一致（无副作用），以及降噪开关逐一切换时对应元素是否被正确移除/恢复。

**核心逻辑三：后端服务（规则分发 / AI 代理 / 埋点）**

1. 数据输入：插件侧的匿名设备 ID、当前规则库版本号、用户主动触发 AI 功能时提交的正文文本（默认不上传任何正文内容）
2. 处理逻辑：
   ```
   GET  /v1/rules?since=<version>
     查 rules 表中 version > since 的条目（按 site_host 维度）
     返回 { version, rules: [{ site_host, selectors: {ads:[], sidebar:[], comments:[], banners:[]} }] }
     客户端：与本地默认选择器合并，写入 chrome.storage.sync 缓存；
             网络失败时直接用本地缓存或内置默认规则，不阻塞阅读功能

   POST /v1/ai/summarize
     输入 { text, mode: "summary" | "sentence_split" }
     服务端持有 LLM API Key，转发请求到第三方 LLM
     （或按调研文档优先尝试 Chrome 内置 AI，仅客户端不支持时才落到这条云端代理路径）
     按 device_id 做速率限制，防止 API Key 被刷爆
     返回 { result }

   POST /v1/events
     输入 { device_id, event_type, site_host, ts }
     写入 events 表，仅存统计所需字段，不落地正文内容
     返回 { ok: true }
   ```
3. 输出结果：规则库增量 JSON、AI 处理结果字符串、埋点确认。验证方式：本地起 FastAPI + SQLite 跑通三条接口的请求，并确认断网/后端不可用时插件仍可正常阅读（规则用本地缓存、AI 功能置灰、埋点静默失败）。

**是否有现成开源库 / 影石 SDK 支持？**
- 影石 SDK / API 使用点：不适用——本项目为纯软件浏览器插件，不涉及硬件采集或影石设备接入
- 开源库 / 框架：
  - 前端正文抽取：Mozilla Readability.js v0.5.0（MIT 协议，Firefox Reader View 同款库），本地引入不依赖网络请求
  - 后端框架：FastAPI（异步 Web 框架）+ SQLAlchemy（ORM，操作 PostgreSQL/SQLite）+ Pydantic（请求/响应数据校验，FastAPI 内置依赖）
  - 若接入第三方 LLM：使用对应官方 SDK（如 OpenAI Python SDK），避免手写 HTTP 调用

### 3.3 开发计划与风险

| 时间段 | 任务 | 负责人 |
|---|---|---|
| Day1 上午 | 前端：正文定位+面板骨架／后端：FastAPI 骨架+数据表 | 待填 |
| Day1 下午 | 前端：降噪联调+阅读层渲染／后端：规则下发+埋点接口 | 待填 |
| Day1 晚上 | 前端：主题字号排版联调／后端：AI 代理接口+限流 | 待填 |
| Day2 上午 | 前后端联调、真实网站兼容性测试、Demo 打包 | 待填 |

| 风险 | 影响 | 备选方案 |
|---|---|---|
| Readability 定位失败/偏差 | 中 | 自动降级到文本密度算法 |
| 降噪误伤正文内元素 | 中 | 用户可逐类关闭对应开关 |
| 后端在演示现场不可用 | 高 | 核心阅读功能不依赖后端，断网可演示，AI/规则更新置灰+提前录屏备用 |
| LLM API Key 被刷爆 | 中 | 按设备限流+每日总量上限 |
| SPA 路由切换后正文失效 | 低 | MVP 不处理，作为已知限制说明 |
