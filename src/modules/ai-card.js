// Copyright (c) 2026 Insta360. All rights reserved.
// INS_Reader · AI 状态浮层卡片
// 职责：在真实页面右下角用独立 Shadow DOM 显示 AI 内容助手的进度/结果/失败原因，
// 并提供"撤销"入口。设置面板会在点击页面任意处时自动关闭，而 AI 请求要等数秒到
// 数十秒，没有这张卡片用户在面板关闭后就完全看不到进度、也没有回退入口。
// 卡片自身是 position:fixed 的 Shadow DOM 宿主，不进入正文流、不改动页面任何既有节点，
// dismiss() 会把宿主整个移除。z-index 比阅读层高，因此阅读模式下同样可见。
// 依赖 INS_Reader.aiEnhance（撤销时回调它的 clearSimplify/clearKeyInfo）。
// 调用者：panel-ui.js 在触发两个 AI 开关时调用 showLoading()/showResult()/showError()；
// content.js 的 restoreOriginalPage() 调用 dismiss()。

window.INS_Reader = window.INS_Reader || {};

(function () {
  const HOST_ID = 'ins-reader-ai-card-host';

  const FEATURE_LABELS = {
    simplify: '简化段落长句',
    keyinfo: '高亮核心信息',
  };

  const state = {
    host: null,
    // feature → { status: 'loading'|'done'|'error', message }
    entries: new Map(),
    onUndo: null,
  };

  function INS_ensureHost() {
    if (state.host && state.host.isConnected) return state.host;
    const host = document.createElement('div');
    host.id = HOST_ID;
    host.style.position = 'fixed';
    host.style.right = '18px';
    host.style.bottom = '18px';
    host.style.width = '0';
    host.style.height = '0';
    // 面板 2147483647、阅读层 2147483646，卡片取 2147483645：
    // permanently 位于面板之下、阅读层之上，不会盖住用户正在操作的面板。
    host.style.zIndex = '2147483645';
    document.documentElement.appendChild(host);
    host.attachShadow({ mode: 'open' });
    state.host = host;
    return host;
  }

  const CARD_CSS = `
    :host { all: initial; }
    .card {
      position: fixed; right: 0; bottom: 0; width: 248px;
      padding: 12px 14px;
      font-family: Inter, "Noto Sans SC", -apple-system, sans-serif;
      font-size: 12px; color: #1A1A1A;
      background: #FFFFFF; border: 1px solid #E0E0DC; border-radius: 10px;
      box-shadow: 0 10px 30px #00000018;
      animation: ins-ai-card-in 0.16s ease-out;
    }
    @keyframes ins-ai-card-in {
      from { opacity: 0; transform: translateY(6px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .card-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .card-title { font-weight: 600; font-size: 12px; }
    .card-close {
      width: 20px; height: 20px; flex: none; padding: 0; border: 0; border-radius: 4px;
      background: transparent; color: #888888; font-size: 15px; line-height: 1; cursor: pointer;
    }
    .card-close:hover { background: #F5F5F3; color: #333333; }
    .row { display: flex; align-items: flex-start; gap: 7px; margin-top: 9px; line-height: 1.5; }
    .dot { width: 6px; height: 6px; flex: none; margin-top: 5px; border-radius: 50%; background: #FFB800; }
    .row.loading .dot { animation: ins-ai-card-pulse 1s ease-in-out infinite; }
    .row.error .dot { background: #b95042; }
    .row.done .dot { background: #4a8f5f; }
    @keyframes ins-ai-card-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.25; } }
    .row-text { flex: 1; }
    .row-label { color: #333333; }
    .row-message { display: block; margin-top: 2px; font-size: 10px; color: #777777; }
    .row.error .row-message { color: #b95042; }
    .card-undo {
      width: 100%; height: 26px; margin-top: 11px;
      border: 1px solid #DCDCDC; border-radius: 4px; background: #fff;
      color: #333333; font-size: 11px; cursor: pointer; transition: background 0.15s;
    }
    .card-undo:hover { background: #FFF3CC; }
  `;

  function INS_render() {
    // 没有任何条目时不留空卡片在页面上。
    if (state.entries.size === 0) {
      INS_dismiss();
      return;
    }
    const shadow = INS_ensureHost().shadowRoot;
    shadow.innerHTML = '';

    const style = document.createElement('style');
    style.textContent = CARD_CSS;
    shadow.appendChild(style);

    const card = document.createElement('div');
    card.className = 'card';

    const top = document.createElement('div');
    top.className = 'card-top';
    const title = document.createElement('span');
    title.className = 'card-title';
    title.textContent = 'AI 内容助手';
    const close = document.createElement('button');
    close.className = 'card-close';
    close.textContent = '×';
    close.setAttribute('aria-label', '关闭');
    close.addEventListener('click', INS_dismiss);
    top.append(title, close);
    card.appendChild(top);


    for (const [feature, entry] of state.entries) {
      const row = document.createElement('div');
      row.className = `row ${entry.status}`;
      const dot = document.createElement('span');
      dot.className = 'dot';
      const textWrap = document.createElement('span');
      textWrap.className = 'row-text';
      const label = document.createElement('span');
      label.className = 'row-label';
      label.textContent = FEATURE_LABELS[feature] || feature;
      textWrap.appendChild(label);
      if (entry.message) {
        const message = document.createElement('span');
        message.className = 'row-message';
        message.textContent = entry.message;
        textWrap.appendChild(message);
      }
      row.append(dot, textWrap);
      card.appendChild(row);
    }

    // 只要有已生效的功能就给撤销入口——面板可能已经关掉了。
    const undoable = Array.from(state.entries.entries()).filter(([, e]) => e.status === 'done');
    if (undoable.length > 0) {
      const undo = document.createElement('button');
      undo.className = 'card-undo';
      undo.textContent = undoable.length > 1 ? '撤销全部 AI 改动' : `撤销${FEATURE_LABELS[undoable[0][0]]}`;
      undo.addEventListener('click', () => {
        const features = undoable.map(([feature]) => feature);
        if (typeof state.onUndo === 'function') state.onUndo(features);
      });
      card.appendChild(undo);
    }

    shadow.appendChild(card);
  }

  function INS_showLoading(feature, message) {
    state.entries.set(feature, { status: 'loading', message: message || '正在处理…' });
    INS_render();
  }

  function INS_showResult(feature, message) {
    state.entries.set(feature, { status: 'done', message: message || '' });
    INS_render();
  }

  function INS_showError(feature, message) {
    state.entries.set(feature, { status: 'error', message: message || '处理失败' });
    INS_render();
  }

  function INS_clearFeature(feature) {
    state.entries.delete(feature);
    INS_render();
  }

  function INS_dismiss() {
    state.entries.clear();
    if (state.host) {
      state.host.remove();
      state.host = null;
    }
  }

  function INS_setOnUndo(callback) {
    state.onUndo = callback;
  }

  window.INS_Reader.aiCard = {
    showLoading: INS_showLoading,
    showResult: INS_showResult,
    showError: INS_showError,
    clearFeature: INS_clearFeature,
    dismiss: INS_dismiss,
    setOnUndo: INS_setOnUndo,
  };
})();
