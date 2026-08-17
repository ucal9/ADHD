// 缓读 · background service worker
// 图标点击由 popup.html 处理（default_popup 优先级高于 onClicked）。
//
// 承担 AI 摘要的实际网络请求：content script 里的 fetch 会受宿主页面的 CSP
// （如 connect-src 白名单）约束，很多站点会因此直接拦截插件对 localhost:8000
// 的请求；service worker 是独立执行上下文，不受宿主页面 CSP 影响，所以把请求
// 转发到这里执行。ai-client.js 通过 chrome.runtime.sendMessage 委托请求。

const AI_API_BASE = 'http://localhost:8000';

async function handleSummarize(payload) {
  console.log('[缓读][background] 收到摘要请求，准备 fetch:', AI_API_BASE);
  let resp;
  try {
    resp = await fetch(`${AI_API_BASE}/v1/ai/summarize`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.error('[缓读][background] fetch 抛出异常:', err.name, err.message, err);
    throw err;
  }
  console.log('[缓读][background] fetch 返回，status:', resp.status);

  const body = await resp.json().catch((err) => {
    console.error('[缓读][background] 响应体解析失败:', err);
    return null;
  });
  if (!resp.ok) {
    const detail = (body && body.detail) || `AI 服务出错（${resp.status}）`;
    console.error('[缓读][background] 后端返回非 200:', resp.status, detail);
    return { ok: false, status: resp.status, detail };
  }
  console.log('[缓读][background] 摘要成功');
  return { ok: true, result: body.result };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type !== 'HUANDU_AI_SUMMARIZE') return;
  console.log('[缓读][background] onMessage 收到消息，来自:', sender?.tab?.url || sender?.url || '未知');
  handleSummarize(msg.payload)
    .then(sendResponse)
    .catch((err) => {
      console.error('[缓读][background] handleSummarize 最终失败:', err.name, err.message, err);
      sendResponse({ ok: false, status: 0, detail: err.message || '无法连接 AI 服务' });
    });
  return true; // 告知 Chrome 会异步调用 sendResponse
});
