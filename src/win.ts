import { invoke } from "@tauri-apps/api/core";
import {
  getCurrentWindow,
  availableMonitors,
  currentMonitor,
  primaryMonitor,
  PhysicalPosition,
  PhysicalSize,
} from "@tauri-apps/api/window";
import type { Anchor, DisguiseTarget, Settings, WinPos } from "./state";

export const win = getCurrentWindow();

const MARGIN = 12;

export const disguiseTitles: Record<DisguiseTarget, string> = {
  vscode: "utils.ts - workspace - Visual Studio Code",
  notepad: "会议纪要.txt - 记事本",
  explorer: "文档 - 文件资源管理器",
};

/**
 * 按锚点放置窗口；w/h 为逻辑像素，bottom-edge 时宽度铺满工作区。
 * saved 为拖动记住的位置（物理像素）：落在某个显示器工作区内时优先于锚点，并夹到该工作区内。
 */
export async function placeWindow(w: number, h: number, anchor: Anchor, saved: WinPos | null = null) {
  const savedMon = anchor === "bottom-edge" ? null : await monitorAt(saved);
  const mon = savedMon ?? (await currentMonitor()) ?? (await primaryMonitor());
  if (!mon) return;
  const sf = mon.scaleFactor;
  const { position: wp, size: ws } = mon.workArea;
  const m = Math.round(MARGIN * sf);
  let pw = Math.round(w * sf);
  const ph = Math.round(h * sf);
  let x: number;
  let y = wp.y + ws.height - ph - m;
  if (anchor === "bottom-edge") {
    pw = ws.width;
    x = wp.x;
    y = wp.y + ws.height - ph;
  } else if (saved && savedMon) {
    // 夹到工作区内：改了行数等导致尺寸变化时，窗口也不会伸到屏幕外
    x = clamp(saved.x, wp.x, wp.x + ws.width - pw);
    y = clamp(saved.y, wp.y, wp.y + ws.height - ph);
  } else if (anchor === "bottom-left") {
    x = wp.x + m;
  } else {
    x = wp.x + ws.width - pw - m;
  }
  await win.setSize(new PhysicalSize(pw, ph));
  await win.setPosition(new PhysicalPosition(x, y));
}

/** 左上角落在某个显示器的工作区内时返回该显示器；显示器拔掉或分辨率变化后，旧位置可能已在屏幕外 */
async function monitorAt(p: WinPos | null) {
  if (!p) return null;
  const mons = await availableMonitors();
  return (
    mons.find(
      ({ workArea: { position: o, size: s } }) => p.x >= o.x && p.x < o.x + s.width && p.y >= o.y && p.y < o.y + s.height,
    ) ?? null
  );
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(v, hi));
}

/** 应用任务栏 / Alt+Tab 伪装；disguised 表示当前正显示伪装界面 */
export async function applyTaskbar(s: Settings, disguised: boolean) {
  const useDisguise = disguised || s.taskbar === "disguise";
  await win.setTitle(useDisguise ? disguiseTitles[s.disguiseAs] : "notes");
  try {
    await invoke("set_window_icon", { target: useDisguise ? s.disguiseAs : "default" });
  } catch (e) {
    console.warn(e);
    await invoke("set_window_icon", { target: "default" });
  }
  // 切换该样式需要隐藏再显示窗口，状态没变时跳过，避免闪烁
  const altTabHidden = s.hideAltTab && !disguised;
  if (altTabHidden !== lastAltTabHidden) {
    await invoke("set_alt_tab_hidden", { hidden: altTabHidden });
    lastAltTabHidden = altTabHidden;
  }
  await win.setSkipTaskbar(s.taskbar === "hidden" && !disguised);
}

let lastAltTabHidden = false;

export async function logicalInnerSize() {
  const [size, sf] = await Promise.all([win.innerSize(), win.scaleFactor()]);
  return { w: Math.round(size.width / sf), h: Math.round(size.height / sf) };
}
