import { useEffect, useRef, useState } from "react";
import {
  Bell, Bookmark, ChevronLeft, ChevronRight, Eye, GripVertical,
  Info, Menu, Pause, Play,
  Sparkles, Type, X, Zap,
} from "lucide-react";

// ── Primitives ────────────────────────────────────────────────────────────────

function Switch({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <button aria-label={label} onClick={onChange} className={`switch ${checked ? "on" : ""}`}>
      <span />
    </button>
  );
}

function NumStepper({ label, value, onChange, min, max, step = 1, unit = "" }: {
  label: string; value: number; onChange: (v: number) => void;
  min: number; max: number; step?: number; unit?: string;
}) {
  const clamp = (v: number) => Math.min(max, Math.max(min, parseFloat(v.toFixed(2))));
  return (
    <div className="num-stepper">
      <span className="num-stepper-label">{label}</span>
      <div className="num-stepper-ctrl">
        <button onClick={() => onChange(clamp(value - step))}>−</button>
        <input
          type="number" value={value} min={min} max={max} step={step}
          onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v)) onChange(clamp(v)); }}
        />
        {unit && <span className="num-unit">{unit}</span>}
        <button onClick={() => onChange(clamp(value + step))}>+</button>
      </div>
    </div>
  );
}

function ToggleRow({ label, checked, onClick }: { label: string; checked: boolean; onClick: () => void }) {
  return (
    <div className="toggle-row">
      <span>{label}</span>
      <Switch checked={checked} onChange={onClick} label={label} />
    </div>
  );
}

// ── Content ───────────────────────────────────────────────────────────────────

const originalParagraphs = [
  "在城市里，安静似乎成了一种需要主动争取的资源：来自工作群的提醒、自动播放的短视频、不断更新的资讯流，以及页面上那些试图占据注意力的浮层，都在提醒我们还有更多内容值得立刻处理。",
  "一项围绕公共图书馆的观察发现，当读者能够自行选择座位、光线与阅读节奏时，他们更愿意在同一篇文章上停留；这种停留并不意味着效率下降，反而可能为理解留出必要的空白。研究者也提醒，环境偏好存在明显个体差异，不能把某一种阅读方式当成通用答案。",
  "因此，好的阅读环境未必需要替人做决定。它更像一个可调节的容器：在需要时减少噪音，在想要时保留原貌，并让每一个改变都可以被清楚地看见、被随时撤销。",
];
const easyParagraphs = [
  "在城市里，安静需要主动争取。工作提醒、自动播放的视频、不断更新的资讯和浮层，都可能打断阅读。",
  "公共图书馆的一项观察发现：读者能选择座位、光线和阅读节奏时，往往更愿意停留在同一篇文章上。停留不一定降低效率，它也可能给理解留出空白。",
  "研究者提醒，不同人的环境偏好差异很大。没有一种阅读方式适合所有人。好的阅读环境不替人决定，而是在需要时减少噪音，并允许随时恢复原貌。",
];

function ReadIcon({ size = 18, activated = false }: { size?: number; activated?: boolean }) {
  const bg = activated ? "#FFB800" : "#111111";
  const wave = activated ? "#111111" : "#FFB800";
  return (
    <svg className="read-icon" width={size} height={size} viewBox="0 0 200 200" fill="none" aria-hidden="true">
      <rect width="200" height="200" rx="44" fill={bg}/>
      <path
        d="M58 62C58 53.16 65.16 46 74 46H126C134.84 46 142 53.16 142 62V138C142 146.84 134.84 154 126 154H74C65.16 154 58 146.84 58 138V62Z"
        fill="none" stroke="white" strokeWidth="12"/>
      <path d="M82 78H122" stroke="white" strokeWidth="11" strokeLinecap="round"/>
      <path d="M78 100C92 90 106 90 120 100C134 110 146 110 158 100" stroke={wave} strokeWidth="11" strokeLinecap="round"/>
      <path d="M78 126C92 116 106 116 120 126C134 136 146 136 158 126" stroke="white" strokeWidth="11" strokeLinecap="round" opacity="0.5"/>
    </svg>
  );
}

