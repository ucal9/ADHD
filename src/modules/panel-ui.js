// Copyright (c) 2026 Insta360. All rights reserved.
// INS_Reader · 设置面板模块
// 职责：渲染用户设置面板，Shadow DOM 隔离样式。面板分两级：
// 一级入口界面只展示 Logo/Slogan、降噪总开关、AI 内容助手总开关、我的预设 与【详细配置】入口；
// 点【详细配置】后展开二级面板（主题、排版、预设管理、动态降噪细分开关、AI 二级细分开关）。
// 依赖 INS_Reader.prefsStore / readerLayer / aiClient / pageMeta / appController。
// 面板自身不决定"是否应用"，只负责收集用户输入后回调 INS_Reader.appController
// 提供的 applyAll/restoreOriginalPage；点击"生成摘要"时直接调用 aiClient.summarize()，
// 成功后把结果写入 readerLayer.setSummary() 再重新渲染。当前页面被判定不适合阅读模式时
// （readerLayer.getLastFeasibilityReason() 非空），改为展示"生成内容概览"入口：用
// pageMeta.extract() 抓取标题/描述文本，同样交给 aiClient.summarize() 生成概览，
// 结果只存在面板本地状态（不写入 prefsStore/readerLayer，关闭面板即丢弃）。
// 调用者：content.js 把 updateNoiseCount 注册为 readerLayer 的降噪计数回调；
// content.js 收到 INS_READER_TOGGLE_PANEL 消息时调用 toggle()。

window.INS_Reader = window.INS_Reader || {};

