// Copyright (c) 2026 Insta360. All rights reserved.
// INS_Reader · 沉浸阅读层模块
// 职责：在独立的 Shadow DOM 全屏层中展示清理后的正文，与原页面 DOM 完全隔离，
// 不修改原页面结构，避免因隐藏兄弟节点导致 grid/flex 布局跑位。
// 依赖 INS_Reader.prefsStore / articleLocator / feasibility / noiseFilter / domPath / readingStats。
// 调用者：content.js 的 applyAll()/restoreOriginalPage() 调用 render()/remove()/
// lockOriginalPage()/unlockOriginalPage()；render() 返回 false 时 content.js 不会
// 锁定原页面。panel-ui.js 每次改设置后调用 render() 重新渲染，并读取
// getHiddenCount()/getArticleText()/getSummary()/getLastFeasibilityReason() 展示状态、
// 调用 setSummary() 写入 AI 摘要结果（写入后固定以悬浮窗形式展示在阅读层顶部居中，
// 不随"原文/缓读版"切换隐藏，用户可点击悬浮窗上的×收起为小圆点，收起状态不持久化）、
// 调用 setHighlightHtml() 写入 AI 高亮处理后的正文 HTML、
// 调用 setContentVersion() 切换"原文/缓读版"（只决定 render() 是否展示高亮改写结果，摘要悬浮窗不受影响）。

window.INS_Reader = window.INS_Reader || {};

