import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { register, unregisterAll } from "@tauri-apps/plugin-global-shortcut";
import { state, loadState, saveState, currentBook, lineHeightOf, CHROME_Y, type Book, type Settings } from "./state";
import { win, placeWindow, applyTaskbar, logicalInnerSize } from "./win";
import { Reader, textBlocks } from "./reader";
import { isEpub, readEpub, type BookContent, type TocItem } from "./epub";
import { disguiseHtml } from "./disguise";
import { renderShelf } from "./shelf";
import { renderSettings, keyLabel } from "./settings";
import { renderToc, tocIndexAt } from "./toc";

type View = "reader" | "shelf" | "settings" | "toc";
/** stashed：已收进任务栏，等待被点开；disguised：正在显示伪装界面 */
type Mode = "normal" | "stashed" | "disguised" | "hidden";

const PANEL_W = 520;
const PANEL_H = 420;

const app = document.getElementById("app")!;
const S = () => state.settings;
let view: View = "reader";
let mode: Mode = "normal";
let busy = false;
let dialogOpen = false;
/** 程序主动改窗口尺寸期间不把尺寸存为用户偏好 */
let sizingUntil = 0;

// ---------- 阅读视图 ----------
const icon = (d: string) => `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4">${d}</svg>`;
const readerEl = document.createElement("div");
readerEl.className = "reader";
readerEl.innerHTML = `
  <div class="viewport"><div class="flow"></div></div>
  <div class="empty" hidden></div>
  <div class="progress" data-a="pct" title="点击输入百分比跳转"></div>
  <div class="toolbar">
    <button data-a="shelf" title="文件 (Ctrl+O)">${icon('<path d="M2 4h12M2 8h12M2 12h8"/>')}</button>
    <button data-a="toc" title="目录 (Ctrl+T)" hidden>${icon('<path d="M5.5 4h8M5.5 8h8M5.5 12h8M2 4h1.5M2 8h1.5M2 12h1.5"/>')}</button>
    <button data-a="settings" title="设置 (Ctrl+,)">${icon('<circle cx="8" cy="8" r="2.2"/><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4"/>')}</button>
    <button data-a="boss" title="隐藏 (Esc)">${icon('<path d="M3 8h10"/>')}</button>
  </div>`;
const viewportEl = readerEl.querySelector<HTMLElement>(".viewport")!;
const emptyEl = readerEl.querySelector<HTMLElement>(".empty")!;
const progressEl = readerEl.querySelector<HTMLElement>(".progress")!;
const tocBtnEl = readerEl.querySelector<HTMLElement>('[data-a="toc"]')!;
const reader = new Reader(viewportEl, readerEl.querySelector<HTMLElement>(".flow")!);
/** 当前书的目录；没有目录时隐藏目录按钮 */
let currentToc: TocItem[] = [];

// ---------- 进度 ----------
/** 正在输入的百分比；为空时底部显示当前进度 */
let pctInput: HTMLInputElement | null = null;

const progressValue = () => (reader.progress * 100).toFixed(1);

function showProgress() {
  if (!pctInput) progressEl.textContent = `${progressValue()}%`;
}

/** 点击底部进度：原地变成输入框，输入 0–100 后回车跳转，Esc 或失焦取消 */
function editProgress() {
  if (pctInput || !reader.paras.length) return;
  const input = document.createElement("input");
  input.value = progressValue();
  input.addEventListener("keydown", (e) => {
    // 输入时不触发阅读快捷键（空格翻页、Esc 老板键等）
    e.stopPropagation();
    if (e.key === "Enter") seekPercent(input);
    else if (e.key === "Escape") closeProgress(input);
  });
  input.addEventListener("blur", () => closeProgress(input));
  pctInput = input;
  progressEl.replaceChildren(input, "%");
  input.select();
  input.focus();
}

function closeProgress(input: HTMLInputElement) {
  if (pctInput !== input) return;
  pctInput = null;
  showProgress();
}

function seekPercent(input: HTMLInputElement) {
  const text = input.value.trim().replace(/%$/, "").trim();
  const pct = Number(text);
  // 空输入、非数字或与当前进度相同时不跳，避免进度显示的小数精度带来的偏移
  if (text && Number.isFinite(pct) && pct !== Number(progressValue())) reader.seek(pct / 100);
  closeProgress(input);
}