(function () {
  const FONT_MIN = 14;
  const FONT_MAX = 28;
  const LINE_HEIGHT_MIN = 1.5;
  const LINE_HEIGHT_MAX = 2.2;
  const PARAGRAPH_SPACING_MIN = 1.0;
  const PARAGRAPH_SPACING_MAX = 2.0;
  const LETTER_SPACING_MIN = 0;
  const LETTER_SPACING_MAX = 0.12;

  const FONT_FAMILIES = {
    default: '系统默认',
    serif: '宋体',
    'sans-serif': '黑体',
    monospace: '等宽',
  };

  // 页面底色调色盘（PRD：排版栏目新增自定义调色盘）
  const BG_SWATCHES = [
    { bg: '#fbfcfa', text: '#3b4540', label: '米白' },
    { bg: '#f5efe1', text: '#4a4034', label: '纸黄' },
    { bg: '#e8f0e6', text: '#33443a', label: '浅绿' },
    { bg: '#e6edf5', text: '#333f4a', label: '浅蓝' },
    { bg: '#f7e9ec', text: '#4a3639', label: '浅粉' },
    { bg: '#20211f', text: '#ecede8', label: '深灰' },
  ];

  // 四个数值型排版项统一用 +/- 步进器（PRD：不使用拖动条，直接加减数值）
  const STEPPERS = [
    { key: 'fontSize', label: '字号', min: FONT_MIN, max: FONT_MAX, step: 1, digits: 0, suffix: '' },
    { key: 'lineHeight', label: '行间距', min: LINE_HEIGHT_MIN, max: LINE_HEIGHT_MAX, step: 0.1, digits: 1, suffix: '' },
    {
      key: 'paragraphSpacing',
      label: '段落间距',
      min: PARAGRAPH_SPACING_MIN,
      max: PARAGRAPH_SPACING_MAX,
      step: 0.1,
      digits: 1,
      suffix: '×',
    },
    {
      key: 'letterSpacing',
      label: '字间距',
      min: LETTER_SPACING_MIN,
      max: LETTER_SPACING_MAX,
      step: 0.01,
      digits: 2,
      suffix: 'em',
    },
  ];

  // 把浮点步进结果修正到指定小数位，避免 0.1 累加出现 1.7000000000000002
  function INS_roundTo(value, digits) {
    return Number(value.toFixed(digits));
  }

  // 套用预设：深拷贝写回，避免 prefs 与预设共享嵌套对象引用
  // （否则套用后改设置会连带修改已保存的预设）。
  function INS_applyPreset(preset) {
    const { prefsStore, appController } = window.INS_Reader;
    const prefs = prefsStore.get();
    if (!preset || !preset.prefs) return;
    Object.assign(prefs, JSON.parse(JSON.stringify(preset.prefs)));
    prefs.enabled = true;
    prefsStore.save();
    appController.applyAll();
    INS_render();
  }

  const state = {
    panelHost: null,
    isExpanded: false,
    pageOverviewText: '',
    pageOverviewStatus: '',
    pageOverviewError: '',
    expandedMenus: {}, // 保存各菜单的展开状态
  };

  function INS_ensurePanelHost() {
    if (state.panelHost) return state.panelHost;
    state.panelHost = document.createElement('div');
    state.panelHost.id = 'ins-reader-panel-host';
    state.panelHost.style.position = 'fixed';
    state.panelHost.style.top = '0';
    state.panelHost.style.left = '0';
    state.panelHost.style.width = '0';
    state.panelHost.style.height = '0';
    state.panelHost.style.zIndex = '2147483647';
    document.documentElement.appendChild(state.panelHost);
    return state.panelHost;
  }

  function INS_isOpen() {
    const shadow = state.panelHost && state.panelHost.shadowRoot;
    return !!(shadow && shadow.querySelector('.ins-reader-panel'));
  }

  function INS_updateNoiseCount(count) {
    const shadow = state.panelHost && state.panelHost.shadowRoot;
    if (!shadow) return;
    const countEl = shadow.querySelector('[data-role="noise-count"]');
    if (countEl) countEl.textContent = String(count);
  }

  function INS_toggle() {
    const host = INS_ensurePanelHost();
    const shadow = host.shadowRoot;
    const existing = shadow && shadow.querySelector('.ins-reader-panel');
    if (existing) {
      INS_close(existing);
      return;
    }
    INS_render();
  }

  function INS_close(panelEl) {
    panelEl.classList.add('closing');
    panelEl.addEventListener('animationend', () => panelEl.remove(), { once: true });
  }

  function INS_render() {
    const { prefsStore, readerLayer, appController } = window.INS_Reader;
    const prefs = prefsStore.get();

    const host = INS_ensurePanelHost();
    let shadow = host.shadowRoot;
    if (!shadow) shadow = host.attachShadow({ mode: 'open' });
    const isFirstOpen = !shadow.querySelector('.ins-reader-panel');
    shadow.innerHTML = '';

    const style = document.createElement('style');
    style.textContent = PANEL_CSS;
    shadow.appendChild(style);

    const noiseLabels = {
      ads: '广告推荐',
      sidebar: '侧边栏/导航',
      comments: '评论区',
      banners: '弹窗/横幅',
      marketing: '会员/登录推销',
      pauseAutoplay: '视频动画（暂停自动播放）',
      blockAllVideos: '屏蔽所有视频',
    };

    // 需要额外风险提示的降噪项
    const noiseNotes = {
      blockAllVideos: '可能存在风险',
    };

    // 降噪开关的展示顺序：选择器类别（来自 NOISE_GROUPS）之外，还有 pauseAutoplay
    // 这个作用于原页面播放状态的特殊项，因此这里显式列出顺序而不是遍历 NOISE_GROUPS。
    const noiseOrder = ['ads', 'sidebar', 'comments', 'banners', 'marketing', 'pauseAutoplay', 'blockAllVideos'];

    const feasibilityReason = readerLayer.getLastFeasibilityReason();
    const feasibilityMessages = {
      domain: '此页面暂不支持阅读模式（识别为视频/流媒体网站）',
      video: '此页面暂不支持阅读模式（检测到视频内容为主）',
      'thin-content': '此页面暂不支持阅读模式（未能识别到足够的正文内容）',
    };

    const panel = document.createElement('div');
    panel.className = isFirstOpen ? 'ins-reader-panel opening' : 'ins-reader-panel';
    panel.classList.toggle('expanded', state.isExpanded);

    let panelHTML = `
      <div class="panel-top">
        ${
          state.isExpanded
            ? '<button class="back-btn" data-role="collapse-btn" aria-label="返回">‹ 返回</button>'
            : ''
        }
        <div class="brand">INS_Reader</div>
        <button class="close-btn" data-role="close" aria-label="关闭">×</button>
      </div>
      <p class="tagline">把阅读调成适合你的样子</p>
    `;

    if (state.isExpanded) {
      panelHTML += `
        ${
          feasibilityReason
            ? `<div class="feasibility-notice">
                <p class="feasibility-notice-text">${
                  feasibilityMessages[feasibilityReason] || '此页面暂不支持阅读模式'
                }</p>
                <button class="overview-generate" data-role="overview-generate" ${
                  state.pageOverviewStatus === 'loading' ? 'disabled' : ''
                }>
                  ${state.pageOverviewText ? '重新生成内容概览' : '生成内容概览'}
                </button>
                ${state.pageOverviewStatus === 'loading' ? '<p class="overview-status">正在生成…</p>' : ''}
                ${
                  state.pageOverviewStatus === 'error'
                    ? `<p class="overview-status error" data-role="overview-error"></p>`
                    : ''
                }
                ${
                  state.pageOverviewText
                    ? `<div class="overview-result">
                        <p class="overview-body" data-role="overview-body"></p>
                        <p class="overview-disclaimer">基于页面标题与简介生成，可能不完整</p>
                      </div>`
                    : ''
                }
              </div>`
            : ''
        }

        <div class="expandable-group" data-group="typography">
          <button class="group-header" data-role="typography-toggle">
            <span class="group-label">排版</span>
            <span class="group-icon">▼</span>
          </button>
          <div class="group-content ${state.expandedMenus.typography ? 'expanded' : ''}" data-role="typography-menu">
            <div class="setting">
              <span>页面底色</span>
              <div class="bg-swatches">
                ${BG_SWATCHES.map(
                  (s) =>
                    `<button class="bg-swatch ${
                      prefs.customColors.bg.toLowerCase() === s.bg ? 'active' : ''
                    }" data-swatch-bg="${s.bg}" data-swatch-text="${s.text}" title="${s.label}" aria-label="${s.label}" style="background:${s.bg}"></button>`
                ).join('')}
              </div>
            </div>

            <div class="custom-colors">
              <label>背景 <input type="color" data-role="custom-bg" value="${prefs.customColors.bg}" /></label>
              <label>文字 <input type="color" data-role="custom-text" value="${prefs.customColors.text}" /></label>
            </div>

            ${STEPPERS.map(
              (s) => `
            <div class="setting row">
              <span>${s.label}</span>
              <div class="stepper">
                <button data-step-key="${s.key}" data-step-dir="-1" ${
                prefs[s.key] <= s.min ? 'disabled' : ''
              } aria-label="减小${s.label}">−</button>
                <b class="step-value">${prefs[s.key].toFixed(s.digits)}${s.suffix}</b>
                <button data-step-key="${s.key}" data-step-dir="1" ${
                prefs[s.key] >= s.max ? 'disabled' : ''
              } aria-label="增大${s.label}">＋</button>
              </div>
            </div>`
            ).join('')}

            <div class="setting">
              <span>字体</span>
              <div class="font-options">
                ${Object.entries(FONT_FAMILIES)
                  .map(
                    ([key, label]) =>
                      `<button data-font="${key}" class="font-btn ${prefs.fontFamily === key ? 'active' : ''}">${label}</button>`
                  )
                  .join('')}
              </div>
            </div>

            <button class="save-preset" data-role="save-preset">💾 保存预设</button>
          </div>
        </div>

        ${
          prefs.presets && prefs.presets.length > 0
            ? `<div class="presets-section">
                <div class="presets-header">我的预设</div>
                <div class="presets-list">
                  ${prefs.presets
                    .map(
                      (p, idx) => `
                    <div class="preset-item">
                      <button class="preset-apply" data-preset-index="${idx}">${p.name}</button>
                      <button class="preset-delete" data-preset-index="${idx}" aria-label="删除预设">×</button>
                    </div>`
                    )
                    .join('')}
                </div>
              </div>`
            : ''
        }

        <div class="expandable-group" data-group="noise">
          <button class="group-header" data-role="noise-toggle">
            <span class="group-label">降噪</span>
            <span class="group-icon">▼</span>
          </button>
          <div class="group-content ${state.expandedMenus.noise ? 'expanded' : ''}" data-role="noise-menu">
            ${noiseOrder
              .map(
                (key) => `
              <div class="noise-row">
                <span>${noiseLabels[key]}${
                  noiseNotes[key] ? `<em class="noise-note">${noiseNotes[key]}</em>` : ''
                }</span>
                <button class="switch small ${prefs.noiseOptions[key] ? 'on' : ''}" data-noise-key="${key}"><span></span></button>
              </div>`
              )
              .join('')}
            <p class="noise-feedback">本页已隐藏 <b data-role="noise-count">${readerLayer.getHiddenCount()}</b> 个干扰元素</p>
          </div>
        </div>

        <div class="expandable-group" data-group="ai">
          <button class="group-header" data-role="ai-toggle">
            <span class="group-label">AI 内容助手</span>
            <span class="group-icon">▼</span>
          </button>
          <div class="group-content ${state.expandedMenus.ai ? 'expanded' : ''}" data-role="ai-menu">
            ${
              prefs.aiEnabled
                ? `
              <div class="ai-row">
                <span>AI 摘要</span>
                <button class="switch small ${prefs.aiSummary ? 'on' : ''}" data-role="ai-summary-switch"><span></span></button>
              </div>

              ${
                prefs.aiSummary
                  ? `
                <p class="ai-hint">正文将发送到 INS_Reader 后端生成摘要，不会用于其他用途。</p>
                <button class="ai-generate" data-role="ai-generate">${
                  readerLayer.getSummary() ? '重新生成摘要' : '生成摘要'
                }</button>
                <div class="ai-progress" data-role="ai-progress" hidden><div class="ai-progress-bar"></div></div>
                <p class="ai-status" data-role="ai-status"></p>`
                  : ''
              }

              <div class="ai-row">
                <span>高亮</span>
                <button class="switch small ${prefs.aiHighlight?.enabled ? 'on' : ''}" data-role="ai-highlight-switch"><span></span></button>
              </div>

              ${
                prefs.aiHighlight?.enabled
                  ? `
                <div class="ai-highlight-section">
                  <div class="ai-highlight-header">内容</div>
                  <div class="highlight-option">
                    <label>
                      <input type="checkbox" data-highlight-key="breakLongParagraphs" ${
                        prefs.aiHighlight.breakLongParagraphs ? 'checked' : ''
                      } />
                      拆分长段落
                    </label>
                  </div>
                  <div class="highlight-option">
                    <label>
                      <input type="checkbox" data-highlight-key="simplifySentences" ${
                        prefs.aiHighlight.simplifySentences ? 'checked' : ''
                      } />
                      简化复杂长句
                    </label>
                  </div>
                  <div class="highlight-option">
                    <label>
                      <input type="checkbox" data-highlight-key="markKeyInfo" ${
                        prefs.aiHighlight.markKeyInfo ? 'checked' : ''
                      } />
                      标记核心信息
                    </label>
                  </div>
                </div>`
                  : ''
              }
            `
                : '<p class="ai-hint">AI 内容助手总开关在入口界面，开启后可在此配置摘要与高亮。</p>'
            }
          </div>
        </div>

        <button class="restore" data-role="restore">恢复原网页</button>
      `;
    } else {
      panelHTML += `
        <div class="simple-mode">
          <div class="simple-row">
            <span>降噪</span>
            <button class="switch ${prefs.noiseReduction ? 'on' : ''}" data-role="simple-noise-toggle"><span></span></button>
          </div>

          <div class="simple-row">
            <span>AI 内容助手</span>
            <button class="switch ${prefs.aiEnabled ? 'on' : ''}" data-role="ai-master-switch"><span></span></button>
          </div>

          ${
            prefs.presets && prefs.presets.length > 0
              ? `<div class="simple-presets">
                  <div class="simple-presets-title">我的预设</div>
                  ${prefs.presets
                    .map(
                      (p, idx) =>
                        `<button class="simple-preset-btn" data-preset-index="${idx}">${p.name}</button>`
                    )
                    .join('')}
                </div>`
              : ''
          }

          <button class="expand-btn" data-role="expand-btn">详细配置</button>
        </div>
      `;
    }

    panel.innerHTML = panelHTML;
    shadow.appendChild(panel);

    // 概览文本用 textContent 写入
    const overviewBodyEl = panel.querySelector('[data-role="overview-body"]');
    if (overviewBodyEl) overviewBodyEl.textContent = state.pageOverviewText;
    const overviewErrorEl = panel.querySelector('[data-role="overview-error"]');
    if (overviewErrorEl) overviewErrorEl.textContent = state.pageOverviewError || '生成失败';

    // ===== 事件绑定 =====
    panel.querySelector('[data-role="close"]').addEventListener('click', () => INS_close(panel));

    // 展开/收起详细配置
    const expandBtn = panel.querySelector('[data-role="expand-btn"]');
    if (expandBtn) {
      expandBtn.addEventListener('click', () => {
        state.isExpanded = true;
        INS_render();
      });
    }

    // 从详细配置返回入口界面
    const collapseBtn = panel.querySelector('[data-role="collapse-btn"]');
    if (collapseBtn) {
      collapseBtn.addEventListener('click', () => {
        state.isExpanded = false;
        INS_render();
      });
    }

    // 页面概览生成
    const overviewBtn = panel.querySelector('[data-role="overview-generate"]');
    if (overviewBtn) {
      overviewBtn.addEventListener('click', async () => {
        const { pageMeta, aiClient } = window.INS_Reader;
        const metaText = pageMeta.extract();
        if (!metaText) {
          state.pageOverviewStatus = 'error';
          state.pageOverviewError = '未能提取到页面标题或简介';
          INS_render();
          return;
        }
        state.pageOverviewStatus = 'loading';
        state.pageOverviewError = '';
        INS_render();
        try {
          const overview = await aiClient.summarize(metaText);
          state.pageOverviewText = overview;
          state.pageOverviewStatus = '';
        } catch (err) {
          state.pageOverviewStatus = 'error';
          state.pageOverviewError = err.message || '生成失败';
        }
        INS_render();
      });
    }

    // 自定义颜色
    const customBg = panel.querySelector('[data-role="custom-bg"]');
    const customText = panel.querySelector('[data-role="custom-text"]');
    if (customBg && customText) {
      customBg.addEventListener('input', () => {
        prefs.customColors.bg = customBg.value;
        prefs.enabled = true;
        appController.applyAll();
      });
      customText.addEventListener('input', () => {
        prefs.customColors.text = customText.value;
        prefs.enabled = true;
        appController.applyAll();
      });
      [customBg, customText].forEach((input) => input.addEventListener('change', prefsStore.save));
    }

    // 页面底色调色盘：选中色板即写入前景/背景色
    panel.querySelectorAll('[data-swatch-bg]').forEach((btn) => {
      btn.addEventListener('click', () => {
        prefs.customColors.bg = btn.getAttribute('data-swatch-bg');
        prefs.customColors.text = btn.getAttribute('data-swatch-text');
        prefs.enabled = true;
        prefsStore.save();
        appController.applyAll();
        INS_render();
      });
    });

    // 四个数值型排版项的 +/- 步进器（字号/行间距/段落间距/字间距）
    panel.querySelectorAll('[data-step-key]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.getAttribute('data-step-key');
        const dir = Number(btn.getAttribute('data-step-dir'));
        const conf = STEPPERS.find((s) => s.key === key);
        if (!conf) return;
        const next = INS_roundTo(prefs[key] + dir * conf.step, conf.digits);
        prefs[key] = Math.min(conf.max, Math.max(conf.min, next));
        prefs.enabled = true;
        prefsStore.save();
        appController.applyAll();
        INS_render();
      });
    });

    // 字体选择
    panel.querySelectorAll('[data-font]').forEach((btn) => {
      btn.addEventListener('click', () => {
        prefs.fontFamily = btn.getAttribute('data-font');
        prefs.enabled = true;
        prefsStore.save();
        appController.applyAll();
        INS_render();
      });
    });

    // 排版菜单展开/收起
    const typographyToggle = panel.querySelector('[data-role="typography-toggle"]');
    const typographyMenu = panel.querySelector('[data-role="typography-menu"]');
    if (typographyToggle && typographyMenu) {
      typographyToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        state.expandedMenus.typography = !state.expandedMenus.typography;
        typographyMenu.classList.toggle('expanded');
      });
    }

    // 降噪菜单展开/收起 - 注意这里只控制展开/收起，不同时改变 noiseReduction 状态
    const noiseToggle = panel.querySelector('[data-role="noise-toggle"]');
    const noiseMenu = panel.querySelector('[data-role="noise-menu"]');
    if (noiseToggle && noiseMenu) {
      noiseToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        state.expandedMenus.noise = !state.expandedMenus.noise;
        noiseMenu.classList.toggle('expanded');
      });
    }

    // AI 菜单展开/收起
    const aiToggle = panel.querySelector('[data-role="ai-toggle"]');
    const aiMenu = panel.querySelector('[data-role="ai-menu"]');
    if (aiToggle && aiMenu) {
      aiToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        state.expandedMenus.ai = !state.expandedMenus.ai;
        aiMenu.classList.toggle('expanded');
      });
    }

    // AI 内容助手模块总开关（位于一级入口界面）
    const aiMasterSwitch = panel.querySelector('[data-role="ai-master-switch"]');
    if (aiMasterSwitch) {
      aiMasterSwitch.addEventListener('click', () => {
        prefs.aiEnabled = !prefs.aiEnabled;
        prefsStore.save();
        INS_render();
      });
    }

    // 二级细分开关：AI 摘要
    const aiSummarySwitch = panel.querySelector('[data-role="ai-summary-switch"]');
    if (aiSummarySwitch) {
      aiSummarySwitch.addEventListener('click', (e) => {
        e.stopPropagation();
        prefs.aiSummary = !prefs.aiSummary;
        prefsStore.save();
        // 展开状态存在 state.expandedMenus 里，重渲染后会被还原，因此这里可以安全重渲染
        INS_render();
      });
    }

    // 二级细分开关：高亮
    const aiHighlightSwitch = panel.querySelector('[data-role="ai-highlight-switch"]');
    if (aiHighlightSwitch) {
      aiHighlightSwitch.addEventListener('click', (e) => {
        e.stopPropagation();
        prefs.aiHighlight.enabled = !prefs.aiHighlight.enabled;
        prefsStore.save();
        INS_render();
      });
    }

    // AI 高亮子功能复选框
    panel.querySelectorAll('[data-highlight-key]').forEach((checkbox) => {
      checkbox.addEventListener('change', () => {
        const key = checkbox.getAttribute('data-highlight-key');
        prefs.aiHighlight[key] = checkbox.checked;
        prefsStore.save();
      });
    });

    // 生成摘要按钮
    const statusEl = panel.querySelector('[data-role="ai-status"]');
    const generateBtn = panel.querySelector('[data-role="ai-generate"]');
    const progressEl = panel.querySelector('[data-role="ai-progress"]');
    if (generateBtn) {
      generateBtn.addEventListener('click', async () => {
        const startedAt = performance.now();
        const { aiClient } = window.INS_Reader;
        const articleText = readerLayer.getArticleText();
        console.log('[INS_Reader][panel-ui] 用户点击生成摘要', {
          textLength: articleText ? articleText.length : 0,
          href: location.href,
          origin: location.origin,
        });
        if (!articleText) {
          console.warn('[INS_Reader][panel-ui] 未找到正文内容，终止生成');
          if (statusEl) statusEl.textContent = '未找到正文内容';
          return;
        }
        generateBtn.disabled = true;
        if (progressEl) progressEl.hidden = false;
        if (statusEl) statusEl.classList.remove('error');

        const stages = ['正在读取正文…', '正在分析内容…', '正在生成摘要…'];
        let stageIndex = 0;
        if (statusEl) statusEl.textContent = stages[0];
        console.log('[INS_Reader][panel-ui] 进入生成流程，阶段文案:', stages[0]);
        const stageTimer = setInterval(() => {
          stageIndex = Math.min(stageIndex + 1, stages.length - 1);
          if (statusEl) statusEl.textContent = stages[stageIndex];
        }, 3000);

        try {
          console.log('[INS_Reader][panel-ui] 准备调用 aiClient.summarize');
          const summary = await aiClient.summarize(articleText);
          console.log('[INS_Reader][panel-ui] aiClient.summarize 返回成功', {
            elapsed: `${Math.round(performance.now() - startedAt)}ms`,
            resultLength: summary ? summary.length : 0,
          });
          readerLayer.setSummary(summary);
          prefs.enabled = true;
          appController.applyAll();
          INS_render();
        } catch (err) {
          console.error('[INS_Reader][panel-ui] aiClient.summarize 返回失败', {
            elapsed: `${Math.round(performance.now() - startedAt)}ms`,
            name: err && err.name,
            message: err && err.message,
            stack: err && err.stack,
          });
          if (statusEl) {
            statusEl.classList.add('error');
            statusEl.textContent = err.message || 'AI 摘要生成失败';
          }
          generateBtn.disabled = false;
          if (progressEl) progressEl.hidden = true;
        } finally {
          clearInterval(stageTimer);
        }
      });
    }

    // 保存预设
    const savePresetBtn = panel.querySelector('[data-role="save-preset"]');
    if (savePresetBtn) {
      savePresetBtn.addEventListener('click', () => {
        const presetName = prompt('请输入预设名称：', '');
        if (!presetName || presetName.trim() === '') return;
        if (prefs.presets.length >= 3) {
          alert('最多保存 3 个预设，请先删除旧预设');
          return;
        }
        const existingName = prefs.presets.some((p) => p.name === presetName.trim());
        if (existingName) {
          alert('预设名称已存在');
          return;
        }
        // 深拷贝快照：noiseOptions/customColors/aiHighlight 都是嵌套对象，浅拷贝会让
        // 预设与当前偏好共享同一个引用，之后改设置会把已保存的预设一起改掉。
        // 同时剔除 presets（避免预设自包含）和 deviceId（设备标识，不属于外观配置）。
        const prefsSnapshot = JSON.parse(JSON.stringify(prefs));
        delete prefsSnapshot.presets;
        delete prefsSnapshot.deviceId;
        prefs.presets.push({
          name: presetName.trim(),
          timestamp: Date.now(),
          prefs: prefsSnapshot,
        });
        prefsStore.save();
        INS_render();
      });
    }

    // 应用预设
    panel.querySelectorAll('.preset-apply').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.getAttribute('data-preset-index'));
        INS_applyPreset(prefs.presets[idx]);
      });
    });

    // 删除预设
    panel.querySelectorAll('.preset-delete').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.getAttribute('data-preset-index'));
        if (confirm('确定删除此预设？')) {
          prefs.presets.splice(idx, 1);
          prefsStore.save();
          INS_render();
        }
      });
    });

    // 简洁模式降噪开关
    const simpleNoiseToggle = panel.querySelector('[data-role="simple-noise-toggle"]');
    if (simpleNoiseToggle) {
      simpleNoiseToggle.addEventListener('click', () => {
        prefs.noiseReduction = !prefs.noiseReduction;
        prefs.enabled = true;
        prefsStore.save();
        appController.applyAll();
        INS_render();
      });
    }

    // 各降噪选项开关
    panel.querySelectorAll('[data-noise-key]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.getAttribute('data-noise-key');
        prefs.noiseOptions[key] = !prefs.noiseOptions[key];
        prefs.enabled = true;
        prefsStore.save();
        appController.applyAll();
        INS_render();
      });
    });

    // 简洁模式预设按钮
    panel.querySelectorAll('.simple-preset-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.getAttribute('data-preset-index'));
        INS_applyPreset(prefs.presets[idx]);
      });
    });

    const restoreBtn = panel.querySelector('[data-role="restore"]');
    if (restoreBtn) {
      restoreBtn.addEventListener('click', appController.restoreOriginalPage);
    }
  }

  const PANEL_CSS = `
    :host { all: initial; }
    .ins-reader-panel {
      position: fixed;
      top: 78px;
      right: 18px;
      width: 330px;
      padding: 17px 17px 13px;
      font-family: "Noto Sans SC", -apple-system, sans-serif;
      font-size: 12px;
      color: #33403a;
      background: #fffdf9;
      border: 1px solid #ccd4ce;
      border-radius: 7px;
      box-shadow: 0 18px 46px rgba(37, 59, 51, 0.12);
      transform-origin: top right;
      max-height: 85vh;
      overflow-y: auto;
    }
    .ins-reader-panel.opening { animation: ins-reader-in 0.16s ease-out; }
    .ins-reader-panel.closing { animation: ins-reader-out 0.14s ease-in forwards; }
    @keyframes ins-reader-in {
      from { opacity: 0; transform: scale(0.96) translateY(-4px); }
      to { opacity: 1; transform: scale(1) translateY(0); }
    }
    @keyframes ins-reader-out {
      from { opacity: 1; transform: scale(1) translateY(0); }
      to { opacity: 0; transform: scale(0.96) translateY(-4px); }
    }
    .panel-top { display: flex; justify-content: space-between; align-items: flex-start; }
    .back-btn {
      border: none; background: transparent; color: #5f7a6c; cursor: pointer;
      font-size: 13px; padding: 0 8px 0 0; line-height: 1.4;
    }
    .back-btn:hover { color: #3b4540; }
    .brand { font-size: 18px; font-weight: 700; color: #21463f; }
    .close-btn {
      background: none; border: 0; font-size: 16px; line-height: 1; color: #7c8580;
      cursor: pointer; padding: 2px 4px;
    }
    .close-btn:hover { color: #33403a; }
    .tagline { margin: 5px 0 14px; font-size: 11px; color: #287e72; }
    .feasibility-notice {
      margin: 0 0 12px; padding: 8px 10px; border-radius: 5px;
      background: #fdf1ea; border: 1px solid #eecdb3; color: #9a5a2c;
      font-size: 11px; line-height: 1.5;
    }
    .feasibility-notice-text { margin: 0 0 8px; }
    .overview-generate {
      width: 100%; height: 26px; border: 1px solid #eecdb3; border-radius: 4px;
      background: #fff; color: #9a5a2c; font-size: 11px; cursor: pointer; transition: background 0.15s;
    }
    .overview-generate:hover:not(:disabled) { background: #fdf1ea; }
    .overview-generate:disabled { opacity: 0.6; cursor: default; }
    .overview-status { margin: 6px 0 0; font-size: 10px; color: #9a5a2c; }
    .overview-status.error { color: #b95042; }
    .overview-result { margin-top: 8px; padding-top: 8px; border-top: 1px solid #eecdb3; }
    .overview-body { margin: 0; font-size: 11px; line-height: 1.6; color: #5a4030; white-space: pre-line; }
    .overview-disclaimer { margin: 6px 0 0; font-size: 9px; color: #b08a63; }
    .segmented {
      display: grid; grid-template-columns: repeat(3, 1fr);
      background: #eef1ed; border-radius: 4px; padding: 2px; margin-bottom: 10px;
    }
    .segmented button {
      background: none; border: 0; border-radius: 3px; padding: 5px; font-size: 11px;
      color: #65716a; cursor: pointer; transition: background 0.15s, color 0.15s;
    }
    .segmented button.selected { background: #fff; color: #19786c; font-weight: 600; box-shadow: 0 1px 3px rgba(32,44,37,0.08); }
    .expandable-group { margin: 10px 0; }
    .group-header {
      display: flex; justify-content: space-between; align-items: center;
      width: 100%; padding: 10px 11px; background: #eaf5f0; border-radius: 5px;
      border: 0; cursor: pointer; font-size: 12px; font-weight: 700; color: #246d62;
      transition: background 0.15s;
    }
    .group-header:hover { background: #ddf1ed; }
    .group-icon { font-size: 10px; transition: transform 0.18s; }
    .group-header.open .group-icon { transform: rotate(180deg); }
    .group-content {
      max-height: 0; overflow: hidden; transition: max-height 0.2s ease-out;
      margin-top: 0;
    }
    .group-content.expanded { max-height: 800px; margin-top: 6px; }
    .custom-colors { display: flex; gap: 14px; margin-bottom: 10px; font-size: 11px; color: #56625c; }
    .custom-colors label { display: flex; align-items: center; gap: 6px; }
    .custom-colors input[type="color"] { width: 24px; height: 20px; border: 1px solid #d7ded8; border-radius: 3px; padding: 0; cursor: pointer; }
    .setting { margin: 8px 0; }
    .setting span { display: flex; justify-content: space-between; color: #56625c; margin-bottom: 4px; }
    .setting b { color: #278477; font-weight: 500; }
    /* 步进器行：标签在左、加减控件在右，同一行对齐 */
    .setting.row { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
    .setting.row > span { margin-bottom: 0; }
    .step-value {
      min-width: 42px; text-align: center; font-variant-numeric: tabular-nums;
      color: #278477; font-weight: 500;
    }
    .bg-swatches { display: flex; flex-wrap: wrap; gap: 6px; }
    .bg-swatch {
      width: 22px; height: 22px; border-radius: 50%; cursor: pointer;
      border: 1px solid #d7ded8; padding: 0; transition: transform 0.15s, box-shadow 0.15s;
    }
    .bg-swatch:hover { transform: scale(1.1); }
    .bg-swatch.active { box-shadow: 0 0 0 2px #258578; border-color: #fff; }
    .stepper { display: flex; align-items: center; gap: 6px; }
    .stepper input[type="range"] { flex: 1; accent-color: #258578; }
    .stepper button {
      width: 20px; height: 20px; flex: none; border: 1px solid #d7ded8; border-radius: 4px;
      background: #fff; color: #59625e; cursor: pointer; font-size: 13px; line-height: 1;
      display: flex; align-items: center; justify-content: center; transition: background 0.15s;
    }
    .stepper button:hover:not(:disabled) { background: #eef1ed; }
    .stepper button:disabled { opacity: 0.4; cursor: default; }
    .font-options { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; margin-top: 6px; }
    .font-btn {
      padding: 6px; border: 1px solid #d7ded8; border-radius: 4px; background: #fff;
      color: #56625c; font-size: 11px; cursor: pointer; transition: all 0.15s;
    }
    .font-btn.active { background: #1f8b7d; color: #fff; border-color: #1f8b7d; }
    .font-btn:hover:not(.active) { background: #eef1ed; }
    .width-row { display: flex; align-items: center; gap: 5px; margin-top: 8px; color: #56625c; }
    .width-row span { margin-right: auto; }
    .width-row button {
      background: none; border: 0; border-radius: 3px; padding: 5px; font-size: 11px;
      color: #65716a; cursor: pointer; transition: background 0.15s, color 0.15s;
    }
    .width-row button.active { color: #187a6e; background: #deeee8; }
    .save-preset {
      width: 100%; height: 26px; margin-top: 8px; border: 1px solid #d7ded8; border-radius: 4px;
      background: #fff; color: #246d62; font-size: 11px; cursor: pointer; transition: background 0.15s;
    }
    .save-preset:hover { background: #eaf5f0; }
    .presets-section { margin: 10px 0; }
    .presets-header { font-size: 11px; font-weight: 600; color: #246d62; margin-bottom: 6px; padding: 0 5px; }
    .presets-list { display: flex; flex-direction: column; gap: 4px; }
    .preset-item { display: flex; gap: 6px; align-items: center; }
    .preset-apply {
      flex: 1; padding: 6px; border: 1px solid #d7ded8; border-radius: 4px; background: #fff;
      color: #56625c; font-size: 11px; cursor: pointer; transition: all 0.15s; text-align: left;
    }
    .preset-apply:hover { background: #eef1ed; }
    .preset-delete {
      width: 24px; height: 24px; padding: 0; border: 1px solid #d7ded8; border-radius: 4px;
      background: #fff; color: #56625c; font-size: 14px; cursor: pointer; transition: all 0.15s;
    }
    .preset-delete:hover { background: #fff5f5; color: #b95042; }
    .noise-row { display: flex; justify-content: space-between; align-items: center; min-height: 26px; color: #53615a; gap: 8px; }
    .noise-row > span { display: flex; align-items: baseline; gap: 5px; }
    .noise-note { font-style: normal; font-size: 10px; color: #b95042; white-space: nowrap; }
    .noise-feedback { margin: 7px 0 0; font-size: 10px; color: #718078; }
    .ai-row { display: flex; justify-content: space-between; align-items: center; height: 26px; color: #53615a; }
    .ai-hint { margin: 4px 0 8px; font-size: 10px; color: #718078; line-height: 1.5; }
    .ai-generate {
      width: 100%; height: 28px; border: 1px solid #d7ded8; border-radius: 4px;
      background: #fff; color: #246d62; font-size: 12px; cursor: pointer; transition: background 0.15s;
    }
    .ai-generate:hover:not(:disabled) { background: #eaf5f0; }
    .ai-generate:disabled { opacity: 0.6; cursor: default; }
    .ai-progress { margin: 8px 0 0; height: 3px; border-radius: 999px; background: #e3ece7; overflow: hidden; }
    .ai-progress-bar { width: 40%; height: 100%; border-radius: 999px; background: #1f8b7d; animation: ins-reader-ai-progress 1.1s ease-in-out infinite; }
    @keyframes ins-reader-ai-progress {
      0% { transform: translateX(-100%); }
      100% { transform: translateX(250%); }
    }
    .ai-status { margin: 6px 0 0; font-size: 10px; color: #718078; min-height: 12px; }
    .ai-status.error { color: #b95042; }
    .ai-highlight-section { margin: 8px 0 0; padding: 8px 0 0; border-top: 1px solid #e3ece7; }
    .ai-highlight-header { font-size: 11px; font-weight: 600; color: #246d62; margin-bottom: 6px; }
    .highlight-option { margin: 4px 0; }
    .highlight-option label { display: flex; align-items: center; gap: 6px; font-size: 11px; color: #56625c; cursor: pointer; }
    .highlight-option input[type="checkbox"] { cursor: pointer; }
    .switch {
      cursor: pointer; background: #c8d0ca; border: 0; border-radius: 999px;
      width: 33px; height: 18px; padding: 2px; transition: background 0.18s;
    }
    .switch span { display: block; width: 14px; height: 14px; background: #fff; border-radius: 50%; transition: transform 0.18s; box-shadow: 0 1px 2px rgba(0,0,0,0.13); }
    .switch.on { background: #1f8b7d; }
    .switch.on span { transform: translateX(15px); }
    .switch.small { width: 27px; height: 15px; }
    .switch.small span { width: 11px; height: 11px; }
    .switch.small.on span { transform: translateX(12px); }
    .restore {
      width: 100%; height: 30px; margin: 15px 0 0; display: flex; align-items: center; justify-content: center;
      color: #53615a; background: #fff; border: 1px solid #d7ded8; border-radius: 4px; cursor: pointer; font-size: 12px;
      transition: background 0.15s;
    }
    .restore:hover { background: #f6f8f5; }
    .simple-mode { display: flex; flex-direction: column; gap: 12px; }
    .simple-row { display: flex; justify-content: space-between; align-items: center; }
    .simple-presets { display: flex; flex-direction: column; gap: 6px; }
    .simple-presets-title { font-size: 11px; color: #8a948e; }
    .simple-preset-btn {
      padding: 8px; border: 1px solid #d7ded8; border-radius: 4px; background: #fff;
      color: #246d62; font-size: 11px; cursor: pointer; transition: all 0.15s;
    }
    .simple-preset-btn:hover { background: #eaf5f0; }
    .expand-btn {
      width: 100%; height: 32px; border: 1px solid #d7ded8; border-radius: 4px; background: #fff;
      color: #246d62; font-size: 12px; cursor: pointer; transition: all 0.15s; font-weight: 600;
    }
    .expand-btn:hover { background: #eaf5f0; }
  `;

  window.INS_Reader.panelUI = {
    toggle: INS_toggle,
    render: INS_render,
    isOpen: INS_isOpen,
    updateNoiseCount: INS_updateNoiseCount,
  };
})();
