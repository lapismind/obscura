import type { TocItem } from "./epub";

export interface TocApi {
  back(): void;
  open(para: number): void;
}

/** 当前所在章节：段落序号不超过阅读位置的最后一项（目录一般按顺序排列） */
export function tocIndexAt(items: TocItem[], para: number) {
  let best = -1;
  items.forEach((item, i) => {
    if (item.para <= para && (best < 0 || item.para >= items[best].para)) best = i;
  });
  return best;
}

/** 目录面板：按层级缩进列出章节，点击跳转。标题用 Contents，与书架、设置一样低调 */
export function renderToc(items: TocItem[], current: number, api: TocApi) {
  const root = document.createElement("div");
  root.className = "panel";
  root.innerHTML = `<div class="panel-head"><h1>Contents</h1><button class="link" data-a="back" title="Esc">返回</button></div><div class="panel-body"></div>`;
  const body = root.querySelector<HTMLElement>(".panel-body")!;
  if (!items.length) body.innerHTML = `<div class="hint">没有目录</div>`;
  items.forEach((item, i) => {
    const row = document.createElement("div");
    row.className = `toc-item${item.depth ? " sub" : ""}${i === current ? " current" : ""}`;
    // tabIndex=-1：可以聚焦（键盘移动、鼠标点击），但不进入 Tab 顺序
    row.tabIndex = -1;
    row.style.paddingLeft = `${10 + item.depth * 16}px`;
    row.textContent = item.title;
    row.title = item.title;
    row.dataset.para = String(item.para);
    body.appendChild(row);
  });

  root.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    if (t.closest("[data-a=back]")) return api.back();
    const row = t.closest<HTMLElement>(".toc-item");
    if (row) api.open(Number(row.dataset.para));
  });

  // 键盘：↑↓ 移动，Home / End 到首尾，Enter / 空格跳转
  root.addEventListener("keydown", (e) => {
    const rows = Array.from(body.querySelectorAll<HTMLElement>(".toc-item"));
    const at = rows.indexOf(document.activeElement as HTMLElement);
    const go = (i: number) => {
      e.preventDefault();
      rows[Math.max(0, Math.min(rows.length - 1, i))]?.focus();
    };
    if (e.key === "ArrowDown") go(at + 1);
    else if (e.key === "ArrowUp") go(at - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(rows.length - 1);
    else if ((e.key === "Enter" || e.key === " ") && at >= 0) {
      e.preventDefault();
      api.open(Number(rows[at].dataset.para));
    }
  });

  // 挂载到页面后再聚焦并滚动到当前章节（没有当前项则聚焦第一项），键盘可以直接操作
  requestAnimationFrame(() => {
    const target = body.querySelector<HTMLElement>(".toc-item.current") ?? body.querySelector<HTMLElement>(".toc-item");
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({ block: "center" });
  });
  return root;
}
