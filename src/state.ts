import { invoke } from "@tauri-apps/api/core";

export type Theme = "log" | "terminal" | "paper" | "system";
export type Anchor = "bottom-left" | "bottom-right" | "bottom-edge";
export type BossAction = "stash" | "disguise" | "hide";
export type DisguiseTarget = "vscode" | "notepad" | "explorer";
export type TaskbarMode = "disguise" | "plain" | "hidden";

export interface Settings {
  theme: Theme;
  fontSize: number;
  /** 背景不透明度 0.2–1 */
  opacity: number;
  showProgress: boolean;
  alwaysOnTop: boolean;
  anchor: Anchor;
  /** 阅读窗口尺寸（逻辑像素）；显示行数由高度决定。底边模式下宽度铺满，忽略 winWidth */
  winWidth: number;
  winHeight: number;

  bossKey: string;
  bossAction: BossAction;
  disguiseAs: DisguiseTarget;
  taskbar: TaskbarMode;
  hideAltTab: boolean;
  fadeOnLeave: boolean;
  fadeOpacity: number;
  hideOnBlur: boolean;
  /** 加载 epub 中的图片；关闭时以 [图片] 占位 */
  epubImages: boolean;
  /** 设置结构版本，用于一次性迁移 */
  schema: number;
}

export interface Book {
  id: string;
  name: string;
  path: string;
  group: string;
  /** 阅读位置：段落序号 + 段内行偏移 */
  para: number;
  line: number;
  total: number;
  lastRead: number;
}

/** 窗口左上角的物理像素坐标 */
export interface WinPos {
  x: number;
  y: number;
}

export interface AppState {
  settings: Settings;
  books: Book[];
  currentId: string | null;
  /** 拖动后记住的阅读窗口位置；为空时使用默认位置设置 */
  winPos: WinPos | null;
}

/** 阅读窗口上下内边距 + 边框 */
export const CHROME_Y = 14;

export function lineHeightOf(fontSize: number) {
  return Math.round(fontSize * 1.75);
}

export function heightForLines(lines: number, fontSize: number) {
  return lines * lineHeightOf(fontSize) + CHROME_Y;
}

export function linesForHeight(height: number, fontSize: number) {
  return Math.max(1, Math.floor((height - CHROME_Y) / lineHeightOf(fontSize)));
}

export const defaultSettings: Settings = {
  theme: "log",
  fontSize: 13,
  opacity: 0.92,
  showProgress: true,
  alwaysOnTop: true,
  anchor: "bottom-right",
  winWidth: 420,
  winHeight: heightForLines(3, 13),

  bossKey: "Alt+Backquote",
  bossAction: "stash",
  disguiseAs: "vscode",
  taskbar: "disguise",
  hideAltTab: false,
  fadeOnLeave: true,
  fadeOpacity: 0.25,
  hideOnBlur: false,
  epubImages: false,
  schema: 2,
};

export const state: AppState = {
  settings: { ...defaultSettings },
  books: [],
  currentId: null,
  winPos: null,
};

export async function loadState() {
  const raw = await invoke<string | null>("load_state");
  if (!raw) return;
  try {
    const saved = JSON.parse(raw) as Partial<AppState>;
    state.settings = { ...defaultSettings, ...saved.settings };
    migrate(state.settings as Settings & Record<string, unknown>);
    // 旧版默认老板键迁移到新默认
    if (state.settings.bossKey === "CommandOrControl+Alt+Q") state.settings.bossKey = defaultSettings.bossKey;
    state.books = saved.books ?? [];
    state.currentId = saved.currentId ?? null;
    const p = saved.winPos;
    state.winPos = p && Number.isFinite(p.x) && Number.isFinite(p.y) ? { x: p.x, y: p.y } : null;
  } catch {
    // 状态文件损坏时用默认值，下次保存会覆盖
  }
}

/** 旧版“固定行数 / 整页”两套尺寸合并为一套窗口尺寸 */
function migrate(s: Settings & Record<string, unknown>) {
  if (typeof s.range === "number") {
    if (s.range > 0) {
      s.winWidth = (s.lineWidth as number) ?? s.winWidth;
      s.winHeight = heightForLines(s.range, s.fontSize);
    } else {
      s.winWidth = (s.pageWidth as number) ?? s.winWidth;
      s.winHeight = (s.pageHeight as number) ?? s.winHeight;
    }
  }
  // v2：老板键默认改为“收进任务栏”；旧的 minimize 已移除
  if ((s.schema ?? 1) < 2) {
    if (s.bossAction === ("disguise" as string) || s.bossAction === ("minimize" as string)) s.bossAction = "stash";
    s.schema = 2;
  }
  for (const k of ["range", "lineWidth", "pageWidth", "pageHeight", "hotCorner"]) delete s[k];
}

let saveTimer: number | undefined;

export function saveState() {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    invoke("save_state", { json: JSON.stringify(state) }).catch(console.error);
  }, 300);
}

export function currentBook(): Book | undefined {
  return state.books.find((b) => b.id === state.currentId);
}
