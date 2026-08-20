// Copyright (c) 2026 Insta360. All rights reserved.
// INS_Reader · background service worker
// 图标点击由 popup.html 处理（default_popup 优先级高于 onClicked）。
//
// 承担 AI 摘要的实际网络请求：content script 里的 fetch 会受宿主页面的 CSP
// （如 connect-src 白名单）约束，很多站点会因此直接拦截插件对 localhost:8000
// 的请求；service worker 是独立执行上下文，不受宿主页面 CSP 影响，所以把请求
// 转发到这里执行。
// 调用者：仅 ai-client.js 通过 chrome.runtime.sendMessage({ type: 'INS_READER_AI_SUMMARIZE' })
// 委托请求；本文件转发到 backend/routers/ai.py 的 POST /v1/ai/summarize，
// 结果通过 sendResponse 回传给 ai-client.js。

const AI_API_BASE = 'http://localhost:8000';

async function INS_handleSummarize(payload) {
  const startedAt = performance.now();
  console.log('[INS_Reader][background] 开始处理摘要请求', {
    runtimeId: chrome.runtime.id,
    apiBase: AI_API_BASE,
    textLength: payload && payload.text ? payload.text.length : undefined,
    mode: payload && payload.mode,
    deviceIdPrefix: payload && payload.device_id ? String(payload.device_id).slice(0, 8) : undefined,
  });

  let resp;
  try {
    resp = await fetch(`${AI_API_BASE}/v1/ai/summarize`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.error('[INS_Reader][background] fetch 抛出异常', {
      elapsed: `${Math.round(performance.now() - startedAt)}ms`,
      name: err.name,
      message: err.message,
      stack: err.stack,
    });
    throw err;
  }
  console.log('[INS_Reader][background] fetch 返回', {
    elapsed: `${Math.round(performance.now() - startedAt)}ms`,
    status: resp.status,
    ok: resp.ok,
  });

  const body = await resp.json().catch((err) => {
    console.error('[INS_Reader][background] 响应体解析失败', {
      name: err && err.name,
      message: err && err.message,
    });
    return null;
  });
  if (!resp.ok) {
    const detail = (body && body.detail) || `AI 服务出错（${resp.status}）`;
    console.error('[INS_Reader][background] 后端返回非 200', {
      status: resp.status,
      detail,
      body,
    });
    return { ok: false, status: resp.status, detail };
  }
  if (!body || typeof body.result !== 'string') {
    console.error('[INS_Reader][background] 后端返回 200 但 result 格式异常', {
      bodyType: body === null ? 'null' : typeof body,
      resultType: body && typeof body.result,
    });
    return { ok: false, status: 502, detail: 'AI 服务返回格式异常' };
  }
  console.log('[INS_Reader][background] 摘要成功', {
    elapsed: `${Math.round(performance.now() - startedAt)}ms`,
    resultLength: body.result.length,
  });
  return { ok: true, result: body.result };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type !== 'INS_READER_AI_SUMMARIZE') {
    return;
  }
  console.log('[INS_Reader][background] onMessage 收到摘要消息', {
    runtimeId: chrome.runtime.id,
    senderUrl: sender && (sender.tab ? sender.tab.url : sender.url),
    senderId: sender && sender.id,
    messageKeys: Object.keys(msg || {}),
  });
  INS_handleSummarize(msg.payload)
    .then(sendResponse)
    .catch((err) => {
      console.error('[INS_Reader][background] handleSummarize 最终失败', {
        name: err && err.name,
        message: err && err.message,
        stack: err && err.stack,
      });
      sendResponse({ ok: false, status: 0, detail: err.message || '无法连接 AI 服务' });
    });
  return true; // 告知 Chrome 会异步调用 sendResponse
});
