import { unregisterAll } from "@tauri-apps/plugin-global-shortcut";
import { state, heightForLines, linesForHeight, type Settings } from "./state";

type Opt = [string | number, string];
type Field = { key: keyof Settings; label: string; hint?: string } & (
  | { type: "select"; options: Opt[] }
  | { type: "range"; min: number; max: number; step: number; fmt: (v: number) => string }
  | { type: "check" }
  | { type: "key" }
  | { type: "lines" }
);

const pct = (v: number) => `${Math.round(v * 100)}%`;

const sections: [string, Field[]][] = [
  [
    "外观",
    [
      { key: "theme", label: "主题", type: "select", options: [["log", "日志灰"], ["terminal", "终端"], ["paper", "文档白"], ["system", "跟随系统"]] },
      { key: "fontSize", label: "字号", type: "range", min: 11, max: 22, step: 1, fmt: (v) => `${v}px` },
      { key: "winHeight", label: "窗口高度", hint: "快速设为整行；也可直接拖动窗口边缘", type: "lines" },
      { key: "opacity", label: "背景不透明度", type: "range", min: 0.2, max: 1, step: 0.05, fmt: pct },
      { key: "showProgress", label: "显示阅读进度", type: "check" },
    ],
  ],
  [
    "窗口",
    [
      { key: "anchor", label: "默认位置", hint: "启动和从设置返回时回到这里；拖动后会记住位置，改动此项则清除", type: "select", options: [["bottom-left", "左下角"], ["bottom-right", "右下角"], ["bottom-edge", "底边（铺满宽度）"]] },
      { key: "alwaysOnTop", label: "始终置顶", type: "check" },
    ],
  ],
  [
    "伪装",
    [
      { key: "bossAction", label: "老板键动作", type: "select", hint: "任务栏设为“不显示”时一律完全隐藏", options: [["stash", "收进任务栏，点开显示伪装界面"], ["disguise", "立即显示伪装界面"], ["hide", "完全隐藏"]] },
      { key: "disguiseAs", label: "伪装为", hint: "同时决定任务栏图标和标题", type: "select", options: [["vscode", "VS Code"], ["notepad", "记事本"], ["explorer", "文件资源管理器"]] },
      { key: "taskbar", label: "任务栏", type: "select", options: [["disguise", "伪装图标和标题"], ["plain", "普通"], ["hidden", "不显示"]] },
      { key: "hideAltTab", label: "在 Alt+Tab 中隐藏", hint: "开启后任务栏也不会显示", type: "check" },
      { key: "fadeOnLeave", label: "鼠标移出后变淡", type: "check" },
      { key: "fadeOpacity", label: "变淡后的不透明度", type: "range", min: 0, max: 0.6, step: 0.05, fmt: pct },
      { key: "hideOnBlur", label: "失去焦点自动隐藏", hint: "隐藏后按老板键找回", type: "check" },
    ],
  ],
  [
    "快捷键",
    [{ key: "bossKey", label: "老板键", hint: "全局生效；再按一次恢复阅读", type: "key" }],
  ],
  [
    "文件",
    [{ key: "epubImages", label: "加载 epub 图片", hint: "关闭后图片显示为 [图片]；切换后立即重新载入当前书", type: "check" }],
  ],
];

let tab = 0;

export function keyLabel(k: string) {
  return k
    .replace("CommandOrControl", "Ctrl")
    .replace("Backquote", "`")
    .split("+")
    .join(" + ");
}

/** 允许不带修饰键单独使用的按键：不会妨碍正常打字 */
const SOLO_KEYS = /^(F\d{1,2}|Pause|ScrollLock|Backquote|Insert|NumLock|ContextMenu)$/;

/** KeyboardEvent → 全局快捷键字符串；修饰键本身返回 null，不可单用的键返回 "solo" */
function comboOf(e: KeyboardEvent) {
  if (["Control", "Alt", "Shift", "Meta"].includes(e.key)) return null;
  const mods = [e.ctrlKey && "Ctrl", e.altKey && "Alt", e.shiftKey && "Shift"].filter(Boolean);
  const key = e.code.replace(/^Key/, "").replace(/^Digit/, "");
  if (!mods.length && !SOLO_KEYS.test(key)) return "solo";
  return [...mods, key].join("+");
}

