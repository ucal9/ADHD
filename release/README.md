# 缓读插件版本

- `calmread-chrome-extension-0.2.6-noise-video-scope.zip`：当前版本。在 0.2.5 控件与诊断优化基础上，调整新浪动态降噪范围，视频动画同时覆盖正文和右侧视频推荐，并移除阅读层剩余时间显示。

- `calmread-chrome-extension-0.2.4-ui-polish.zip`：上一版 UI 参考。在 0.2.3 直达入口基础上更新启用态 Icon、浅黄色预设选中态、预设胶囊布局和入口面板文案。
- `calmread-chrome-extension-0.2.3-direct-action.zip`：上一版参考。移除浏览器 Popup，工具栏点击由 service worker 直接打开网页内入口面板；已打开页面会按需注入内容脚本。
- `calmread-chrome-extension-0.2.2-presets.zip`：上一版参考。工具栏点击通过 Popup 转发到网页内入口面板。
- `calmread-chrome-extension-0.2.1-toolbar-page3.zip`：上一版回退参考。工具栏点击后直接打开网页内页面 3，点击“详细配置”进入页面 2，返回按钮回到页面 3。

发布包都可以在 `chrome://extensions` 中通过“加载已解压的扩展程序”安装；安装前先解压 ZIP，并确保一次只加载一个版本目录。