(function () {
  const state = {
    readerHost: null,
    articleSourceRoot: null, // 原页面中定位到的正文节点（只读，从不修改）
    bodyOverflowBackup: null,
    hiddenCount: 0,
    onHiddenCountChange: null, // 供面板模块订阅，渲染完成后回调最新的降噪计数
    summaryText: '', // AI 摘要结果，由面板模块调用 aiClient 后写入
    summaryFloatCollapsed: false, // AI 摘要悬浮窗是否收起为小圆点，由用户点击关闭按钮控制
    highlightHtml: '', // AI 高亮处理后的正文 HTML（拆分长段落/简化长句/标记核心信息），由面板模块调用 aiClient.highlight() 后写入
    contentVersion: 'original', // 内容版本：'original' 原文 | 'digest' 缓读版（展示已生成的摘要/高亮），由面板模块的"内容版本"切换控制
    articleText: '', // 当前渲染的正文纯文本，供面板模块传给 aiClient.summarize()/aiClient.highlight()
    lastFeasibilityReason: null, // 最近一次 render() 判定不可行的原因，null 表示可行或未判断过
    pausedMedia: [], // 因"暂停自动播放"被我们暂停的原页面媒体元素，退出阅读模式时还原 autoplay
  };

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
    if (state.bodyOverflowBackup === null) {
      state.bodyOverflowBackup = document.documentElement.style.overflow;
    }
    document.documentElement.style.overflow = 'hidden';
  }

  function INS_unlockOriginalPage() {
    document.documentElement.style.overflow = state.bodyOverflowBackup || '';
    state.bodyOverflowBackup = null;
    // style.overflow = '' 只是清空属性值，留下的 style="" 仍是一条新增的空属性；
    // 页面原本没有 style 属性时，这里补一刀彻底移除，还原成打开阅读模式之前的原始标记。
    if (document.documentElement.getAttribute('style') === '') {
      document.documentElement.removeAttribute('style');
    }
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

    // 降噪总开关关闭 = 直接退出阅读视图、显示未经处理的原网页——与"可行性判断不通过"
    // 走同一条早退分支，天然复用 content.js 里 render() 返回 false 时调用
    // unlockOriginalPage() 的逻辑。不清空 summaryText/highlightHtml/typographyEnabled
    // 等其它状态，重新打开这个总开关后 render() 用同一份 state 重绘，排版和 AI 缓读
    // 内容原样恢复，不重新触发网络请求。
    if (!prefs.noiseReduction) {
      INS_remove();
      state.hiddenCount = 0;
      if (typeof state.onHiddenCountChange === 'function') {
        state.onHiddenCountChange(0);
      }
      return false;
    }

    const host = INS_ensureReaderHost();
    let shadow = host.shadowRoot;
    if (!shadow) shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = '';

    // 先记录正文节点在真实 DOM 中的下标路径，再克隆**整个 body**（而非只克隆正文节点）：
    // 广告/侧边栏/评论等干扰元素与正文在 DOM 树中是平级关系，必须存在于克隆体里，
    // 降噪选择器才能命中它们。克隆会产生全新的节点身份，因此需要按这条路径在克隆体
    // 里重新定位出等价的正文节点——但必须在**清理之前**定位：降噪会删除克隆体里正文
    // 之外（甚至位置更靠前）的兄弟节点，一旦先清理再按下标去找，下标就已经失效，
    // resolveChildIndexPath 会返回 null，导致 `|| bodyClone` 兜底把整个未清理的
    // body 当正文渲染出来。先拿到节点引用后，后续清理只操作节点树、不会使引用失效
    // （即使正文节点被移出 bodyClone，它自己和子树依然完整可用）。
    const path = domPath.getChildIndexPath(sourceNode, document.body);
    const bodyClone = document.body.cloneNode(true);
    const resolvedClone = (path && domPath.resolveChildIndexPath(bodyClone, path)) || bodyClone;
    // 第二个参数把计数范围限定在 resolvedClone（即将挂载进阅读层的正文子树）内——
    // 与正文平级的兄弟节点（真实侧边栏/页眉页脚等）即使被降噪一并摘掉，也从不会出现在
    // 阅读层里，不应该计入"已隐藏 N 个干扰元素"，否则这个数字会和用户实际看到的效果对不上。
    state.hiddenCount = noiseFilter.stripNoiseFromClone(bodyClone, resolvedClone);

    // 自动播放的暂停必须作用于原页面（克隆体里的播放器不会发声），因此单独处理；
    // 与"视频（暂停播放并隐藏）"是同一个开关的两个动作，一起生效一起还原。
    if (prefs.noiseReduction && prefs.noiseOptions.video) {
      INS_pauseAutoplayMedia();
    } else {
      INS_restoreAutoplayMedia();
    }
    if (typeof state.onHiddenCountChange === 'function') {
      state.onHiddenCountChange(state.hiddenCount);
    }

    const clone = resolvedClone;
    state.articleText = clone.textContent || '';

    // 排版总开关关闭时，阅读层改用系统默认外观（DEFAULT_PREFS），不应用用户调过的字号/颜色等——
    // 与 noiseFilter 里 noiseReduction 关闭时跳过清理步骤是同一种"总开关降级"思路。
    const typographyPrefs = prefs.typographyEnabled ? prefs : prefsStore.DEFAULT_PREFS;

    const theme = { ...typographyPrefs.customColors, accent: '#278477' };
    const maxWidth = typographyPrefs.contentWidth === 'narrow' ? '640px' : '900px';

    // 字体映射
    const fontFamilyMap = {
      default: '"Noto Sans SC", -apple-system, sans-serif',
      serif: '"Noto Serif SC", serif',
      'sans-serif': '"Noto Sans SC", -apple-system, sans-serif',
      monospace: '"Noto Sans Mono", monospace',
    };
    const fontFamily = fontFamilyMap[typographyPrefs.fontFamily] || fontFamilyMap.default;

    const style = document.createElement('style');
    style.textContent = `
      .ins-reader-overlay {
        position: fixed; inset: 0; z-index: 1;
        background: ${theme.bg};
        overflow-y: auto;
        font-family: ${fontFamily};
      }
      @keyframes ins-reader-fade-in {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      .ins-reader-progress-track {
        position: sticky; top: 0; z-index: 2;
        height: 3px;
        border-radius: 2px;
        background: rgba(0,0,0,0.06);
      }
      .ins-reader-progress-bar {
        height: 100%;
        width: 0%;
        border-radius: 2px;
        background: ${theme.accent};
        transition: width 0.1s linear;
      }
      .ins-reader-time {
        position: sticky; top: 3px; z-index: 2;
        text-align: right;
        padding: 6px 24px 0;
        font-size: 12px;
        color: ${theme.accent};
        background: ${theme.bg};
      }
      .ins-reader-article {
        max-width: ${maxWidth};
        margin: 0 auto;
        padding: 20px 24px 80px;
        color: ${theme.text};
        font-size: ${typographyPrefs.fontSize}px;
        line-height: ${typographyPrefs.lineHeight};
        letter-spacing: ${typographyPrefs.letterSpacing}em;
        opacity: 0;
        animation: ins-reader-fade-in 0.25s ease-out forwards;
      }
      .ins-reader-article p {
        margin-bottom: ${typographyPrefs.paragraphSpacing}em;
      }
      .ins-reader-article a { color: ${theme.accent}; }
      .ins-reader-article img { max-width: 100%; height: auto; }
      .ins-reader-article mark { background: ${theme.accent}33; color: inherit; border-radius: 2px; padding: 0 2px; }
      .ins-reader-article h2 { font-size: 1.4em; line-height: 1.5; margin: 1.4em 0 0.6em; color: ${theme.text}; }
      .ins-reader-article h3 { font-size: 1.15em; line-height: 1.5; margin: 1.2em 0 0.5em; color: ${theme.text}; }
      .ins-reader-article blockquote {
        margin: 0 0 ${typographyPrefs.paragraphSpacing}em;
        padding: 4px 16px;
        border-left: 3px solid ${theme.accent}88;
        color: ${theme.text}cc;
      }
      .ins-reader-article ul, .ins-reader-article ol {
        margin: 0 0 ${typographyPrefs.paragraphSpacing}em;
        padding-left: 1.4em;
      }
      .ins-reader-article li { margin-bottom: 0.4em; }
      .ins-reader-article code {
        background: ${theme.accent}14;
        border-radius: 3px;
        padding: 0.1em 0.4em;
        font-size: 0.9em;
      }
      .ins-reader-summary-float {
        position: fixed;
        top: 44px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 5;
        width: min(560px, calc(100% - 64px));
        max-height: 45vh;
        overflow-y: auto;
        padding: 14px 16px;
        border-radius: 10px;
        border: 1px solid ${theme.accent}55;
        background: ${theme.bg};
        box-shadow: 0 12px 32px rgba(0,0,0,0.16);
        font-size: 0.85em;
        line-height: 1.7;
        letter-spacing: 0;
        color: ${theme.text};
        animation: ins-reader-fade-in 0.2s ease-out;
      }
      .ins-reader-summary-float-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin: 0 0 6px;
      }
      .ins-reader-summary-float-title {
        font-weight: 600;
        color: ${theme.accent};
      }
      .ins-reader-summary-float-title::before {
        content: '✦ ';
      }
      .ins-reader-summary-float-close {
        border: 0;
        background: none;
        cursor: pointer;
        font-size: 14px;
        line-height: 1;
        color: ${theme.text};
        opacity: 0.55;
        padding: 2px;
      }
      .ins-reader-summary-float-close:hover { opacity: 1; }
      .ins-reader-summary-float-body { white-space: pre-line; }
      .ins-reader-summary-pill {
        position: fixed;
        top: 44px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 5;
        border: 1px solid ${theme.accent}55;
        border-radius: 999px;
        background: ${theme.bg};
        color: ${theme.accent};
        box-shadow: 0 8px 20px rgba(0,0,0,0.14);
        font-size: 12px;
        padding: 6px 12px;
        cursor: pointer;
      }
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

    const timeEl = document.createElement('div');
    timeEl.className = 'ins-reader-time';
    const totalMinutes = readingStats.estimateMinutes(clone.textContent || '');
    timeEl.textContent = `预计阅读 ${readingStats.formatMinutes(totalMinutes)}`;
    overlay.appendChild(timeEl);

    const articleWrap = document.createElement('div');
    articleWrap.className = 'ins-reader-article';
    // AI 内容助手总开关关闭时视为始终展示原文——与排版/降噪总开关关闭时的"总开关降级"是同一种思路。
    const showDigest = prefs.aiEnabled && state.contentVersion === 'digest';
    // AI 摘要以悬浮窗形式固定展示在阅读层顶部居中，不随"原文/缓读版"切换隐藏——
    // 只要总开关开着、摘要子开关开着、且已经生成过摘要就一直悬浮显示，用户可点×收起为小圆点。
    if (prefs.aiEnabled && prefs.aiSummary && state.summaryText) {
      if (state.summaryFloatCollapsed) {
        const pill = document.createElement('button');
        pill.className = 'ins-reader-summary-pill';
        pill.textContent = '✦ AI 摘要';
        pill.addEventListener('click', () => {
          state.summaryFloatCollapsed = false;
          INS_render();
        });
        overlay.appendChild(pill);
      } else {
        const summaryFloat = document.createElement('div');
        summaryFloat.className = 'ins-reader-summary-float';
        summaryFloat.innerHTML = `
          <div class="ins-reader-summary-float-header">
            <span class="ins-reader-summary-float-title">AI 摘要</span>
            <button class="ins-reader-summary-float-close" aria-label="收起">×</button>
          </div>
          <p class="ins-reader-summary-float-body"></p>
        `;
        summaryFloat.querySelector('.ins-reader-summary-float-body').textContent = state.summaryText;
        summaryFloat.querySelector('.ins-reader-summary-float-close').addEventListener('click', () => {
          state.summaryFloatCollapsed = true;
          INS_render();
        });
        overlay.appendChild(summaryFloat);
      }
    }
    // 高亮结果由 aiClient.highlight() 整篇重写生成（拆分长段落/简化长句/标记核心信息），
    // 一旦生成过结果，就整体替换原始 clone 的展示，而不是逐段落合并——
    // 结构化 diff 没有必要，直接展示 AI 重写后的 HTML。只在"缓读版"下展示，
    // 切回"原文"时始终展示未处理的 clone，即使已经生成过摘要/高亮也不受影响。
    if (showDigest && prefs.aiHighlight?.enabled && state.highlightHtml) {
      const highlighted = document.createElement('div');
      highlighted.innerHTML = state.highlightHtml;
      articleWrap.appendChild(highlighted);
    } else {
      articleWrap.appendChild(clone);
    }
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

    return true;
  }

  function INS_remove() {
    INS_restoreAutoplayMedia();
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

  function INS_setSummary(text) {
    state.summaryText = text || '';
    if (state.summaryText) state.summaryFloatCollapsed = false;
  }

  function INS_getSummary() {
    return state.summaryText;
  }

  function INS_setHighlightHtml(html) {
    state.highlightHtml = html || '';
  }

  function INS_getHighlightHtml() {
    return state.highlightHtml;
  }

  function INS_setContentVersion(version) {
    state.contentVersion = version === 'digest' ? 'digest' : 'original';
  }

  function INS_getContentVersion() {
    return state.contentVersion;
  }

  function INS_getLastFeasibilityReason() {
    return state.lastFeasibilityReason;
  }

  window.INS_Reader.readerLayer = {
    render: INS_render,
    remove: INS_remove,
    lockOriginalPage: INS_lockOriginalPage,
    unlockOriginalPage: INS_unlockOriginalPage,
    getHiddenCount: INS_getHiddenCount,
    setOnHiddenCountChange: INS_setOnHiddenCountChange,
    getArticleText: INS_getArticleText,
    setSummary: INS_setSummary,
    getSummary: INS_getSummary,
    setHighlightHtml: INS_setHighlightHtml,
    getHighlightHtml: INS_getHighlightHtml,
    setContentVersion: INS_setContentVersion,
    getContentVersion: INS_getContentVersion,
    getLastFeasibilityReason: INS_getLastFeasibilityReason,
  };
})();
