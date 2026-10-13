import "./disguise.css";
import type { DisguiseTarget } from "./state";

const CODE = `import { readFile } from "node:fs/promises";
import type { Config, Entry } from "./types";

// Parse a key=value config file, ignoring comments and blank lines
export async function loadConfig(path: string): Promise<Config> {
  const raw = await readFile(path, "utf8");
  const entries: Entry[] = [];
  for (const line of raw.split("\\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx < 0) throw new Error(\`Invalid line: \${trimmed}\`);
    entries.push({
      key: trimmed.slice(0, idx).trim(),
      value: trimmed.slice(idx + 1).trim(),
    });
  }
  return normalize(entries);
}

function normalize(entries: Entry[]): Config {
  const config: Config = { retries: 3, timeout: 5000, tags: [] };
  for (const { key, value } of entries) {
    switch (key) {
      case "retries":
        config.retries = Number.parseInt(value, 10);
        break;
      case "timeout":
        config.timeout = Number.parseInt(value, 10);
        break;
      case "tags":
        config.tags = value.split(",").map((t) => t.trim());
        break;
      default:
        console.warn(\`Unknown key: \${key}\`);
    }
  }
  return config;
}

export function mergeConfig(base: Config, override: Partial<Config>): Config {
  return { ...base, ...override, tags: [...base.tags, ...(override.tags ?? [])] };
}
`;

const KEYWORDS = new Set(
  "import export from async function const let for of if continue throw new return switch case break default type await".split(" "),
);

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
}

