# Obscura

Windows 桌面端的隐蔽小说阅读器，基于 Tauri 2 + TypeScript 开发。

平时它是一条低调的小窗，可以置顶、调透明度、贴边。按老板键后，窗口会收进任务栏，或换成伪装界面（VS Code、记事本、文件资源管理器的样子）。

## 功能

- **阅读格式**：txt（自动识别 UTF-8 / UTF-16 / GB18030），epub。
- **epub**：按阅读顺序排版；图片可在设置中开关（默认关闭，关闭时以 `[图片]` 占位）；目录支持 EPUB3 导航文档和 EPUB2 `toc.ncx`，都没有时按章节标题生成。
- **翻页**：按行网格翻页，窗口高度决定每屏显示的行数。
- **进度跳转**：底部显示阅读百分比，点击后输入 0–100 即可跳到对应位置（按段落定位）。
- **书架**：添加、重命名、分组、移除，记住每本书的阅读进度。
- **老板键**（默认 ``Alt+` ``）：收进任务栏 / 立即显示伪装界面 / 完全隐藏，可在设置中选择。
- **窗口位置**：拖动后记住位置，下次启动和从设置返回时回到该位置。
- **主题**：日志灰、终端、文档白、跟随系统。

## 快捷键

| 按键 | 功能 |
|---|---|
| `Esc` | 同老板键：隐藏 / 恢复阅读 |
| `↓` `→` `空格` `PgDn` / `↑` `←` `PgUp` | 翻页 |
| `Ctrl+O` | 书架 |
| `Ctrl+T` | 目录（仅有目录的书） |
| `Ctrl+,` | 设置 |

目录面板内：`↑` `↓` 选择，`Home` / `End` 到首尾，`Enter` 或空格跳转。

## 安装

在 [Releases](../../releases) 下载 `Obscura_<版本>_x64-setup.exe` 并安装。

运行环境：Windows 10 / 11（x64），需要 WebView2 运行时（Windows 11 自带）。

应用的数据保存在 `%APPDATA%\com.lapismind.obscura\state.json`。

## 从源码构建

环境要求：

- Node.js（LTS）
- Rust（stable，`x86_64-pc-windows-msvc`），以及 Visual Studio 2022 Build Tools 的 C++ 工具链
- WebView2 运行时

```bash
npm install
npm run tauri dev
```

```bash
npm run tauri build
```

安装包输出到 `src-tauri/target/release/bundle/nsis/`。

类型检查：

```bash
npx tsc --noEmit
```

## 目录结构

| 路径 | 说明 |
|---|---|
| `src/` | 前端源码（TypeScript / CSS）：阅读器、书架、设置、目录、epub 解析等 |
| `src-tauri/` | Rust 后端（文件读取、epub 解压、状态持久化、任务栏伪装）与 Tauri 配置 |
| `docs/ui-design.md` | 界面设计稿与已定决策 |
| `_scratch/` | 测试素材：三本 epub 样例（有目录 / 只有 NCX / 无目录，带图片）和一份 GBK 编码的测试小说 |

## 已知限制

- 仅支持 Windows。
- epub 的 CSS、字体、粗体和斜体不保留；DRM 加密的 epub 无法读取。
- 没有目录文件的 epub，目录只列出每章的第一个标题。
- txt 没有目录。

## 许可证

[MIT](LICENSE)
