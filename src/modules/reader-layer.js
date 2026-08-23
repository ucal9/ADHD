// Copyright (c) 2026 Insta360. All rights reserved.
// INS_Reader · 沉浸阅读层模块
// 职责：阅读模式有两条路径——
//   降噪未全开：不盖阅读层，在真实页面上按开关隐藏噪音（不拆节点，保留原布局）；
//   动态降噪始终在真实页面上执行，保留网页原生布局；正文阅读层不由降噪开关触发。
// 不修改原页面的父子结构。
// 依赖 INS_Reader.prefsStore / articleLocator / feasibility / noiseFilter / domPath /
// readingStats / aiEnhance。
// 调用者：content.js 的 applyAll()/restoreOriginalPage() 调用 render()/remove()/
// lockOriginalPage()/unlockOriginalPage()；render() 返回 false 时 content.js 不会
// 锁定原页面。panel-ui.js 每次改设置后调用 render() 重新渲染，并读取
// getHiddenCount()/getArticleText()/getSummary()/getLastFeasibilityReason() 展示状态、
// 调用 setSummary() 写入 AI 摘要结果。
// render() 末尾会调用 aiEnhance.reapply()：克隆体每次重建都是新节点，已生成的
// AI 改写/高亮必须重新落地一次（走缓存，不重复请求）。getRenderedArticle() 就是
// 给 aiEnhance 用来拿当前克隆正文节点的。

window.INS_Reader = window.INS_Reader || {};

