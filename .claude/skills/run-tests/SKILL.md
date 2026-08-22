---
name: run-tests
description: 运行缓读扩展的自动化测试（语法与清单一致性、后端解析单元测试、headless 浏览器行为测试）。在修改 src/modules/、backend/ 或 manifest.json 之后、以及提交之前使用。
---

# 缓读 · 自动化测试

一条命令跑全部：

```bash
tests/run-tests.sh
```

失败时退出码非 0，并只打印失败项的细节。单跑某一层用 `--only`：

```bash
tests/run-tests.sh --only syntax
```

## 三层结构

`syntax` 最快，无外部依赖。所有 `src/**.js` 过 `node --check`，`backend/**.py` 过 `ast.parse`，再校验 `manifest.json` 的模块列表与 `background.js` 的 `CONTENT_SCRIPT_FILES` 完全一致（含顺序），最后扫一遍冲突标记。

`backend` 是纯函数单元测试，不联网、不消耗 LLM 额度。集中在 `services/llm_client.py` 的输出解析容错上 —— 那里是线上 502 的高发区。

`browser` 在 headless Chrome 里跑 `tests/browser/*.html`。这些页面 mock 掉 `chrome.runtime` / `chrome.storage`，用固定的假响应驱动真实模块，验证 DOM 行为。需要真实浏览器是因为 CSS Custom Highlight API 和 Shadow DOM 无法在 jsdom 里可靠模拟。找不到 Chrome 时该层跳过而非失败。

## 改代码后该跑哪层

改了 `backend/services/llm_client.py` 的解析逻辑 → `backend`。改了 `src/modules/ai-enhance.js`、`ai-card.js` 或阅读层与 AI 的交互 → `browser`。新增或重排 content script 模块 → `syntax`（这一层专门卡住 manifest 与 background 不同步的问题）。提交前跑全部。

## 新增浏览器测试页

放到 `tests/browser/` 下，遵守三条约定即可被 runner 自动发现：跑完置 `window.__done = true`；有断言失败置 `window.__failed = true`；逐条结果写进 `#log` 的 `textContent`。

引用模块用 `../../src/modules/xxx.js`。必须通过 HTTP 打开（runner 会自动起临时服务），不能用 `file://` —— 每个 file URL 是独立 origin，模块间会被跨域拦掉。

mock 的假响应要贴近真实畸形输出。`tests/browser/ai-enhance.html` 里故意放了一个定位不到的片段和一个被 `<img>` 保护的段落，就是为了让"部分失败"和"跳过"这两条路径也被覆盖到。

## 已知的环境限制

后端与 LLM 网关的真实连通性不在测试覆盖范围内。网关模式故意用 `trust_env=False` 绕开系统代理直连（避免 Clash 之类的代理断开内网隧道），因此在受限网络里会 DNS 失败。这属于环境问题，需要手工验证：

```bash
curl -s http://127.0.0.1:8000/healthz
```
