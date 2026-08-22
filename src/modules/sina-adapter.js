// Copyright (c) 2026 Insta360. All rights reserved.
// INS_Reader · 新浪文章页适配器
// 职责：为新浪新闻文章页提供稳定的正文根节点、标题和降噪选择器。
// 只读查询真实页面，删除操作仍由 noise-filter.js 作用于 body 克隆体。

window.INS_Reader = window.INS_Reader || {};

(function () {
  const SINA_HOSTS = ['sina.com.cn', 'sina.cn'];

  function isSinaPage() {
    return SINA_HOSTS.some(
      (host) => location.hostname === host || location.hostname.endsWith(`.${host}`)
    );
  }

  function findArticleRoot() {
    if (!isSinaPage()) return null;
    return document.querySelector('#article, .article-content-left .article');
  }

  function getNoiseSelectors() {
    if (!isSinaPage()) return {};
    return {
      ads: ['.sinaads', '.article-content-left > .ad', '.right-side-ad'],
      // 右栏整体包含阅读排行榜、评论排行榜、广告和视频推荐；按容器处理，避免重复计数。
      sidebar: ['.article-content-right', '.page-right-bar'],
      // 正文评论区，不包含右栏的评论排行榜（#read-comment）。
      comments: ['#bottom_sina_comment', '.blk-comment'],
      // 顶部横幅、站点导航、文章底部横幅和动态浮层。
      banners: [
        '.top-banner',
        '#sina-header',
        '.sina-header',
        '.nav-others',
        '#article-bottom',
        '.sinaad-toolkit-box',
        '.qrcode-modal',
        '.modal-overlay',
        '.modal-content',
      ],
      marketing: ['.modal-content', '[id*="login"]', '[class*="login"]'],
      // 视频/动画统一归入该分类，包含正文媒体和右侧视频推荐卡片。
      blockAllVideos: [
        '#article video',
        '#article iframe[src*="video"]',
        '#article iframe[src*="player"]',
        '#article [class*="video-player"]',
        '#article [class*="videoPlayer"]',
        '#article [class*="article-video"]',
        '#article [data-video]',
        '#article [data-video-id]',
        '.news-video-miaopai',
        '.img-video-box',
      ],
    };
  }

  window.INS_Reader.siteAdapters = {
    isSinaPage,
    findArticleRoot,
    getNoiseSelectors,
  };
})();