function Article({
  easy, fontSize, lineHeight, width, showProgress,
  staticMode = false, split = true, highlight = true,
  paragraphGap = 22, font = "原网页", letterSpacing = 0,
  originalText = false, showSummary = false,
}: {
  easy: boolean; fontSize: number; lineHeight: number; width: string;
  showProgress: boolean; staticMode?: boolean; split?: boolean; highlight?: boolean;
  paragraphGap?: number; font?: string; letterSpacing?: number;
  originalText?: boolean; showSummary?: boolean;
}) {
  const paragraphs = originalText
    ? originalParagraphs
    : easy ? (split ? easyParagraphs : [easyParagraphs.join(" ")]) : originalParagraphs;
  const fontFamily =
    font === "清晰无衬线" ? '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif' :
    font === "阅读衬线" ? '"Source Han Serif SC", "Noto Serif CJK SC", "Songti SC", serif' :
    '"Noto Serif SC", serif';
  return (
    <article
      className={`article ${easy ? "easy" : "raw"} ${staticMode ? "compare-article" : ""}`}
      style={{
        "--article-size": `${fontSize}px`,
        "--article-leading": lineHeight,
        "--article-width": width,
        "--paragraph-gap": `${paragraphGap}px`,
        "--reading-font": fontFamily,
        "--letter-sp": `${letterSpacing}px`,
      } as React.CSSProperties}
    >
      {showSummary && (
        <div className="ai-summary-box">
          <div className="summary-header"><Sparkles size={13} />AI 摘要</div>
          <p>本文探讨城市阅读中的噪音问题，指出安静需要主动争取。公共图书馆研究显示，自主选择阅读节奏能提升专注。作者认为好的阅读环境应是可调节的容器，而非替人做决定。</p>
        </div>
      )}
      <div className="article-kicker"><span>城市观察</span><span>·</span><span>阅读与公共空间</span></div>
      <h1>在噪声之中，为阅读留出一小块安静的地方</h1>
      <p className="deck">人们并非总要读得更快。有时，重新安排眼前的信息，也是一种开始。</p>
      <div className="byline">
        <span className="author-dot">林</span>
        <span>林见 / 撰文</span><span>2025.04.17</span><span>12 分钟阅读</span>
      </div>
      {showProgress && (
        <div className="reading-progress">
          <span>阅读进度</span><div><i /></div><b>38%</b>
        </div>
      )}
      <div className="article-rule" />
      {paragraphs.map((p, index) => (
        <p className="body-copy" key={index}>
          {easy && !originalText && highlight && index === 1
            ? <>{p.split("停留不一定")[0]}<mark>停留不一定降低效率</mark>{"，它也可能给理解留出空白。"}</>
            : p}
        </p>
      ))}
      {easy && (
        <aside className="source-note">
          <Info size={15} />
          <span>缓读版保留原文观点与限定条件。<button>查看对应原文</button></span>
        </aside>
      )}
    </article>
  );
}

// ── Panels ────────────────────────────────────────────────────────────────────

type Preset = { name: string; settings: Record<string, unknown> };

