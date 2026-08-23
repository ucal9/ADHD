// Copyright (c) 2026 Insta360. All rights reserved.
// INS_Reader · 降噪清理模块
// 职责：维护降噪选择器规则组。未全开细分时对真实页面做可逆隐藏；
// 四开关全开时对 DOM 克隆体执行清理（不触碰原页面结构）。
// 依赖 INS_Reader.prefsStore 读取用户当前开启的降噪类别；
// 智能屏蔽图片依赖 INS_Reader.imageClassifier（须先加载）和可选的 aiClient.classifyImages。
// 调用者：reader-layer.js 的 render() 调用 stripNoiseFromClone() / isStrictArticleMode()；
// panel-ui.js 读取 UI_NOISE_KEYS 来渲染降噪类别开关。

window.INS_Reader = window.INS_Reader || {};

(function () {
  const NOISE_GROUPS = {
    ads: ['[class*="advert"]', '[class*="ad-"]', '[id*="ad-"]', '[class*="promo"]'],
    sidebar: ['nav', 'aside', '[class*="sidebar"]'],
    comments: ['[class*="comment"]'],
    banners: ['header', 'footer', '[class*="banner"]', '[class*="popup"]', '[class*="modal"]', '[class*="subscribe"]', '[class*="related"]', '[class*="recommend"]', '[class*="toolbox"]', '[class*="toolbar"]'],
    // 会员/登录墙推销 UI：常见于 CSDN、掘金等技术博客站——蒙层遮挡正文、
    // 求关注/求登录浮层、VIP 购买卡片，混在正文容器内部而非平级兄弟节点。
    marketing: ['[class*="vip-mask"]', '[class*="mask-dark"]', '[class*="article-vip"]', '[class*="openvippay"]', '[class*="unlogin"]', '[class*="login-mask"]'],
    // 智能屏蔽：视频/动画/播放器壳仍用选择器一刀切；图片不再进选择器，
    // 改由 imageClassifier 逐张判定，只藏无意义图，正文配图留下。
    blockAllVideos: [
      'video',
      'canvas',
      'iframe[src*="youtube"]',
      'iframe[src*="bilibili"]',
      'iframe[src*="vimeo"]',
      'iframe[src*="player"]',
      '[class*="video-player"]',
      '[class*="videoPlayer"]',
    ],
  };

  // 动态降噪始终作用于原页面，避免任何降噪组合把网页替换成正文克隆，
  // 从而破坏站点原有的布局、滚动容器和 DOM 关系。正文阅读层只保留给显式阅读流程。
  const UI_NOISE_KEYS = ['sidebar', 'comments', 'banners', 'blockAllVideos'];

  function INS_uniqueSelectors(generic, site) {
    const seen = new Set();
    const out = [];
    for (const selector of [...generic, ...(site || [])]) {
      if (!selector || seen.has(selector)) continue;
      seen.add(selector);
      out.push(selector);
    }
    return out;
  }

  function INS_isStrictArticleMode(prefs) {
    return false;
  }

  function INS_activeRules(prefs) {
    const current = prefs || window.INS_Reader.prefsStore.get();
    const groups = current.noiseOptions || window.INS_Reader.prefsStore.DEFAULT_PREFS.noiseOptions;
    const siteGroups = window.INS_Reader.siteAdapters?.getNoiseSelectors?.() || {};
    const strict = INS_isStrictArticleMode(current);
    // 整页模式只执行面板上能看见的分类，避免 ads/marketing 在没有对应按钮时偷偷删节点。
    // 四开关全开进入正文模式时，再叠上 ads/marketing。
    const keys = strict ? Object.keys(NOISE_GROUPS) : UI_NOISE_KEYS;
    const mergedGroups = Object.fromEntries(
      keys.map((key) => [key, INS_uniqueSelectors(NOISE_GROUPS[key] || [], siteGroups[key])])
    );
    // 分类之间使用并集语义：任意一个已开启的分类命中节点，节点就会被移除。
    return Object.entries(mergedGroups)
      .filter(([key]) => groups[key])
      .flatMap(([category, selectors]) =>
        selectors.map((selector) => ({ category, selector }))
      );
  }

  function INS_protectList(protectRoot) {
    if (!protectRoot) return [];
    return Array.isArray(protectRoot) ? protectRoot.filter(Boolean) : [protectRoot];
  }

  function INS_isProtected(el, protectRoot) {
    if (!el) return false;
    for (const root of INS_protectList(protectRoot)) {
      if (el === root) return true;
      // 正文/标题的祖先不能删：删掉会把它们一起带走。
      if (el.contains(root)) return true;
    }
    return false;
  }

  const IGNORE_EMPTY_TAGS = { SCRIPT: 1, STYLE: 1, LINK: 1, NOSCRIPT: 1, META: 1, BR: 1, SOURCE: 1, TRACK: 1 };
  const SUBSTANCE_TAGS = {
    IFRAME: 1,
    OBJECT: 1,
    EMBED: 1,
    INPUT: 1,
    TEXTAREA: 1,
    SELECT: 1,
    BUTTON: 1,
    HR: 1,
    TABLE: 1,
    SVG: 1,
    VIDEO: 1,
    AUDIO: 1,
    IMG: 1,
    CANVAS: 1,
    PICTURE: 1,
  };

  function INS_isIgnorableShellNode(el) {
    return !el || el.nodeType !== 1 || IGNORE_EMPTY_TAGS[el.tagName] === 1;
  }

  // 判断节点在隐藏若干子节点后是否还剩可见文字或未隐藏内容。
  // hideAttr 为 null 时只看当前 DOM（克隆体里被删掉的节点已经不在树上）。
  function INS_hasVisibleSubstance(el, hideAttr) {
    if (!el) return false;
    if (el.nodeType === 1) {
      if (hideAttr && el.hasAttribute(hideAttr)) return false;
      if (INS_isIgnorableShellNode(el)) return false;
      if (INS_isExtensionHost(el)) return false;
      if (SUBSTANCE_TAGS[el.tagName] === 1) return true;
    }
    const children = el.childNodes;
    for (let i = 0; i < children.length; i += 1) {
      const child = children[i];
      if (child.nodeType === 3) {
        if (child.textContent && child.textContent.trim()) return true;
      } else if (child.nodeType === 1) {
        if (INS_hasVisibleSubstance(child, hideAttr)) return true;
      }
    }
    return false;
  }

  // 真实页：从已隐藏的媒体节点向上，把只剩空壳的包装也 display:none，让后文回流。
  function INS_collapseEmptyAncestors(starts, protectRoot, category) {
    const hideAttr = LIVE_HIDE_ATTR;
    const queued = [];
    const seen = new Set();
    for (const el of starts) {
      if (el && el.parentElement) queued.push(el.parentElement);
    }
    while (queued.length) {
      const parent = queued.shift();
      if (!parent || seen.has(parent)) continue;
      seen.add(parent);
      if (parent === document.body || parent === document.documentElement) continue;
      if (INS_isExtensionHost(parent) || INS_isProtected(parent, protectRoot)) continue;
      if (INS_hasVisibleSubstance(parent, hideAttr)) continue;
      parent.setAttribute(hideAttr, category);
      if (parent.parentElement) queued.push(parent.parentElement);
    }
  }

  // 克隆体：从深到浅摘掉已经没有实质内容的空壳，避免固定高度容器留白。
  function INS_collapseEmptyInClone(cloneRoot, protectRoot) {
    if (!cloneRoot || !cloneRoot.querySelectorAll) return;
    const nodes = Array.from(
      cloneRoot.querySelectorAll('div, p, figure, picture, section, span, a, li, header, aside, article')
    );
    for (let i = nodes.length - 1; i >= 0; i -= 1) {
      const el = nodes[i];
      if (!el.parentNode) continue;
      if (INS_isProtected(el, protectRoot)) continue;
      if (INS_hasVisibleSubstance(el, null)) continue;
      el.remove();
    }
  }

  function INS_isExtensionHost(el) {
    if (!el || el.nodeType !== 1) return false;
    const id = el.id;
    return id === 'ins-reader-host' || id === 'ins-reader-panel-host' || id === 'ins-reader-ai-card-host';
  }

  function INS_enabledCategories(prefs) {
    return new Set(INS_activeRules(prefs).map((rule) => rule.category));
  }

  function INS_eachExtraSiteNode(root, prefs, protectRoot, visit) {
    const finder = window.INS_Reader.siteAdapters?.findExtraNoiseNodes;
    if (typeof finder !== 'function' || !root) return 0;
    let count = 0;
    INS_enabledCategories(prefs).forEach((category) => {
      const nodes = finder(root, category) || [];
      nodes.forEach((el) => {
        if (!el) return;
        if (INS_isProtected(el, protectRoot)) return;
        visit(el, category);
        count += 1;
      });
    });
    return count;
  }

  // 返回移除的元素数量。cloneRoot 必须是克隆体，绝不作用于原始 DOM。
  // protectRoot 是克隆体里的正文节点：命中它或其祖先时跳过删除。
  function INS_stripNoiseFromClone(cloneRoot, protectRoot) {
    const prefs = window.INS_Reader.prefsStore.get();
    if (!prefs.noiseReduction) return 0;
    let count = 0;
    for (const { selector } of INS_activeRules(prefs)) {
      let elements;
      try {
        elements = cloneRoot.querySelectorAll(selector);
      } catch (error) {
        // 单个站点适配器规则失效时跳过该规则，不能阻断阅读层渲染和计数回调。
        console.warn('[INS_Reader][noise-filter] 忽略无效降噪选择器', {
          selector,
          message: error && error.message ? error.message : String(error),
        });
        continue;
      }
      elements.forEach((el) => {
        if (!el.parentNode) return;
        if (INS_isProtected(el, protectRoot)) return;
        el.remove();
        count += 1;
      });
    }
    count += INS_eachExtraSiteNode(cloneRoot, prefs, protectRoot, (el) => {
      if (el.parentNode) el.remove();
    });
    count += INS_stripSmartImagesFromClone(cloneRoot, protectRoot, prefs);
    INS_collapseEmptyInClone(cloneRoot, protectRoot);
    return count;
  }

  const LIVE_HIDE_ATTR = 'data-ins-noise-hide';
  const LIVE_STYLE_ID = 'ins-reader-live-noise-style';
  const MAX_AI_IMAGES = 24;
  let hideGeneration = 0;
  let lastRestorePromise = Promise.resolve();
  let imageObserver = null;
  let imageWatchTimer = null;
  let watchedProtectRoot = null;

  function INS_isSkippableImage(el, protectRoot) {
    if (!el) return true;
    if (INS_isExtensionHost(el) || INS_isProtected(el, protectRoot)) return true;
    if (el.closest('#ins-reader-host, #ins-reader-panel-host, #ins-reader-ai-card-host')) return true;
    return false;
  }

  function INS_stripSmartImagesFromClone(cloneRoot, protectRoot, prefs) {
    if (!prefs.noiseOptions || !prefs.noiseOptions.blockAllVideos) return 0;
    const classifier = window.INS_Reader.imageClassifier;
    if (!classifier || !cloneRoot.querySelectorAll) return 0;
    let count = 0;
    cloneRoot.querySelectorAll('img').forEach((el) => {
      if (!el.parentNode) return;
      if (INS_isProtected(el, protectRoot)) return;
      if (classifier.classify(el) === 'keep') return;
      el.remove();
      count += 1;
    });
    return count;
  }

  function INS_hideSmartImages(protectRoot, mediaStarts) {
    const classifier = window.INS_Reader.imageClassifier;
    const prefs = window.INS_Reader.prefsStore.get();
    const result = { hidden: 0, ambiguous: [] };
    if (!prefs.noiseOptions || !prefs.noiseOptions.blockAllVideos || !classifier) return result;
    document.body.querySelectorAll('img').forEach((el) => {
      if (INS_isSkippableImage(el, protectRoot)) return;
      if (el.closest(`[${LIVE_HIDE_ATTR}]`)) return;
      const verdict = classifier.classify(el);
      if (verdict === 'keep') return;
      el.setAttribute(LIVE_HIDE_ATTR, 'blockAllVideos');
      mediaStarts.push(el);
      result.hidden += 1;
      if (verdict === 'ambiguous') result.ambiguous.push(el);
    });
    return result;
  }

  function INS_revealNode(el) {
    if (!el) return;
    el.removeAttribute(LIVE_HIDE_ATTR);
    let parent = el.parentElement;
    while (parent && parent !== document.body && parent !== document.documentElement) {
      if (parent.getAttribute(LIVE_HIDE_ATTR) === 'blockAllVideos' && INS_hasVisibleSubstance(parent, LIVE_HIDE_ATTR)) {
        parent.removeAttribute(LIVE_HIDE_ATTR);
      }
      parent = parent.parentElement;
    }
  }

  function INS_mediaShieldOn() {
    const prefs = window.INS_Reader.prefsStore.get();
    return !!(prefs.noiseReduction && prefs.noiseOptions && prefs.noiseOptions.blockAllVideos);
  }

  async function INS_requestImageRestore(images, generation) {
    const classifier = window.INS_Reader.imageClassifier;
    const aiClient = window.INS_Reader.aiClient;
    if (!images.length || !classifier || !aiClient || typeof aiClient.classifyImages !== 'function') {
      return;
    }
    const pending = images.slice(0, MAX_AI_IMAGES);
    const items = pending.map((el, i) => classifier.describe(el, i));
    try {
      const keepIds = await aiClient.classifyImages(items);
      pending.forEach((el, i) => {
        const src = items[i].src;
        if (keepIds.indexOf(i) !== -1) classifier.remember(src, 'keep');
        else classifier.remember(src, 'hide');
      });
      if (generation !== hideGeneration || !INS_mediaShieldOn()) return;
      keepIds.forEach((i) => {
        const el = pending[i];
        if (!el || !el.isConnected) return;
        INS_revealNode(el);
      });
      const layer = window.INS_Reader.readerLayer;
      if (layer && typeof layer.setHiddenCount === 'function') {
        layer.setHiddenCount(document.querySelectorAll(`[${LIVE_HIDE_ATTR}]`).length);
      }
    } catch (error) {
      // 失败保持隐藏：开关仍生效，只是正文配图可能不再恢复。
    }
  }

  function INS_watchNewImages(protectRoot) {
    watchedProtectRoot = protectRoot;
    if (imageObserver) return;
    imageObserver = new MutationObserver(() => {
      if (imageWatchTimer) clearTimeout(imageWatchTimer);
      imageWatchTimer = setTimeout(() => {
        if (!INS_mediaShieldOn()) return;
        const mediaStarts = [];
        const pending = INS_hideSmartImages(watchedProtectRoot, mediaStarts);
        if (!pending.hidden) return;
        INS_collapseEmptyAncestors(mediaStarts, watchedProtectRoot, 'blockAllVideos');
        if (pending.ambiguous.length) {
          lastRestorePromise = INS_requestImageRestore(pending.ambiguous, hideGeneration);
        }
      }, 200);
    });
    imageObserver.observe(document.body, { childList: true, subtree: true });
  }

  function INS_selectorTouchesProtect(selector, protectRoot) {
    if (!protectRoot) return false;
    try {
      const nodes = document.body.querySelectorAll(selector);
      for (const el of nodes) {
        if (INS_isProtected(el, protectRoot)) return true;
      }
    } catch (error) {
      return true;
    }
    return false;
  }

  function INS_setLiveHideCss(selectors) {
    let style = document.getElementById(LIVE_STYLE_ID);
    if (!style) {
      style = document.createElement('style');
      style.id = LIVE_STYLE_ID;
      document.documentElement.appendChild(style);
    }
    const rules = [`[${LIVE_HIDE_ATTR}]{display:none !important}`];
    for (const selector of selectors) {
      rules.push(`${selector}{display:none !important}`);
    }
    style.textContent = rules.join('\n');
  }

  function INS_stopImageWatch() {
    if (imageObserver) {
      imageObserver.disconnect();
      imageObserver = null;
    }
    if (imageWatchTimer) {
      clearTimeout(imageWatchTimer);
      imageWatchTimer = null;
    }
  }

  function INS_clearLiveHide() {
    hideGeneration += 1;
    lastRestorePromise = Promise.resolve();
    INS_stopImageWatch();
    if (window.INS_Reader.imageClassifier) window.INS_Reader.imageClassifier.clearMemory();
    document.querySelectorAll(`[${LIVE_HIDE_ATTR}]`).forEach((el) => {
      el.removeAttribute(LIVE_HIDE_ATTR);
    });
    const style = document.getElementById(LIVE_STYLE_ID);
    if (style) style.remove();
  }

  // 未全开细分时在真实页面上按开关隐藏噪音，不拆 DOM、不进 Shadow，
  // 这样侧栏/评论关掉隐藏后仍留在原来的 grid/flex 位置。
  // 选择器会同时写入 stylesheet：新浪底部图示墙是异步插入的，只打属性会漏掉晚到的节点。
  function INS_applyLiveHide(protectRoot) {
    hideGeneration += 1;
    const generation = hideGeneration;
    document.querySelectorAll(`[${LIVE_HIDE_ATTR}]`).forEach((el) => {
      el.removeAttribute(LIVE_HIDE_ATTR);
    });
    const prefs = window.INS_Reader.prefsStore.get();
    if (!prefs.noiseReduction) {
      INS_stopImageWatch();
      const style = document.getElementById(LIVE_STYLE_ID);
      if (style) style.remove();
      lastRestorePromise = Promise.resolve();
      return 0;
    }
    const cssSelectors = [];
    const mediaStarts = [];
    let count = 0;
    for (const { selector, category } of INS_activeRules(prefs)) {
      let elements;
      try {
        elements = document.body.querySelectorAll(selector);
      } catch (error) {
        console.warn('[INS_Reader][noise-filter] 忽略无效降噪选择器', {
          selector,
          message: error && error.message ? error.message : String(error),
        });
        continue;
      }
      if (!INS_selectorTouchesProtect(selector, protectRoot)) {
        cssSelectors.push(selector);
      }
      elements.forEach((el) => {
        if (INS_isExtensionHost(el) || INS_isProtected(el, protectRoot)) return;
        if (el.closest('#ins-reader-host, #ins-reader-panel-host, #ins-reader-ai-card-host')) return;
        el.setAttribute(LIVE_HIDE_ATTR, category);
        if (category === 'blockAllVideos') mediaStarts.push(el);
        count += 1;
      });
    }
    const pendingImages = INS_hideSmartImages(protectRoot, mediaStarts);
    count += pendingImages.hidden;
    INS_collapseEmptyAncestors(mediaStarts, protectRoot, 'blockAllVideos');
    count += INS_eachExtraSiteNode(document.body, prefs, protectRoot, (el, category) => {
      if (INS_isExtensionHost(el)) return;
      if (el.closest('#ins-reader-host, #ins-reader-panel-host, #ins-reader-ai-card-host')) return;
      el.setAttribute(LIVE_HIDE_ATTR, category);
    });
    INS_setLiveHideCss(cssSelectors);
    if (prefs.noiseOptions && prefs.noiseOptions.blockAllVideos) {
      INS_watchNewImages(protectRoot);
      lastRestorePromise = INS_requestImageRestore(pendingImages.ambiguous, generation);
    } else {
      INS_stopImageWatch();
      lastRestorePromise = Promise.resolve();
    }
    return count;
  }

  window.INS_Reader.noiseFilter = {
    NOISE_GROUPS,
    UI_NOISE_KEYS,
    LIVE_HIDE_ATTR,
    isStrictArticleMode: INS_isStrictArticleMode,
    stripNoiseFromClone: INS_stripNoiseFromClone,
    applyLiveHide: INS_applyLiveHide,
    clearLiveHide: INS_clearLiveHide,
    whenImagesClassified: () => lastRestorePromise,
  };
})();
