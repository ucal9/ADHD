// 缓读 · AI 客户端模块
// 职责：调用缓读后端的 AI 摘要代理接口（后端持有 LLM Key，前端不接触密钥）。
// 依赖 Huandu.prefsStore 读取 deviceId。后端不可用时功能整体降级为不可用，
// 不影响正文定位/降噪/排版等核心本地功能。
//
// 实际网络请求不在这里直接 fetch：content script 的 fetch 会受宿主页面 CSP
// （如知乎等站点的 connect-src 白名单）拦截，导致在部分网站上"无法连接 AI 服务"。
// 因此改为通过 chrome.runtime.sendMessage 委托给 background service worker
// 执行（service worker 不受宿主页面 CSP 约束）。demo.html 环境没有 background，
// 用等价的 mock 直接在页面里 fetch。

window.Huandu = window.Huandu || {};

(function () {
  async function summarize(text) {
    const { prefsStore } = window.Huandu;
    const prefs = prefsStore.get();

    console.log('[缓读][ai-client] 发起摘要请求，正文长度:', text.length, 'origin:', location.origin);

    let resp;
    try {
      resp = await chrome.runtime.sendMessage({
        type: 'HUANDU_AI_SUMMARIZE',
        payload: { device_id: prefs.deviceId, text, mode: 'summary' },
      });
      console.log('[缓读][ai-client] sendMessage 返回:', resp, 'chrome.runtime.lastError:', chrome.runtime.lastError);
    } catch (err) {
      console.error('[缓读][ai-client] sendMessage 抛出异常:', err.name, err.message, err);
      throw new Error('无法连接 AI 服务，请确认后端已启动');
    }

    if (!resp) {
      console.error('[缓读][ai-client] resp 为空（service worker 可能未响应或已休眠），lastError:', chrome.runtime.lastError);
      throw new Error('无法连接 AI 服务，请确认后端已启动');
    }
    if (resp.status === 429) {
      throw new Error('请求过于频繁，请稍后再试');
    }
    if (!resp.ok) {
      console.error('[缓读][ai-client] 后端返回失败:', resp.status, resp.detail);
      throw new Error(resp.detail || `AI 服务出错（${resp.status}）`);
    }

    console.log('[缓读][ai-client] 摘要成功，长度:', resp.result.length);
    return resp.result;
  }

  window.Huandu.aiClient = {
    summarize,
  };
})();