/** 粗略的 TS 语法着色，只为看起来像代码 */
function highlight(line: string) {
  const re = /(\/\/.*$)|("(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`)|\b(\d+)\b|\b([A-Za-z_]\w*)(?=\s*\()|\b([A-Z]\w*)\b|\b([a-z]\w*)\b/g;
  let out = "";
  let last = 0;
  for (const m of line.matchAll(re)) {
    out += esc(line.slice(last, m.index));
    const [t, com, str, num, fn, typ, word] = m;
    if (com) out += `<span class="c">${esc(t)}</span>`;
    else if (str) out += `<span class="s">${esc(t)}</span>`;
    else if (num) out += `<span class="n">${t}</span>`;
    else if (word && KEYWORDS.has(word)) out += `<span class="k">${t}</span>`;
    else if (fn) out += `<span class="f">${t}</span>`;
    else if (typ) out += `<span class="t">${t}</span>`;
    else out += `<span class="v">${t}</span>`;
    last = m.index! + t.length;
  }
  return out + esc(line.slice(last));
}

const winButtons = `<div class="wb"><span>&#xE921;</span><span>&#xE922;</span><span>&#xE8BB;</span></div>`;

function vscode() {
  const lines = CODE.split("\n");
  const rows = lines
    .map((l, i) => `<div class="ln"><i>${i + 1}</i><code>${highlight(l) || " "}</code></div>`)
    .join("");
  return `
  <div class="vsc">
    <div class="vsc-title"><span class="menu">文件 编辑 选择 查看 转到 运行 终端 帮助</span><span class="cmd">workspace</span>${winButtons}</div>
    <div class="vsc-main">
      <div class="vsc-act"><b></b><b></b><b></b><b></b></div>
      <div class="vsc-side">
        <div class="hd">资源管理器</div>
        <div class="tree">
          <div>▾ WORKSPACE</div><div class="d1">▸ .vscode</div><div class="d1">▸ node_modules</div>
          <div class="d1">▾ src</div><div class="d2">index.ts</div><div class="d2">types.ts</div>
          <div class="d2 on">utils.ts</div><div class="d2">server.ts</div><div class="d1">package.json</div>
          <div class="d1">tsconfig.json</div><div class="d1">README.md</div>
        </div>
      </div>
      <div class="vsc-ed">
        <div class="tabs"><span class="on">utils.ts</span><span>types.ts</span><span>index.ts</span></div>
        <div class="crumb">src › utils.ts › loadConfig</div>
        <div class="code">${rows}</div>
      </div>
    </div>
    <div class="vsc-status"><span>⎇ main</span><span>⊗ 0 ⚠ 0</span><span class="r">行 12，列 31　空格: 2　UTF-8　LF　TypeScript</span></div>
  </div>`;
}

function notepad() {
  const text = `周例会纪要

时间：周二 14:00–15:00
地点：3F 小会议室

一、上周进展
1. 数据导出接口已完成联调，待测试环境回归。
2. 报表页面加载慢的问题定位到分页查询，已加索引，耗时从 3.2s 降到 0.4s。
3. 权限模块需求评审通过，排期下周开始开发。

二、本周计划
1. 完成导出接口回归测试，周四前上线。
2. 整理权限模块的接口文档，同步给前端。
3. 跟进客户反馈的时区显示问题。

三、风险与待办
- 测试环境资源紧张，需协调第二套环境。
- 权限模块依赖账号中心的新接口，需确认对方排期。

下次例会：周二 14:00`;
  return `
  <div class="np">
    <div class="np-title"><span class="tab">会议纪要.txt</span><span class="plus">+</span>${winButtons}</div>
    <div class="np-menu"><span>文件</span><span>编辑</span><span>查看</span></div>
    <textarea class="np-text" readonly spellcheck="false">${esc(text)}</textarea>
    <div class="np-status"><span>行 1，列 1</span><span>${text.length} 个字符</span><span class="r">100%　Windows (CRLF)　UTF-8</span></div>
  </div>`;
}

function explorer() {
  const files: [string, string, string, string][] = [
    ["项目资料", "2026/10/09 16:42", "文件夹", ""],
    ["归档", "2026/09/28 10:15", "文件夹", ""],
    ["2026Q4 工作计划.docx", "2026/10/12 18:03", "Microsoft Word 文档", "38 KB"],
    ["需求评审记录.xlsx", "2026/10/11 11:27", "Microsoft Excel 工作表", "52 KB"],
    ["接口文档 v2.3.pdf", "2026/10/10 09:58", "PDF 文件", "1,204 KB"],
    ["周报-第41周.docx", "2026/10/10 17:40", "Microsoft Word 文档", "24 KB"],
    ["系统架构图.png", "2026/10/08 14:12", "PNG 文件", "386 KB"],
    ["会议纪要.txt", "2026/10/07 15:05", "文本文档", "2 KB"],
    ["数据字典.xlsx", "2026/09/30 10:21", "Microsoft Excel 工作表", "117 KB"],
  ];
  const rows = files
    .map(
      ([n, d, t, s]) =>
        `<div class="row"><span class="nm"><i class="${t === "文件夹" ? "fd" : "fl"}"></i>${n}</span><span>${d}</span><span>${t}</span><span class="sz">${s}</span></div>`,
    )
    .join("");
  return `
  <div class="ex">
    <div class="ex-title"><span class="tab">文档</span><span class="plus">+</span>${winButtons}</div>
    <div class="ex-nav"><span>←</span><span>→</span><span>↑</span><span>⟳</span><div class="addr">此电脑 › 文档</div><div class="search">搜索 文档</div></div>
    <div class="ex-tool"><span>新建 ▾</span><span>剪切</span><span>复制</span><span>粘贴</span><span>重命名</span><span>共享</span><span>删除</span><span>排序 ▾</span><span>查看 ▾</span></div>
    <div class="ex-main">
      <div class="ex-side"><div>主文件夹</div><div>图库</div><hr><div>桌面</div><div>下载</div><div class="on">文档</div><div>图片</div><hr><div>此电脑</div><div>网络</div></div>
      <div class="ex-list"><div class="row hd"><span>名称</span><span>修改日期</span><span>类型</span><span class="sz">大小</span></div>${rows}</div>
    </div>
    <div class="ex-status">${files.length} 个项目</div>
  </div>`;
}

export function disguiseHtml(target: DisguiseTarget) {
  return target === "vscode" ? vscode() : target === "notepad" ? notepad() : explorer();
}
