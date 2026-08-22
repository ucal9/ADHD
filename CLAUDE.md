# 缓读 Chrome 扩展开发说明

根目录是 Chrome Manifest V3 插件。`manifest.json` 加载 `src/` 下的 content script、Shadow DOM 阅读层、设置面板和 background service worker；不要把根目录当成 Vite 项目运行。

## 安装与验证

- Chrome：`chrome://extensions` → 开发者模式 → 加载根目录；
- 真实网页：打开新浪文章或普通文章，点击工具栏中的缓读图标；
- 语法检查：`node --check src/content.js` 以及逐个检查 `src/modules/*.js`；
- 后端：在 `backend/` 使用 `uvicorn main:app --port 8000`，只为 AI 摘要提供可选服务。

## 架构约定

- 所有 content script 模块挂载到 `window.INS_Reader`，加载顺序由 `manifest.json` 控制；
- `reader-layer.js` 只在 Shadow DOM 中渲染克隆内容，不能修改真实页面 DOM 结构；
- `sina-adapter.js` 只做新浪页面只读定位和选择器提供，删除动作必须由 `noise-filter.js` 在克隆体执行；
- `panel-ui.js` 的排版、AI、降噪配置在同一个面板中展开，不使用二级页面路由；
- AI 默认关闭，发送正文前必须有用户同意，失败必须保留原文和恢复入口；
- 新站点优先新增适配器，不要把站点选择器散落到通用模块。

`demo-app/` 是独立的 React/Vite 视觉演示，不是插件运行时。
