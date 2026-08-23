// Copyright (c) 2026 Insta360. All rights reserved.
// INS_Reader · AI 客户端模块
// 职责：调用 INS_Reader 后端的 AI 接口（后端持有 LLM Key，前端不接触密钥）。
// 依赖 INS_Reader.prefsStore 读取 deviceId。后端不可用时功能整体降级为不可用，
// 不影响正文定位/降噪/排版等核心本地功能。
// 提供三个方法，对应后端的三个 mode：
//   summarize(text)          → string，要点摘要文本；
//   simplifyParagraphs(list) → [{ i, text }]，按传入段落顺序编号的改写结果；
//   extractKeySpans(text)    → [string]，逐字取自原文的重点片段。
// 调用者：panel-ui.js 点击"生成摘要"调用 summarize()；ai-enhance.js 执行
// 简化段落/高亮核心信息时调用后两者。
//
// 实际网络请求不在这里直接 fetch：content script 的 fetch 会受宿主页面 CSP
// （如知乎等站点的 connect-src 白名单）拦截，导致在部分网站上"无法连接 AI 服务"。
// 因此改为通过 chrome.runtime.sendMessage 委托给 background service worker
// 执行（service worker 不受宿主页面 CSP 约束）。demo.html 环境没有 background，
// 用等价的 mock 直接在页面里 fetch。

window.INS_Reader = window.INS_Reader || {};

(function () {
  // 后端调用 LLM 的默认超时是 45s，也允许用户调到 90s；前端必须留出比它更长的等待时间，
  // 否则后端还在等上游响应，前端已经先把请求判成超时。
  const SEND_MESSAGE_TIMEOUT_MS = 120000;

  function INS_friendlyTransportError(err) {
    const raw = err && err.message ? err.message : '';
    if (/超时|timed?\s*out/i.test(raw)) {
      return 'AI 请求超时，请稍后重试';
    }
    if (/message port|receiving end|could not establish/i.test(raw)) {
      return '无法连接 AI 服务，请重新加载插件或确认后端已启动';
    }
    return '无法连接 AI 服务，请确认后端已启动';
  }

  function INS_detailMessage(detail, fallback) {
    if (typeof detail === 'string' && detail.trim()) return detail;
    if (detail && typeof detail.message === 'string' && detail.message.trim()) return detail.message;
    if (detail && typeof detail === 'object') {
      try {
        const serialized = JSON.stringify(detail);
        if (serialized && serialized !== '{}') return serialized;
      } catch (_) {
        // 仅用于错误展示，不能让序列化失败遮蔽原始请求结果。
      }
    }
    return fallback;
  }

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

  // 三个 mode 共用的请求与错误处理路径，差别只在 payload.mode 和返回值的取法。
  async function INS_request(text, mode) {
    const { prefsStore } = window.INS_Reader;
    const prefs = prefsStore.get();

    console.log('[INS_Reader][ai-client] 发起 AI 请求', {
      mode,
      textLength: text.length,
      origin: location.origin,
    });

    let resp;
    try {
      resp = await INS_sendWithTimeout({
        type: 'INS_READER_AI_SUMMARIZE',
        payload: { device_id: prefs.deviceId, text, mode },
      });
    } catch (err) {
      console.error('[INS_Reader][ai-client] 请求阶段失败:', {
        mode,
        name: err && err.name,
        message: err && err.message,
        stack: err && err.stack,
        lastError: chrome.runtime.lastError,
      });
      throw new Error(INS_friendlyTransportError(err));
    }

    if (!resp) {
      console.error('[INS_Reader][ai-client] resp 为空（service worker 可能未响应或已休眠）', {
        mode,
        lastError: chrome.runtime.lastError,
        runtimeId: INS_runtimeIdentity().id,
      });
      throw new Error('无法连接 AI 服务，请确认后端已启动');
    }
    if (resp.status === 429) {
      throw new Error('请求过于频繁，请稍后再试');
    }
    if (!resp.ok) {
      console.error('[INS_Reader][ai-client] 后端返回失败:', mode, resp.status, resp.detail);
      throw new Error(INS_detailMessage(resp.detail, `AI 服务出错（${resp.status}）`));
    }
    return resp;
  }

  async function INS_summarize(text) {
    const resp = await INS_request(text, 'summary');
    if (typeof resp.result !== 'string') {
      console.error('[INS_Reader][ai-client] summary 响应缺少 result 字符串', {
        resultType: typeof resp.result,
      });
      throw new Error('AI 服务返回格式异常');
    }
    console.log('[INS_Reader][ai-client] 摘要成功，长度:', resp.result.length);
    return resp.result;
  }

  // paragraphs 是段落原文数组，这里按下标编号后拼成 [编号] 正文 交给模型；
  // 返回项的 i 就是传入数组的下标，调用方据此对回具体段落节点。
  async function INS_simplifyParagraphs(paragraphs) {
    const numbered = paragraphs.map((text, i) => `[${i}] ${text}`).join('\n\n');
    const resp = await INS_request(numbered, 'simplify');
    const items = resp.data && Array.isArray(resp.data.paragraphs) ? resp.data.paragraphs : null;
    if (!items) {
      console.error('[INS_Reader][ai-client] simplify 响应缺少 paragraphs 数组', { data: resp.data });
      throw new Error('AI 服务返回格式异常');
    }
    // 编号越界的条目直接丢弃：宁可少改写一段，也不能把结果套到错误的段落上。
    const valid = items.filter(
      (item) => Number.isInteger(item.i) && item.i >= 0 && item.i < paragraphs.length
    );
    if (valid.length === 0) throw new Error('AI 未返回可用的改写结果');
    console.log('[INS_Reader][ai-client] 段落简化成功', {
      requested: paragraphs.length,
      returned: valid.length,
    });
    return valid;
  }

  async function INS_extractKeySpans(text) {
    const resp = await INS_request(text, 'keyinfo');
    const spans = resp.data && Array.isArray(resp.data.spans) ? resp.data.spans : null;
    if (!spans) {
      console.error('[INS_Reader][ai-client] keyinfo 响应缺少 spans 数组', { data: resp.data });
      throw new Error('AI 服务返回格式异常');
    }
    // 后端已约束短词组，前端再做一道轻量校验，避免模型偶尔返回整句造成大面积高亮。
    const valid = spans
      .map((span) => String(span).trim())
      .filter((span) => span.length >= 3 && span.length <= 20)
      .filter((span) => !/[，。！？；：、,.!?;:]/.test(span));
    console.log('[INS_Reader][ai-client] 重点片段提取成功，数量:', valid.length);
    return valid;
  }

  window.INS_Reader.aiClient = {
    summarize: INS_summarize,
    simplifyParagraphs: INS_simplifyParagraphs,
    extractKeySpans: INS_extractKeySpans,
  };
})();
