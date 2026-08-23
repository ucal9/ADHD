// Copyright (c) 2026 Insta360. All rights reserved.
// INS_Reader · 新浪文章页适配器
// 职责：为新浪新闻文章页提供稳定的正文根节点、标题和降噪选择器。
// 只读查询真实页面，删除操作仍由 noise-filter.js 作用于 body 克隆体。

window.INS_Reader = window.INS_Reader || {};

(function () {
  const SINA_HOSTS = ['sina.com.cn', 'sina.cn'];
  const BAIKE_HOSTS = ['baike.baidu.com'];

  function isSinaPage() {
    return SINA_HOSTS.some(
      (host) => location.hostname === host || location.hostname.endsWith(`.${host}`)
    );
  }

  function isBaikePage() {
    return BAIKE_HOSTS.includes(location.hostname);
  }

  function findArticleRootIn(root) {
    if (!root || !root.querySelector) return null;
    if (isBaikePage()) return root.querySelector('.J-lemma-content');
    if (!isSinaPage()) return null;
    return root.querySelector('#article, .article-content-left .article');
  }

  function findArticleRoot() {
    return findArticleRootIn(document);
  }

  function findHeadline(root) {
    if (!isSinaPage() || !root || !root.querySelector) {
      return { title: null, meta: null };
    }
    return {
      title: root.querySelector('h1.main-title, .main-title'),
      meta: root.querySelector('.date-source'),
    };
  }

  function getNoiseSelectors() {
    if (isBaikePage()) {
      return {
        // 百科正文使用 J-lemma-content；只隐藏明确的固定侧栏和推荐模块，
        // 不使用通配的 .content/.wrapper，避免把正文章节一起隐藏。
        sidebar: ['#J-side-catalog', '[class*="sideCatalog"]', '[class*="lemmaRight"]'],
        comments: ['[class*="commentList"]', '[class*="commentPanel"]'],
        banners: ['[class*="fixedWrapper"]', '[class*="recommend"]', '[class*="related"]'],
        blockAllVideos: ['[class*="videoList"]', '[class*="videoCard"]', '[class*="videoWrap"]'],
      };
    }
    if (!isSinaPage()) return {};
    return {
      ads: ['.sinaads', '.article-content-left > .ad', '.right-side-ad'],
      // 右栏整体包含阅读排行榜、评论排行榜、广告和视频推荐；按容器处理，避免重复计数。
      sidebar: ['.article-content-right', '.page-right-bar'],
      // 正文评论区，不包含右栏的评论排行榜（#read-comment）。
      comments: ['#bottom_sina_comment', '.blk-comment'],
      // 顶部横幅、站点导航、二维码和广告浮层。不把 .modal-content 算进来，
      // 以免误删包着正文的壳；原页 display:none 的蒙层由阅读层拷贝隐藏态处理。
      banners: [
        '.top-banner',
        '#sina-header',
        '.sina-header',
        '.nav-others',
        '#article-bottom',
        '.sinaad-toolkit-box',
        '.qrcode-modal',
        '[class*="qrcode"]',
        '[id*="qrcode"]',
        '[class*="qr-code"]',
        '[class*="ewm"]',
        '.modal-overlay',
        // 文末版权/立场免责声明，常在 #article 末尾，有时没有稳定 class。
        '.show_author',
        '.article-notice',
      ],
      marketing: ['.modal-content', '[id*="login"]', '[class*="login"]'],
      // 与通用 video/iframe/img 规则合并：正文播放器、封面图外壳、右栏视频卡，
      // 以及正文下方动态插入的图示/广告墙。特别声明在 #article 内，
      // 不会被「#article 后面的兄弟」选中。
      blockAllVideos: [
        '.video-2017',
        '[id^="videoList"]',
        '.play-video-area',
        '[class*="article-video"]',
        '[data-video]',
        '[data-video-id]',
        '.news-video-miaopai',
        '.img-video-box',
        '#article-bottom',
        '.article-bottom',
        '#wxFollow',
        '#timeline_pc_tmpl',
        '#card_weibo_topic',
        '#sina_keyword_ad_area2',
        '.sina_keyword_ad_area',
        '[class*="sinaads"]',
        '.article-content-left > #article ~ *:not(#bottom_sina_comment):not(.blk-comment)',
      ],
    };
  }

  // 选择器打不到的文末声明：按正文特征收进「隐藏弹窗横幅」。
  function findExtraNoiseNodes(root, category) {
    if (!isSinaPage() || category !== 'banners' || !root || !root.querySelectorAll) return [];
    const matched = [];
    root.querySelectorAll('p, div, span, section').forEach((el) => {
      const text = (el.textContent || '').replace(/\s+/g, '');
      if (!text.startsWith('特别声明')) return;
      if (!text.includes('不代表新浪')) return;
      if (text.length > 400) return;
      matched.push(el);
    });
    return matched.filter((el) => !matched.some((other) => other !== el && el.contains(other)));
  }

  window.INS_Reader.siteAdapters = {
    isSinaPage,
    isBaikePage,
    findArticleRoot,
    findArticleRootIn,
    findHeadline,
    getNoiseSelectors,
    findExtraNoiseNodes,
  };
})();
