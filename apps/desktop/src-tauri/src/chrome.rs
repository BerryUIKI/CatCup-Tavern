// The custom title bar's Windows half.
//
// The SPA draws the bar and its window buttons (see
// `apps/web/src/components/TitleBar.tsx`). This module only removes the native
// frame and restores the corners a frameless window loses; everything else is
// the page's, because the page is the only thing that can have it.
//
// **Why not hit-test the frame.** The obvious implementation subclasses the
// window and answers `WM_NCCALCSIZE` / `WM_NCHITTEST` / `WM_NCLBUTTONDOWN`:
// `HTMAXBUTTON` over the page's maximise button is what raises Windows 11's
// Snap Layout flyout. That does not work here. WebView2 runs as a child window
// covering the whole client area and takes every mouse message itself, so the
// top-level window procedure never sees a hit test over the bar — measured, not
// assumed: a subclass installed on the top-level window logged no hit tests at
// all while the pointer moved over the bar, and the only `WM_NCLBUTTONDOWN` it
// ever received was `HTTOP` from a resize gutter. Dragging is therefore the
// page's job, through the Tauri window API, which is also how Tauri itself does
// frameless windows. Snap Layouts are not reachable this way and are listed as
// a known limitation in `docs/DESKTOP.md`.

/// Height of the strip the SPA draws the bar into, in logical pixels.
pub const TITLE_BAR_HEIGHT: f64 = 32.0;

/// Width of one window button, in logical pixels.
pub const BUTTON_WIDTH: f64 = 46.0;

/// The window buttons, left to right. The page draws them in this order.
pub const BUTTON_ORDER: &str = "minimize,maximize,close";

/// Make the window frameless and round its corners.
///
/// Returns `false` on a platform that keeps its native decoration, which the
/// caller does not need to branch on: the SPA is told through
/// `CATCUP_TITLE_BAR_HEIGHT` whether there is a bar to draw.
#[cfg(windows)]
pub fn install(window: &tauri::WebviewWindow) -> tauri::Result<bool> {
    use windows_sys::Win32::Graphics::Dwm::{
        DwmSetWindowAttribute, DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_ROUND,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetWindowLongPtrW, SetWindowLongPtrW, GWL_STYLE, WS_THICKFRAME,
    };

    window.set_decorations(false)?;

    let hwnd = window.hwnd()?.0 as isize;
    unsafe {
        // Removing the decoration drops `WS_THICKFRAME` with it, and that style
        // is what gives the window its resize gutters and Aero Snap. It is put
        // back without `WS_CAPTION`, so the frame is still not drawn: the page
        // owns everything inside the window.
        let style = GetWindowLongPtrW(hwnd as _, GWL_STYLE);
        SetWindowLongPtrW(hwnd as _, GWL_STYLE, style | WS_THICKFRAME as isize);

        let preference = DWMWCP_ROUND;
        DwmSetWindowAttribute(
            hwnd as _,
            DWMWA_WINDOW_CORNER_PREFERENCE as u32,
            &preference as *const _ as *const std::ffi::c_void,
            std::mem::size_of_val(&preference) as u32,
        );
    }
    Ok(true)
}

#[cfg(not(windows))]
pub fn install(_window: &tauri::WebviewWindow) -> tauri::Result<bool> {
    Ok(false)
}
