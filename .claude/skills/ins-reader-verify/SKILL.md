---
name: ins-reader-verify
description: 用 demo.html + preview_* 浏览器工具反复验证 INS_Reader 插件的核心渲染、排版/降噪/AI 模块开关、预设保存等功能，不需要加载真实 Chrome 插件。改完 panel-ui.js / reader-layer.js / prefs-store.js / noise-filter.js 之后应该用这个 skill 走一遍验证。
---

# INS_Reader 功能验证

## 适用范围

覆盖 `demo.html` 能模拟到的部分：核心渲染链路（正文定位/降噪清理/排版应用）+ 设置面板全部交互（两个 Shadow DOM host）。**不覆盖**真实 Chrome 扩展特有行为——popup.js 点击图标、`chrome.action.onClicked`、`chrome.storage.sync` 真实跨设备同步、`background.js` 到后端的真实网络请求。这些必须在 `chrome://extensions` 加载未打包插件手动测。

## 前置：起服务

用 `preview_start` 起 `.claude/launch.json` 里的某个配置（`demo` / `demo-alt` / `demo-verify`，都是 `python3 -m http.server`）。如果报错说另一个会话的 dev server 已经在这个目录跑，换一个配置名而不是去杀别人的进程。

## 打开面板

`demo.html` 没有真的扩展图标，面板入口是模拟的 `chrome.runtime.onMessage` 触发器，**别猜选择器**，先 grep：

```bash
grep -n "onMessage\|_dispatch\|INS_READER_TOGGLE_PANEL" demo.html
```

当前版本是 `#open-panel-btn`，点击后执行 `window.chrome.runtime.onMessage._dispatch({ type: 'INS_READER_TOGGLE_PANEL' })`。

## 两个独立的 Shadow DOM host，标准工具穿不透

- `#ins-reader-host`：阅读浮层（正文渲染结果）
- `#ins-reader-panel-host`：设置面板

`preview_snapshot` / `preview_click` 的 CSS 选择器不会穿透 shadow boundary。要用 `preview_eval` 手动取 `shadowRoot`：

```js
document.getElementById('ins-reader-panel-host').shadowRoot.querySelector('[data-role="..."]')
```

## 面板分两级，先确认当前在哪一级

一级简易视图（`.ins-reader-panel`，没有 `expanded` class）：图标 + 标题 + 一键降噪开关（`data-role="simple-noise-toggle"`，本身就是阅读模式总开关，关闭即直接恢复原网页）合并一行；若已有保存的预设会多出一份"我的预设"列表（`.simple-preset-btn`）；底部是分割线 + 【详细配置 ›】链接（`data-role="expand-btn"`）进入二级。

二级详细配置（`.ins-reader-panel.expanded`）：顶部固定是【‹ 返回】（`data-role="collapse-btn"`，退回一级简易视图，同时会把三个分组的展开状态一起收起）/ 标题 / 【×】（`data-role="close"`，直接关闭面板）。下面是"排版"/"降噪"/"AI 内容助手"三个**各自独立的手风琴分组**（`.nav-row`），点标题行本身（`data-role="group-open-typography"` / `"group-open-noise"` / `"group-open-ai"`）会在原地展开/收起该分组自己的设置内容——**不是互斥手风琴，也不是整页跳转/替换成独立二级页面**，三个分组可以同时展开，没有各自的返回按钮。每个 `nav-row` 右侧还有一个独立的模块总开关（`typography-master-switch` / `noise-master-switch` / `ai-master-switch`），点击只影响该模块是否生效，不会触发展开/收起（事件处理里 `stopPropagation`）。**验证前先查 `panel.className` 是否带 `expanded`、再查对应 `nav-row` 是否带 `open` class**，别假设已经展开——面板每次重新收到 `INS_READER_TOGGLE_PANEL` 都会从头渲染，状态可能被意外重置回一级。

## 头号陷阱：每次状态变化都会整体重渲染

`panelUI.render()` 每次调用都会把 shadow 内容清空重建（`shadow.innerHTML = ''`）。任何在触发点击**之前**拿到的 DOM 引用，点击后就是脱离文档的旧节点——继续读它的 `class`/`value` 不会报错，但读到的是点击前的状态，看起来像是"改了没生效"，其实是引用过期。

```js
// ❌ 错：sw 在 click() 触发重渲染后已经是脱离文档的旧节点
const sw = shadow.querySelector('[data-role="typography-master-switch"]');
sw.click();
sw.classList.contains('on'); // 读到的是点击前的状态，不可信

// ✅ 对：点击后重新查询一次
shadow.querySelector('[data-role="typography-master-switch"]').click();
shadow.querySelector('[data-role="typography-master-switch"]').classList.contains('on');
```

## 头号陷阱之二：直接改 prefsStore 字段不会自动重渲染