function fieldHtml(f: Field) {
  const v = state.settings[f.key];
  const label = `<label>${f.label}${f.hint ? `<small>${f.hint}</small>` : ""}</label>`;
  let ctl = "";
  if (f.type === "select") {
    ctl = `<select data-k="${f.key}">${f.options.map(([ov, ol]) => `<option value="${ov}" ${ov === v ? "selected" : ""}>${ol}</option>`).join("")}</select>`;
  } else if (f.type === "range") {
    ctl = `<span class="out">${f.fmt(v as number)}</span><input type="range" data-k="${f.key}" min="${f.min}" max="${f.max}" step="${f.step}" value="${v}">`;
  } else if (f.type === "lines") {
    const cur = linesForHeight(state.settings.winHeight, state.settings.fontSize);
    const opts = [1, 3, 5, 8, 12];
    if (!opts.includes(cur)) opts.push(cur), opts.sort((a, b) => a - b);
    ctl = `<select data-k="${f.key}" data-lines>${opts.map((n) => `<option value="${n}" ${n === cur ? "selected" : ""}>${n} 行</option>`).join("")}</select>`;
  } else if (f.type === "check") {
    ctl = `<input type="checkbox" data-k="${f.key}" ${v ? "checked" : ""}>`;
  } else {
    ctl = `<div><button class="keycap" data-k="${f.key}">${keyLabel(v as string)}</button><div class="err"></div></div>`;
  }
  return `<div class="field">${label}${ctl}</div>`;
}

export function renderSettings(api: { back(): void; changed(key: keyof Settings): Promise<string | void> }) {
  const root = document.createElement("div");
  root.className = "panel";
  root.innerHTML = `<div class="panel-head"><h1>Preferences</h1><button class="link" data-a="back" title="Esc">返回</button></div><div class="settings"><nav></nav><div class="form"></div></div>`;
  const nav = root.querySelector("nav")!;
  const form = root.querySelector<HTMLElement>(".form")!;

  const draw = () => {
    nav.innerHTML = sections.map(([name], i) => `<div class="${i === tab ? "on" : ""}" data-tab="${i}">${name}</div>`).join("");
    form.innerHTML = sections[tab][1].map(fieldHtml).join("");
  };

  const set = async (key: keyof Settings, value: unknown) => {
    (state.settings as unknown as Record<string, unknown>)[key] = value;
    return api.changed(key);
  };

  root.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    if (t.closest("[data-a=back]")) return api.back();
    const tabEl = t.closest<HTMLElement>("[data-tab]");
    if (tabEl) {
      tab = Number(tabEl.dataset.tab);
      draw();
    }
    if (t.classList.contains("keycap")) {
      // 录制期间注销全局老板键，否则按下现有组合会被系统截走
      unregisterAll();
      t.classList.add("rec");
      t.textContent = "请按下组合键…";
    }
  });

  root.addEventListener("input", (e) => {
    const t = e.target as HTMLInputElement;
    const key = t.dataset.k as keyof Settings | undefined;
    if (!key) return;
    const cur = state.settings[key];
    let value: unknown = t.type === "checkbox" ? t.checked : t.value;
    if (typeof cur === "number") value = Number(value);
    if ("lines" in t.dataset) value = heightForLines(value as number, state.settings.fontSize);
    if (t.type === "range") {
      const f = sections.flatMap((s) => s[1]).find((x) => x.key === key);
      if (f?.type === "range") t.previousElementSibling!.textContent = f.fmt(value as number);
    }
    set(key, value);
  });

  root.addEventListener("keydown", async (e) => {
    const t = e.target as HTMLElement;
    if (!t.classList.contains("keycap") || !t.classList.contains("rec")) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Escape") {
      await set("bossKey", state.settings.bossKey);
      return draw();
    }
    const combo = comboOf(e);
    if (!combo) return;
    if (combo === "solo") {
      t.nextElementSibling!.textContent = "单键只支持 F1–F24、Pause、Scroll Lock、`、Insert 等";
      return;
    }
    const prev = state.settings.bossKey;
    const err = await set("bossKey", combo);
    if (err) {
      await set("bossKey", prev);
      draw();
      form.querySelector(".err")!.textContent = `无法注册：${err}`;
      return;
    }
    draw();
  });

  draw();
  return root;
}
