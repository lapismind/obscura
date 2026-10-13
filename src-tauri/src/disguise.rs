//! 窗口伪装：任务栏图标替换、Alt+Tab 隐藏。
//! 图标在运行时从本机已安装程序中提取，不随应用分发第三方图标。

use tauri::{Manager, WebviewWindow};

/// target: "default" | "vscode" | "notepad" | "explorer"
#[tauri::command]
pub fn set_window_icon(window: WebviewWindow, target: String) -> Result<(), String> {
    if target == "default" {
        if let Some(icon) = window.app_handle().default_window_icon() {
            window.set_icon(icon.clone()).map_err(|e| e.to_string())?;
        }
        return Ok(());
    }
    #[cfg(windows)]
    {
        win::apply_icon(&window, &target)
    }
    #[cfg(not(windows))]
    {
        Ok(())
    }
}

/// 通过 WS_EX_TOOLWINDOW 让窗口不出现在 Alt+Tab（同时也不会出现在任务栏）
#[tauri::command]
pub fn set_alt_tab_hidden(window: WebviewWindow, hidden: bool) -> Result<(), String> {
    #[cfg(windows)]
    {
        win::set_tool_window(&window, hidden)
    }
    #[cfg(not(windows))]
    {
        let _ = (window, hidden);
        Ok(())
    }
}

/// on = true：无动画地收进任务栏（最小化），且从任务栏点开时直接最大化（显示伪装界面）；
/// on = false：恢复为普通窗口，不抢焦点；topmost 决定恢复后是否置顶
#[tauri::command]
pub fn set_stashed(window: WebviewWindow, on: bool, topmost: bool) -> Result<(), String> {
    #[cfg(windows)]
    {
        win::set_stashed(&window, on, topmost)
    }
    #[cfg(not(windows))]
    {
        let _ = topmost;
        if on { window.minimize() } else { window.unminimize() }.map_err(|e| e.to_string())
    }
}

#[cfg(windows)]
mod win {
    use std::path::PathBuf;
    use tauri::WebviewWindow;
    use windows::Win32::Foundation::{HWND, LPARAM, WPARAM};
    use windows::Win32::UI::Shell::ExtractIconExW;
    use windows::Win32::UI::WindowsAndMessaging::{
        GWL_EXSTYLE, GetWindowLongPtrW, GetWindowPlacement, HICON, HWND_TOP, HWND_TOPMOST, ICON_BIG,
        ICON_SMALL, SW_HIDE, SW_SHOWMINNOACTIVE, SW_SHOWNOACTIVATE, SWP_NOACTIVATE, SWP_NOMOVE,
        SWP_NOSIZE, SendMessageW, SetWindowLongPtrW, SetWindowPlacement, SetWindowPos, ShowWindow, WINDOWPLACEMENT, WINDOWPLACEMENT_FLAGS, WM_SETICON, WPF_RESTORETOMAXIMIZED,
        WS_EX_APPWINDOW, WS_EX_TOOLWINDOW,
    };
    use windows::core::HSTRING;

    fn hwnd(window: &WebviewWindow) -> Result<HWND, String> {
        Ok(HWND(window.hwnd().map_err(|e| e.to_string())?.0))
    }

    fn env_path(var: &str, rest: &str) -> Option<PathBuf> {
        std::env::var_os(var).map(|v| PathBuf::from(v).join(rest))
    }

    fn icon_source(target: &str) -> Result<(PathBuf, i32), String> {
        let candidates: Vec<PathBuf> = match target {
            "vscode" => [
                env_path("LOCALAPPDATA", r"Programs\Microsoft VS Code\Code.exe"),
                env_path("ProgramFiles", r"Microsoft VS Code\Code.exe"),
            ]
            .into_iter()
            .flatten()
            .collect(),
            "notepad" => env_path("SystemRoot", r"System32\notepad.exe").into_iter().collect(),
            "explorer" => env_path("SystemRoot", "explorer.exe").into_iter().collect(),
            _ => return Err(format!("未知的伪装目标：{target}")),
        };
        candidates
            .into_iter()
            .find(|p| p.exists())
            .map(|p| (p, 0))
            .ok_or_else(|| format!("本机未找到 {target} 的图标来源"))
    }

    pub fn apply_icon(window: &WebviewWindow, target: &str) -> Result<(), String> {
        let (path, index) = icon_source(target)?;
        let mut large = HICON::default();
        let mut small = HICON::default();
        let count = unsafe {
            ExtractIconExW(
                &HSTRING::from(path.as_os_str()),
                index,
                Some(&mut large),
                Some(&mut small),
                1,
            )
        };
        if count == 0 || large.is_invalid() {
            return Err(format!("提取图标失败：{}", path.display()));
        }
        let small = if small.is_invalid() { large } else { small };
        let h = hwnd(window)?;
        // 图标句柄随窗口一直使用，刻意不释放
        unsafe {
            SendMessageW(h, WM_SETICON, Some(WPARAM(ICON_BIG as usize)), Some(LPARAM(large.0 as isize)));
            SendMessageW(h, WM_SETICON, Some(WPARAM(ICON_SMALL as usize)), Some(LPARAM(small.0 as isize)));
        }
        Ok(())
    }

    pub fn set_stashed(window: &WebviewWindow, on: bool, topmost: bool) -> Result<(), String> {
        let h = hwnd(window)?;
        let mut wp = WINDOWPLACEMENT { length: size_of::<WINDOWPLACEMENT>() as u32, ..Default::default() };
        unsafe { GetWindowPlacement(h, &mut wp) }.map_err(|e| e.to_string())?;
        if on {
            // 先隐藏再以“最小化”状态放回，跳过最小化动画
            unsafe {
                let _ = ShowWindow(h, SW_HIDE);
            }
            wp.flags = WPF_RESTORETOMAXIMIZED;
            wp.showCmd = SW_SHOWMINNOACTIVE.0 as u32;
        } else {
            wp.flags = WINDOWPLACEMENT_FLAGS(0);
            wp.showCmd = SW_SHOWNOACTIVATE.0 as u32;
        }
        unsafe { SetWindowPlacement(h, &wp) }.map_err(|e| e.to_string())?;
        if !on {
            // Tauri 的 setAlwaysOnTop 是异步的，会和上面的恢复竞争，这里同步补设一次
            let after = if topmost { HWND_TOPMOST } else { HWND_TOP };
            unsafe { SetWindowPos(h, Some(after), 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE) }
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    pub fn set_tool_window(window: &WebviewWindow, hidden: bool) -> Result<(), String> {
        let h = hwnd(window)?;
        let tool = WS_EX_TOOLWINDOW.0 as isize;
        let app = WS_EX_APPWINDOW.0 as isize;
        let visible = window.is_visible().unwrap_or(false);
        // 扩展样式要在窗口隐藏时修改，任务栏 / Alt+Tab 才会刷新
        if visible {
            window.hide().map_err(|e| e.to_string())?;
        }
        unsafe {
            let ex = GetWindowLongPtrW(h, GWL_EXSTYLE);
            let next = if hidden { (ex | tool) & !app } else { ex & !tool };
            SetWindowLongPtrW(h, GWL_EXSTYLE, next);
        }
        if visible {
            window.show().map_err(|e| e.to_string())?;
        }
        Ok(())
    }
}
