// 缓读 · 正文定位模块
// 职责：在原页面 DOM 中找到正文根节点（只读，从不修改原始 DOM）。
// 优先用 Readability 辅助定位，失败时降级为语义标签 + 文本密度算法。
// 不依赖缓读的其他模块，只依赖全局 Readability（由 vendor/readability.js 提供）。

window.Huandu = window.Huandu || {};

(function () {
  function textLength(el) {
    return (el.textContent || '').trim().length;
  }

  // 用 Readability 解析文档克隆体，取其判断出的正文首段文本，
  // 回到原始 document 里找与之匹配的真实节点，这样后续克隆才能带上
  // 原始 class/结构，供降噪选择器和样式继承使用。
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

    // 在原始文档中找出文本内容与 Readability 输出最匹配、且层级最深（最贴近
    // 正文容器本身，而非层层嵌套的祖先）的候选节点。
    const candidates = Array.from(document.body.querySelectorAll('article, main, [role="main"], div, section'));
    let best = null;
    let bestDepth = Infinity;
    for (const el of candidates) {
      const text = (el.textContent || '').trim();
      if (text.includes(firstText)) {
        let depth = 0;
        for (let n = el; n; n = n.parentElement) depth += 1;
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

  // 降级路径：Readability 不可用或未命中时启用。
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

  function pickBestCandidate() {
    const candidates = Array.from(document.querySelectorAll('article, main, [role="main"]'));
    if (candidates.length > 0) {
      return candidates.reduce((a, b) => (textLength(a) >= textLength(b) ? a : b));
    }
    return findByTextDensity();
  }

  function findArticleRoot() {
    const byReadability = findArticleRootViaReadability();
    if (byReadability) return byReadability;
    return pickBestCandidate();
  }

  window.Huandu.articleLocator = {
    findArticleRoot,
  };
})();