function QuickPanel({ enabled, setEnabled, savedPresets, applyPreset, applyDefaultMode, activePresetName, hasCustomized, deletePreset, openDetails }: {
  enabled: boolean; setEnabled: (v: boolean) => void;
  savedPresets: Preset[]; applyPreset: (p: Preset) => void;
  applyDefaultMode: () => void; activePresetName: string | null;
  hasCustomized: boolean; deletePreset: (i: number) => void; openDetails: () => void;
}) {
  const showPresets = hasCustomized || savedPresets.length > 0;
  return (
    <aside className="quick-panel" aria-label="缓读快捷控制">
      <header className="quick-header">
        <div>
          <div className="brand"><ReadIcon size={20} />缓读</div>
          <p className="quick-slogan">把阅读调成适合你的样子</p>
        </div>
        <Switch checked={enabled} onChange={() => setEnabled(!enabled)} label="缓读开关" />
      </header>

      {showPresets && (
        <div className="quick-presets">
          <div className="quick-presets-header">我的预设</div>
          <div className="quick-presets-list">
            {hasCustomized && (
              <button
                onClick={applyDefaultMode}
                className={`preset-chip${activePresetName === "默认模式" ? " active" : ""}`}
              >
                默认模式
              </button>
            )}
            {savedPresets.map((p, i) => (
              <span key={i} className="preset-chip-wrap">
                <button
                  onClick={() => applyPreset(p)}
                  className={`preset-chip${activePresetName === p.name ? " active" : ""}`}
                >
                  {p.name}
                </button>
                <button
                  className="preset-delete"
                  onClick={e => { e.stopPropagation(); deletePreset(i); }}
                  aria-label={`删除预设 ${p.name}`}
                >×</button>
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="quick-footer">
        <button onClick={openDetails}>详细配置 <span>›</span></button>
      </div>
    </aside>
  );
}

function ModuleRow({ label, icon, checked, onToggle, onClick }: {
  label: string; icon: React.ReactNode; checked: boolean;
  onToggle: () => void; onClick: () => void;
}) {
  return (
    <div className="module-row" onClick={onClick}>
      <span className="module-row-label">{icon}{label}</span>
      <div className="module-row-right">
        <div onClick={e => e.stopPropagation()}>
          <Switch checked={checked} onChange={onToggle} label={label} />
        </div>
        <ChevronRight size={14} className="module-chevron" />
      </div>
    </div>
  );
}

function FirstLevelPanel({
  enabled, setEnabled,
  typographyOn, setTypographyOn,
  aiOn, setAiOn,
  noiseOn, setNoiseOn,
  setActiveModule, noiseCount,
  savedPresets, setSavedPresets, getCurrentSettings,
  markChanged, onPresetSaved, closeDetails,
}: any) {
  const [saving, setSaving] = useState(false);
  const [presetName, setPresetName] = useState("");

  const doSave = () => {
    if (!presetName.trim()) return;
    const name = presetName.trim();
    setSavedPresets((prev: Preset[]) => [...prev, { name, settings: getCurrentSettings() }]);
    onPresetSaved(name);
    setSaving(false);
    setPresetName("");
  };

  return (
    <aside className="plugin-panel first-level-panel" aria-label="缓读配置">
      <header className="panel-top">
        <div className="brand"><ReadIcon size={20} />缓读</div>
        <button aria-label="关闭" className="icon-btn" onClick={closeDetails}><X size={15} /></button>
      </header>

      <div className="module-list">
        <ModuleRow label="舒适排版" icon={<Type size={14} />} checked={typographyOn} onToggle={() => { setTypographyOn(!typographyOn); markChanged(); }} onClick={() => setActiveModule("typography")} />
        <ModuleRow label="AI 内容助手" icon={<Sparkles size={14} />} checked={aiOn} onToggle={() => { setAiOn(!aiOn); markChanged(); }} onClick={() => setActiveModule("ai")} />
        <ModuleRow label="动态降噪" icon={<Zap size={14} />} checked={noiseOn} onToggle={() => { setNoiseOn(!noiseOn); markChanged(); }} onClick={() => setActiveModule("noise")} />
      </div>

      {noiseCount > 0 && (
        <p className="noise-feedback first-noise-feedback">已隐藏 {noiseCount} 个干扰元素</p>
      )}

      <div className="panel-bottom">
        {saving ? (
          <div className="preset-save-ui">
            <input
              autoFocus
              value={presetName}
              onChange={e => setPresetName(e.target.value)}
              onKeyDown={e => e.key === "Enter" && doSave()}
              placeholder="为预设命名…"
              maxLength={12}
            />
            <div className="preset-save-actions">
              <button onClick={doSave} className="btn-primary">保存</button>
              <button onClick={() => setSaving(false)} className="btn-ghost">取消</button>
            </div>
          </div>
        ) : savedPresets.length >= 3 ? (
          <p className="preset-limit">已达预设上限（3 个）</p>
        ) : (
          <button className="save-preset-btn" onClick={() => setSaving(true)}>
            + 保存当前配置为预设
          </button>
        )}
      </div>
    </aside>
  );
}

function TypographyModule({ typographyOn, setTypographyOn, fontSize, setFontSize, lineHeight, setLineHeight, paragraphGap, setParagraphGap, font, setFont, letterSpacing, setLetterSpacing, pageBg, setPageBg, customBgColor, setCustomBgColor, onChanged, onBack }: any) {
  const ch = (fn: () => void) => { fn(); onChanged(); };
  return (
    <aside className="plugin-panel module-panel">
      <header className="module-header">
        <button className="back-btn" onClick={onBack}><ChevronLeft size={15} />返回</button>
        <span className="module-title">舒适排版</span>
        <Switch checked={typographyOn} onChange={() => ch(() => setTypographyOn(!typographyOn))} label="排版开关" />
      </header>
      <div className={typographyOn ? "" : "module-disabled"}>
        <NumStepper label="字号" value={fontSize} onChange={v => ch(() => setFontSize(v))} min={14} max={28} unit="px" />
        <NumStepper label="行距" value={lineHeight} onChange={v => ch(() => setLineHeight(parseFloat(v.toFixed(1))))} min={1.2} max={2.5} step={0.1} />
        <NumStepper label="段落间距" value={paragraphGap} onChange={v => ch(() => setParagraphGap(v))} min={8} max={48} step={2} unit="px" />
        <div className="font-row">
          <span>字体</span>
          {["原网页", "清晰无衬线", "阅读衬线"].map(o => (
            <button key={o} className={font === o ? "active" : ""} onClick={() => ch(() => setFont(o))}>{o}</button>
          ))}
        </div>
        <NumStepper label="字间距" value={letterSpacing} onChange={v => ch(() => setLetterSpacing(v))} min={-2} max={8} step={0.5} unit="px" />
        <div className="background-row">
          <span>页面底色</span>
          <div className="bg-options">
            {([["原网页", "original"], ["柔和浅色", "soft"], ["深色", "dark"]] as [string, string][]).map(([l, v]) => (
              <button key={v} className={pageBg === v ? "active" : ""} onClick={() => ch(() => setPageBg(v))}>{l}</button>
            ))}
            <label className={`color-picker-btn ${pageBg === "custom" ? "active" : ""}`} title="自定义颜色">
              <span className="color-swatch-dot" style={{ background: customBgColor }} />
              <span>自定义</span>
              <input
                type="color"
                value={customBgColor}
                onChange={e => ch(() => { setCustomBgColor(e.target.value); setPageBg("custom"); })}
              />
            </label>
          </div>
        </div>
      </div>
    </aside>
  );
}

function AiModule({ aiOn, setAiOn, showSummary, setShowSummary, split, setSplit, simplify, requestSimplify, highlight, setHighlight, aiPrompt, setAiPrompt, onChanged, onBack }: any) {
  const ch = (fn: () => void) => { fn(); onChanged(); };
  return (
    <aside className="plugin-panel module-panel">
      <header className="module-header">
        <button className="back-btn" onClick={onBack}><ChevronLeft size={15} />返回</button>
        <span className="module-title">AI 内容助手</span>
        <Switch checked={aiOn} onChange={() => ch(() => setAiOn(!aiOn))} label="AI开关" />
      </header>
      <div className={aiOn ? "" : "module-disabled"}>
        <ToggleRow label="AI 摘要" checked={showSummary} onClick={() => ch(() => setShowSummary(!showSummary))} />
        <ToggleRow label="拆分长段落" checked={split} onClick={() => ch(() => setSplit(!split))} />
        <ToggleRow label="简化复杂长句" checked={simplify} onClick={requestSimplify} />
        <ToggleRow label="标记核心信息" checked={highlight} onClick={() => ch(() => setHighlight(!highlight))} />
        {aiPrompt && (
          <div className="ai-consent">
            <Info size={14} />
            <span>
              简化会将本段文本发送至 AI 处理，不会改变原文。
              <button onClick={() => { requestSimplify(true); setAiPrompt(false); }}>同意并开启</button>
              <button onClick={() => setAiPrompt(false)}>暂不</button>
            </span>
          </div>
        )}
      </div>
    </aside>
  );
}

function NoiseModule({ noiseOn, setNoiseOn, hideSidebar, setHideSidebar, hideComments, setHideComments, hideBanners, setHideBanners, blockVideos, setBlockVideos, onChanged, onBack }: any) {
  const ch = (fn: () => void) => { fn(); onChanged(); };
  return (
    <aside className="plugin-panel module-panel">
      <header className="module-header">
        <button className="back-btn" onClick={onBack}><ChevronLeft size={15} />返回</button>
        <span className="module-title">动态降噪</span>
        <Switch checked={noiseOn} onChange={() => ch(() => setNoiseOn(!noiseOn))} label="降噪开关" />
      </header>
      <div className={noiseOn ? "" : "module-disabled"}>
        <ToggleRow label="隐藏侧边栏" checked={hideSidebar} onClick={() => ch(() => setHideSidebar(!hideSidebar))} />
        <ToggleRow label="隐藏评论区" checked={hideComments} onClick={() => ch(() => setHideComments(!hideComments))} />
        <ToggleRow label="隐藏弹窗横幅" checked={hideBanners} onClick={() => ch(() => setHideBanners(!hideBanners))} />
        <ToggleRow label="屏蔽所有视频" checked={blockVideos} onClick={() => ch(() => setBlockVideos(!blockVideos))} />
      </div>
      <p className="noise-disclaimer">降噪通过样式调整隐藏元素，刷新页面后恢复原状。</p>
    </aside>
  );
}

// ── App ───────────────────────────────────────────────────────────────────────

export default function App() {
  const [enabled, setEnabled] = useState(false);
  const [panel, setPanel] = useState(true);
  const [detailed, setDetailed] = useState(false);
  const [activeModule, setActiveModule] = useState<null | "typography" | "ai" | "noise">(null);
  const [comparison, setComparison] = useState(false);
  const [divider, setDivider] = useState(49);

  const [typographyOn, setTypographyOn] = useState(true);
  const [aiOn, setAiOn] = useState(true);
  const [noiseOn, setNoiseOn] = useState(true);

  const [fontSize, setFontSize] = useState(18);
  const [lineHeight, setLineHeight] = useState(1.7);
  const [paragraphGap, setParagraphGap] = useState(22);
  const [font, setFont] = useState("原网页");
  const [letterSpacing, setLetterSpacing] = useState(0);
  const [pageBg, setPageBg] = useState("original");
  const [customBgColor, setCustomBgColor] = useState("#F2EFE6");

  const [showSummary, setShowSummary] = useState(true);
  const [split, setSplit] = useState(true);
  const [simplify, setSimplify] = useState(true);
  const [highlight, setHighlight] = useState(true);
  const [contentVersion, setContentVersion] = useState("缓读版");
  const [aiPrompt, setAiPrompt] = useState(false);

  const [hideSidebar, setHideSidebar] = useState(true);
  const [hideComments, setHideComments] = useState(true);
  const [hideBanners, setHideBanners] = useState(true);
  const [blockVideos, setBlockVideos] = useState(true);

  const [savedPresets, setSavedPresets] = useState<Preset[]>([]);
  const [activePresetName, setActivePresetName] = useState<string | null>(null);
  const [hasCustomized, setHasCustomized] = useState(false);

  const markChanged = () => { setActivePresetName(null); setHasCustomized(true); };

  const getCurrentSettings = () => ({
    fontSize, lineHeight, paragraphGap, font, letterSpacing, pageBg, customBgColor,
    showSummary, split, simplify, highlight, contentVersion,
    hideSidebar, hideComments, hideBanners, blockVideos,
    typographyOn, aiOn, noiseOn,
  });

  const applyPreset = (preset: Preset) => {
    const s = preset.settings as Record<string, any>;
    setEnabled(true);
    setFontSize(s.fontSize); setLineHeight(s.lineHeight); setParagraphGap(s.paragraphGap);
    setFont(s.font); setLetterSpacing(s.letterSpacing); setPageBg(s.pageBg); setCustomBgColor(s.customBgColor);
    setShowSummary(s.showSummary); setSplit(s.split); setSimplify(s.simplify);
    setHighlight(s.highlight); setContentVersion(s.contentVersion);
    setHideSidebar(s.hideSidebar); setHideComments(s.hideComments);
    setHideBanners(s.hideBanners); setBlockVideos(s.blockVideos);
    setTypographyOn(s.typographyOn); setAiOn(s.aiOn); setNoiseOn(s.noiseOn);
    setActivePresetName(preset.name); setHasCustomized(true);
  };

  const applyDefaultMode = () => {
    setEnabled(true);
    setTypographyOn(true); setAiOn(true); setNoiseOn(true);
    setFontSize(18); setLineHeight(1.7); setParagraphGap(22);
    setFont("原网页"); setLetterSpacing(0); setPageBg("original");
    setShowSummary(true); setSplit(true); setSimplify(true); setHighlight(true);
    setHideSidebar(true); setHideComments(true); setHideBanners(true); setBlockVideos(true);
    setActivePresetName("默认模式"); setHasCustomized(true);
  };

  const requestSimplify = (approved = false) => {
    if (simplify) { setSimplify(false); return; }
    if (approved) { setSimplify(true); } else { setAiPrompt(true); }
  };

  const deletePreset = (i: number) => {
    if (activePresetName === savedPresets[i]?.name) setActivePresetName(null);
    setSavedPresets(prev => prev.filter((_, idx) => idx !== i));
  };

  const onPresetSaved = (name: string) => {
    setEnabled(true);
    setActivePresetName(name);
    setHasCustomized(true);
  };

  // Close panel on click outside
  const panelRef = useRef<HTMLDivElement>(null);
  const iconBtnRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!panel) return;
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        panelRef.current && !panelRef.current.contains(target) &&
        iconBtnRef.current && !iconBtnRef.current.contains(target)
      ) {
        setPanel(false);
        setDetailed(false);
        setActiveModule(null);
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [panel]);

  const activeNoise = enabled && noiseOn;
  const activeTypography = enabled && typographyOn;
  const activeAi = enabled && aiOn;

  const noiseCount = activeNoise
    ? [hideSidebar, hideComments, hideBanners, blockVideos].filter(Boolean).length
    : 0;

  const effectiveBg = activeTypography ? pageBg : "original";
  const effectiveFontSize = activeTypography ? fontSize : 17;
  const effectiveLineHeight = activeTypography ? lineHeight : 1.8;
  const effectiveParagraphGap = activeTypography ? paragraphGap : 18;
  const effectiveFont = activeTypography ? font : "原网页";
  const effectiveLetterSpacing = activeTypography ? letterSpacing : 0;
  const effectiveSummary = activeAi && showSummary;
  const easy = activeAi;
  const originalText = contentVersion === "原文" || !simplify;

  const hideSidebarActive = activeNoise && hideSidebar;
  const hideCommentsActive = activeNoise && hideComments;
  const hideBannersActive = activeNoise && hideBanners;
  const blockVideosActive = activeNoise && blockVideos;

  const bodyClass = [
    "site-body",
    hideSidebarActive ? "hide-sidebar" : "noisy",
    `page-${effectiveBg}`,
  ].join(" ");

  const title = comparison ? "前后对比 · 同步阅读" : enabled ? "缓读模式已开启" : "原始网页";

  return (
    <main className="canvas">
      <div className="browser-shell">
        <div className="browser-top">
          <div className="traffic"><i /><i /><i /></div>
          <div className="browser-actions"><span>‹</span><span>›</span><span>↻</span></div>
          <div className="address"><span className="lock">⌁</span> thepaper.cn / insight / reading-space <b>⋮</b></div>
          <div className="toolbar">
            <button aria-label="收藏"><Bookmark size={16} /></button>
            <button aria-label="通知"><Bell size={16} /><i className="notification" /></button>
            <button
              ref={iconBtnRef}
              onClick={() => { setPanel(!panel); setDetailed(false); setActiveModule(null); }}
              className={`slow-icon ${enabled ? "activated" : ""}`}
              aria-label="打开缓读插件"
            >
              <ReadIcon size={18} activated={enabled} />
            </button>
            <div className="avatar">M</div>
          </div>
        </div>

        <div className="site-nav">
          <div className="site-logo">澎湃 <small>INSIGHT</small></div>
          <nav><a>深度</a><a>城市</a><a>文化</a><a>思想</a><a>生活</a></nav>
          <div><span className="live-dot" />正在直播 <Menu size={19} /></div>
        </div>

        {!hideBannersActive && (
          <div className="promo-banner">
            <span className="live-dot" />直播：雨季城市观察 · 今晚 20:00
            <button>立即预约</button><b>×</b>
          </div>
        )}

        <div className="context-bar">
          <span className={enabled ? "mode-on" : ""}>
            {enabled ? <><Sparkles size={14} />缓读模式</> : <><Eye size={14} />原始网页</>}
          </span>
          <b>{title}</b>
          <span>{comparison ? "左右拖动滑杆，查看同一内容" : "第 4 / 8 节"}</span>
        </div>

        {comparison ? (
          <div className="comparison-stage">
            <div className="compare-label left-label">原始网页</div>
            <div className="compare-label right-label">缓读模式</div>
            <div className="compare-original">
              <Article easy={false} fontSize={16} lineHeight={1.7} width="88%" showProgress={false} staticMode split={false} highlight={false} />
            </div>
            <div className="compare-easy" style={{ clipPath: `inset(0 0 0 ${divider}%)` }}>
              <Article easy={true} fontSize={fontSize} lineHeight={lineHeight} width="640px" showProgress staticMode split={split} highlight={highlight} paragraphGap={paragraphGap} font={font} letterSpacing={letterSpacing} showSummary={showSummary} />
            </div>
            <input className="compare-slider" type="range" min="18" max="82" value={divider} onChange={e => setDivider(+e.target.value)} aria-label="前后对比滑杆" />
            <div className="divider-line" style={{ left: `${divider}%` }}><GripVertical size={19} /></div>
          </div>
        ) : (
          <div
            className={bodyClass}
            style={effectiveBg === "custom" ? { "--custom-bg": customBgColor } as React.CSSProperties : undefined}
          >
            {!hideSidebarActive && (
              <aside className="left-rail">
                <span>专题</span><b>公共空间</b><b>城市生活</b>
                <div className="rail-ad">春日书单<br /><em>限时领取</em></div>
              </aside>
            )}

            <div className="reading-area">
              <Article
                easy={easy}
                fontSize={effectiveFontSize}
                lineHeight={effectiveLineHeight}
                width={hideSidebarActive ? "680px" : "640px"}
                showProgress={enabled}
                split={split}
                highlight={highlight}
                paragraphGap={effectiveParagraphGap}
                font={effectiveFont}
                letterSpacing={effectiveLetterSpacing}
                originalText={originalText}
                showSummary={effectiveSummary}
              />
              {!hideCommentsActive && (
                <div className="comments-section">
                  <h3 className="comments-title">评论区 <span>42 条</span></h3>
                  {[
                    { u: "读者甲", t: "这篇文章很有共鸣，每次打开手机总被通知打断，完全没法专心读完一篇文章。" },
                    { u: "M", t: "很喜欢「可调节的容器」这个比喻，阅读环境本来就应该是个人化的。" },
                  ].map(c => (
                    <div className="comment-item" key={c.u}>
                      <span className="comment-avatar">{c.u[0]}</span>
                      <div><b>{c.u}</b><p>{c.t}</p></div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {!hideSidebarActive && (
              <aside className="right-rail">
                {!blockVideosActive && (
                  <div className="video-card">
                    <div className="video-noise">
                      城市夜航<br />
                      <small>{activeNoise ? "已暂停 · 00:18" : "自动播放 · 00:18"}</small>
                      <button>{activeNoise ? <Play size={16} /> : <Pause size={16} />}</button>
                    </div>
                    <b>正在发生</b><p>夜间公共交通延长运营</p>
                  </div>
                )}
                <h3>延伸阅读</h3>
                {["那些被重新设计的公共座椅", "给日常生活留一点余地", "一间图书馆的慢速实验"].map((x, i) => (
                  <div className="recommend" key={x}><span>{String(i + 1).padStart(2, "0")}</span>{x}</div>
                ))}
              </aside>
            )}

            {!hideBannersActive && (
              <div className="subscribe-pop">
                <button aria-label="关闭"><X size={15} /></button>
                <strong>订阅我们的周报</strong>
                <p>每周三，收到一封更有深度的信。</p>
                <div><input placeholder="你的邮箱" /><button>订阅</button></div>
              </div>
            )}
          </div>
        )}
      </div>

      {panel && (
        <div ref={panelRef}>
          {!detailed && (
            <QuickPanel
              enabled={enabled}
              setEnabled={setEnabled}
              savedPresets={savedPresets}
              applyPreset={applyPreset}
              applyDefaultMode={applyDefaultMode}
              activePresetName={activePresetName}
              hasCustomized={hasCustomized}
              deletePreset={deletePreset}
              openDetails={() => setDetailed(true)}
            />
          )}
          {detailed && activeModule === null && (
            <FirstLevelPanel
              enabled={enabled} setEnabled={setEnabled}
              typographyOn={typographyOn} setTypographyOn={setTypographyOn}
              aiOn={aiOn} setAiOn={setAiOn}
              noiseOn={noiseOn} setNoiseOn={setNoiseOn}
              setActiveModule={setActiveModule}
              noiseCount={noiseCount}
              savedPresets={savedPresets} setSavedPresets={setSavedPresets}
              getCurrentSettings={getCurrentSettings}
              markChanged={markChanged}
              onPresetSaved={onPresetSaved}
              closeDetails={() => { setDetailed(false); setActiveModule(null); }}
            />
          )}
          {detailed && activeModule === "typography" && (
            <TypographyModule
              typographyOn={typographyOn} setTypographyOn={setTypographyOn}
              fontSize={fontSize} setFontSize={setFontSize}
              lineHeight={lineHeight} setLineHeight={setLineHeight}
              paragraphGap={paragraphGap} setParagraphGap={setParagraphGap}
              font={font} setFont={setFont}
              letterSpacing={letterSpacing} setLetterSpacing={setLetterSpacing}
              pageBg={pageBg} setPageBg={setPageBg}
              customBgColor={customBgColor} setCustomBgColor={setCustomBgColor}
              onChanged={markChanged}
              onBack={() => setActiveModule(null)}
            />
          )}
          {detailed && activeModule === "ai" && (
            <AiModule
              aiOn={aiOn} setAiOn={setAiOn}
              showSummary={showSummary} setShowSummary={setShowSummary}
              split={split} setSplit={setSplit}
              simplify={simplify} requestSimplify={requestSimplify}
              highlight={highlight} setHighlight={setHighlight}
              aiPrompt={aiPrompt} setAiPrompt={setAiPrompt}
              onChanged={markChanged}
              onBack={() => setActiveModule(null)}
            />
          )}
          {detailed && activeModule === "noise" && (
            <NoiseModule
              noiseOn={noiseOn} setNoiseOn={setNoiseOn}
              hideSidebar={hideSidebar} setHideSidebar={setHideSidebar}
              hideComments={hideComments} setHideComments={setHideComments}
              hideBanners={hideBanners} setHideBanners={setHideBanners}
              blockVideos={blockVideos} setBlockVideos={setBlockVideos}
              onChanged={markChanged}
              onBack={() => setActiveModule(null)}
            />
          )}
        </div>
      )}
    </main>
  );
}
