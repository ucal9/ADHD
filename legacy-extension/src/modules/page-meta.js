// Copyright (c) 2026 Insta360. All rights reserved.
// INS_Reader · 页面元信息提取模块
// 职责：只读提取页面标题/描述等元信息文本，供无法定位正文的页面（如视频站）
// 生成内容概览时使用。不修改真实 DOM，只做查询。
// 不依赖 INS_Reader 的其他模块。

window.INS_Reader = window.INS_Reader || {};

(function () {
  function INS_extract() {
    const parts = [];

    if (document.title) {
      parts.push(document.title.trim());
    }

    const metaDesc = document.querySelector('meta[name="description"]');
    const metaDescContent = metaDesc && metaDesc.content ? metaDesc.content.trim() : '';
    if (metaDescContent) {
      parts.push(metaDescContent);
    }

    const ogDesc = document.querySelector('meta[property="og:description"]');
    const ogDescContent = ogDesc && ogDesc.content ? ogDesc.content.trim() : '';
    if (ogDescContent && ogDescContent !== metaDescContent) {
      parts.push(ogDescContent);
    }

    return parts.join('\n').trim();
  }

  window.INS_Reader.pageMeta = {
    extract: INS_extract,
  };
})();
