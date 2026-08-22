// Copyright (c) 2026 Insta360. All rights reserved.
// INS_Reader · AI 内容增强模块
// 职责：实现"简化段落长句"与"高亮核心信息"两项 AI 功能的落地。
// 与阅读层的关系：两条渲染路径共用同一套逻辑，只是作用的根节点不同——
//   阅读模式开启 → 作用于阅读层 Shadow DOM 里的克隆正文，真实页面零改动；
//   阅读模式关闭 → 作用于真实页面的正文节点（就地降噪场景）。
// 对真实页面的改动限制在两点，且都可完整还原：
//   简化段落：用 replaceChildren 换掉段落子节点，原子节点数组仍被本模块持有，
//             clearSimplify() 原样放回，绝不修改段落自身属性或它的父子结构；
//   高亮：使用 CSS Custom Highlight API（CSS.highlights + Range），
//         完全不插入 <mark>、不切分文本节点，零 DOM 改动。
// AI 结果按"段落原文归一化文本"作为键缓存，因此阅读层重渲染（改字号/换配色都会
// 重建克隆体）之后可以由 reapply() 无损重新落地，不需要再请求一次 AI。
// 依赖 INS_Reader.prefsStore / aiClient / articleLocator / readerLayer。
// 调用者：panel-ui.js 的两个 AI 开关调用 runSimplify()/runKeyInfo()/clearSimplify()/
// clearKeyInfo()；reader-layer.js 的 render() 末尾调用 reapply()；
// content.js 的 restoreOriginalPage() 调用 clearAll()。

window.INS_Reader = window.INS_Reader || {};

