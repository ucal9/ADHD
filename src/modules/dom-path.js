// 缓读 · DOM 路径工具模块
// 职责：记录节点相对某个祖先的子节点下标路径，用于在克隆后的树里重新定位同一个节点。
// 纯函数工具，不依赖任何缓读状态或其他模块。

window.Huandu = window.Huandu || {};

(function () {
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

  window.Huandu.domPath = {
    getChildIndexPath,
    resolveChildIndexPath,
  };
})();
