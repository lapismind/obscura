import { invoke } from "@tauri-apps/api/core";
import type { Block } from "./reader";

type Picture = Extract<Block, { kind: "image" }>;
/** 收集阶段的中间结果：图片还没决定是否加载，先记下包内路径 */
type Pending = Block | { kind: "pic"; path: string };

/** 目录项：para 为目标在阅读块中的序号 */
export interface TocItem {
  title: string;
  depth: number;
  para: number;
}

export interface BookContent {
  blocks: Block[];
  toc: TocItem[];
}

/** 目录文件里读到的原始项：href 相对于该目录文件本身 */
interface RawToc {
  title: string;
  depth: number;
  href: string;
}

/** 这些元素自成一段，前后断开 */
const BLOCK_TAGS = new Set([
  "p", "div", "h1", "h2", "h3", "h4", "h5", "h6", "li", "dt", "dd", "tr", "blockquote", "pre",
  "section", "article", "header", "footer", "figure", "figcaption", "ul", "ol", "dl", "table",
]);
const SKIP_TAGS = new Set(["script", "style"]);

export const isEpub = (path: string) => /\.epub$/i.test(path);

/**
 * 解析 epub：按 spine 顺序把各章 XHTML 转成阅读块，并解析目录。
 * 每个 <img> / <image> 恰好对应一个块，不论是否加载图片，
 * 所以开关图片前后段落序号不变，阅读位置和目录都保持有效。
 */
export async function readEpub(path: string, loadImages: boolean): Promise<BookContent> {
  const texts = await invoke<Record<string, string>>("read_epub_texts", { path });
  const parser = new DOMParser();
  const parseXml = (src: string) => parser.parseFromString(src, "application/xml");

  const container = texts["META-INF/container.xml"];
  const opfPath = container && parseXml(container).getElementsByTagName("rootfile")[0]?.getAttribute("full-path");
  if (!opfPath || texts[opfPath] === undefined) throw new Error("不是有效的 epub：找不到 OPF 文件");
  const opf = parseXml(texts[opfPath]);

  // manifest 给出 id → 包内路径（以及 nav 标记、媒体类型），spine 给出阅读顺序
  const items = Array.from(opf.getElementsByTagName("item")).map((item) => ({
    id: item.getAttribute("id") ?? "",
    path: resolvePath(opfPath, item.getAttribute("href") ?? ""),
    props: item.getAttribute("properties") ?? "",
    type: item.getAttribute("media-type") ?? "",
  }));
  const manifest = new Map(items.map((i) => [i.id, i.path]));
  const chapters = Array.from(opf.getElementsByTagName("itemref"))
    .map((ref) => manifest.get(ref.getAttribute("idref") ?? ""))
    .filter((p): p is string => p !== undefined && texts[p] !== undefined);
  if (!chapters.length) throw new Error("epub 中没有可读的章节");

  // 各章依次收集：记下章节起点，以及带 id 的元素对应的块序号（目录锚点用）
  const starts = new Map<string, number>();
  const anchors = new Map<string, number>();
  const headings: TocItem[] = []; // 没有目录文件时的兜底：每章第一个标题
  const pending: Pending[] = [];
  for (const chapter of chapters) {
    const start = pending.length;
    starts.set(chapter, start);
    const body = parser.parseFromString(texts[chapter], "text/html").body;
    const { out, ids } = collect(body, chapter);
    for (const [id, i] of ids) anchors.set(`${chapter}#${id}`, start + i);
    pending.push(...out);

    const h = body.querySelector("h1, h2, h3");
    const title = clean(h?.textContent);
    const anchor = h?.id ? anchors.get(`${chapter}#${h.id}`) : undefined;
    if (h && title) headings.push({ title, depth: 0, para: anchor ?? start });
  }

  /** 目录 href（相对于 base 文件）→ 块序号：有锚点且找到则用锚点，否则用所在章节的开头 */
  const locate = (base: string, href: string) => {
    const [file, frag = ""] = href.split("#");
    const path = file ? resolvePath(base, file) : base;
    const id = safeDecode(frag);
    const anchored = id ? anchors.get(`${path}#${id}`) : undefined;
    return anchored ?? starts.get(path);
  };
  const toItems = (raw: RawToc[], base: string): TocItem[] =>
    raw.flatMap(({ title, depth, href }) => {
      const para = locate(base, href);
      return para === undefined ? [] : [{ title, depth, para }];
    });

  // 目录优先级：EPUB3 nav → EPUB2 toc.ncx → 每章第一个标题
  const navItem = items.find((i) => i.props.split(/\s+/).includes("nav"));
  const spineToc = opf.getElementsByTagName("spine")[0]?.getAttribute("toc") ?? "";
  const ncxItem = (spineToc && items.find((i) => i.id === spineToc)) || items.find((i) => i.type === "application/x-dtbncx+xml");
  let toc = navItem ? toItems(parseNav(texts[navItem.path] ?? "", parser), navItem.path) : [];
  if (!toc.length && ncxItem) toc = toItems(parseNcx(texts[ncxItem.path] ?? ""), ncxItem.path);
  if (!toc.length) toc = headings;

  const pictures = new Map<string, Picture>();
  if (loadImages) {
    const names = [...new Set(pending.flatMap((p) => (p.kind === "pic" ? [p.path] : [])))];
    const srcs = await invoke<Record<string, string>>("read_epub_images", { path, names });
    await Promise.all(
      names
        .filter((n) => srcs[n])
        .map(async (n) => {
          const pic = await measure(srcs[n]);
          if (pic) pictures.set(n, pic);
        }),
    );
  }

  const blocks = pending.map((p): Block => {
    if (p.kind !== "pic") return p;
    return pictures.get(p.path) ?? { kind: "note", text: "[图片]" };
  });
  return { blocks, toc };
}

