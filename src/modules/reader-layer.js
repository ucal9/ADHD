// 缓读 · 沉浸阅读层模块
// 职责：在独立的 Shadow DOM 全屏层中展示清理后的正文，与原页面 DOM 完全隔离，
// 不修改原页面结构，避免因隐藏兄弟节点导致 grid/flex 布局跑位。
// 依赖 Huandu.prefsStore / articleLocator / noiseFilter / domPath。

window.Huandu = window.Huandu || {};

(function () {
  const THEMES = {
    gentle: { bg: '#f7f7f3', text: '#242422', accent: '#187a6e' },
    focus: { bg: '#20211f', text: '#ecede8', accent: '#83cfc0' },
  };

  const state = {
    readerHost: null,
    articleSourceRoot: null, // 原页面中定位到的正文节点（只读，从不修改）
    bodyOverflowBackup: null,
    hiddenCount: 0,
    onHiddenCountChange: null, // 供面板模块订阅，渲染完成后回调最新的降噪计数
    summaryText: '', // AI 摘要结果，由面板模块调用 aiClient 后写入
    articleText: '', // 当前渲染的正文纯文本，供面板模块传给 aiClient.summarize()
  };

  function ensureReaderHost() {
    if (state.readerHost) return state.readerHost;
    state.readerHost = document.createElement('div');
    state.readerHost.id = 'huandu-reader-host';
    state.readerHost.style.position = 'fixed';
    state.readerHost.style.top = '0';
    state.readerHost.style.left = '0';
    state.readerHost.style.width = '0';
    state.readerHost.style.height = '0';
    state.readerHost.style.zIndex = '2147483646'; // 面板层 z-index 减 1，面板始终盖在阅读层之上
    document.documentElement.appendChild(state.readerHost);
    return state.readerHost;
  }

  function lockOriginalPage() {
    if (state.bodyOverflowBackup === null) {
      state.bodyOverflowBackup = document.documentElement.style.overflow;
    }
    document.documentElement.style.overflow = 'hidden';
  }

  function unlockOriginalPage() {
    document.documentElement.style.overflow = state.bodyOverflowBackup || '';
    state.bodyOverflowBackup = null;
  }

  function render() {
    const { articleLocator, noiseFilter, domPath, prefsStore, readingStats } = window.Huandu;
    const prefs = prefsStore.get();

    const host = ensureReaderHost();
    let shadow = host.shadowRoot;
    if (!shadow) shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = '';

    state.articleSourceRoot = state.articleSourceRoot || articleLocator.findArticleRoot();
    const sourceNode = state.articleSourceRoot || document.body;

    // 克隆整个 body（而非只克隆正文节点），这样广告/侧边栏/评论等
    // 与正文平级的干扰元素才能被降噪选择器命中。清理后再按路径
    // 找回正文节点，只把这部分内容放进阅读层展示。
    const path = domPath.getChildIndexPath(sourceNode, document.body);
    const bodyClone = document.body.cloneNode(true);
    state.hiddenCount = noiseFilter.stripNoiseFromClone(bodyClone);
    if (typeof state.onHiddenCountChange === 'function') {
      state.onHiddenCountChange(state.hiddenCount);
    }

    const clone = (path && domPath.resolveChildIndexPath(bodyClone, path)) || bodyClone;
    state.articleText = clone.textContent || '';

    const theme = prefs.theme === 'custom'
      ? { ...prefs.customColors, accent: '#278477' }
      : (THEMES[prefs.theme] || THEMES.gentle);
    const maxWidth = prefs.contentWidth === 'narrow' ? '640px' : '900px';

    const style = document.createElement('style');
    style.textContent = `
      .huandu-reader-overlay {
        position: fixed; inset: 0; z-index: 1;
        background: ${theme.bg};
        overflow-y: auto;
        font-family: "Noto Sans SC", -apple-system, sans-serif;
      }
      .huandu-reader-progress-track {
        position: sticky; top: 0; z-index: 2;
        height: 3px;
        background: rgba(0,0,0,0.06);
      }
      .huandu-reader-progress-bar {
        height: 100%;
        width: 0%;
        background: ${theme.accent};
        transition: width 0.1s linear;
      }
      .huandu-reader-time {
        position: sticky; top: 3px; z-index: 2;
        text-align: right;
        padding: 6px 24px 0;
        font-size: 12px;
        color: ${theme.accent};
        background: ${theme.bg};
      }
      .huandu-reader-article {
        max-width: ${maxWidth};
        margin: 0 auto;
        padding: 20px 24px 80px;
        color: ${theme.text};
        font-size: ${prefs.fontSize}px;
        line-height: ${prefs.lineHeight};
        letter-spacing: ${prefs.letterSpacing}em;
      }
      .huandu-reader-article a { color: ${theme.accent}; }
      .huandu-reader-article img { max-width: 100%; height: auto; }
      .huandu-reader-summary {
        margin: 0 0 28px;
        padding: 14px 18px;
        border-radius: 8px;
        border: 1px solid ${theme.accent}55;
        background: ${theme.accent}14;
        font-size: 0.85em;
        line-height: 1.7;
        letter-spacing: 0;
      }
      .huandu-reader-summary-title {
        font-weight: 600;
        color: ${theme.accent};
        margin: 0 0 6px;
      }
      .huandu-reader-summary-body { white-space: pre-line; }
    `;
    shadow.appendChild(style);

    const overlay = document.createElement('div');
    overlay.className = 'huandu-reader-overlay';

    const progressTrack = document.createElement('div');
    progressTrack.className = 'huandu-reader-progress-track';
    const progressBar = document.createElement('div');
    progressBar.className = 'huandu-reader-progress-bar';
    progressTrack.appendChild(progressBar);
    overlay.appendChild(progressTrack);

    const timeEl = document.createElement('div');
    timeEl.className = 'huandu-reader-time';
    const totalMinutes = readingStats.estimateMinutes(clone.textContent || '');
    timeEl.textContent = `预计阅读 ${readingStats.formatMinutes(totalMinutes)}`;
    overlay.appendChild(timeEl);

    const articleWrap = document.createElement('div');
    articleWrap.className = 'huandu-reader-article';
    if (state.summaryText) {
      const summaryEl = document.createElement('div');
      summaryEl.className = 'huandu-reader-summary';
      summaryEl.innerHTML = `<p class="huandu-reader-summary-title">AI 摘要</p><p class="huandu-reader-summary-body"></p>`;
      summaryEl.querySelector('.huandu-reader-summary-body').textContent = state.summaryText;
      articleWrap.appendChild(summaryEl);
    }
    articleWrap.appendChild(clone);
    overlay.appendChild(articleWrap);
    shadow.appendChild(overlay);

    overlay.addEventListener('scroll', () => {
      const progress = readingStats.computeProgress(
        overlay.scrollTop,
        overlay.scrollHeight,
        overlay.clientHeight
      );
      progressBar.style.width = `${progress * 100}%`;
      const remaining = totalMinutes * (1 - progress);
      timeEl.textContent = progress >= 0.98
        ? '已读完'
        : `剩余 ${readingStats.formatMinutes(remaining)}`;
    });
  }

  function remove() {
    if (state.readerHost) {
      state.readerHost.remove();
      state.readerHost = null;
    }
  }

  function getHiddenCount() {
    return state.hiddenCount;
  }

  function setOnHiddenCountChange(callback) {
    state.onHiddenCountChange = callback;
  }

  function getArticleText() {
    return state.articleText;
  }

  function setSummary(text) {
    state.summaryText = text || '';
  }

  function getSummary() {
    return state.summaryText;
  }

  window.Huandu.readerLayer = {
    render,
    remove,
    lockOriginalPage,
    unlockOriginalPage,
    getHiddenCount,
    setOnHiddenCountChange,
    getArticleText,
    setSummary,
    getSummary,
  };
})();
