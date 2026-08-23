// Copyright (c) 2026 Insta360. All rights reserved.
// INS_Reader · background service worker
// 工具栏点击直接在当前网页打开入口面板；不使用 default_popup，避免回退到旧的
// 浏览器 Popup 页面。对于扩展安装/更新前就已经打开的页面，按需补注入内容脚本。
//
// 承担 AI 内容助手的实际网络请求：content script 里的 fetch 会受宿主页面的 CSP
// （如 connect-src 白名单）约束，很多站点会因此直接拦截插件对 localhost:8000
// 的请求；service worker 是独立执行上下文，不受宿主页面 CSP 影响，所以把请求
// 转发到这里执行。
// 调用者：仅 ai-client.js 通过 chrome.runtime.sendMessage({ type: 'INS_READER_AI_SUMMARIZE' })
// 委托请求；本文件转发到 backend/routers/ai.py 的 POST /v1/ai/summarize，
// 结果通过 sendResponse 回传给 ai-client.js。
// 后端按 mode 返回 result（summary 纯文本）或 data（simplify/keyinfo 结构化对象），
// 本文件不解释语义，只做形状校验后原样透传。

const AI_API_BASE = 'http://localhost:8000';
const PREFS_STORAGE_KEY = 'ins_reader_prefs_v1';

function INS_errorMessage(error, fallback = '未知错误') {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  if (error && typeof error.message === 'string' && error.message.trim()) return error.message;
  if (error && typeof error === 'object') {
    try {
      const serialized = JSON.stringify(error);
      if (serialized && serialized !== '{}') return serialized;
    } catch (_) {
      // 某些扩展 API 错误对象包含循环引用，退回 String() 仍比直接拼接更明确。
    }
  }
  if (error == null) return fallback;
  const stringified = String(error);
  return stringified === '[object Object]' ? fallback : stringified;
}

function INS_errorRecord(error) {
  return {
    name: error && error.name ? String(error.name) : undefined,
    message: INS_errorMessage(error),
    stack: error && error.stack ? String(error.stack) : undefined,
  };
}

function INS_transportError(error) {
  const message = INS_errorMessage(error);
  if (/failed to fetch|network|load failed|connection refused/i.test(message)) {
    return `无法连接 AI 后端（${AI_API_BASE}），请确认后端已启动并允许本地网络访问`;
  }
  return message || `无法连接 AI 后端（${AI_API_BASE}）`;
}

const TOOLBAR_ICON_PATHS = {
  off: {
    16: 'icons/icon16.png',
    48: 'icons/icon48.png',
    128: 'icons/icon128.png',
  },
  on: {
    16: 'icons/icon-enabled16.png',
    48: 'icons/icon-enabled48.png',
    128: 'icons/icon-enabled128.png',
  },
};

function INS_updateToolbarIcon(enabled) {
  chrome.action.setIcon({ path: enabled ? TOOLBAR_ICON_PATHS.on : TOOLBAR_ICON_PATHS.off }).catch((err) => {
    console.warn('[INS_Reader][background] 工具栏图标更新失败', err);
  });
}

chrome.storage.sync.get([PREFS_STORAGE_KEY], (result) => {
  INS_updateToolbarIcon(Boolean(result[PREFS_STORAGE_KEY]?.enabled));
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'sync' || !changes[PREFS_STORAGE_KEY]) return;
  INS_updateToolbarIcon(Boolean(changes[PREFS_STORAGE_KEY].newValue?.enabled));
});

const CONTENT_SCRIPT_FILES = [
  'vendor/readability.js',
  'src/modules/prefs-store.js',
  'src/modules/sina-adapter.js',
  'src/modules/article-locator.js',
  'src/modules/feasibility.js',
  'src/modules/page-meta.js',
  'src/modules/image-classifier.js',
  'src/modules/noise-filter.js',
  'src/modules/dom-path.js',
  'src/modules/reading-stats.js',
  'src/modules/ai-client.js',
  'src/modules/ai-enhance.js',
  'src/modules/ai-card.js',
  'src/modules/reader-layer.js',
  'src/modules/panel-ui.js',
  'src/content.js',
];

async function INS_openPanelOnTab(tabId) {
  const message = { type: 'INS_READER_TOGGLE_PANEL' };
  try {
    const response = await chrome.tabs.sendMessage(tabId, message);
    if (!response?.ok) throw new Error('content script did not acknowledge panel open');
    return;
  } catch (firstError) {
    // 页面在扩展安装/更新前已经打开时，声明式 content_scripts 尚未运行。
    // activeTab + scripting 允许本次用户点击按需补注入；注入失败则静默结束，
    // 不再打开旧的 Popup 回退界面。
    await chrome.scripting.executeScript({
      target: { tabId },
      files: CONTENT_SCRIPT_FILES,
    });
    const response = await chrome.tabs.sendMessage(tabId, message);
    if (!response?.ok) throw new Error('injected content script did not acknowledge panel open');
  }
}

chrome.action.onClicked.addListener((tab) => {
  if (!tab?.id) return;
  INS_openPanelOnTab(tab.id).catch((err) => {
    console.warn('[INS_Reader][background] 当前页面无法打开缓读面板', {
      tabId: tab.id,
      url: tab.url,
      name: err && err.name,
      message: err && err.message,
    });
  });
});

async function INS_handleSummarize(payload) {
  const startedAt = performance.now();
  console.log('[INS_Reader][background] 开始处理 AI 请求', {
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
      apiBase: AI_API_BASE,
      ...INS_errorRecord(err),
    });
    throw new Error(INS_transportError(err));
  }
  console.log('[INS_Reader][background] fetch 返回', {
    elapsed: `${Math.round(performance.now() - startedAt)}ms`,
    status: resp.status,
    ok: resp.ok,
  });

  const body = await resp.json().catch((err) => {
    console.error('[INS_Reader][background] 响应体解析失败', {
      ...INS_errorRecord(err),
    });
    return null;
  });
  if (!resp.ok) {
    const detail = INS_errorMessage(body && body.detail, `AI 服务出错（${resp.status}）`);
    console.error('[INS_Reader][background] 后端返回非 200', {
      status: resp.status,
      detail,
      body,
    });
    return { ok: false, status: resp.status, detail };
  }
  if (!body || (typeof body.result !== 'string' && (!body.data || typeof body.data !== 'object'))) {
    console.error('[INS_Reader][background] 后端返回 200 但响应体格式异常', {
      mode: payload && payload.mode,
      bodyType: body === null ? 'null' : typeof body,
      resultType: body && typeof body.result,
      dataType: body && typeof body.data,
    });
    return { ok: false, status: 502, detail: 'AI 服务返回格式异常' };
  }
  console.log('[INS_Reader][background] AI 请求成功', {
    elapsed: `${Math.round(performance.now() - startedAt)}ms`,
    mode: payload && payload.mode,
    resultLength: typeof body.result === 'string' ? body.result.length : undefined,
    dataKeys: body.data ? Object.keys(body.data) : undefined,
  });
  return { ok: true, result: body.result, data: body.data };
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
        ...INS_errorRecord(err),
      });
      sendResponse({ ok: false, status: 0, detail: INS_errorMessage(err, `无法连接 AI 后端（${AI_API_BASE}）`) });
    });
  return true; // 告知 Chrome 会异步调用 sendResponse
});