`prefsStore.get()` 返回的是内存里的活引用，直接改它的字段（比如 `prefsStore.get().noiseOptions.sidebar = false`）确实会立刻改到数据层，但阅读层**不是响应式的**——不会自动重渲染。真实的面板点击处理器每次改完都会显式跟一句 `prefsStore.save(); appController.applyAll();`（有些地方还加一句 `INS_render()` 重渲面板自己）；如果测试时图省事绕过点击、直接改 `prefsStore.get()` 上的字段，却忘了补这两行，阅读层里显示的还是改之前那次 `render()` 的旧内容——看起来像是"这个开关点了没生效/关了没恢复"，其实只是没有重新渲染，不是产品代码有 bug。

```js
// ❌ 错：只改了数据层，阅读层还是旧的
window.INS_Reader.prefsStore.get().noiseOptions.banners = false;
// ... 这时候读 .ins-reader-article 看到的还是改之前的内容

// ✅ 对：改完数据层，必须补上这两行才算等效于一次真实点击
window.INS_Reader.prefsStore.get().noiseOptions.banners = false;
window.INS_Reader.prefsStore.save();
window.INS_Reader.appController.applyAll();
```

**优先用真实点击**（`shadow.querySelector('[data-noise-key="banners"]').click()`）而不是直接改字段——点击处理器本身就包含了 save+applyAll，不会漏。只有在需要绕过 UI 快速铺垫初始状态（比如批量设成非默认值）时才直接改字段，且改完必须自己补 save+applyAll，不能只改字段就去读渲染结果下结论。

## 验证"总开关关闭 = 回退默认值"类功能的正确顺序

不要只查"关闭后是否等于默认值"——如果本来就没改过设置，默认值和当前值原本就相同，测不出降级逻辑是否真的生效。正确顺序：

1. 打开总开关，把某个值改成**非默认值**（比如字号 18→22）
2. 确认 `window.INS_Reader.prefsStore.get()` 里存的确实是 22（数据层没被误改）
3. 关闭总开关，确认渐染节点的 `getComputedStyle(...)` 变回默认值（18px），但 `prefsStore.get().fontSize` 仍然是 22（说明是"渲染降级"而不是"数据被清空"）
4. 重新打开总开关，确认渲染值恢复成 22

## 两条独立的真相来源，交叉验证

- `window.INS_Reader.prefsStore.get()` —— 持久化的偏好值（数据层）
- 目标节点的 `getComputedStyle(...)` —— 实际渲染效果（视图层）

只查一边容易漏 bug：存对了但没重渲染，或者看起来渲染对了但存错了。两者都查，尤其是"总开关"这类同时影响两层的功能。

## 遇到原生 alert() / confirm() 时怎么办

这些会阻塞同步执行，`preview_eval` 里没法真的弹窗等待用户点——临时替换掉再还原，不要跳过这条验证路径：

```js
const originalAlert = window.alert;
let alertMsg = null;
window.alert = (msg) => { alertMsg = msg; };
/* 触发会调用 alert() 的操作 */
window.alert = originalAlert;
```

`confirm()` 同理，临时替换成返回 `true`/`false` 的假函数，用完立刻还原成 `originalConfirm`。

## 测完要还原 demo 状态

`demo.html` 是拿来反复验证以后新功能的，别把这一轮测试产生的脏数据（临时预设、改过的字号/颜色等）留在里面污染下一次验证：

```js
// 清空测试期间新增的预设（preset-delete 走原生 confirm()）
const originalConfirm = window.confirm;
window.confirm = () => true;
while (shadow.querySelector('.preset-delete')) shadow.querySelector('.preset-delete').click();
window.confirm = originalConfirm;

// 重置测试期间改动的排版值
const prefs = window.INS_Reader.prefsStore.get();
prefs.fontSize = 18; // 或其他被改动过的字段，改回 prefsStore.DEFAULT_PREFS 里的值
window.INS_Reader.prefsStore.save();
window.INS_Reader.appController.applyAll();
```

## 分模块验证清单

