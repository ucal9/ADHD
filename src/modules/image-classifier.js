// Copyright (c) 2026 Insta360. All rights reserved.
// INS_Reader · 图片噪音分类
// 职责：把 <img> 分成 keep / hide / ambiguous。只看 DOM 元数据（尺寸、class、
// 地址、alt、图注、所在容器），不下载、不看像素。
// hide：追踪像素、小图标、IAB 广告尺寸、广告 class/地址、侧栏/页头页脚图。
// keep：正文里带图注的配图，或边长 ≥ 400 的正文大图。
// ambiguous：拿不准，交给调用方先藏再问 AI。
// remember()/lookup() 按去掉查询串的图片地址缓存终局结论，避免改字号重复请求。
// 调用者：noise-filter.js 在智能屏蔽开启时遍历页面图片。

window.INS_Reader = window.INS_Reader || {};

(function () {
  const IAB_SIZES = [
    [728, 90],
    [970, 90],
    [970, 250],
    [300, 250],
    [336, 280],
    [320, 50],
    [320, 100],
    [300, 600],
    [160, 600],
    [120, 600],
    [250, 250],
    [468, 60],
    [234, 60],
  ];

  const AD_HOST_RE =
    /googlesyndication|doubleclick|googletagservices|googleadservices|adsense|adservice|amazon-adsystem|adsafeprotected|adnxs|adsystem|pagead/i;
  const AD_TEXT_RE =
    /广告|赞助|推广|(^|[^a-z0-9])(ads?|advert|advertisement|sponsor|promo|banner)([^a-z0-9]|$)/i;
  const ASIDE_RE = 'aside, header, footer, nav, [class*="sidebar"], [class*="recommend"], [class*="related"]';
  const ARTICLE_RE = 'article, main, [role="main"], #article, .article';

  const memory = new Map();

  function INS_normalizeSrc(raw) {
    if (!raw) return '';
    try {
      const url = new URL(raw, typeof location !== 'undefined' ? location.href : 'https://example.invalid/');
      if (url.protocol === 'data:') return 'data:';
      return `${url.origin}${url.pathname}`;
    } catch (error) {
      return String(raw).split('?')[0].split('#')[0];
    }
  }

  function INS_readSize(el) {
    const attrW = parseFloat(el.getAttribute('width')) || 0;
    const attrH = parseFloat(el.getAttribute('height')) || 0;
    let layoutW = 0;
    let layoutH = 0;
    if (typeof el.getBoundingClientRect === 'function') {
      const rect = el.getBoundingClientRect();
      layoutW = rect.width;
      layoutH = rect.height;
    }
    const naturalW = el.naturalWidth || 0;
    const naturalH = el.naturalHeight || 0;
    // 破图占位往往只有十几像素，不能压过 width/height 属性里的真实意图。
    return {
      w: Math.round(Math.max(layoutW, attrW, naturalW)),
      h: Math.round(Math.max(layoutH, attrH, naturalH)),
    };
  }

  function INS_isIab(width, height) {
    return IAB_SIZES.some(([aw, ah]) => Math.abs(width - aw) <= 2 && Math.abs(height - ah) <= 2);
  }

  function INS_looksLikeAd(text) {
    const value = String(text || '');
    if (!value) return false;
    if (AD_HOST_RE.test(value) || AD_TEXT_RE.test(value)) return true;
    try {
      const url = new URL(value, typeof location !== 'undefined' ? location.href : 'https://example.invalid/');
      return AD_HOST_RE.test(url.hostname);
    } catch (error) {
      return false;
    }
  }

  function INS_captionOf(el) {
    const figure = el.closest && el.closest('figure');
    if (!figure) return '';
    const caption = figure.querySelector('figcaption');
    return caption ? (caption.textContent || '').trim() : '';
  }

  function INS_contextPath(el) {
    const parts = [];
    let node = el;
    for (let i = 0; i < 5 && node && node.nodeType === 1 && node !== document.body; i += 1) {
      const tag = node.tagName.toLowerCase();
      parts.unshift(node.id ? `${tag}#${node.id}` : tag);
      node = node.parentElement;
    }
    return parts.join('>');
  }

  function INS_srcOf(el) {
    return INS_normalizeSrc((el.currentSrc || el.getAttribute('src') || el.src || '').trim());
  }

  function INS_lookup(src) {
    return memory.get(INS_normalizeSrc(src)) || null;
  }

  function INS_remember(src, verdict) {
    if (verdict !== 'keep' && verdict !== 'hide') return;
    const key = INS_normalizeSrc(src);
    if (key) memory.set(key, verdict);
  }

  function INS_clearMemory() {
    memory.clear();
  }

  function INS_classify(el) {
    if (!el || el.nodeType !== 1) return 'hide';
    const src = INS_srcOf(el);
    const cached = INS_lookup(src);
    if (cached) return cached;

    const { w, h } = INS_readSize(el);
    const maxSide = Math.max(w, h);
    const haystack = [el.className, el.id, src, el.alt || '', el.getAttribute('data-src') || ''].join(' ');

    if (w > 0 && h > 0 && w <= 2 && h <= 2) return 'hide';
    if (w > 0 && h > 0 && w < 50 && h < 50) return 'hide';
    if (w > 0 && h > 0 && INS_isIab(w, h)) return 'hide';
    if (INS_looksLikeAd(haystack)) return 'hide';
    if (el.closest && el.closest(ASIDE_RE)) return 'hide';

    const inArticle = !!(el.closest && el.closest(ARTICLE_RE));
    const caption = INS_captionOf(el);
    const captionIsAd = caption && INS_looksLikeAd(caption);
    if (inArticle && caption && caption.replace(/\s+/g, '').length >= 4 && !captionIsAd && maxSide >= 200) {
      return 'keep';
    }
    if (inArticle && maxSide >= 400 && !captionIsAd) return 'keep';
    if (!inArticle && maxSide < 400) return 'hide';
    return 'ambiguous';
  }

  function INS_describe(el, index) {
    const { w, h } = INS_readSize(el);
    return {
      i: index,
      src: INS_srcOf(el),
      width: w,
      height: h,
      alt: (el.alt || '').trim().slice(0, 80),
      caption: INS_captionOf(el).slice(0, 80),
      context: INS_contextPath(el).slice(0, 160),
    };
  }

  window.INS_Reader.imageClassifier = {
    classify: INS_classify,
    describe: INS_describe,
    remember: INS_remember,
    lookup: INS_lookup,
    clearMemory: INS_clearMemory,
    normalizeSrc: INS_normalizeSrc,
  };
})();