reader.onMove = (para, line) => {
  const b = currentBook();
  if (!b) return;
  b.para = para;
  b.line = line;
  b.lastRead = Date.now();
  showProgress();
  saveState();
};

function showEmpty(msg: string | null) {
  emptyEl.hidden = !msg;
  emptyEl.textContent = msg ?? "";
  viewportEl.hidden = !!msg;
  progressEl.hidden = !!msg || !S().showProgress;
}

const lineHeight = () => lineHeightOf(S().fontSize);

function relayoutReader() {
  reader.layout(lineHeight(), readerEl.clientHeight - CHROME_Y);
  const b = currentBook();
  if (b && reader.paras.length) reader.jump(b.para, b.line);
}

async function placeReader() {
  const s = S();
  sizingUntil = Date.now() + 800;
  await placeWindow(s.winWidth, s.winHeight, s.anchor, state.winPos);
}

async function placePanel() {
  sizingUntil = Date.now() + 800;
  const anchor = S().anchor === "bottom-edge" ? "bottom-right" : S().anchor;
  await placeWindow(PANEL_W, PANEL_H, anchor);
}

// ---------- 书籍 ----------
/** 读取书籍内容；epub 的图片按设置决定是否加载，txt 没有目录 */
async function readBook(b: Book): Promise<BookContent> {
  if (isEpub(b.path)) return readEpub(b.path, S().epubImages);
  return { blocks: textBlocks(await invoke<string>("read_text_file", { path: b.path })), toc: [] };
}

let loadSeq = 0;

/** 把书籍内容交给阅读器；失败时在阅读区显示原因，返回是否成功 */
async function loadBook(b: Book): Promise<boolean> {
  // 连续切换设置时只保留最后一次的结果
  const seq = ++loadSeq;
  try {
    const { blocks, toc } = await readBook(b);
    if (seq !== loadSeq) return false;
    reader.load(blocks, b.para, b.line);
    b.total = reader.paras.length;
    setToc(toc);
    showEmpty(reader.paras.length ? null : "文件是空的");
    return true;
  } catch (e) {
    reader.paras = [];
    setToc([]);
    showEmpty(`${e}`);
    return false;
  }
}

function setToc(toc: TocItem[]) {
  currentToc = toc;
  tocBtnEl.hidden = !toc.length;
}

/** 从目录跳转：阅读位置记到该段落开头，再回到阅读视图 */
function openTocEntry(para: number) {
  const b = currentBook();
  if (b) {
    b.para = para;
    b.line = 0;
    b.lastRead = Date.now();
    saveState();
  }
  return showView("reader");
}

async function openBook(id: string) {
  const b = state.books.find((x) => x.id === id);
  if (!b) return;
  state.currentId = id;
  if (await loadBook(b)) b.lastRead = Date.now();
  saveState();
  await showView("reader");
}

async function addBooks() {
  dialogOpen = true;
  try {
    const picked = await open({ multiple: true, filters: [{ name: "txt / epub", extensions: ["txt", "epub"] }] });
    for (const path of picked ?? []) {
      if (state.books.some((b) => b.path === path)) continue;
      const name = path.split(/[\\/]/).pop()!.replace(/\.(txt|epub)$/i, "");
      state.books.push({ id: crypto.randomUUID(), name, path, group: "", para: 0, line: 0, total: 0, lastRead: 0 });
    }
    saveState();
  } finally {
    dialogOpen = false;
  }
}

// ---------- 视图切换 ----------
async function showView(v: View) {
  // 离开设置页时重新注册老板键（录制中途离开会处于注销状态）
  if (view === "settings" && v !== "settings") await registerBossKey();
  view = v;
  document.body.classList.remove("faded");
  if (v === "reader") {
    app.replaceChildren(readerEl);
    if (!currentBook()) showEmpty(`按 Ctrl+O 打开文件　·　${keyLabel(S().bossKey)} 老板键`);
    await placeReader();
    requestAnimationFrame(relayoutReader);
  } else if (v === "shelf") {
    app.replaceChildren(renderShelf({ open: openBook, add: addBooks, back: () => showView("reader"), changed: saveState }));
    await placePanel();
  } else if (v === "toc") {
    const cur = tocIndexAt(currentToc, currentBook()?.para ?? 0);
    app.replaceChildren(renderToc(currentToc, cur, { back: () => showView("reader"), open: openTocEntry }));
    await placePanel();
  } else {
    app.replaceChildren(renderSettings({ back: () => showView("reader"), changed: settingChanged }));
    await placePanel();
  }
}

