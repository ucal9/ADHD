// Copyright (c) 2026 Insta360. All rights reserved.
// INS_Reader · 降噪清理模块
// 职责：维护降噪选择器规则组。未全开细分时对真实页面做可逆隐藏；
// 四开关全开时对 DOM 克隆体执行清理（不触碰原页面结构）。
// 依赖 INS_Reader.prefsStore 读取用户当前开启的降噪类别。
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
    // 屏蔽视频、动画和图片：媒体标签与常见播放器壳一起摘掉，再向上收空壳，
    // 避免封面图/固定高度容器留下空白。正文配图也去掉，由用户自行控制该选项。
    blockAllVideos: [
      'video',
      'img',
      'picture',
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
    INS_collapseEmptyInClone(cloneRoot, protectRoot);
    return count;
  }

  const LIVE_HIDE_ATTR = 'data-ins-noise-hide';
  const LIVE_STYLE_ID = 'ins-reader-live-noise-style';

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

  function INS_clearLiveHide() {
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
    document.querySelectorAll(`[${LIVE_HIDE_ATTR}]`).forEach((el) => {
      el.removeAttribute(LIVE_HIDE_ATTR);
    });
    const prefs = window.INS_Reader.prefsStore.get();
    if (!prefs.noiseReduction) {
      const style = document.getElementById(LIVE_STYLE_ID);
      if (style) style.remove();
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
    INS_collapseEmptyAncestors(mediaStarts, protectRoot, 'blockAllVideos');
    count += INS_eachExtraSiteNode(document.body, prefs, protectRoot, (el, category) => {
      if (INS_isExtensionHost(el)) return;
      if (el.closest('#ins-reader-host, #ins-reader-panel-host, #ins-reader-ai-card-host')) return;
      el.setAttribute(LIVE_HIDE_ATTR, category);
    });
    INS_setLiveHideCss(cssSelectors);
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
  };
})();