(function () {
  const state = {
    readerHost: null,
    articleSourceRoot: null, // 原页面中定位到的正文节点（只读，从不修改）
    bodyOverflowBackup: null,
    hiddenCount: 0,
    onHiddenCountChange: null, // 供面板模块订阅，渲染完成后回调最新的降噪计数
    summaryText: '', // AI 摘要结果，由面板模块调用 aiClient 后写入
    articleText: '', // 当前渲染的正文纯文本，供面板模块传给 aiClient.summarize()
    renderedArticle: null, // 克隆体中的正文节点，供 aiEnhance 落地改写/高亮
    lastFeasibilityReason: null, // 最近一次 render() 判定不可行的原因，null 表示可行或未判断过
    pausedMedia: [], // 因"暂停自动播放"被我们暂停的原页面媒体元素，退出阅读模式时还原 autoplay
    livePageMode: false, // 未全开降噪时作用在真实页面上；四开关全开时为 false，使用正文阅读层
  };

  function INS_setHiddenCount(count) {
    state.hiddenCount = Number.isFinite(Number(count)) ? Math.max(0, Number(count)) : 0;
    if (typeof state.onHiddenCountChange === 'function') {
      state.onHiddenCountChange(state.hiddenCount);
    }
  }

  function INS_ensureReaderHost() {
    if (state.readerHost) return state.readerHost;
    state.readerHost = document.createElement('div');
    state.readerHost.id = 'ins-reader-host';
    state.readerHost.style.position = 'fixed';
    state.readerHost.style.top = '0';
    state.readerHost.style.left = '0';
    state.readerHost.style.width = '0';
    state.readerHost.style.height = '0';
    state.readerHost.style.zIndex = '2147483646'; // 面板层 z-index 减 1，面板始终盖在阅读层之上
    document.documentElement.appendChild(state.readerHost);
    return state.readerHost;
  }

  // 暂停原页面里正在自动播放的视频/音频。这是全模块唯一会改动原页面运行状态的地方
  // （不改 DOM 结构，只改播放状态 + 暂存 autoplay 属性），因为"自动播放"是播放器行为，
  // 在克隆体上做任何处理都影响不到真实页面里那个正在出声的播放器。
  // 所有改动都记在 state.pausedMedia 里，退出阅读模式时由 INS_restoreAutoplay() 原样还原。
  function INS_pauseAutoplayMedia() {
    document.querySelectorAll('video, audio').forEach((el) => {
      const hadAutoplay = el.hasAttribute('autoplay');
      if (!hadAutoplay && el.paused) return;
      state.pausedMedia.push({ el, hadAutoplay, wasPlaying: !el.paused });
      if (hadAutoplay) el.removeAttribute('autoplay');
      if (!el.paused) el.pause();
    });
  }

  function INS_restoreAutoplayMedia() {
    state.pausedMedia.forEach(({ el, hadAutoplay, wasPlaying }) => {
      if (hadAutoplay) el.setAttribute('autoplay', '');
      if (wasPlaying) el.play().catch(() => {});
    });
    state.pausedMedia = [];
  }

  function INS_lockOriginalPage() {
    // 真实页降噪需要继续滚动原页面，不能把 overflow 锁死。
    if (state.livePageMode) {
      INS_unlockOriginalPage();
      return;
    }
    if (state.bodyOverflowBackup === null) {
      state.bodyOverflowBackup = document.documentElement.style.overflow;
    }
    document.documentElement.style.overflow = 'hidden';
  }

  function INS_unlockOriginalPage() {
    document.documentElement.style.overflow = state.bodyOverflowBackup || '';
    state.bodyOverflowBackup = null;
  }

  // 原页靠站点 CSS 隐藏的节点（登录层、空蒙层等），克隆进 Shadow 后会丢掉那些规则
  // 而变成可见的白罩。按相同文档顺序把 display/visibility 写到克隆节点的内联样式上。
  function INS_copyHiddenComputedStyles(sourceRoot, cloneRoot) {
    const sourceEls = sourceRoot.querySelectorAll('*');
    const cloneEls = cloneRoot.querySelectorAll('*');
    const limit = Math.min(sourceEls.length, cloneEls.length);
    for (let i = 0; i < limit; i++) {
      let computed;
      try {
        computed = window.getComputedStyle(sourceEls[i]);
      } catch (error) {
        continue;
      }
      if (computed.display === 'none') cloneEls[i].style.display = 'none';
      else if (computed.visibility === 'hidden') cloneEls[i].style.visibility = 'hidden';
    }
  }

  function INS_resolveCloneArticle(bodyClone, sourceNode, path) {
    const { articleLocator, domPath } = window.INS_Reader;
    const byLocator = articleLocator.findArticleRootIn?.(bodyClone, sourceNode);
    if (byLocator) return byLocator;
    if (path) return domPath.resolveChildIndexPath(bodyClone, path);
    return null;
  }

  function INS_unwrapBodyClone(bodyClone) {
    const wrap = document.createElement('div');
    wrap.className = 'ins-reader-page';
    while (bodyClone.firstChild) wrap.appendChild(bodyClone.firstChild);
    return wrap;
  }

  function INS_syncAutoplay(prefs) {
    if (prefs.noiseReduction && prefs.noiseOptions.pauseAutoplay) {
      INS_pauseAutoplayMedia();
    } else {
      INS_restoreAutoplayMedia();
    }
  }

  function INS_teardownOverlay() {
    state.renderedArticle = null;
    if (state.readerHost) {
      state.readerHost.remove();
      state.readerHost = null;
    }
  }

  function INS_renderLivePage(sourceNode, prefs) {
    const { noiseFilter } = window.INS_Reader;
    state.livePageMode = true;
    INS_teardownOverlay();
    INS_setHiddenCount(noiseFilter.applyLiveHide(sourceNode));
    INS_syncAutoplay(prefs);
    state.articleText = sourceNode.textContent || '';
    // 落点留在真实正文，aiEnhance 会走原页面分支而不是 Shadow。
    state.renderedArticle = null;
    window.INS_Reader.aiEnhance.reapply();
    return true;
  }

  function INS_render() {
    const { articleLocator, feasibility, noiseFilter, domPath, prefsStore, readingStats } = window.INS_Reader;
    const prefs = prefsStore.get();

    state.articleSourceRoot = state.articleSourceRoot || articleLocator.findArticleRoot();
    const sourceNode = state.articleSourceRoot || document.body;

    const { feasible, reason } = feasibility.check(state.articleSourceRoot);
    if (!feasible) {
      state.lastFeasibilityReason = reason;
      INS_remove();
      return false;
    }
    state.lastFeasibilityReason = null;

    if (!noiseFilter.isStrictArticleMode(prefs)) {
      return INS_renderLivePage(sourceNode, prefs);
    }

    noiseFilter.clearLiveHide();
    state.livePageMode = false;

    const host = INS_ensureReaderHost();
    let shadow = host.shadowRoot;
    if (!shadow) shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = '';

    // 正文节点必须在删除之前定位：删完再按下标找会错位。
    const path = sourceNode === document.body ? null : domPath.getChildIndexPath(sourceNode, document.body);
    const bodyClone = document.body.cloneNode(true);
    INS_copyHiddenComputedStyles(document.body, bodyClone);
    const articleClone = INS_resolveCloneArticle(bodyClone, sourceNode, path);
    INS_setHiddenCount(noiseFilter.stripNoiseFromClone(bodyClone, articleClone));
    INS_syncAutoplay(prefs);

    const pageClone = INS_unwrapBodyClone(bodyClone);
    const mountedArticle = articleClone && pageClone.contains(articleClone) ? articleClone : null;
    const clone = mountedArticle || pageClone;
    state.articleText = (mountedArticle || clone).textContent || '';
    state.renderedArticle = mountedArticle || clone;

    const typographyEnabled = prefs.typographyEnabled !== false;
    const theme = { ...prefs.customColors, accent: '#FFB800' };
    const maxWidth = prefs.contentWidth === 'narrow' ? '640px' : '900px';

    // 字体映射
    const fontFamilyMap = {
      default: '"Noto Sans SC", -apple-system, sans-serif',
      serif: '"Noto Serif SC", serif',
      'sans-serif': '"Noto Sans SC", -apple-system, sans-serif',
      monospace: '"Noto Sans Mono", monospace',
    };
    const fontFamily = fontFamilyMap[prefs.fontFamily] || fontFamilyMap.default;

    const style = document.createElement('style');
    style.textContent = `
      .ins-reader-overlay {
        position: fixed; inset: 0; z-index: 1;
        background: ${theme.bg};
        overflow-y: auto;
        font-family: ${typographyEnabled ? fontFamily : 'sans-serif'};
      }
      .ins-reader-progress-track {
        position: sticky; top: 0; z-index: 2;
        height: 3px;
        background: rgba(0,0,0,0.06);
      }
      .ins-reader-progress-bar {
        height: 100%;
        width: 0%;
        background: ${theme.accent};
        transition: width 0.1s linear;
      }
      .ins-reader-article {
        max-width: ${maxWidth};
        margin: 0 auto;
        padding: 20px 24px 80px;
        color: ${theme.text};
        font-size: ${typographyEnabled ? `${prefs.fontSize}px` : '16px'};
        line-height: ${typographyEnabled ? prefs.lineHeight : 1.6};
        letter-spacing: ${typographyEnabled ? `${prefs.letterSpacing}em` : 'normal'};
      }
      .ins-reader-article p {
        margin-bottom: ${typographyEnabled ? `${prefs.paragraphSpacing}em` : '1em'};
      }
      .ins-reader-article a { color: ${theme.accent}; }
      .ins-reader-article img { max-width: 100%; height: auto; }
      .ins-reader-summary {
        margin: 0 0 28px;
        padding: 14px 18px;
        border-radius: 8px;
        border: 1px solid ${theme.accent}55;
        background: ${theme.accent}14;
        font-size: 0.85em;
        line-height: 1.7;
        letter-spacing: 0;
      }
      .ins-reader-summary-title {
        font-weight: 600;
        color: ${theme.accent};
        margin: 0 0 6px;
      }
      .ins-reader-summary-body { white-space: pre-line; }
      ${window.INS_Reader.aiEnhance.HIGHLIGHT_CSS}
    `;
    shadow.appendChild(style);

    const overlay = document.createElement('div');
    overlay.className = 'ins-reader-overlay';

    const progressTrack = document.createElement('div');
    progressTrack.className = 'ins-reader-progress-track';
    const progressBar = document.createElement('div');
    progressBar.className = 'ins-reader-progress-bar';
    progressTrack.appendChild(progressBar);
    overlay.appendChild(progressTrack);

    const articleWrap = document.createElement('div');
    articleWrap.className = 'ins-reader-article';
    if (state.summaryText) {
      const summaryEl = document.createElement('div');
      summaryEl.className = 'ins-reader-summary';
      summaryEl.innerHTML = `<p class="ins-reader-summary-title">AI 摘要</p><p class="ins-reader-summary-body"></p>`;
      summaryEl.querySelector('.ins-reader-summary-body').textContent = state.summaryText;
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
    });

    // 克隆体是全新节点，之前落地的 AI 改写/高亮随旧克隆体一起消失了，
    // 必须在挂载后用缓存重新落地一次（不发请求）。
    window.INS_Reader.aiEnhance.reapply();

    return true;
  }

  function INS_remove() {
    window.INS_Reader.noiseFilter.clearLiveHide();
    INS_restoreAutoplayMedia();
    INS_setHiddenCount(0);
    state.renderedArticle = null;
    state.livePageMode = false;
    if (state.readerHost) {
      state.readerHost.remove();
      state.readerHost = null;
    }
  }

  function INS_getHiddenCount() {
    return state.hiddenCount;
  }

  function INS_setOnHiddenCountChange(callback) {
    state.onHiddenCountChange = callback;
  }

  function INS_getArticleText() {
    return state.articleText;
  }

  // 克隆体中的正文节点，供 aiEnhance 在阅读层内落地改写/高亮。
  // 阅读层未渲染或已卸载时返回 null，此时 aiEnhance 会改为作用于真实页面。
  function INS_getRenderedArticle() {
    return state.renderedArticle;
  }

  function INS_setSummary(text) {
    state.summaryText = text || '';
  }

  function INS_getSummary() {
    return state.summaryText;
  }

  function INS_getLastFeasibilityReason() {
    return state.lastFeasibilityReason;
  }

  function INS_clearFeasibilityReason() {
    state.lastFeasibilityReason = null;
  }

  window.INS_Reader.readerLayer = {
    render: INS_render,
    remove: INS_remove,
    lockOriginalPage: INS_lockOriginalPage,
    unlockOriginalPage: INS_unlockOriginalPage,
    getHiddenCount: INS_getHiddenCount,
    setOnHiddenCountChange: INS_setOnHiddenCountChange,
    getArticleText: INS_getArticleText,
    getRenderedArticle: INS_getRenderedArticle,
    setSummary: INS_setSummary,
    getSummary: INS_getSummary,
    getLastFeasibilityReason: INS_getLastFeasibilityReason,
    clearFeasibilityReason: INS_clearFeasibilityReason,
  };
})();
