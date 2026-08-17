// Copyright (c) 2026 Insta360. All rights reserved.
// INS_Reader · AI 客户端模块
// 职责：调用 INS_Reader 后端的 AI 摘要代理接口（后端持有 LLM Key，前端不接触密钥）。
// 依赖 INS_Reader.prefsStore 读取 deviceId。后端不可用时功能整体降级为不可用，
// 不影响正文定位/降噪/排版等核心本地功能。
// 调用者：仅 panel-ui.js 点击"生成摘要"按钮时调用 summarize()。
//
// 实际网络请求不在这里直接 fetch：content script 的 fetch 会受宿主页面 CSP
// （如知乎等站点的 connect-src 白名单）拦截，导致在部分网站上"无法连接 AI 服务"。
// 因此改为通过 chrome.runtime.sendMessage 委托给 background service worker
// 执行（service worker 不受宿主页面 CSP 约束）。demo.html 环境没有 background，
// 用等价的 mock 直接在页面里 fetch。

window.INS_Reader = window.INS_Reader || {};

(function () {
  // 后端调用 LLM 的默认超时是 45s，前端必须留出比它更长的等待时间，
  // 否则后端还在等上游响应，前端已经先把请求判成超时。
  const SEND_MESSAGE_TIMEOUT_MS = 60000;

  function INS_runtimeIdentity() {
    const rt = chrome && chrome.runtime;
    return {
      id: rt && rt.id ? rt.id : '<无 extension id，可能是 demo mock>',
      sendMessageType: rt && typeof rt.sendMessage,
      lastError: chrome && chrome.runtime ? chrome.runtime.lastError : undefined,
    };
  }

  function INS_sendWithTimeout(message) {
    const identity = INS_runtimeIdentity();
    console.log('[INS_Reader][ai-client] 准备 sendMessage', {
      messageType: message.type,
      payloadMode: message.payload.mode,
      textLength: message.payload.text.length,
      deviceIdPrefix: String(message.payload.device_id || '').slice(0, 8),
      runtimeId: identity.id,
      sendMessageType: identity.sendMessageType,
      href: location.href,
      origin: location.origin,
    });

    const startedAt = performance.now();
    const sendPromise = chrome.runtime.sendMessage(message);
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        const elapsed = Math.round(performance.now() - startedAt);
        reject(new Error(`AI 请求超时（${SEND_MESSAGE_TIMEOUT_MS / 1000}s 内 background 未响应，耗时 ${elapsed}ms）`));
      }, SEND_MESSAGE_TIMEOUT_MS);
    });

    return Promise.race([sendPromise, timeoutPromise])
      .then(
        (resp) => {
          const elapsed = Math.round(performance.now() - startedAt);
          const respSummary = resp
            ? {
                ok: resp.ok,
                status: resp.status,
                detail: resp.detail,
                resultLength: typeof resp.result === 'string' ? resp.result.length : undefined,
              }
            : resp;
          console.log('[INS_Reader][ai-client] sendMessage 完成', {
            elapsed: `${elapsed}ms`,
            resp: respSummary,
            lastError: chrome.runtime.lastError,
            runtimeId: INS_runtimeIdentity().id,
          });
          return resp;
        },
        (err) => {
          const elapsed = Math.round(performance.now() - startedAt);
          console.error('[INS_Reader][ai-client] sendMessage 失败/超时', {
            elapsed: `${elapsed}ms`,
            error: err && err.message ? err.message : String(err),
            lastError: chrome.runtime.lastError,
            runtimeId: INS_runtimeIdentity().id,
          });
          throw err;
        }
      )
      .finally(() => clearTimeout(timeoutId));
  }

  async function INS_summarize(text) {
    const { prefsStore } = window.INS_Reader;
    const prefs = prefsStore.get();

    console.log('[INS_Reader][ai-client] 发起摘要请求，正文长度:', text.length, 'origin:', location.origin);

    let resp;
    try {
      resp = await INS_sendWithTimeout({
        type: 'INS_READER_AI_SUMMARIZE',
        payload: { device_id: prefs.deviceId, text, mode: 'summary' },
      });
    } catch (err) {
      console.error('[INS_Reader][ai-client] summarize 请求阶段失败:', {
        name: err && err.name,
        message: err && err.message,
        stack: err && err.stack,
        lastError: chrome.runtime.lastError,
      });
      throw new Error(err && err.message ? err.message : '无法连接 AI 服务，请确认后端已启动');
    }

    if (!resp) {
      console.error('[INS_Reader][ai-client] resp 为空（service worker 可能未响应或已休眠）', {
        lastError: chrome.runtime.lastError,
        runtimeId: INS_runtimeIdentity().id,
      });
      throw new Error('无法连接 AI 服务，请确认后端已启动');
    }
    if (resp.status === 429) {
      throw new Error('请求过于频繁，请稍后再试');
    }
    if (!resp.ok) {
      console.error('[INS_Reader][ai-client] 后端返回失败:', resp.status, resp.detail);
      throw new Error(resp.detail || `AI 服务出错（${resp.status}）`);
    }

    console.log('[INS_Reader][ai-client] 摘要成功，长度:', resp.result.length);
    return resp.result;
  }

  window.INS_Reader.aiClient = {
    summarize: INS_summarize,
  };
})();