- **排版总开关**：关闭 → 二级设置项消失、出现提示文案、渲染值回默认；重新开启 → 恢复此前的自定义值（用上面"总开关关闭"验证顺序）。
- **降噪总开关**：展开"降噪"分组后，4 个子开关（见下一条）**始终显示**（这是与排版模块故意不同的模式——降噪是"始终可见，只是效果被总开关拦掉"，不是"隐藏子设置"）；关闭总开关后**直接退出阅读视图**，显示未经任何处理的真实原网页——`reader-layer.js` 的 `render()` 在可行性判断通过之后、创建阅读层 host 之前会检查 `!prefs.noiseReduction` 并早退（复用"不可行"分支同款的 `INS_remove()` + `content.js` 的 `unlockOriginalPage()`），这是三个模块总开关里**唯一**会导致整体退出阅读模式的（排版总开关见上一条、AI 总开关见下面条目，两者关闭后仍是"降级"模式，阅读层继续存在）。验证要点：`prefs.enabled`/`aiSummary`/`typographyEnabled`/`summaryText`/`highlightHtml` 等其它状态不受影响、不会被清空；`readerLayer.getHiddenCount()` 归零；`document.getElementById('ins-reader-host')` 被移除，`document.documentElement` 的 `overflow` 样式恢复正常（不再是 `hidden`，且退出后不应残留空 `style=""` 属性）。重新打开总开关后阅读层重新出现，之前的排版设置和已生成的 AI 摘要/高亮内容原样恢复、不重新触发 `aiClient.summarize()`/`aiClient.highlight()` 请求。
- **降噪细分开关**（目前只暴露 4 项：`sidebar`/`comments`/`banners`/`video`；`ads`/`marketing`/`pauseAutoplay` 按默认值生效、不作为开关暴露——改动这个范围时同步检查 [README.md](README.md) 里"动态降噪"那一行和 Roadmap 清单是否还在讲旧的五类开关）：**必须双向验证**，只测"打开后隐藏了"不够——每一项都要点两次，用真实点击（`shadow.querySelector('[data-noise-key="sidebar"]').click()`），不要直接改 `prefsOptions` 字段（见上面"头号陷阱之二"）：
  1. 打开该子开关，确认对应元素消失。
  2. 关闭该子开关，确认**同一批元素重新出现**。

  第 2 步要直接检查 `#ins-reader-host` shadow 里 `.ins-reader-article` 的实际内容（比如 `article.querySelectorAll('[class*="comment"]').length`），同时也可以看 `readerLayer.getHiddenCount()` /面板上 `[data-role="noise-count"]` 的总数——[noise-filter.js](src/modules/noise-filter.js) 的 `stripNoiseFromClone(cloneRoot, countScopeRoot)` 现在会把计数严格限定在 `countScopeRoot`（即 [reader-layer.js](src/modules/reader-layer.js) 传入的 `resolvedClone`，也就是实际挂载进 `.ins-reader-article` 的正文子树）内，两者应该始终一致，不再有历史上"总数和实际可见变化对不上"的问题。

  **排查这类"关掉开关元素没恢复"的报告时，第一步永远是确认被测元素到底在不在正文子树里**：`main.article`（或 Readability 定位到的正文根节点）之外、与正文平级的兄弟节点（真实网站的侧边栏列、页头页脚、demo.html 里的 `aside.fake-sidebar`/`fake-aside-right`/`fake-site-nav`/`fake-footer`）**从架构上就永远不会出现在阅读层里**——阅读层只挂载 `resolvedClone`（正文子树）本身，克隆整个 `document.body` 只是为了让降噪选择器能命中平级的干扰节点、以及给 `getHiddenCount()` 提供裁剪范围用的路径基准，并不代表这些平级节点清理前后会在阅读层里"露出来"。所以对着这些页面级"门面"元素测"关闭 sidebar/banners 后应该重新出现"永远会看起来像 bug（元素确实一直不出现，但不是因为没恢复，而是它们本来就不在阅读层的展示范围内，无论开关状态如何）。真正会随开关状态在 `.ins-reader-article` 里出现/消失的，是**正文内部**的同类元素——demo.html 里对应 `sidebar` → `main.article aside.fake-sidebar-inline`（"本文导读"框）、`banners` → `.related-recommend`（"相关推荐"区块）、`comments` → `.comment-section`、`video` → `<video>`。验证脚本示例：

  ```js
  const article = () => document.getElementById('ins-reader-host').shadowRoot.querySelector('.ins-reader-article');
  const panel = () => document.getElementById('ins-reader-panel-host').shadowRoot;
  panel().querySelector('[data-noise-key="sidebar"]').click(); // 关
  article().querySelectorAll('.fake-sidebar-inline').length; // 应为 1（恢复）
  panel().querySelector('[data-noise-key="sidebar"]').click(); // 开
  article().querySelectorAll('.fake-sidebar-inline').length; // 应为 0（重新隐藏）
  ```
- **AI 总开关**：关闭 → 展开"AI 内容助手"分组后只显示提示语（复用 `.ai-hint` class），不显示任何子开关。开启后是 4 个扁平开关——`data-role="ai-summary-switch"`（AI 摘要）与 `data-highlight-key="breakLongParagraphs"/"simplifySentences"/"markKeyInfo"`（拆分长段落/简化复杂长句/标记核心信息），彼此平级，**没有独立的"高亮"总开关或子分组**；再往下是"内容版本"切换（`data-role="content-version-original"` / `"content-version-digest"`，对应原文/缓读版），取代了旧版"生成摘要"/"应用高亮"两个按钮——切到缓读版才会按需触发 `aiClient.summarize()`/`aiClient.highlight()`，切回原文不触发任何请求。
- **保存预设 + 命名弹层**：空名称报错、重名报错、正常保存、Enter 确认、Escape 取消、点遮罩关闭、达到 3 个上限时走原生 `alert()` 而不是打开自定义弹层。
- **应用/删除预设**：`preset-apply` 套用后修改当前设置不应该连带改动已保存的预设（深拷贝校验）；`preset-delete` 走原生 `confirm()`。

## 收尾：给用户看什么

功能性结论（哪些通过、哪些没有）应该基于 `preview_eval` 读到的数据层/视图层结果，而不是单靠截图——截图只能证明"看起来对"，证明不了 `prefsStore` 里存的值对不对。截图适合作为最后给用户看的视觉佐证，配合前面已经用数据验证过的结论一起发。
