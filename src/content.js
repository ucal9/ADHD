// 缓读 · 内容脚本
// 职责：用 Readability 定位正文所在的原始 DOM 节点，在独立的沉浸阅读层中克隆展示，
// 并对克隆体应用用户自定义的降噪选择器规则（广告/侧边栏/评论/弹窗）。
// 阅读层与原页面 DOM 完全隔离，不修改原页面结构，避免因隐藏兄弟节点导致
// grid/flex 布局跑位。Readability 只负责“正文在哪”，不负责“清理成什么样”。

(function () {
  const STORAGE_KEY = 'huandu_prefs_v1';

  const DEFAULT_PREFS = {
    enabled: false,
    theme: 'gentle', // gentle | focus | custom
    fontSize: 18,
    contentWidth: 'wide', // wide | narrow
    noiseReduction: true,
    noiseOptions: { ads: true, sidebar: true, comments: true, banners: true },
    customColors: { bg: '#fbfcfa', text: '#3b4540' },
  };

  const THEMES = {
    gentle: { bg: '#f7f7f3', text: '#242422', accent: '#187a6e' },
    focus: { bg: '#20211f', text: '#ecede8', accent: '#83cfc0' },
  };

  const NOISE_GROUPS = {
    ads: ['[class*="advert"]', '[class*="ad-"]', '[id*="ad-"]', '[class*="promo"]'],
    sidebar: ['nav', 'aside', '[class*="sidebar"]'],
    comments: ['[class*="comment"]'],
    banners: ['header', 'footer', '[class*="banner"]', '[class*="popup"]', '[class*="modal"]', '[class*="subscribe"]', '[class*="related"]', '[class*="recommend"]'],
  };

  let prefs = { ...DEFAULT_PREFS };
  let hiddenCount = 0;
  let articleSourceRoot = null; // 原页面中定位到的正文节点（只读，从不修改）
  let readerHost = null; // 沉浸阅读层的宿主元素（Shadow DOM）
  let panelHost = null;
  let bodyOverflowBackup = null;

  function loadPrefs() {
    return new Promise((resolve) => {
      chrome.storage.sync.get([STORAGE_KEY], (result) => {
        const stored = result[STORAGE_KEY] || {};
        prefs = {
          ...DEFAULT_PREFS,
          ...stored,
          noiseOptions: { ...DEFAULT_PREFS.noiseOptions, ...(stored.noiseOptions || {}) },
          customColors: { ...DEFAULT_PREFS.customColors, ...(stored.customColors || {}) },
        };
        resolve(prefs);
      });
    });
  }

  function savePrefs() {
    chrome.storage.sync.set({ [STORAGE_KEY]: prefs });
  }

  // ---- 正文识别（只读，定位原页面节点，不修改）----
  // 用 Readability 解析文档克隆体，取其判断出的正文标题/首段文本，
  // 回到原始 document 里找与之匹配的真实节点，这样后续克隆才能带上
  // 原始 class/结构，供降噪选择器和样式继承使用。
  function findArticleRoot() {
    const byReadability = findArticleRootViaReadability();
    if (byReadability) return byReadability;
    return pickBestCandidate();
  }

  function findArticleRootViaReadability() {
    if (typeof Readability === 'undefined') return null;
    let parsed = null;
    try {
      parsed = new Readability(document.cloneNode(true), { keepClasses: true }).parse();
    } catch (err) {
      return null;
    }
    if (!parsed || !parsed.content) return null;

    const tmp = document.createElement('div');
    tmp.innerHTML = parsed.content;
    const firstText = (tmp.textContent || '').trim().slice(0, 80);
    if (!firstText) return null;

    // 在原始文档中找出文本内容与 Readability 输出最匹配、且层级最浅（最贴近
    // 正文容器本身，而非层层嵌套的祖先）的候选节点。
    const candidates = Array.from(document.body.querySelectorAll('article, main, [role="main"], div, section'));
    let best = null;
    let bestDepth = Infinity;
    for (const el of candidates) {
      const text = (el.textContent || '').trim();
      if (text.includes(firstText)) {
        let depth = 0;
        for (let n = el; n; n = n.parentElement) depth += 1;
        // 优先选择“包含目标文本的节点里，DOM 深度最大（范围最贴近正文）”的一个，
        // 即在包含关系里找最具体的容器。
        if (depth > bestDepth || best === null) {
          if (best === null || textLength(el) <= textLength(best)) {
            best = el;
            bestDepth = depth;
          }
        }
      }
    }
    return best;
  }

  function pickBestCandidate() {
    const candidates = Array.from(document.querySelectorAll('article, main, [role="main"]'));
    if (candidates.length > 0) {
      return candidates.reduce((a, b) => (textLength(a) >= textLength(b) ? a : b));
    }
    return findByTextDensity();
  }

  function textLength(el) {
    return (el.textContent || '').trim().length;
  }

  function findByTextDensity() {
    const blocks = Array.from(document.body.querySelectorAll('div, section, article'));
    let best = null;
    let bestScore = 0;
    for (const el of blocks) {
      const text = textLength(el);
      const linkText = Array.from(el.querySelectorAll('a')).reduce(
        (sum, a) => sum + textLength(a),
        0
      );
      const linkDensity = text > 0 ? linkText / text : 1;
      const score = text * (1 - linkDensity);
      if (score > bestScore) {
        bestScore = score;
        best = el;
      }
    }
    return best;
  }

  // ---- 干扰元素识别（作用于阅读层内的克隆体，不触碰原页面）----
  function activeNoiseSelectors() {
    const groups = prefs.noiseOptions || DEFAULT_PREFS.noiseOptions;
    return Object.keys(NOISE_GROUPS)
      .filter((key) => groups[key])
      .flatMap((key) => NOISE_GROUPS[key]);
  }

  function stripNoiseFromClone(cloneRoot) {
    if (!prefs.noiseReduction) return 0;
    let count = 0;
    for (const selector of activeNoiseSelectors()) {
      cloneRoot.querySelectorAll(selector).forEach((el) => {
        el.remove();
        count += 1;
      });
    }
    return count;
  }

  // 记录节点相对 root 的子节点下标路径，用于在克隆后的树里重新定位同一个节点。
  function getChildIndexPath(node, root) {
    const path = [];
    let current = node;
    while (current && current !== root) {
      const parent = current.parentNode;
      if (!parent) return null;
      path.unshift(Array.prototype.indexOf.call(parent.childNodes, current));
      current = parent;
    }
    return current === root ? path : null;
  }

  function resolveChildIndexPath(root, path) {
    let current = root;
    for (const index of path) {
      current = current && current.childNodes[index];
      if (!current) return null;
    }
    return current;
  }

  // ---- 沉浸阅读层 ----
  function ensureReaderHost() {
    if (readerHost) return readerHost;
    readerHost = document.createElement('div');
    readerHost.id = 'huandu-reader-host';
    readerHost.style.position = 'fixed';
    readerHost.style.top = '0';
    readerHost.style.left = '0';
    readerHost.style.width = '0';
    readerHost.style.height = '0';
    readerHost.style.zIndex = '2147483646'; // 面板层 z-index 减 1，面板始终盖在阅读层之上
    document.documentElement.appendChild(readerHost);
    return readerHost;
  }

  function lockOriginalPage() {
    if (bodyOverflowBackup === null) {
      bodyOverflowBackup = document.documentElement.style.overflow;
    }
    document.documentElement.style.overflow = 'hidden';
  }

  function unlockOriginalPage() {
    document.documentElement.style.overflow = bodyOverflowBackup || '';
    bodyOverflowBackup = null;
  }

  function renderReaderLayer() {
    const host = ensureReaderHost();
    let shadow = host.shadowRoot;
    if (!shadow) shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = '';

    articleSourceRoot = articleSourceRoot || findArticleRoot();
    const sourceNode = articleSourceRoot || document.body;

    // 克隆整个 body（而非只克隆正文节点），这样广告/侧边栏/评论等
    // 与正文平级的干扰元素才能被降噪选择器命中。清理后再按路径
    // 找回正文节点，只把这部分内容放进阅读层展示。
    const path = getChildIndexPath(sourceNode, document.body);
    const bodyClone = document.body.cloneNode(true);
    hiddenCount = stripNoiseFromClone(bodyClone);
    updatePanelNoiseCount();

    const clone = (path && resolveChildIndexPath(bodyClone, path)) || bodyClone;

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
      .huandu-reader-article {
        max-width: ${maxWidth};
        margin: 0 auto;
        padding: 56px 24px 80px;
        color: ${theme.text};
        font-size: ${prefs.fontSize}px;
        line-height: 1.8;
      }
      .huandu-reader-article a { color: ${theme.accent}; }
      .huandu-reader-article img { max-width: 100%; height: auto; }
    `;
    shadow.appendChild(style);

    const overlay = document.createElement('div');
    overlay.className = 'huandu-reader-overlay';
    const articleWrap = document.createElement('div');
    articleWrap.className = 'huandu-reader-article';
    articleWrap.appendChild(clone);
    overlay.appendChild(articleWrap);
    shadow.appendChild(overlay);
  }

  function removeReaderLayer() {
    if (readerHost) {
      readerHost.remove();
      readerHost = null;
    }
  }

  function restoreOriginalPage() {
    prefs.enabled = false;
    removeReaderLayer();
    unlockOriginalPage();
    savePrefs();
    renderPanel();
  }

  function applyAll() {
    if (!prefs.enabled) {
      removeReaderLayer();
      unlockOriginalPage();
      return;
    }
    lockOriginalPage();
    renderReaderLayer();
  }

  // ---- 面板 UI（Shadow DOM，避免样式冲突）----
  function ensurePanelHost() {
    if (panelHost) return panelHost;
    panelHost = document.createElement('div');
    panelHost.id = 'huandu-panel-host';
    panelHost.style.position = 'fixed';
    panelHost.style.top = '0';
    panelHost.style.left = '0';
    panelHost.style.width = '0';
    panelHost.style.height = '0';
    panelHost.style.zIndex = '2147483647';
    document.documentElement.appendChild(panelHost);
    return panelHost;
  }

  function updatePanelNoiseCount() {
    const shadow = panelHost && panelHost.shadowRoot;
    if (!shadow) return;
    const countEl = shadow.querySelector('[data-role="noise-count"]');
    if (countEl) countEl.textContent = String(hiddenCount);
  }

  window.__huanduToggle = function () {
    const host = ensurePanelHost();
    const shadow = host.shadowRoot;
    const existing = shadow && shadow.querySelector('.huandu-panel');
    if (existing) {
      closePanel(existing);
      return;
    }
    renderPanel();
  };

  function closePanel(panelEl) {
    panelEl.classList.add('closing');
    panelEl.addEventListener('animationend', () => panelEl.remove(), { once: true });
  }

  const FONT_MIN = 14;
  const FONT_MAX = 28;

  function renderPanel() {
    const host = ensurePanelHost();
    let shadow = host.shadowRoot;
    if (!shadow) shadow = host.attachShadow({ mode: 'open' });
    const isFirstOpen = !shadow.querySelector('.huandu-panel');
    shadow.innerHTML = '';

    const style = document.createElement('style');
    style.textContent = PANEL_CSS;
    shadow.appendChild(style);

    const noiseLabels = { ads: '广告', sidebar: '侧边栏/导航', comments: '评论区', banners: '弹窗/横幅' };

    const panel = document.createElement('div');
    panel.className = isFirstOpen ? 'huandu-panel opening' : 'huandu-panel';
    panel.innerHTML = `
      <div class="panel-top">
        <div class="brand">缓读</div>
        <button class="close-btn" data-role="close" aria-label="关闭">×</button>
      </div>
      <p class="tagline">把阅读调成适合你的样子</p>

      <div class="segmented" data-role="theme-group">
        ${['gentle', 'focus', 'custom']
          .map(
            (t) =>
              `<button data-theme="${t}" class="${prefs.theme === t ? 'selected' : ''}">${
                { gentle: '温和', focus: '专注', custom: '自定义' }[t]
              }</button>`
          )
          .join('')}
      </div>

      ${
        prefs.theme === 'custom'
          ? `<div class="custom-colors">
              <label>背景 <input type="color" data-role="custom-bg" value="${prefs.customColors.bg}" /></label>
              <label>文字 <input type="color" data-role="custom-text" value="${prefs.customColors.text}" /></label>
            </div>`
          : ''
      }

      <div class="setting">
        <span>字号 <b data-role="font-size-value">${prefs.fontSize}</b></span>
        <div class="stepper">
          <button data-role="font-minus" ${prefs.fontSize <= FONT_MIN ? 'disabled' : ''}>−</button>
          <input type="range" min="${FONT_MIN}" max="${FONT_MAX}" step="1" value="${prefs.fontSize}" data-role="font-size" />
          <button data-role="font-plus" ${prefs.fontSize >= FONT_MAX ? 'disabled' : ''}>＋</button>
        </div>
      </div>

      <div class="width-row">
        <span>内容宽度</span>
        <button data-width="wide" class="${prefs.contentWidth === 'wide' ? 'active' : ''}">宽</button>
        <button data-width="narrow" class="${prefs.contentWidth === 'narrow' ? 'active' : ''}">窄</button>
      </div>

      <div class="noise-main">
        <label>动态降噪</label>
        <button class="switch ${prefs.noiseReduction ? 'on' : ''}" data-role="noise-switch"><span></span></button>
      </div>
      <div class="noise-settings ${prefs.noiseReduction ? '' : 'disabled'}" data-role="noise-settings">
        ${Object.keys(NOISE_GROUPS)
          .map(
            (key) => `
          <div class="noise-row">
            <span>${noiseLabels[key]}</span>
            <button class="switch small ${prefs.noiseOptions[key] ? 'on' : ''}" data-noise-key="${key}"><span></span></button>
          </div>`
          )
          .join('')}
      </div>
      <p class="noise-feedback">本页已隐藏 <b data-role="noise-count">${hiddenCount}</b> 个干扰元素</p>

      <button class="restore" data-role="restore">恢复原网页</button>
    `;
    shadow.appendChild(panel);

    // 事件绑定
    panel.querySelector('[data-role="close"]').addEventListener('click', () => closePanel(panel));

    panel.querySelectorAll('[data-theme]').forEach((btn) => {
      btn.addEventListener('click', () => {
        prefs.theme = btn.getAttribute('data-theme');
        prefs.enabled = true;
        savePrefs();
        applyAll();
        renderPanel();
      });
    });

    const customBg = panel.querySelector('[data-role="custom-bg"]');
    const customText = panel.querySelector('[data-role="custom-text"]');
    if (customBg && customText) {
      customBg.addEventListener('input', () => {
        prefs.customColors.bg = customBg.value;
        applyAll();
      });
      customText.addEventListener('input', () => {
        prefs.customColors.text = customText.value;
        applyAll();
      });
      [customBg, customText].forEach((input) => input.addEventListener('change', savePrefs));
    }

    const fontInput = panel.querySelector('[data-role="font-size"]');
    function setFontSize(value) {
      prefs.fontSize = Math.min(FONT_MAX, Math.max(FONT_MIN, value));
      prefs.enabled = true;
      applyAll();
      savePrefs();
      renderPanel();
    }
    fontInput.addEventListener('input', () => {
      prefs.fontSize = Number(fontInput.value);
      prefs.enabled = true;
      panel.querySelector('[data-role="font-size-value"]').textContent = prefs.fontSize;
      applyAll();
    });
    fontInput.addEventListener('change', savePrefs);
    panel.querySelector('[data-role="font-minus"]').addEventListener('click', () => setFontSize(prefs.fontSize - 1));
    panel.querySelector('[data-role="font-plus"]').addEventListener('click', () => setFontSize(prefs.fontSize + 1));

    panel.querySelectorAll('[data-width]').forEach((btn) => {
      btn.addEventListener('click', () => {
        prefs.contentWidth = btn.getAttribute('data-width');
        prefs.enabled = true;
        savePrefs();
        applyAll();
        renderPanel();
      });
    });

    panel.querySelector('[data-role="noise-switch"]').addEventListener('click', () => {
      prefs.noiseReduction = !prefs.noiseReduction;
      savePrefs();
      applyAll();
      renderPanel();
    });

    panel.querySelectorAll('[data-noise-key]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.getAttribute('data-noise-key');
        prefs.noiseOptions[key] = !prefs.noiseOptions[key];
        savePrefs();
        applyAll();
        renderPanel();
      });
    });

    panel.querySelector('[data-role="restore"]').addEventListener('click', restoreOriginalPage);
  }

  const PANEL_CSS = `
    :host { all: initial; }
    .huandu-panel {
      position: fixed;
      top: 78px;
      right: 18px;
      width: 330px;
      padding: 17px 17px 13px;
      font-family: "Noto Sans SC", -apple-system, sans-serif;
      font-size: 12px;
      color: #33403a;
      background: #fffdf9;
      border: 1px solid #ccd4ce;
      border-radius: 7px;
      box-shadow: 0 18px 46px rgba(37, 59, 51, 0.12);
      transform-origin: top right;
    }
    .huandu-panel.opening { animation: huandu-in 0.16s ease-out; }
    .huandu-panel.closing { animation: huandu-out 0.14s ease-in forwards; }
    @keyframes huandu-in {
      from { opacity: 0; transform: scale(0.96) translateY(-4px); }
      to { opacity: 1; transform: scale(1) translateY(0); }
    }
    @keyframes huandu-out {
      from { opacity: 1; transform: scale(1) translateY(0); }
      to { opacity: 0; transform: scale(0.96) translateY(-4px); }
    }
    .panel-top { display: flex; justify-content: space-between; align-items: flex-start; }
    .brand { font-size: 18px; font-weight: 700; color: #21463f; }
    .close-btn {
      background: none; border: 0; font-size: 16px; line-height: 1; color: #7c8580;
      cursor: pointer; padding: 2px 4px;
    }
    .close-btn:hover { color: #33403a; }
    .tagline { margin: 5px 0 14px; font-size: 11px; color: #287e72; }
    .segmented {
      display: grid; grid-template-columns: repeat(3, 1fr);
      background: #eef1ed; border-radius: 4px; padding: 2px; margin-bottom: 10px;
    }
    .segmented button {
      background: none; border: 0; border-radius: 3px; padding: 5px; font-size: 11px;
      color: #65716a; cursor: pointer; transition: background 0.15s, color 0.15s;
    }
    .segmented button.selected { background: #fff; color: #19786c; font-weight: 600; box-shadow: 0 1px 3px rgba(32,44,37,0.08); }
    .custom-colors { display: flex; gap: 14px; margin-bottom: 10px; font-size: 11px; color: #56625c; }
    .custom-colors label { display: flex; align-items: center; gap: 6px; }
    .custom-colors input[type="color"] { width: 24px; height: 20px; border: 1px solid #d7ded8; border-radius: 3px; padding: 0; cursor: pointer; }
    .setting { margin: 8px 0; }
    .setting span { display: flex; justify-content: space-between; color: #56625c; margin-bottom: 4px; }
    .setting b { color: #278477; font-weight: 500; }
    .stepper { display: flex; align-items: center; gap: 6px; }
    .stepper input[type="range"] { flex: 1; accent-color: #258578; }
    .stepper button {
      width: 20px; height: 20px; flex: none; border: 1px solid #d7ded8; border-radius: 4px;
      background: #fff; color: #59625e; cursor: pointer; font-size: 13px; line-height: 1;
      display: flex; align-items: center; justify-content: center; transition: background 0.15s;
    }
    .stepper button:hover:not(:disabled) { background: #eef1ed; }
    .stepper button:disabled { opacity: 0.4; cursor: default; }
    .width-row { display: flex; align-items: center; gap: 5px; margin-top: 8px; color: #56625c; }
    .width-row span { margin-right: auto; }
    .width-row button {
      background: none; border: 0; border-radius: 3px; padding: 5px; font-size: 11px;
      color: #65716a; cursor: pointer; transition: background 0.15s, color 0.15s;
    }
    .width-row button.active { color: #187a6e; background: #deeee8; }
    .noise-main {
      display: flex; justify-content: space-between; align-items: center;
      background: #eaf5f0; border-radius: 5px; margin: 10px 0 6px; padding: 10px 11px;
    }
    .noise-main label { font-size: 12px; font-weight: 700; color: #246d62; }
    .switch {
      cursor: pointer; background: #c8d0ca; border: 0; border-radius: 999px;
      width: 33px; height: 18px; padding: 2px; transition: background 0.18s;
    }
    .switch span { display: block; width: 14px; height: 14px; background: #fff; border-radius: 50%; transition: transform 0.18s; box-shadow: 0 1px 2px rgba(0,0,0,0.13); }
    .switch.on { background: #1f8b7d; }
    .switch.on span { transform: translateX(15px); }
    .switch.small { width: 27px; height: 15px; }
    .switch.small span { width: 11px; height: 11px; }
    .switch.small.on span { transform: translateX(12px); }
    .noise-settings { display: flex; flex-direction: column; gap: 3px; margin: 0 0 6px 4px; transition: opacity 0.15s; }
    .noise-settings.disabled { opacity: 0.45; pointer-events: none; }
    .noise-row { display: flex; justify-content: space-between; align-items: center; height: 26px; color: #53615a; }
    .noise-feedback { margin: 7px 0 0; font-size: 10px; color: #718078; }
    .restore {
      width: 100%; height: 30px; margin: 15px 0 0; display: flex; align-items: center; justify-content: center;
      color: #53615a; background: #fff; border: 1px solid #d7ded8; border-radius: 4px; cursor: pointer; font-size: 12px;
      transition: background 0.15s;
    }
    .restore:hover { background: #f6f8f5; }
  `;

  // ---- 初始化 ----
  loadPrefs().then(() => {
    if (prefs.enabled) applyAll();
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'HUANDU_TOGGLE_PANEL') {
      if (!prefs.enabled) {
        prefs.enabled = true;
        savePrefs();
        applyAll();
      }
      window.__huanduToggle();
    }
  });
})();
