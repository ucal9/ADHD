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
      sidebar: ['.article-content-right', '.page-right-bar'],
      comments: ['.blk-comment', '#bottom_sina_comment', '#read-comment'],
      banners: ['.sina-header', '.nav-others', '#article-bottom'],
      marketing: ['.modal-content', '[id*="login"]', '[class*="login"]'],
      blockAllVideos: ['.news-video-miaopai', '.img-video-box'],
    };
  }

  window.INS_Reader.siteAdapters = {
    isSinaPage,
    findArticleRoot,
    getNoiseSelectors,
  };
})();
