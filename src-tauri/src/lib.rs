mod disguise;

use base64::Engine;
use std::collections::HashMap;
use std::fs;
use std::io::Read;
use tauri::{AppHandle, Manager};

/// 读取文本文件，自动识别 UTF-8 / UTF-16 / GB18030 编码
#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    let bytes = fs::read(&path).map_err(|e| format!("读取失败：{e}"))?;
    Ok(decode_text(&bytes))
}

fn decode_text(bytes: &[u8]) -> String {
    if let Some((enc, bom_len)) = encoding_rs::Encoding::for_bom(bytes) {
        return enc.decode_without_bom_handling(&bytes[bom_len..]).0.into_owned();
    }
    match std::str::from_utf8(bytes) {
        Ok(s) => s.to_owned(),
        // 国内 txt 小说多为 GBK，GB18030 是其超集
        Err(_) => encoding_rs::GB18030.decode_without_bom_handling(bytes).0.into_owned(),
    }
}

fn open_epub(path: &str) -> Result<zip::ZipArchive<fs::File>, String> {
    let file = fs::File::open(path).map_err(|e| format!("读取失败：{e}"))?;
    zip::ZipArchive::new(file).map_err(|e| format!("不是有效的 epub：{e}"))
}

fn is_text_entry(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    [".xhtml", ".html", ".htm", ".xml", ".opf", ".ncx"].iter().any(|ext| lower.ends_with(ext))
}

fn image_mime(name: &str) -> Option<&'static str> {
    let ext = name.rsplit_once('.')?.1.to_ascii_lowercase();
    Some(match ext.as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        _ => return None,
    })
}

/// 读取 epub 包内的 XML / XHTML 文本（容器、OPF、章节），结构解析交给前端
#[tauri::command]
fn read_epub_texts(path: String) -> Result<HashMap<String, String>, String> {
    let mut zip = open_epub(&path)?;
    let mut texts = HashMap::new();
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).map_err(|e| e.to_string())?;
        let name = entry.name().map_err(|e| e.to_string())?.into_owned();
        if !is_text_entry(&name) {
            continue;
        }
        let mut bytes = Vec::new();
        entry.read_to_end(&mut bytes).map_err(|e| e.to_string())?;
        texts.insert(name, decode_text(&bytes));
    }
    Ok(texts)
}

/// 按需读取 epub 内的图片并转为 data URL；不存在或不是图片的条目跳过
#[tauri::command]
fn read_epub_images(path: String, names: Vec<String>) -> Result<HashMap<String, String>, String> {
    let mut zip = open_epub(&path)?;
    let mut images = HashMap::new();
    for name in names {
        let Some(mime) = image_mime(&name) else { continue };
        let Ok(mut entry) = zip.by_name(&name) else { continue };
        let mut bytes = Vec::new();
        entry.read_to_end(&mut bytes).map_err(|e| e.to_string())?;
        let b64 = base64::engine::general_purpose::STANDARD.encode(bytes);
        images.insert(name, format!("data:{mime};base64,{b64}"));
    }
    Ok(images)
}

fn state_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("state.json"))
}

/// 读取持久化状态（设置 + 书架），不存在时返回 null
#[tauri::command]
fn load_state(app: AppHandle) -> Result<Option<String>, String> {
    let path = state_path(&app)?;
    if !path.exists() {
        return Ok(None);
    }
    fs::read_to_string(path).map(Some).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_state(app: AppHandle, json: String) -> Result<(), String> {
    let path = state_path(&app)?;
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, json).map_err(|e| e.to_string())?;
    fs::rename(tmp, path).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            read_text_file,
            read_epub_texts,
            read_epub_images,
            load_state,
            save_state,
            disguise::set_window_icon,
            disguise::set_alt_tab_hidden,
            disguise::set_stashed,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