(function () {
  const HIGHLIGHT_NAME = 'ins-reader-key-info';
  const STYLE_ID = 'ins-reader-ai-highlight-style';
  // 单次请求最多送多少段，避免长文把 token 和等待时间拉爆。
  const MAX_PARAGRAPHS = 24;
  // 短句本来就好读，改写它们只会浪费 token 并引入无意义改动。
  const MIN_PARAGRAPH_CHARS = 60;

  // 高亮样式在两个作用域各需一份：真实页面用 document 里的 <style>，
  // 阅读层用 reader-layer.js 注入到 Shadow DOM 的同一段 CSS。
  const HIGHLIGHT_CSS = `
    ::highlight(${HIGHLIGHT_NAME}) {
      background-color: #FFB80055;
      text-decoration: underline;
      text-decoration-color: #FFB800;
      text-decoration-thickness: 2px;
      text-underline-offset: 2px;
    }
  `;

  const state = {
    // 归一化段落原文 → AI 改写后的文本。跨重渲染复用，避免重复请求。
    simplifyCache: new Map(),
    keySpans: [],
    simplifyActive: false,
    keyInfoActive: false,
    // 已改写的段落及其原始子节点，clearSimplify() 靠它还原。
    appliedSimplify: [],
    styleEl: null,
    onStatusChange: null,
  };

  function INS_supportsHighlightApi() {
    return (
      typeof CSS !== 'undefined' &&
      CSS.highlights &&
      typeof window.Highlight === 'function'
    );
  }

  function INS_normalize(text) {
    return (text || '').replace(/\s+/g, ' ').trim();
  }

  function INS_notify() {
    if (typeof state.onStatusChange === 'function') state.onStatusChange();
  }

  // 当前正文所在的根节点。阅读层渲染成功时用它的克隆体，否则回落到真实页面正文。
  function INS_getContext() {
    const { readerLayer, articleLocator, prefsStore } = window.INS_Reader;
    const rendered = readerLayer.getRenderedArticle();
    if (rendered && rendered.isConnected) {
      return { root: rendered, inShadow: true };
    }
    if (prefsStore.get().enabled && rendered) {
      // 阅读模式开着但克隆体已被卸载：此刻没有稳定的落点，等下一次 render()。
      return { root: null, inShadow: true };
    }
    const real = articleLocator.findArticleRoot();
    return { root: real || document.body, inShadow: false };
  }

  // 可改写的段落：有足够长度的纯文本段，且不含图片/媒体/代码块——
  // 这些段落一旦被文本替换就会丢内容，不值得为改写付这个代价。
  function INS_collectParagraphs(root) {
    if (!root) return [];
    const all = Array.from(root.querySelectorAll('p'));
    const result = [];
    for (const el of all) {
      if (el.querySelector('img, video, audio, iframe, pre, code, table')) continue;
      const text = INS_normalize(el.textContent);
      if (text.length < MIN_PARAGRAPH_CHARS) continue;
      result.push({ el, text });
      if (result.length >= MAX_PARAGRAPHS) break;
    }
    return result;
  }

  function INS_getArticleText() {
    const { root } = INS_getContext();
    return root ? root.textContent || '' : '';
  }

  // ---- 简化段落长句 ----

  // 用缓存里已有的改写结果覆盖段落文本。命中不到缓存的段落保持原文不动，
  // 因此重渲染后即使正文结构略有变化也不会出现空段落。
  function INS_applySimplifyFromCache(root) {
    const paragraphs = INS_collectParagraphs(root);
    let applied = 0;
    for (const { el, text } of paragraphs) {
      const rewritten = state.simplifyCache.get(text);
      if (!rewritten) continue;
      // 保存原始子节点（而非 innerHTML 字符串）：还原时直接放回同一批节点，
      // 段落内的链接、事件监听、行内样式都不会丢。
      state.appliedSimplify.push({ el, originalNodes: Array.from(el.childNodes) });
      el.replaceChildren(document.createTextNode(rewritten));
      el.setAttribute('data-ins-ai-simplified', '');
      applied += 1;
    }
    return applied;
  }

  function INS_undoSimplify() {
    for (const { el, originalNodes } of state.appliedSimplify) {
      if (!el.isConnected) continue; // 克隆体已被丢弃，无需还原
      el.replaceChildren(...originalNodes);
      el.removeAttribute('data-ins-ai-simplified');
    }
    state.appliedSimplify = [];
  }

  async function INS_runSimplify() {
    const { aiClient } = window.INS_Reader;
    const { root } = INS_getContext();
    if (!root) throw new Error('未找到正文内容');

    const paragraphs = INS_collectParagraphs(root);
    if (paragraphs.length === 0) throw new Error('未找到可简化的长段落');

    // 只请求缓存里没有的段落，重复开关不会反复消耗额度。
    const missing = paragraphs.filter((p) => !state.simplifyCache.has(p.text));
    if (missing.length > 0) {
      const results = await aiClient.simplifyParagraphs(missing.map((p) => p.text));
      for (const item of results) {
        const source = missing[item.i];
        if (source) state.simplifyCache.set(source.text, item.text);
      }
    }

    INS_undoSimplify();
    const applied = INS_applySimplifyFromCache(root);
    if (applied === 0) throw new Error('AI 未返回可用的改写结果');
    state.simplifyActive = true;

    // 改写后原文措辞已不存在，之前提取的重点片段可能整体失去落点（Range 会静默塌缩
    // 成空，表现为"高亮开着但看不见"）。交给 resync 判断：还能定位就重建，全都定位
    // 不到就关掉高亮并上报，由调用方同步开关状态和提示用户。
    const keyInfoCleared = INS_resyncKeyInfo(root);
    INS_notify();
    return { applied, keyInfoCleared };
  }

  function INS_clearSimplify() {
    state.simplifyActive = false;
    INS_undoSimplify();
    // 还原段落同样会换掉文本节点,高亮要跟着在新节点上重建。
    const { root } = INS_getContext();
    const keyInfoCleared = root ? INS_resyncKeyInfo(root) : false;
    INS_notify();
    return { keyInfoCleared };
  }

  // ---- 高亮核心信息 ----

  function INS_ensureHighlightStyle() {
    if (state.styleEl && state.styleEl.isConnected) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = HIGHLIGHT_CSS;
    document.documentElement.appendChild(style);
    state.styleEl = style;
  }

  // 把根节点下的所有文本节点拼成一条长字符串，并记录每个节点在其中的起止偏移，
  // 这样就能用一次 indexOf 定位跨节点的片段，再换算回 (节点, 节点内偏移)。
  // 逐节点查找做不到这件事：片段常常被 <a>/<strong> 切成好几段文本节点。
  function INS_buildTextIndex(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const entries = [];
    let full = '';
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const value = node.nodeValue || '';
      if (!value) continue;
      entries.push({ node, start: full.length, end: full.length + value.length });
      full += value;
    }
    return { full, entries };
  }

  function INS_locate(entries, offset) {
    for (const entry of entries) {
      if (offset >= entry.start && offset < entry.end) {
        return { node: entry.node, offset: offset - entry.start };
      }
    }
    return null;
  }

  function INS_rangeForSpan(index, span) {
    // 在空白归一化后的串上查找（原文的换行 / 缩进与模型回传的空格经常不一致），
    // 再通过 index.map 把归一化偏移换算回原始拼接串的偏移。
    const at = index.compact.indexOf(span);
    if (at < 0) return null;
    const start = INS_locate(index.entries, index.map[at]);
    const endOffset = index.map[at + span.length - 1];
    const end = INS_locate(index.entries, endOffset);
    if (!start || !end) return null;
    const range = document.createRange();
    try {
      range.setStart(start.node, start.offset);
      range.setEnd(end.node, end.offset + 1);
    } catch (err) {
      return null;
    }
    return range;
  }

  // 在原始拼接串的基础上再产出一份"空白归一化"的版本，并保留
  // 归一化后每个字符对应的原始偏移，供 Range 定位使用。
  function INS_buildSearchIndex(root) {
    const { full, entries } = INS_buildTextIndex(root);
    let compact = '';
    const map = [];
    let lastWasSpace = false;
    for (let i = 0; i < full.length; i += 1) {
      const ch = full[i];
      if (/\s/.test(ch)) {
        if (lastWasSpace || compact.length === 0) continue;
        compact += ' ';
        map.push(i);
        lastWasSpace = true;
        continue;
      }
      compact += ch;
      map.push(i);
      lastWasSpace = false;
    }
    return { entries, compact, map };
  }

  function INS_applyKeyInfoFromCache(root) {
    if (!INS_supportsHighlightApi()) return 0;
    CSS.highlights.delete(HIGHLIGHT_NAME);
    if (state.keySpans.length === 0) return 0;

    const index = INS_buildSearchIndex(root);
    const ranges = [];
    for (const raw of state.keySpans) {
      const span = INS_normalize(raw);
      if (!span) continue;
      const range = INS_rangeForSpan(index, span);
      if (range) ranges.push(range);
    }
    if (ranges.length === 0) return 0;

    INS_ensureHighlightStyle();
    CSS.highlights.set(HIGHLIGHT_NAME, new Highlight(...ranges));
    return ranges.length;
  }

  // 段落改写和还原都会换掉文本节点，之前提取的重点片段可能在新文本里已经不存在。
  // 还能定位的就在新 DOM 上重建高亮（未被改写的短段落通常还在）；一个都定位不到时
  // 显式关掉高亮并清空缓存，避免留下"开关是开的、页面上什么都没有"的状态。
  // 返回 true 表示高亮被关掉了，调用方需要同步开关并提示用户。
  function INS_resyncKeyInfo(root) {
    if (!state.keyInfoActive) return false;
    if (INS_applyKeyInfoFromCache(root) > 0) return false;
    INS_clearKeyInfo();
    state.keySpans = []; // 重新开启时按当前文本重新提取
    return true;
  }

  async function INS_runKeyInfo() {
    if (!INS_supportsHighlightApi()) {
      throw new Error('当前浏览器版本不支持高亮，请升级 Chrome');
    }
    const { aiClient } = window.INS_Reader;
    const { root } = INS_getContext();
    if (!root) throw new Error('未找到正文内容');

    const text = INS_normalize(root.textContent);
    if (!text) throw new Error('未找到正文内容');

    if (state.keySpans.length === 0) {
      state.keySpans = await aiClient.extractKeySpans(text);
    }
    const applied = INS_applyKeyInfoFromCache(root);
    if (applied === 0) {
      state.keySpans = [];
      throw new Error('未能在正文中定位到 AI 返回的重点片段');
    }
    state.keyInfoActive = true;
    INS_notify();
    return applied;
  }

  function INS_clearKeyInfo() {
    state.keyInfoActive = false;
    if (INS_supportsHighlightApi()) CSS.highlights.delete(HIGHLIGHT_NAME);
    if (state.styleEl) {
      state.styleEl.remove();
      state.styleEl = null;
    }
    INS_notify();
  }

  // ---- 重渲染后的无损重建 ----

  // 阅读层每次 render() 都会重建克隆体，之前落地的改写和高亮随旧克隆体一起消失。
  // 这里只用缓存重新落地，不发起任何网络请求，所以改字号/换配色不会触发 AI 调用。
  function INS_reapply() {
    if (!state.simplifyActive && !state.keyInfoActive) return;
    const { root } = INS_getContext();
    if (!root) return;
    // 旧记录指向已被丢弃的克隆节点，直接清空，避免 undo 时误碰新树。
    state.appliedSimplify = [];
    if (state.simplifyActive) INS_applySimplifyFromCache(root);
    if (state.keyInfoActive) INS_applyKeyInfoFromCache(root);
  }

  // 退出插件（恢复原网页）时调用：清掉落地效果，也清掉缓存的 AI 结果，
  // 下一次开启按新页面重新生成。
  function INS_clearAll() {
    INS_clearSimplify();
    INS_clearKeyInfo();
    state.simplifyCache.clear();
    state.keySpans = [];
  }

  function INS_getStatus() {
    return {
      simplifyActive: state.simplifyActive,
      keyInfoActive: state.keyInfoActive,
      highlightSupported: INS_supportsHighlightApi(),
    };
  }

  function INS_setOnStatusChange(callback) {
    state.onStatusChange = callback;
  }

  window.INS_Reader.aiEnhance = {
    HIGHLIGHT_CSS,
    HIGHLIGHT_NAME,
    getArticleText: INS_getArticleText,
    runSimplify: INS_runSimplify,
    clearSimplify: INS_clearSimplify,
    runKeyInfo: INS_runKeyInfo,
    clearKeyInfo: INS_clearKeyInfo,
    reapply: INS_reapply,
    clearAll: INS_clearAll,
    getStatus: INS_getStatus,
    setOnStatusChange: INS_setOnStatusChange,
  };
})();
