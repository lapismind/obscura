import { state, type Book } from "./state";

export interface ShelfApi {
  open(id: string): void;
  add(): Promise<void>;
  back(): void;
  changed(): void;
}

/** null 表示“全部”，空串表示“未分组” */
let filter: string | null = null;
let editing: { id: string; field: "name" | "group" } | null = null;
let confirming: string | null = null;

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
}

function ago(ts: number) {
  if (!ts) return "未读";
  const min = Math.floor((Date.now() - ts) / 60000);
  if (min < 1) return "刚刚";
  if (min < 60) return `${min} 分钟前`;
  if (min < 1440) return `${Math.floor(min / 60)} 小时前`;
  return `${Math.floor(min / 1440)} 天前`;
}

function percent(b: Book) {
  return b.total > 1 ? ((b.para / (b.total - 1)) * 100).toFixed(1) + "%" : "0%";
}

function row(b: Book) {
  const isEdit = editing?.id === b.id;
  const nameHtml =
    isEdit && editing!.field === "name"
      ? `<input type="text" data-edit="name" value="${esc(b.name)}">`
      : `<div class="name">${esc(b.name)}</div>`;
  const metaHtml =
    isEdit && editing!.field === "group"
      ? `<input type="text" data-edit="group" list="groups" value="${esc(b.group)}" placeholder="分组名，留空为未分组">`
      : `<div class="meta">${b.group ? esc(b.group) + " · " : ""}${percent(b)} · ${ago(b.lastRead)}</div>`;
  const acts =
    confirming === b.id
      ? `<button class="link danger" data-a="remove-yes">确认移除</button><button class="link" data-a="remove-no">取消</button>`
      : `<button class="link" data-a="rename">重命名</button><button class="link" data-a="group">分组</button><button class="link danger" data-a="remove">移除</button>`;
  const cls = ["book", b.id === state.currentId ? "current" : "", isEdit || confirming === b.id ? "editing" : ""].join(" ");
  return `<div class="${cls}" data-id="${b.id}"><div class="info" data-a="open" title="${esc(b.path)}">${nameHtml}${metaHtml}</div><div class="acts">${acts}</div></div>`;
}

export function renderShelf(api: ShelfApi) {
  const root = document.createElement("div");
  root.className = "panel";
  root.innerHTML = `<div class="panel-head"><h1>Files</h1><button data-a="add">添加文件</button><button class="link" data-a="back" title="Esc">返回</button></div><div class="panel-body"></div>`;
  const body = root.querySelector<HTMLElement>(".panel-body")!;

  const draw = () => {
    const groups = [...new Set(state.books.map((b) => b.group).filter(Boolean))].sort();
    const hasUngrouped = state.books.some((b) => !b.group);
    if (filter && !groups.includes(filter)) filter = null;
    const books = state.books
      .filter((b) => filter === null || b.group === filter)
      .sort((a, b) => b.lastRead - a.lastRead);

    const chip = (v: string | null, label: string) =>
      `<button class="${filter === v ? "on" : ""}" data-a="filter" data-v="${v === null ? "__all__" : esc(v)}">${esc(label)}</button>`;
    const chips = groups.length
      ? `<div class="chips">${chip(null, "全部")}${groups.map((g) => chip(g, g)).join("")}${hasUngrouped ? chip("", "未分组") : ""}</div>`
      : "";

    body.innerHTML = state.books.length
      ? `${chips}${books.map(row).join("")}<datalist id="groups">${groups.map((g) => `<option value="${esc(g)}">`).join("")}</datalist>`
      : `<div class="hint">还没有文件<br>点击“添加文件”导入 txt 或 epub</div>`;

    const input = body.querySelector<HTMLInputElement>("input[data-edit]");
    if (input) {
      input.focus();
      input.select();
    }
  };

  const commit = (input: HTMLInputElement) => {
    if (!editing) return;
    const b = state.books.find((x) => x.id === editing!.id);
    const v = input.value.trim();
    if (b) {
      if (editing.field === "name" && v) b.name = v;
      if (editing.field === "group") b.group = v;
      api.changed();
    }
    editing = null;
    draw();
  };

  root.addEventListener("click", async (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>("[data-a]");
    if (!t || (e.target as HTMLElement).tagName === "INPUT") return;
    const id = t.closest<HTMLElement>("[data-id]")?.dataset.id ?? "";
    switch (t.dataset.a) {
      case "add":
        await api.add();
        break;
      case "back":
        api.back();
        return;
      case "filter":
        filter = t.dataset.v === "__all__" ? null : t.dataset.v!;
        break;
      case "open":
        if (!editing) api.open(id);
        return;
      case "rename":
      case "group":
        editing = { id, field: t.dataset.a === "rename" ? "name" : "group" };
        confirming = null;
        break;
      case "remove":
        confirming = id;
        editing = null;
        break;
      case "remove-yes":
        state.books = state.books.filter((b) => b.id !== id);
        if (state.currentId === id) state.currentId = null;
        confirming = null;
        api.changed();
        break;
      case "remove-no":
        confirming = null;
        break;
    }
    draw();
  });

  root.addEventListener("keydown", (e) => {
    const input = e.target as HTMLInputElement;
    if (!input.dataset?.edit) return;
    e.stopPropagation();
    if (e.key === "Enter") commit(input);
    if (e.key === "Escape") {
      editing = null;
      draw();
    }
  });
  root.addEventListener("focusout", (e) => {
    const input = e.target as HTMLInputElement;
    if (input.dataset?.edit) commit(input);
  });

  editing = null;
  confirming = null;
  draw();
  return root;
}
