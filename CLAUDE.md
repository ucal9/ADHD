# 缓读 2.0 开发说明

根目录是一个 React 19 + Vite + TypeScript 应用。默认入口为 `src/main.tsx`，主界面在 `src/App.tsx`，样式集中在 `src/index.css`。

## 常用命令

```bash
pnpm install
pnpm dev
pnpm typecheck
pnpm build
```

不要把 `node_modules/`、`dist/`、环境变量或包管理器缓存提交到仓库。`legacy-extension/` 是旧 Chrome 插件和后端的归档，不参与当前根目录的 Vite 构建。

## 交互约定

- 保持界面文案为中文，避免医疗化表达。
- 缓读模式必须可逆，允许用户查看原文并自行调节字号、行距、宽度和降噪选项。
- 优先使用现有的 Lucide 图标和已有 CSS 类，不引入不必要的 UI 框架。
- 修改后至少运行 `pnpm typecheck` 和 `pnpm build`。
