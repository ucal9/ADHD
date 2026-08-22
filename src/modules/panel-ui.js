// Copyright (c) 2026 Insta360. All rights reserved.
// INS_Reader · 设置面板模块
// 职责：渲染用户设置面板，Shadow DOM 隔离样式。面板分两级，一级入口与详细配置
// 共用同一套真实功能设置；点击模块标题才展开对应二级配置。
// 依赖 INS_Reader.prefsStore / readerLayer / aiClient / pageMeta / appController。
// 面板自身不决定"是否应用"，只负责收集用户输入后回调 INS_Reader.appController
// 提供的 applyAll/restoreOriginalPage；点击"生成摘要"时直接调用 aiClient.summarize()，
// 成功后把结果写入 readerLayer.setSummary() 再重新渲染。当前页面被判定不适合阅读模式时
// （readerLayer.getLastFeasibilityReason() 非空），改为展示"生成内容概览"入口：用
// pageMeta.extract() 抓取标题/描述文本，同样交给 aiClient.summarize() 生成概览，
// 结果只存在面板本地状态（不写入 prefsStore/readerLayer，关闭面板即丢弃）。
// 调用者：content.js 把 updateNoiseCount 注册为 readerLayer 的降噪计数回调；
// content.js 收到 INS_READER_TOGGLE_PANEL 消息时调用 openQuick()。

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

  const ICON_MARK = `<svg class="read-icon" width="20" height="20" viewBox="0 0 200 200" fill="none" aria-hidden="true">
    <rect width="200" height="200" rx="44" fill="#111111"/>
    <path d="M58 62C58 53.16 65.16 46 74 46H126C134.84 46 142 53.16 142 62V138C142 146.84 134.84 154 126 154H74C65.16 154 58 146.84 58 138V62Z" fill="none" stroke="white" stroke-width="12"/>
    <path d="M82 78H122" stroke="white" stroke-width="11" stroke-linecap="round"/>
    <path d="M78 100C92 90 106 90 120 100C134 110 146 110 158 100" stroke="#FFB800" stroke-width="11" stroke-linecap="round"/>
    <path d="M78 126C92 116 106 116 120 126C134 136 146 136 158 126" stroke="white" stroke-width="11" stroke-linecap="round" opacity="0.5"/>
  </svg>`;

  const MODULE_ICONS = {
    typography: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16M12 5v14M8 19h8"/></svg>',
    noise: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 2 3 14h7l-1 8 10-12h-7l1-8Z"/></svg>',
    ai: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 1.4 4.6L18 9l-4.6 1.4L12 15l-1.4-4.6L6 9l4.6-1.4L12 3ZM19 15l.7 2.3L22 18l-2.3.7L19 21l-.7-2.3L16 18l2.3-.7L19 15ZM5 14l.7 2.3L8 17l-2.3.7L5 20l-.7-2.3L2 17l2.3-.7L5 14Z"/></svg>',
  };

  function INS_brandMarkup() {
    return `${ICON_MARK}<span>缓读</span>`;
  }

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

  function INS_markCustomized(prefs) {
    prefs.hasCustomized = true;
    prefs.activePreset = '';
  }

  function INS_resetToStrictDefaults(prefs) {
    const savedPresets = prefs.presets;
    const deviceId = prefs.deviceId;
    Object.assign(prefs, JSON.parse(JSON.stringify(window.INS_Reader.prefsStore.DEFAULT_PREFS)), {
      presets: savedPresets,
      deviceId,
    });
  }

  function INS_applyDefaultMode() {
    const { prefsStore, appController } = window.INS_Reader;
    const prefs = prefsStore.get();
    INS_resetToStrictDefaults(prefs);
    prefs.enabled = true;
    prefs.activePreset = '默认模式';
    prefs.hasCustomized = true;
    prefs.hasActivated = true;
    prefsStore.save();
    appController.applyAll();
    INS_render();
  }

  // 套用预设：深拷贝写回，避免 prefs 与预设共享嵌套对象引用
  // （否则套用后改设置会连带修改已保存的预设）。
  function INS_applyPreset(preset) {
    const { prefsStore, appController } = window.INS_Reader;
    const prefs = prefsStore.get();
    if (!preset || !preset.prefs) return;
    Object.assign(prefs, JSON.parse(JSON.stringify(preset.prefs)));
    prefs.enabled = true;
    prefs.activePreset = preset.name;
    prefs.hasActivated = true;
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
    outsidePointerHandler: null,
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
    state.outsidePointerHandler = (event) => {
      const shadow = state.panelHost && state.panelHost.shadowRoot;
      const panel = shadow && shadow.querySelector('.ins-reader-panel');
      if (panel && !state.panelHost.contains(event.target)) INS_close(panel);
    };
    document.addEventListener('pointerdown', state.outsidePointerHandler, true);
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

  function INS_openDetails() {
    state.isExpanded = true;
    INS_render();
  }

  function INS_openQuick() {
    state.isExpanded = false;
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
      sidebar: '隐藏侧边栏',
      comments: '隐藏评论区',
      banners: '隐藏弹窗横幅',
      blockAllVideos: '屏蔽所有视频',
    };

    // 降噪开关的展示顺序与 develop 设计保持一致。
    const noiseOrder = ['sidebar', 'comments', 'banners', 'blockAllVideos'];

    const feasibilityReason = readerLayer.getLastFeasibilityReason();
    const feasibilityMessages = {
      domain: '此页面暂不支持阅读模式（识别为视频/流媒体网站）',
      video: '此页面暂不支持阅读模式（检测到视频内容为主）',
      'thin-content': '此页面暂不支持阅读模式（未能识别到足够的正文内容）',
    };

    const panel = document.createElement('div');
    panel.className = isFirstOpen ? 'ins-reader-panel opening' : 'ins-reader-panel';
    panel.classList.toggle('expanded', state.isExpanded);
    const showPresetSection = Boolean((prefs.presets && prefs.presets.length > 0) || prefs.hasCustomized);
    const showDefaultPreset = Boolean(prefs.hasCustomized);

    let panelHTML = `
      <div class="panel-top">
        ${
          state.isExpanded
            ? '<button class="back-btn" data-role="collapse-btn" aria-label="返回">‹ 返回</button>'
            : ''
        }
        <div class="brand">${INS_brandMarkup()}</div>
        ${state.isExpanded
          ? '<button class="close-btn" data-role="close" aria-label="关闭">×</button>'
          : `<button class="switch ${prefs.enabled ? 'on' : ''}" data-role="panel-enabled-toggle" aria-label="缓读总开关"><span></span></button>`}
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
          <div class="group-header ${state.expandedMenus.typography ? 'open' : ''}" data-role="typography-toggle" role="button" tabindex="0" aria-expanded="${state.expandedMenus.typography}" aria-controls="typography-menu">
            <span class="group-label">${MODULE_ICONS.typography}<span>舒适排版</span></span>
            <span class="group-actions"><button class="switch small ${prefs.typographyEnabled !== false ? 'on' : ''}" data-role="typography-master-switch" aria-label="舒适排版开关"><span></span></button><span class="group-icon">›</span></span>
          </div>
          <div id="typography-menu" class="group-content ${state.expandedMenus.typography ? 'expanded' : ''}" data-role="typography-menu" role="region">
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

        <div class="expandable-group" data-group="ai">
          <div class="group-header ${state.expandedMenus.ai ? 'open' : ''}" data-role="ai-toggle" role="button" tabindex="0" aria-expanded="${state.expandedMenus.ai}" aria-controls="ai-menu">
            <span class="group-label">${MODULE_ICONS.ai}<span>AI 内容助手</span></span>
            <span class="group-actions"><button class="switch small ${prefs.aiEnabled ? 'on' : ''}" data-role="ai-master-switch" aria-label="AI 内容助手开关"><span></span></button><span class="group-icon">›</span></span>
          </div>
          <div id="ai-menu" class="group-content ${state.expandedMenus.ai ? 'expanded' : ''}" data-role="ai-menu" role="region">
            ${
              prefs.aiEnabled
                ? `
              <div class="ai-row">
                <span>AI 摘要</span>
              </div>

                <p class="ai-hint">正文将发送到缓读后端生成摘要，不会用于其他用途。</p>
                <button class="ai-generate" data-role="ai-generate">${
                  readerLayer.getSummary() ? '重新生成摘要' : '生成摘要'
                }</button>
                <div class="ai-progress" data-role="ai-progress" hidden><div class="ai-progress-bar"></div></div>
                <p class="ai-status" data-role="ai-status"></p>

              <div class="ai-row">
                <span>简化段落长句</span>
                <button class="switch small ${prefs.aiHighlight?.breakLongParagraphs && prefs.aiHighlight?.simplifySentences ? 'on' : ''}" data-ai-feature="simplifyParagraphs" aria-label="简化段落长句"><span></span></button>
              </div>
              <div class="ai-row">
                <span>高亮核心信息</span>
                <button class="switch small ${prefs.aiHighlight?.markKeyInfo ? 'on' : ''}" data-ai-feature="markKeyInfo" aria-label="高亮核心信息"><span></span></button>
              </div>

            `
              : '<p class="ai-hint">开启 AI 内容助手后，可在此配置摘要与高亮。</p>'
            }
          </div>
        </div>

        <div class="expandable-group" data-group="noise">
          <div class="group-header ${state.expandedMenus.noise ? 'open' : ''}" data-role="noise-toggle" role="button" tabindex="0" aria-expanded="${state.expandedMenus.noise}" aria-controls="noise-menu">
            <span class="group-label">${MODULE_ICONS.noise}<span>动态降噪</span></span>
            <span class="group-actions"><button class="switch small ${prefs.noiseReduction ? 'on' : ''}" data-role="noise-master-switch" aria-label="动态降噪开关"><span></span></button><span class="group-icon">›</span></span>
          </div>
          <div id="noise-menu" class="group-content ${state.expandedMenus.noise ? 'expanded' : ''}" data-role="noise-menu" role="region">
            ${noiseOrder
              .map(
                (key) => `
              <div class="noise-row">
                <span>${noiseLabels[key]}</span>
                <button class="switch small ${prefs.noiseOptions[key] ? 'on' : ''}" data-noise-key="${key}"><span></span></button>
                </div>`
              )
              .join('')}
            <p class="noise-disclaimer">降噪通过样式调整隐藏元素，刷新页面后恢复原状。</p>
          </div>
        </div>

        <div class="panel-bottom-actions">
          <button class="save-preset" data-role="save-preset">+ 保存当前配置为预设</button>
          <p class="noise-feedback">本页已隐藏 <b data-role="noise-count">${readerLayer.getHiddenCount()}</b> 个干扰元素</p>
          <button class="restore" data-role="restore">恢复原网页</button>
        </div>
      `;
    } else {
      panelHTML += `
        <div class="simple-mode">
          ${showPresetSection ? `<div class="simple-presets">
            <div class="simple-presets-title">我的预设</div>
            <div class="preset-chips">
              ${showDefaultPreset ? `<span class="preset-chip-wrap"><button class="preset-chip ${prefs.activePreset === '默认模式' ? 'active' : ''}" data-default-preset="true">默认模式</button></span>` : ''}
              ${(prefs.presets || []).map((p, idx) => `<span class="preset-chip-wrap"><button class="preset-chip ${prefs.activePreset === p.name ? 'active' : ''}" data-simple-preset-index="${idx}">${p.name}</button><button class="preset-delete" data-simple-preset-delete="${idx}" aria-label="删除预设 ${p.name}">×</button></span>`).join('')}
            </div>
          </div>` : ''}

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
    const closeBtn = panel.querySelector('[data-role="close"]');
    if (closeBtn) closeBtn.addEventListener('click', () => INS_close(panel));

    const panelEnabledToggle = panel.querySelector('[data-role="panel-enabled-toggle"]');
    if (panelEnabledToggle) {
      panelEnabledToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!prefs.enabled && !prefs.hasActivated && !prefs.hasCustomized && !prefs.activePreset) {
          INS_resetToStrictDefaults(prefs);
          prefs.hasCustomized = false;
          prefs.activePreset = '';
        }
        prefs.enabled = !prefs.enabled;
        prefs.hasActivated = true;
        prefsStore.save();
        appController.applyAll();
        INS_render();
      });
    }

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
        INS_markCustomized(prefs);
        appController.applyAll();
      });
      customText.addEventListener('input', () => {
        prefs.customColors.text = customText.value;
        INS_markCustomized(prefs);
        appController.applyAll();
      });
      [customBg, customText].forEach((input) => input.addEventListener('change', prefsStore.save));
    }

    // 页面底色调色盘：选中色板即写入前景/背景色
    panel.querySelectorAll('[data-swatch-bg]').forEach((btn) => {
      btn.addEventListener('click', () => {
        prefs.customColors.bg = btn.getAttribute('data-swatch-bg');
        prefs.customColors.text = btn.getAttribute('data-swatch-text');
        INS_markCustomized(prefs);
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
        INS_markCustomized(prefs);
        prefsStore.save();
        appController.applyAll();
        INS_render();
      });
    });

    // 字体选择
    panel.querySelectorAll('[data-font]').forEach((btn) => {
      btn.addEventListener('click', () => {
        prefs.fontFamily = btn.getAttribute('data-font');
        INS_markCustomized(prefs);
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
        typographyToggle.classList.toggle('open', state.expandedMenus.typography);
        typographyToggle.setAttribute('aria-expanded', String(state.expandedMenus.typography));
        typographyMenu.classList.toggle('expanded');
        typographyMenu.style.maxHeight = state.expandedMenus.typography ? `${typographyMenu.scrollHeight}px` : '0px';
      });
    }
    const typographyMasterSwitch = panel.querySelector('[data-role="typography-master-switch"]');
    if (typographyMasterSwitch) {
      typographyMasterSwitch.addEventListener('click', (e) => {
        e.stopPropagation();
        prefs.typographyEnabled = prefs.typographyEnabled === false;
        INS_markCustomized(prefs);
        prefsStore.save();
        appController.applyAll();
        INS_render();
      });
    }

    // 降噪菜单展开/收起 - 注意这里只控制展开/收起，不同时改变 noiseReduction 状态
    const noiseToggle = panel.querySelector('[data-role="noise-toggle"]');
    const noiseMenu = panel.querySelector('[data-role="noise-menu"]');
    if (noiseToggle && noiseMenu) {
      noiseToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        state.expandedMenus.noise = !state.expandedMenus.noise;
        noiseToggle.classList.toggle('open', state.expandedMenus.noise);
        noiseToggle.setAttribute('aria-expanded', String(state.expandedMenus.noise));
        noiseMenu.classList.toggle('expanded');
        noiseMenu.style.maxHeight = state.expandedMenus.noise ? `${noiseMenu.scrollHeight}px` : '0px';
      });
    }
    const noiseMasterSwitch = panel.querySelector('[data-role="noise-master-switch"]');
    if (noiseMasterSwitch) {
      noiseMasterSwitch.addEventListener('click', (e) => {
        e.stopPropagation();
        prefs.noiseReduction = !prefs.noiseReduction;
        INS_markCustomized(prefs);
        prefsStore.save();
        appController.applyAll();
        INS_render();
      });
    }

    // AI 菜单展开/收起
    const aiToggle = panel.querySelector('[data-role="ai-toggle"]');
    const aiMenu = panel.querySelector('[data-role="ai-menu"]');
    if (aiToggle && aiMenu) {
      aiToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        state.expandedMenus.ai = !state.expandedMenus.ai;
        aiToggle.classList.toggle('open', state.expandedMenus.ai);
        aiToggle.setAttribute('aria-expanded', String(state.expandedMenus.ai));
        aiMenu.classList.toggle('expanded');
        aiMenu.style.maxHeight = state.expandedMenus.ai ? `${aiMenu.scrollHeight}px` : '0px';
      });
    }

    // AI 内容助手模块总开关（位于 AI 展开区，避免与一级菜单的展开按钮冲突）
    const simpleEnabledToggle = panel.querySelector('[data-role="simple-enabled-toggle"]');
    if (simpleEnabledToggle) {
      simpleEnabledToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        prefs.enabled = !prefs.enabled;
        prefsStore.save();
        appController.applyAll();
        INS_render();
      });
    }

    const aiMasterSwitch = panel.querySelector('[data-role="ai-master-switch"]');
    if (aiMasterSwitch) {
      aiMasterSwitch.addEventListener('click', (e) => {
        e.stopPropagation();
        prefs.aiEnabled = !prefs.aiEnabled;
        INS_markCustomized(prefs);
        prefsStore.save();
        INS_render();
      });
    }

    // AI 内容助手四项二级开关。只有总开关会决定是否进入阅读模式，模块设置本身不自动启用总开关。
    panel.querySelectorAll('[data-ai-feature]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const feature = btn.getAttribute('data-ai-feature');
        INS_markCustomized(prefs);
        if (feature === 'simplifyParagraphs') {
          const next = !(prefs.aiHighlight.breakLongParagraphs && prefs.aiHighlight.simplifySentences);
          prefs.aiHighlight.breakLongParagraphs = next;
          prefs.aiHighlight.simplifySentences = next;
          prefs.aiHighlight.enabled = Boolean(next || prefs.aiHighlight.markKeyInfo);
        }
        else if (Object.prototype.hasOwnProperty.call(prefs.aiHighlight, feature)) {
          prefs.aiHighlight[feature] = !prefs.aiHighlight[feature];
          prefs.aiHighlight.enabled = Boolean(
            prefs.aiHighlight.breakLongParagraphs ||
              prefs.aiHighlight.simplifySentences ||
              prefs.aiHighlight.markKeyInfo
          );
        }
        prefsStore.save();
        INS_render();
      });
    });

    // AI 高亮子功能复选框
    panel.querySelectorAll('[data-highlight-key]').forEach((checkbox) => {
      checkbox.addEventListener('change', () => {
        const key = checkbox.getAttribute('data-highlight-key');
        prefs.aiHighlight[key] = checkbox.checked;
        INS_markCustomized(prefs);
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
          if (prefs.activePreset === prefs.presets[idx]?.name) prefs.activePreset = '';
          prefs.presets.splice(idx, 1);
          prefsStore.save();
          INS_render();
        }
      });
    });

    // 各降噪选项开关
    panel.querySelectorAll('[data-noise-key]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.getAttribute('data-noise-key');
        prefs.noiseOptions[key] = !prefs.noiseOptions[key];
        INS_markCustomized(prefs);
        prefsStore.save();
        appController.applyAll();
        INS_render();
      });
    });

    // 简洁模式预设胶囊
    panel.querySelectorAll('[data-simple-preset-index]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.getAttribute('data-simple-preset-index'));
        INS_applyPreset(prefs.presets[idx]);
      });
    });
    const defaultPresetBtn = panel.querySelector('[data-default-preset]');
    if (defaultPresetBtn) defaultPresetBtn.addEventListener('click', INS_applyDefaultMode);
    panel.querySelectorAll('[data-simple-preset-delete]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = Number(btn.getAttribute('data-simple-preset-delete'));
        if (confirm('确定删除此预设？')) {
          if (prefs.activePreset === prefs.presets[idx]?.name) prefs.activePreset = '';
          prefs.presets.splice(idx, 1);
          prefsStore.save();
          INS_render();
        }
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
      top: 18px;
      right: 18px;
      width: 296px;
      padding: 16px;
      font-family: Inter, "Noto Sans SC", -apple-system, sans-serif;
      font-size: 12px;
      color: #1A1A1A;
      background: #FFFFFF;
      border: 1px solid #E0E0DC;
      border-radius: 10px;
      box-shadow: 0 12px 36px #00000018;
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
    .panel-top { display: flex; justify-content: space-between; align-items: center; padding-bottom: 12px; border-bottom: 1px solid #EBEBEB; }
    .back-btn {
      border: none; background: transparent; color: #111111; cursor: pointer;
      font-size: 13px; padding: 0 8px 0 0; line-height: 1.4;
    }
    .back-btn:hover { color: #555555; }
    .brand { display: flex; align-items: center; gap: 7px; font-size: 17px; font-weight: 700; color: #111111; }
    .brand .read-icon { display: block; flex: none; }
    .close-btn {
      background: none; border: 0; font-size: 16px; line-height: 1; color: #777777;
      cursor: pointer; padding: 2px 4px;
    }
    .close-btn:hover { color: #111111; }
    .tagline { margin: 5px 0 14px; font-size: 10px; color: #999999; }
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
      background: #F5F5F3; border-radius: 4px; padding: 2px; margin-bottom: 10px;
    }
    .segmented button {
      background: none; border: 0; border-radius: 3px; padding: 5px; font-size: 11px;
      color: #666666; cursor: pointer; transition: background 0.15s, color 0.15s;
    }
    .segmented button.selected { background: #FFFFFF; color: #111111; font-weight: 600; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
    .expandable-group { margin: 10px 0; }
    .group-header {
      display: flex; justify-content: space-between; align-items: center;
      width: 100%; padding: 12px 0; background: transparent; border-radius: 0;
      border: 0; border-top: 1px solid #EBEBEB; cursor: pointer; font-size: 13px; font-weight: 600; color: #111111;
      transition: background 0.15s;
    }
    .group-header:hover { background: #F5F5F3; }
    .group-label { display: flex; align-items: center; gap: 8px; }
    .group-label svg { width: 14px; height: 14px; fill: none; stroke: #FFB800; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
    .group-actions { display: flex; align-items: center; gap: 9px; }
    .group-icon { font-size: 20px; line-height: 1; color: #CCCCCC; transition: transform 0.18s; }
    .group-header.open .group-icon { transform: rotate(90deg); color: #111111; }
    .group-content {
      max-height: 0; overflow: hidden; transition: max-height 0.2s ease-out;
      margin-top: 0;
    }
    .group-content.expanded { max-height: 1600px; margin-top: 2px; }
    .custom-colors { display: flex; gap: 14px; margin-bottom: 10px; font-size: 11px; color: #555555; }
    .custom-colors label { display: flex; align-items: center; gap: 6px; }
    .custom-colors input[type="color"] { width: 24px; height: 20px; border: 1px solid #DCDCDC; border-radius: 3px; padding: 0; cursor: pointer; }
    .setting { margin: 8px 0; }
    .setting span { display: flex; justify-content: space-between; color: #444444; margin-bottom: 4px; }
    .setting b { color: #111111; font-weight: 500; }
    /* 步进器行：标签在左、加减控件在右，同一行对齐 */
    .setting.row { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
    .setting.row > span { margin-bottom: 0; }
    .step-value {
      min-width: 42px; text-align: center; font-variant-numeric: tabular-nums;
      color: #111111; font-weight: 500;
    }
    .bg-swatches { display: flex; flex-wrap: wrap; gap: 6px; }
    .bg-swatch {
      width: 22px; height: 22px; border-radius: 50%; cursor: pointer;
      border: 1px solid #DCDCDC; padding: 0; transition: transform 0.15s, box-shadow 0.15s;
    }
    .bg-swatch:hover { transform: scale(1.1); }
    .bg-swatch.active { box-shadow: 0 0 0 2px #FFB800; border-color: #fff; }
    .stepper { display: flex; align-items: center; gap: 6px; }
    .stepper input[type="range"] { flex: 1; accent-color: #FFB800; }
    .stepper button {
      width: 20px; height: 20px; flex: none; border: 1px solid #DCDCDC; border-radius: 4px;
      background: #fff; color: #555555; cursor: pointer; font-size: 13px; line-height: 1;
      display: flex; align-items: center; justify-content: center; transition: background 0.15s;
    }
    .stepper button:hover:not(:disabled) { background: #F5F5F3; }
    .stepper button:disabled { opacity: 0.4; cursor: default; }
    .font-options { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; margin-top: 6px; }
    .font-btn {
      padding: 6px; border: 1px solid #DCDCDC; border-radius: 4px; background: #fff;
      color: #555555; font-size: 11px; cursor: pointer; transition: all 0.15s;
    }
    .font-btn.active { background: #FFF3CC; color: #7A5800; border-color: #FFB800; }
    .font-btn:hover:not(.active) { background: #F5F5F3; }
    .width-row { display: flex; align-items: center; gap: 5px; margin-top: 8px; color: #555555; }
    .width-row span { margin-right: auto; }
    .width-row button {
      background: none; border: 0; border-radius: 3px; padding: 5px; font-size: 11px;
      color: #666666; cursor: pointer; transition: background 0.15s, color 0.15s;
    }
    .width-row button.active { color: #111111; background: #FFF3CC; }
    .save-preset {
      width: 100%; height: 26px; margin-top: 8px; border: 1px solid #DCDCDC; border-radius: 4px;
      background: #fff; color: #111111; font-size: 11px; cursor: pointer; transition: background 0.15s;
    }
    .save-preset:hover { background: #FFF3CC; }
    .presets-section { margin: 10px 0; }
    .presets-header { font-size: 11px; font-weight: 600; color: #555555; margin-bottom: 6px; padding: 0 5px; }
    .presets-list { display: flex; flex-direction: column; gap: 4px; }
    .preset-item { display: flex; gap: 6px; align-items: center; }
    .preset-apply {
      flex: 1; padding: 6px; border: 1px solid #DCDCDC; border-radius: 4px; background: #fff;
      color: #555555; font-size: 11px; cursor: pointer; transition: all 0.15s; text-align: left;
    }
    .preset-apply:hover { background: #F5F5F3; }
    .preset-delete {
      width: 24px; height: 24px; padding: 0; border: 1px solid #DCDCDC; border-radius: 4px;
      background: #fff; color: #555555; font-size: 14px; cursor: pointer; transition: all 0.15s;
    }
    .preset-delete:hover { background: #fff5f5; color: #b95042; }
    .noise-row { display: flex; justify-content: space-between; align-items: center; min-height: 26px; color: #333333; gap: 8px; }
    .noise-row > span { display: flex; align-items: baseline; gap: 5px; }
    .noise-note { font-style: normal; font-size: 10px; color: #b95042; white-space: nowrap; }
    .noise-feedback { margin: 7px 0 0; font-size: 10px; color: #777777; }
    .noise-disclaimer { margin: 8px 0 0; font-size: 10px; color: #888888; line-height: 1.5; }
    .ai-row { display: flex; justify-content: space-between; align-items: center; height: 26px; color: #333333; }
    .ai-hint { margin: 4px 0 8px; font-size: 10px; color: #777777; line-height: 1.5; }
    .ai-generate {
      width: 100%; height: 28px; border: 1px solid #DCDCDC; border-radius: 4px;
      background: #fff; color: #111111; font-size: 12px; cursor: pointer; transition: background 0.15s;
    }
    .ai-generate:hover:not(:disabled) { background: #FFF3CC; }
    .ai-generate:disabled { opacity: 0.6; cursor: default; }
    .ai-progress { margin: 8px 0 0; height: 3px; border-radius: 999px; background: #E8E8E5; overflow: hidden; }
    .ai-progress-bar { width: 40%; height: 100%; border-radius: 999px; background: #FFB800; animation: ins-reader-ai-progress 1.1s ease-in-out infinite; }
    @keyframes ins-reader-ai-progress {
      0% { transform: translateX(-100%); }
      100% { transform: translateX(250%); }
    }
    .ai-status { margin: 6px 0 0; font-size: 10px; color: #777777; min-height: 12px; }
    .ai-status.error { color: #b95042; }
    .ai-highlight-section { display: none; }
    .ai-highlight-header { font-size: 11px; font-weight: 600; color: #555555; margin-bottom: 6px; }
    .highlight-option { margin: 4px 0; }
    .highlight-option label { display: flex; align-items: center; gap: 6px; font-size: 11px; color: #555555; cursor: pointer; }
    .highlight-option input[type="checkbox"] { cursor: pointer; }
    .switch {
      cursor: pointer; background: #c8d0ca; border: 0; border-radius: 999px;
      width: 33px; height: 18px; padding: 2px; transition: background 0.18s;
    }
    .switch span { display: block; width: 14px; height: 14px; background: #fff; border-radius: 50%; transition: transform 0.18s; box-shadow: 0 1px 2px rgba(0,0,0,0.13); }
    .switch.on { background: #FFB800; }
    .switch.on span { transform: translateX(15px); }
    .switch.small { width: 27px; height: 15px; }
    .switch.small span { width: 11px; height: 11px; }
    .switch.small.on span { transform: translateX(12px); }
    .restore {
      width: 100%; height: 30px; margin: 15px 0 0; display: flex; align-items: center; justify-content: center;
      color: #333333; background: #fff; border: 1px solid #DCDCDC; border-radius: 4px; cursor: pointer; font-size: 12px;
      transition: background 0.15s;
    }
    .restore:hover { background: #f6f8f5; }
    .panel-bottom-actions { margin-top: 15px; padding-top: 14px; border-top: 1px solid #EBEBEB; }
    .panel-bottom-actions .save-preset { margin-top: 0; }
    .panel-bottom-actions .noise-feedback { margin: 8px 0 0; }
    .panel-bottom-actions .restore { margin-top: 8px; }
    .simple-mode { display: flex; flex-direction: column; gap: 12px; }
    .simple-presets { display: flex; flex-direction: column; gap: 6px; }
    .simple-presets-title { font-size: 11px; color: #777777; }
    .preset-chips { display: flex; flex-wrap: wrap; gap: 7px; }
    .preset-chip-wrap { position: relative; display: inline-flex; align-items: center; }
    .preset-chip {
      min-height: 30px; padding: 0 14px; border: 1px solid #DCDCDC; border-radius: 999px;
      background: #F5F5F3; color: #555555; font-size: 12px; cursor: pointer; transition: background 0.15s, color 0.15s, padding-right 0.15s;
    }
    .preset-chip:hover { background: #FFF3CC; }
    .preset-chip.active { background: #111111; border-color: #111111; color: #FFFFFF; }
    .preset-chip-wrap .preset-delete {
      position: absolute; right: 6px; top: 50%; transform: translateY(-50%);
      width: 16px; height: 16px; padding: 0; border: 0; background: transparent;
      color: #888888; font-size: 13px; line-height: 16px; opacity: 0; pointer-events: none;
    }
    .preset-chip-wrap:hover .preset-delete { opacity: 1; pointer-events: auto; }
    .preset-chip-wrap:hover .preset-chip { padding-right: 28px; }
    .expand-btn {
      width: 100%; height: 32px; border: 1px solid #DCDCDC; border-radius: 4px; background: #fff;
      color: #111111; font-size: 12px; cursor: pointer; transition: all 0.15s; font-weight: 600;
    }
    .expand-btn:hover { background: #FFF3CC; }
  `;

  window.INS_Reader.panelUI = {
    toggle: INS_toggle,
    openQuick: INS_openQuick,
    openDetails: INS_openDetails,
    render: INS_render,
    isOpen: INS_isOpen,
    updateNoiseCount: INS_updateNoiseCount,
  };
})();
