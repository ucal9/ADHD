# 缓读 2.0

缓读是一个面向 ADHD、阅读障碍和感官过载场景的低干扰阅读界面演示。它展示同一篇中文文章在原始网页与缓读模式之间的即时切换、排版调整、内容简化、动态降噪和前后对比。

## 直接运行

需要 Node.js 18+ 和 pnpm（也可以使用 npm）。

```bash
git clone https://github.com/ucal9/ADHD.git
cd ADHD
pnpm install
pnpm dev
```

打开终端提示的本地地址即可。生产构建：

```bash
pnpm typecheck
pnpm build
pnpm preview
```

如果使用 npm：

```bash
npm install
npm run dev
```

## 项目结构

- `src/App.tsx`：浏览器阅读场景、缓读面板和交互状态
- `src/index.css`：页面与面板样式
- `src/imports/`：界面使用的 SVG 资源
- `vite.config.ts`：标准 Vite 开发与生产配置
- `legacy-extension/`：原 Chrome 插件和 FastAPI 后端，仅作为历史备份，不参与根目录构建

## GitHub 分支

`develop` 分支以本 React/Vite 应用为默认项目。推送后，GitHub 用户下载仓库即可按上面的命令运行；浏览器不能直接运行 TypeScript/React 源码，需要先安装依赖并启动 Vite，或使用 `pnpm build` 后部署 `dist/` 静态产物。
