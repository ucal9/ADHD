// 缓读 · 阅读统计模块
// 职责：根据正文文本估算总阅读时长，并按滚动位置计算已读进度。
// 纯函数工具，不依赖其他缓读模块。

window.Huandu = window.Huandu || {};

(function () {
  const CJK_WPM = 350; // 中文按字符计数的阅读速度（字/分钟）
  const EN_WPM = 230; // 英文按单词计数的阅读速度（词/分钟）

  function countCJKChars(text) {
    const matches = text.match(/[一-鿿㐀-䶿]/g);
    return matches ? matches.length : 0;
  }

  function countWords(text) {
    const matches = text.match(/[A-Za-z0-9']+/g);
    return matches ? matches.length : 0;
  }

  // 中英文混排时分别计数、分别按各自速度换算时间再相加，
  // 避免用单一 WPM 估算导致中文页面严重失真。
  function estimateMinutes(text) {
    const cjkChars = countCJKChars(text);
    const enWords = countWords(text.replace(/[一-鿿㐀-䶿]/g, ' '));
    return cjkChars / CJK_WPM + enWords / EN_WPM;
  }

  function formatMinutes(minutes) {
    const rounded = Math.max(1, Math.round(minutes));
    return `${rounded} 分钟`;
  }

  // scrollTop/scrollHeight/clientHeight 取自阅读层的滚动容器。
  function computeProgress(scrollTop, scrollHeight, clientHeight) {
    const scrollable = scrollHeight - clientHeight;
    if (scrollable <= 0) return 1;
    return Math.min(1, Math.max(0, scrollTop / scrollable));
  }

  window.Huandu.readingStats = {
    estimateMinutes,
    formatMinutes,
    computeProgress,
  };
})();
