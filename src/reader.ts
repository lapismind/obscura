/** 每次渲染的段落数；翻到边缘时以当前位置为起点重新渲染 */
const CHUNK = 80;

/** 阅读器的最小单元：正文段落、占位提示，或一张图片（w / h 为原始像素尺寸） */
export type Block =
  | { kind: "text"; text: string }
  | { kind: "note"; text: string }
  | { kind: "image"; src: string; w: number; h: number };

export function textBlocks(text: string): Block[] {
  return text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s): Block => ({ kind: "text", text: s }));
}

/**
 * 按“行网格”翻页的阅读器：段落无外边距、行高为整数像素，
 * 所以每个段落高度都是行高的整数倍，scrollTop 始终对齐到整行。
 * 图片块同样取整行高度，保持网格对齐。
 */
export class Reader {
  paras: Block[] = [];
  private start = 0;
  private end = 0;
  private lh = 22;
  private lines = 3;
  onMove: (para: number, line: number) => void = () => {};

  constructor(
    private viewport: HTMLElement,
    private flow: HTMLElement,
  ) {}

  load(blocks: Block[], para: number, line: number) {
    this.paras = blocks;
    this.jump(para, line);
  }

  /** 按可用高度取整行；调用方随后需 jump 到保存的位置 */
  layout(lineHeight: number, avail: number) {
    this.lh = lineHeight;
    this.flow.style.lineHeight = `${lineHeight}px`;
    this.lines = Math.max(1, Math.floor(avail / lineHeight));
    this.viewport.style.height = `${this.lines * lineHeight}px`;
    this.flow.style.paddingBottom = `${this.pageH}px`;
  }

  get pageH() {
    return this.lines * this.lh;
  }

  get progress() {
    if (!this.paras.length) return 0;
    return this.position().para / Math.max(1, this.paras.length - 1);
  }

  private render(start: number) {
    this.start = Math.max(0, Math.min(start, this.paras.length - 1));
    this.end = Math.min(this.paras.length, this.start + CHUNK);
    const frag = document.createDocumentFragment();
    for (let i = this.start; i < this.end; i++) frag.appendChild(this.blockEl(this.paras[i], i));
    this.flow.replaceChildren(frag);
  }

  private blockEl(b: Block, i: number) {
    let el: HTMLElement;
    if (b.kind === "image") {
      // 图片不超过阅读区宽度，高度取整行；依赖阅读区宽度，所以在渲染时计算
      const scale = Math.min(1, this.flow.clientWidth / b.w);
      el = document.createElement("div");
      el.className = "pic";
      el.style.height = `${Math.max(1, Math.ceil((b.h * scale) / this.lh)) * this.lh}px`;
      const img = document.createElement("img");
      img.src = b.src;
      img.draggable = false;
      img.style.width = `${b.w * scale}px`;
      img.style.height = `${b.h * scale}px`;
      el.appendChild(img);
    } else {
      el = document.createElement("p");
      el.textContent = b.text;
      if (b.kind === "note") el.className = "note";
    }
    el.dataset.i = String(i);
    return el;
  }

  private contentH() {
    const last = this.flow.lastElementChild as HTMLElement | null;
    return last ? last.offsetTop + last.offsetHeight : 0;
  }

  private elOf(para: number) {
    return this.flow.querySelector<HTMLElement>(`[data-i="${para}"]`);
  }

  position(): { para: number; line: number } {
    const top = this.viewport.scrollTop;
    for (const el of this.flow.children as HTMLCollectionOf<HTMLElement>) {
      if (el.offsetTop + el.offsetHeight > top) {
        return { para: Number(el.dataset.i), line: Math.round((top - el.offsetTop) / this.lh) };
      }
    }
    return { para: this.start, line: 0 };
  }

  jump(para: number, line: number) {
    if (!this.paras.length) {
      this.flow.replaceChildren();
      return;
    }
    this.render(para);
    const el = this.elOf(this.start);
    const maxLine = el ? el.offsetHeight / this.lh - 1 : 0;
    this.viewport.scrollTop = Math.max(0, Math.min(line, maxLine)) * this.lh;
    // 未挂载时没有布局，position() 读不到真实位置，会把行偏移记成 0；挂载后的 relayout 会再 jump 并记录
    if (this.viewport.isConnected) this.emit();
  }

  /** 跳到全文 ratio（0–1）处所在段落的开头 */
  seek(ratio: number) {
    const last = Math.max(0, this.paras.length - 1);
    this.jump(Math.round(Math.min(1, Math.max(0, ratio)) * last), 0);
  }

  next() {
    if (!this.paras.length) return;
    let target = this.viewport.scrollTop + this.pageH;
    if (target + this.pageH > this.contentH() && this.end < this.paras.length) {
      const pos = this.position();
      this.render(pos.para);
      target = (this.elOf(pos.para)?.offsetTop ?? 0) + pos.line * this.lh + this.pageH;
    }
    if (target >= this.contentH()) return;
    this.viewport.scrollTop = target;
    this.emit();
  }

  prev() {
    if (!this.paras.length) return;
    let target = this.viewport.scrollTop - this.pageH;
    if (target < 0 && this.start > 0) {
      const pos = this.position();
      this.render(pos.para - CHUNK / 2);
      target = (this.elOf(pos.para)?.offsetTop ?? 0) + pos.line * this.lh - this.pageH;
    }
    this.viewport.scrollTop = Math.max(0, target);
    this.emit();
  }

  private emit() {
    const { para, line } = this.position();
    this.onMove(para, line);
  }
}
