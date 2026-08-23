# 缓读插件版本

- `calmread-chrome-extension-0.2.11-panel-scroll-switch.zip`：当前版本。详细配置改细分时保持面板滚动位置。一级关闭时二级只置灰、旋钮位置不变，仍可点并把一级带起来；再开一级时保持二级开闭，只从灰色恢复颜色。一级开启时关闭二级只把旋钮拨到左侧，轨道为浅黄、不置灰。
- `calmread-chrome-extension-0.2.9-entry-modes.zip`：上一版参考。去掉入口总开关；入口用原来的胶囊选择「默认模式」（选中全开，再点取消则回到点选前的设置）或进入「详细配置」（仅首次/从未激活时套全关模板）。`enabled` 由三个一级派生；二级可在一级关闭时单独打开并只带起对应一级。仅开排版时样式作用在真实页面。
- `calmread-chrome-extension-0.2.8-headline-media.zip`：上一版参考。四开关全开时阅读层保留标题和日期来源，作者与日期同一行；「屏蔽视频、动画和图片」会去掉配图/视频壳并让后文补位；文末「特别声明」归入隐藏弹窗横幅。
- `calmread-chrome-extension-0.2.7-fullpage-noise.zip`：上一版参考。动态降噪未全开时作用在真实页面上（不拆节点，保留原布局）；四个细分开关全开时才进入正文阅读层。
- `calmread-chrome-extension-0.2.6-noise-video-scope.zip`：上一版参考。调整新浪动态降噪范围，视频动画同时覆盖正文和右侧视频推荐，并移除阅读层剩余时间显示。

- `calmread-chrome-extension-0.2.4-ui-polish.zip`：上一版 UI 参考。在 0.2.3 直达入口基础上更新启用态 Icon、浅黄色预设选中态、预设胶囊布局和入口面板文案。
- `calmread-chrome-extension-0.2.3-direct-action.zip`：上一版参考。移除浏览器 Popup，工具栏点击由 service worker 直接打开网页内入口面板；已打开页面会按需注入内容脚本。
- `calmread-chrome-extension-0.2.2-presets.zip`：上一版参考。工具栏点击通过 Popup 转发到网页内入口面板。
- `calmread-chrome-extension-0.2.1-toolbar-page3.zip`：上一版回退参考。工具栏点击后直接打开网页内页面 3，点击“详细配置”进入页面 2，返回按钮回到页面 3。

发布包都可以在 `chrome://extensions` 中通过“加载已解压的扩展程序”安装；安装前先解压 ZIP，并确保一次只加载一个版本目录。
