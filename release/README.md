# 缓读插件版本

- `calmread-chrome-extension-0.2.3-direct-action.zip`：当前版本。移除浏览器 Popup，工具栏点击由 service worker 直接打开网页内入口面板；已打开页面会按需注入内容脚本，面板外点击关闭；总开关、预设和详细配置分别控制当前状态、快速切换和精细调整。
- `calmread-chrome-extension-0.2.2-presets.zip`：上一版参考。工具栏点击通过 Popup 转发到网页内入口面板。
- `calmread-chrome-extension-0.2.1-toolbar-page3.zip`：上一版回退参考。工具栏点击后直接打开网页内页面 3，点击“详细配置”进入页面 2，返回按钮回到页面 3。

两个版本都可以在 `chrome://extensions` 中通过“加载已解压的扩展程序”安装；安装前先解压 ZIP，并确保一次只加载一个版本目录。