function applyAppearance() {
  const s = S();
  const body = document.body;
  body.classList.remove("theme-log", "theme-terminal", "theme-paper", "theme-system");
  body.classList.add(`theme-${s.theme}`);
  body.style.setProperty("--alpha", String(s.opacity));
  body.style.setProperty("--fade", String(s.fadeOpacity));
  body.style.setProperty("--fs", `${s.fontSize}px`);
  readerEl.classList.toggle("edge", s.anchor === "bottom-edge");
  progressEl.hidden = !s.showProgress || !emptyEl.hidden;
}

async function registerBossKey(): Promise<string | void> {
  await unregisterAll();
  try {
    await register(S().bossKey, (e) => {
      if (e.state === "Pressed") boss();
    });
  } catch (e) {
    return String(e);
  }
}

async function settingChanged(key: keyof Settings): Promise<string | void> {
  saveState();
  applyAppearance();
  switch (key) {
    case "alwaysOnTop":
      await win.setAlwaysOnTop(S().alwaysOnTop);
      break;
    case "taskbar":
    case "disguiseAs":
    case "hideAltTab":
      await applyTaskbar(S(), false);
      break;
    case "anchor":
      // 改了默认位置即放弃拖动记住的位置，回到锚点
      state.winPos = null;
      await placePanel();
      break;
    case "bossKey":
      return registerBossKey();
    case "epubImages": {
      // 段落序号与图片开关无关，重新载入后阅读位置保持不变
      const b = currentBook();
      if (b && isEpub(b.path)) await loadBook(b);
      break;
    }
  }
}

// ---------- 老板键 ----------
function mountDisguise() {
  const el = document.createElement("div");
  el.className = "disguise";
  el.innerHTML = disguiseHtml(S().disguiseAs);
  app.replaceChildren(el);
  document.body.classList.remove("faded");
}

/** 立即全屏显示伪装界面 */
async function enterDisguise() {
  mountDisguise();
  mode = "disguised";
  await win.setAlwaysOnTop(false);
  await applyTaskbar(S(), true);
  await win.maximize();
  await win.setFocus();
}

/** 收进任务栏：屏幕上消失，任务栏留伪装图标；从任务栏点开时最大化显示伪装界面 */
async function stash() {
  // 任务栏不显示时没有入口可点，退化为完全隐藏
  if (S().taskbar === "hidden") {
    mode = "hidden";
    return win.hide();
  }
  mountDisguise();
  mode = "stashed";
  await win.hide();
  await win.setAlwaysOnTop(false);
  await applyTaskbar(S(), true);
  await invoke("set_stashed", { on: true, topmost: false });
}

async function restore() {
  const prev = mode;
  mode = "normal";
  if (prev === "hidden") {
    await win.show();
  } else {
    // 先换回阅读内容并隐藏，再恢复窗口状态，避免伪装界面闪一下
    app.replaceChildren(readerEl);
    await win.hide();
    await applyTaskbar(S(), false);
    await win.setAlwaysOnTop(S().alwaysOnTop);
    await invoke("set_stashed", { on: false, topmost: S().alwaysOnTop });
  }
  await showView("reader");
}

async function boss() {
  if (busy) return;
  busy = true;
  try {
    if (mode !== "normal") return await restore();
    switch (S().bossAction) {
      case "stash":
        return await stash();
      case "disguise":
        return await enterDisguise();
      case "hide":
        mode = "hidden";
        return await win.hide();
    }
  } finally {
    busy = false;
  }
}

// ---------- 事件 ----------
readerEl.addEventListener("click", (e) => {
  const a = (e.target as HTMLElement).closest<HTMLElement>("[data-a]")?.dataset.a;
  if (a === "shelf" || a === "settings" || a === "toc") showView(a);
  if (a === "boss") boss();
  if (a === "pct") editProgress();
});