/**
 * 把一章的 DOM 按段落收集；文本折叠空白，<br> 与块级元素分段。
 * ids：带 id（或旧式 <a name>）的元素 → 它开始处的块序号
 */
function collect(root: Node, chapter: string) {
  const out: Pending[] = [];
  const ids = new Map<string, number>();
  let text = "";
  const flush = () => {
    const t = clean(text);
    text = "";
    if (t) out.push({ kind: "text", text: t });
  };
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent ?? "";
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as Element;
    const tag = el.localName;
    if (SKIP_TAGS.has(tag)) return;
    if (tag === "img" || tag === "image") {
      flush();
      const href = el.getAttribute("src") ?? el.getAttribute("href") ?? el.getAttribute("xlink:href") ?? "";
      out.push({ kind: "pic", path: resolvePath(chapter, href) });
      return;
    }
    if (tag === "br") {
      flush();
      return;
    }
    const block = BLOCK_TAGS.has(tag);
    if (block) flush();
    const id = el.getAttribute("id") ?? (tag === "a" ? el.getAttribute("name") : null);
    if (id && !ids.has(id)) ids.set(id, out.length);
    el.childNodes.forEach(walk);
    if (block) flush();
  };
  walk(root);
  flush();
  return { out, ids };
}

/** EPUB3：导航文档中 epub:type="toc" 的目录（没有该标记时取第一个 nav） */
function parseNav(src: string, parser: DOMParser): RawToc[] {
  const doc = parser.parseFromString(src, "text/html");
  const navs = Array.from(doc.getElementsByTagName("nav"));
  const nav = navs.find((n) => (n.getAttribute("epub:type") ?? "").split(/\s+/).includes("toc")) ?? navs[0];
  const out: RawToc[] = [];
  const walk = (list: Element, depth: number) => {
    for (const li of Array.from(list.children)) {
      if (li.localName !== "li") continue;
      // 有链接的项才可跳转；没有链接的分组只起缩进作用，子项照常收集
      const label = Array.from(li.children).find((c) => c.localName === "a" || c.localName === "span");
      const title = clean(label?.textContent);
      const href = label?.localName === "a" ? label.getAttribute("href") : null;
      if (title && href) out.push({ title, depth, href });
      for (const sub of Array.from(li.children)) {
        if (sub.localName === "ol") walk(sub, depth + 1);
      }
    }
  };
  const top = nav?.getElementsByTagName("ol")[0];
  if (top) walk(top, 0);
  return out;
}

/** EPUB2：toc.ncx 的 navMap 嵌套结构 */
function parseNcx(src: string): RawToc[] {
  const doc = new DOMParser().parseFromString(src, "application/xml");
  const children = (el: Element, name: string) => Array.from(el.children).filter((c) => c.localName === name);
  const out: RawToc[] = [];
  const walk = (parent: Element, depth: number) => {
    for (const point of children(parent, "navPoint")) {
      const title = clean(children(point, "navLabel")[0]?.getElementsByTagName("text")[0]?.textContent);
      const href = children(point, "content")[0]?.getAttribute("src") ?? "";
      if (title && href) out.push({ title, depth, href });
      walk(point, depth + 1);
    }
  };
  const navMap = doc.getElementsByTagName("navMap")[0];
  if (navMap) walk(navMap, 0);
  return out;
}

/** 解码图片取得原始尺寸，用于计算占用的行数；无法解码（或无固有尺寸）时返回 null */
function measure(src: string): Promise<Picture | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () =>
      resolve(img.naturalWidth && img.naturalHeight ? { kind: "image", src, w: img.naturalWidth, h: img.naturalHeight } : null);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/** 折叠空白并去掉首尾空白（标题、段落共用） */
function clean(s: string | null | undefined) {
  return (s ?? "").replace(/\s+/g, " ").trim();
}

/** 按 zip 内路径解析相对引用：OEBPS/text/a.xhtml 中的 ../img/b.jpg → OEBPS/img/b.jpg */
function resolvePath(base: string, href: string) {
  const out = base.split("/").slice(0, -1);
  for (const seg of safeDecode(href.split(/[?#]/)[0]).split("/")) {
    if (seg === "..") out.pop();
    else if (seg && seg !== ".") out.push(seg);
  }
  return out.join("/");
}

function safeDecode(s: string) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
