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
- 新浪文章页优先定位 `#article`，保留标题、段落、图片、表格和免责声明；
- 排版、字体、底色、内容宽度和间距实时生效；
- 广告、侧栏、评论、浮层和视频可独立降噪；
- 自动播放媒体可以暂停，关闭阅读模式后恢复记录的播放状态；
- “排版 / AI 内容助手 / 动态降噪”在同一详细面板中展开，不跳转新页面；
- AI 摘要需要用户主动开启，且通过 background service worker 转发。

## AI 后端（可选）

核心阅读功能不依赖后端。需要 AI 摘要时，在 `backend/` 创建 `.env`，参考 `backend/.env.example`：

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --host 127.0.0.1 --port 8000
```

不要把 `.env` 或 API 密钥提交到仓库。

## 目录结构

```text
manifest.json          # Chrome MV3 入口
src/                    # content script、面板、阅读层和站点适配器
vendor/readability.js   # 正文抽取依赖
backend/                # 可选 AI 摘要服务
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