/** 边缘 6px 留给窗口缩放，其余区域按下即可拖动窗口 */
app.addEventListener("mousedown", (e) => {
  if (e.button !== 0 || mode !== "normal") return;
  const t = e.target as HTMLElement;
  const edge = 6;
  if (e.clientX < edge || e.clientY < edge || innerWidth - e.clientX < edge || innerHeight - e.clientY < edge) return;
  if (t.closest("button, input, select, .book, .field, nav, .progress")) return;
  if (view === "reader" || t.closest(".panel-head")) win.startDragging();
});

let wheelAcc = 0;
readerEl.addEventListener("wheel", (e) => {
  wheelAcc += e.deltaY;
  if (Math.abs(wheelAcc) < 40) return;
  wheelAcc > 0 ? reader.next() : reader.prev();
  wheelAcc = 0;
}, { passive: true });

window.addEventListener("keydown", (e) => {
  if (mode === "disguised") return;
  const k = e.key;
  if (e.ctrlKey && k.toLowerCase() === "o") {
    e.preventDefault();
    showView(view === "shelf" ? "reader" : "shelf");
    return;
  }
  if (e.ctrlKey && k === ",") {
    e.preventDefault();
    showView(view === "settings" ? "reader" : "settings");
    return;
  }
  if (e.ctrlKey && k.toLowerCase() === "t") {
    e.preventDefault();
    if (currentToc.length) showView(view === "toc" ? "reader" : "toc");
    return;
  }
  if (view !== "reader") {
    if (k === "Escape") showView("reader");
    return;
  }
  if (k === "Escape") return void boss();
  if (["ArrowDown", "ArrowRight", "PageDown", " "].includes(k)) {
    e.preventDefault();
    reader.next();
  } else if (["ArrowUp", "ArrowLeft", "PageUp"].includes(k)) {
    e.preventDefault();
    reader.prev();
  }
});

document.documentElement.addEventListener("mouseleave", () => {
  if (S().fadeOnLeave && view === "reader" && mode === "normal") document.body.classList.add("faded");
});
document.documentElement.addEventListener("mouseenter", () => document.body.classList.remove("faded"));
document.addEventListener("contextmenu", (e) => e.preventDefault());

let resizeTimer: number | undefined;
window.addEventListener("resize", () => {
  if (view === "reader" && mode === "normal") requestAnimationFrame(relayoutReader);
  clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(async () => {
    if (view !== "reader" || mode !== "normal" || Date.now() < sizingUntil) return;
    const { w, h } = await logicalInnerSize();
    const s = S();
    s.winHeight = h;
    if (s.anchor !== "bottom-edge") s.winWidth = w;
    saveState();
  }, 500);
});

// 拖动后记住位置：程序摆放（sizingUntil）、伪装 / 隐藏、设置页和底边铺满模式下的位置不记
let moveTimer: number | undefined;
win.onMoved(({ payload }) => {
  if (view !== "reader" || mode !== "normal" || S().anchor === "bottom-edge" || Date.now() < sizingUntil) return;
  clearTimeout(moveTimer);
  moveTimer = window.setTimeout(async () => {
    // 从最大化（伪装界面）还原时也会收到移动事件，此时的坐标不是用户拖出来的
    if (view !== "reader" || mode !== "normal" || (await win.isMaximized())) return;
    state.winPos = { x: payload.x, y: payload.y };
    saveState();
  }, 500);
});

win.onFocusChanged(({ payload: focused }) => {
  if (focused && mode === "stashed") mode = "disguised";
  if (!focused && S().hideOnBlur && mode === "normal" && !dialogOpen) {
    mode = "hidden";
    win.hide();
  }
});

// ---------- 启动 ----------
async function start() {
  try {
    await loadState();
    applyAppearance();
    await applyTaskbar(S(), false);
    await win.setAlwaysOnTop(S().alwaysOnTop);
    if (currentBook()) await openBook(state.currentId!);
    else await showView("reader");
    await registerBossKey();
  } finally {
    await win.show();
    if (S().fadeOnLeave) document.body.classList.add("faded");
  }
}

start();
