// The desktop shell.
//
// Starts the server as a child process on an OS-chosen port, shows it in a
// webview, and makes sure the child dies with the window. See docs/DESKTOP.md.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Mutex};
use std::thread;
use std::time::Duration;

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::webview::PageLoadEvent;
use tauri::{AppHandle, Manager, RunEvent, Runtime, WebviewUrl, WebviewWindowBuilder, WindowEvent};

struct Sidecar {
    child: Mutex<Option<Child>>,
    /// Keeps the child in a job object that is killed when the shell dies,
    /// including when it is killed without a chance to clean up.
    #[cfg(windows)]
    _job: Mutex<Option<job::KillOnClose>>,
}

/// Drop the `\\?\` verbatim prefix Windows APIs hand back.
///
/// Node cannot resolve a main module given that prefix and fails with a bare
/// drive-letter path, so paths are normalised before they are passed on.
fn plain_path(path: &std::path::Path) -> PathBuf {
    let text = path.to_string_lossy();
    match text.strip_prefix(r"\\?\") {
        Some(rest) => PathBuf::from(rest),
        None => path.to_path_buf(),
    }
}

/// The bundled Node runtime sits next to the executable; in development the
/// one on `PATH` is used instead.
fn node_binary() -> PathBuf {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(directory) = exe.parent() {
            let bundled = directory.join(if cfg!(windows) { "node.exe" } else { "node" });
            if bundled.exists() {
                return plain_path(&bundled);
            }
        }
    }
    std::env::var("CATCUP_NODE").map(PathBuf::from).unwrap_or_else(|_| PathBuf::from("node"))
}

/// The server entry: bundled resources when packaged, the workspace build when
/// running from `cargo run`.
fn server_entry(app: &tauri::App) -> PathBuf {
    if let Ok(resources) = app.path().resource_dir() {
        let bundled = resources.join("server").join("dist").join("index.js");
        if bundled.exists() {
            return plain_path(&bundled);
        }
    }
    if let Ok(value) = std::env::var("CATCUP_SERVER_ENTRY") {
        return PathBuf::from(value);
    }
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../server/dist/index.js")
}

/// Start the server with an ephemeral port and wait for its readiness line.
fn start_server(app: &tauri::App) -> Result<(Child, u16), String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;

    let node = node_binary();
    let entry = server_entry(app);
    println!("[shell] node: {}", node.display());
    println!("[shell] server: {}", entry.display());

    let mut child = Command::new(&node)
        .arg(&entry)
        .env("CATCUP_HOST", "127.0.0.1")
        .env("CATCUP_PORT", "0")
        .env("CATCUP_DATA_DIR", &data_dir)
        // Tells the server this is the single-user desktop shape, so an install
        // with no password opens straight into the app instead of a setup screen.
        .env("CATCUP_DESKTOP", "1")
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .map_err(|e| format!("could not start `{}`: {e}", node.display()))?;

    let stdout = child.stdout.take().ok_or("the server has no stdout")?;
    let (tx, rx) = mpsc::channel::<Result<u16, String>>();

    thread::spawn(move || {
        let mut announced = false;
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if !announced {
                if let Some(rest) = line.trim().strip_prefix("CATCUP_READY ") {
                    announced = true;
                    let _ = tx.send(rest.trim().parse::<u16>().map_err(|e| e.to_string()));
                    continue;
                }
            }
            println!("[server] {line}");
        }
        if !announced {
            let _ = tx.send(Err("the server exited before signalling ready".to_string()));
        }
    });

    match rx.recv_timeout(Duration::from_secs(30)) {
        Ok(Ok(port)) => Ok((child, port)),
        Ok(Err(message)) => {
            let _ = child.kill();
            Err(message)
        }
        Err(_) => {
            let _ = child.kill();
            Err("timed out waiting for the server to report a port".to_string())
        }
    }
}

/// Window state remembered between launches.
///
/// Visibility is deliberately left out: a window that was hidden when the app
/// closed — from the tray, or by the user — must not come back invisible, with
/// nothing on screen to click. Decorations are left out too, because the shell
/// never changes them.
fn remembered_window_state() -> tauri_plugin_window_state::StateFlags {
    use tauri_plugin_window_state::StateFlags;

    StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED | StateFlags::FULLSCREEN
}

/// Bring the window back: un-minimise it, show it if it was hidden, and focus
/// it. Shared by the tray menu, a left click on the tray icon and a second
/// launch of the app.
fn show_main_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Put an icon in the notification area, with a menu that can open the window
/// and quit the app.
///
/// The tray is installed once at startup. Tauri keeps the icon alive in its
/// resource table, so the returned handle does not need to be stored.
///
/// This is what makes closing the window safe: the close button hides to here
/// rather than quitting, so the server keeps running and the icon is the way
/// back. That is also why the tray is not optional — the app refuses to start
/// without it rather than run with a window that can be closed but not found.
fn install_tray(app: &tauri::App) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open CatCup Tavern", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&open, &separator, &quit])?;

    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip("CatCup Tavern")
        .menu(&menu)
        // Left click shows the window instead of opening the menu; the menu is
        // on the right-click, as on every other Windows tray icon.
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => show_main_window(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        });

    // `default_window_icon` comes from `tauri.conf.json`'s bundle icons. It is
    // only absent in a build without icons at all, and a tray with no image is
    // better than failing to start.
    if let Some(icon) = app.default_window_icon().cloned() {
        tray = tray.icon(icon);
    }

    tray.build(app)?;
    Ok(())
}

/// The extensions the shell hands to the server, matching its import route.
const CARD_EXTENSIONS: [&str; 4] = ["png", "json", "charx", "catcup"];

/// Card files the app was asked to open, and whether the page can take them.
///
/// Paths arrive before the window can use them: on a first launch they are this
/// process's arguments, and on a second launch the single-instance plugin
/// forwards them while the page may still be loading. They wait here until the
/// webview reports that the page has finished loading.
struct OpenFiles {
    pending: Mutex<Vec<PathBuf>>,
    page_ready: AtomicBool,
}

/// Read one argument as a card path.
///
/// A Windows association hands the file over as `"<exe>" "<path>"`, so the
/// argument is a plain path, usually with a drive letter. It must not go
/// through `Url::parse`: `C:\cards\mira.catcup` parses as a URL whose scheme is
/// `c`, and the following `to_file_path` then fails — which silently drops
/// every file a user opened.
fn card_path(raw: &str) -> Option<PathBuf> {
    let path = if raw.starts_with("file:") {
        // macOS and Linux deliver file URLs; the branch is here so porting the
        // shell does not quietly lose them.
        tauri::Url::parse(raw).ok()?.to_file_path().ok()?
    } else {
        PathBuf::from(raw)
    };

    if !path.is_file() {
        return None;
    }

    let extension = path.extension()?.to_str()?.to_ascii_lowercase();
    CARD_EXTENSIONS.contains(&extension.as_str()).then_some(path)
}

/// The card paths among a set of arguments.
///
/// The executable path that every launch carries is filtered out by the
/// extension check, so callers do not have to skip the first argument.
fn card_paths(args: &[String]) -> Vec<PathBuf> {
    args.iter().filter_map(|argument| card_path(argument)).collect()
}

/// Ask the page to import these cards, then reload it so the library shows them.
///
/// The page is a remote origin served by the sidecar, so Tauri IPC is not
/// available to it; `eval` runs in the page instead, and the request rides on
/// the session cookie the webview already holds.
fn deliver_open_files<R: Runtime>(window: &tauri::WebviewWindow<R>, paths: &[PathBuf]) {
    let Ok(encoded) = serde_json::to_string(
        &paths
            .iter()
            .map(|path| path.to_string_lossy().into_owned())
            .collect::<Vec<_>>(),
    ) else {
        println!("[shell] could not encode the card paths");
        return;
    };

    let script = format!(
        "(async () => {{
            for (const path of {encoded}) {{
                try {{
                    const response = await fetch('/api/characters/import-path', {{
                        method: 'POST',
                        headers: {{ 'content-type': 'application/json' }},
                        body: JSON.stringify({{ path }}),
                    }});
                    if (!response.ok) console.error('CatCup import failed', path, await response.text());
                }} catch (error) {{
                    console.error('CatCup import failed', path, error);
                }}
            }}
            location.reload();
        }})()"
    );

    if let Err(error) = window.eval(script) {
        println!("[shell] could not hand the card to the window: {error}");
    }
}

/// Hand over anything waiting, if the page is ready for it.
fn flush_open_files<R: Runtime>(app: &AppHandle<R>) {
    let Some(state) = app.try_state::<OpenFiles>() else {
        return;
    };
    if !state.page_ready.load(Ordering::SeqCst) {
        return;
    }

    let paths = {
        let mut pending = state.pending.lock().unwrap();
        std::mem::take(&mut *pending)
    };
    if paths.is_empty() {
        return;
    }

    if let Some(window) = app.get_webview_window("main") {
        deliver_open_files(&window, &paths);
    }
}

fn main() {
    // Arguments for this launch. A card the user double-clicked is one of them.
    let startup_args: Vec<String> = std::env::args().skip(1).collect();

    tauri::Builder::default()
        // Registered before any plugin so a second launch that forwards a card
        // while the first is still starting still finds somewhere to put it.
        .manage(OpenFiles {
            pending: Mutex::new(card_paths(&startup_args)),
            page_ready: AtomicBool::new(false),
        })
        // A second launch focuses the window that already exists instead of
        // starting a second server on the same data directory.
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            show_main_window(app);
            if let Some(state) = app.try_state::<OpenFiles>() {
                state.pending.lock().unwrap().extend(card_paths(&args));
            }
            flush_open_files(app);
        }))
        // Restores and persists size, position and maximised state for the
        // window built below. The plugin hooks window creation, so it also
        // covers a window that is created at runtime rather than in
        // `tauri.conf.json`; the state lives in `.window-state.json` under the
        // app config directory.
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(remembered_window_state())
                .build(),
        )
        // Closing the window hides it to the tray instead of quitting, so the
        // server keeps streaming while the window is out of the way. Quit from
        // the tray calls `exit` directly, which does not raise this event.
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .setup(|app| {
            let (child, port) = start_server(app).map_err(Box::<dyn std::error::Error>::from)?;
            println!("[shell] server ready on port {port}");

            #[cfg(windows)]
            let job = job::KillOnClose::new(&child);

            app.manage(Sidecar {
                child: Mutex::new(Some(child)),
                #[cfg(windows)]
                _job: Mutex::new(job),
            });

            let url = format!("http://127.0.0.1:{port}");
            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url.parse()?))
                .title("CatCup Tavern")
                .inner_size(1280.0, 820.0)
                .min_inner_size(900.0, 620.0)
                // A card opened before the page loaded waits until it can be
                // imported, and a reload after importing clears the flag again.
                .on_page_load(|window, payload| match payload.event() {
                    PageLoadEvent::Started => {
                        if let Some(state) = window.try_state::<OpenFiles>() {
                            state.page_ready.store(false, Ordering::SeqCst);
                        }
                    }
                    PageLoadEvent::Finished => {
                        if let Some(state) = window.try_state::<OpenFiles>() {
                            state.page_ready.store(true, Ordering::SeqCst);
                        }
                        flush_open_files(window.app_handle());
                    }
                })
                .build()?;

            install_tray(app)?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("could not build the CatCup Tavern window")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                if let Some(state) = app.try_state::<Sidecar>() {
                    if let Some(mut child) = state.child.lock().unwrap().take() {
                        println!("[shell] stopping the server");
                        let _ = child.kill();
                        let _ = child.wait();
                    }
                }
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A real file with the given extension, in the system temp directory.
    ///
    /// `temp_dir()` is an absolute path with a drive letter on Windows, which
    /// is exactly the shape that the URL parser used to swallow.
    fn card_file(extension: &str) -> PathBuf {
        let mut path = std::env::temp_dir();
        path.push(format!("catcup-card-path-{}.{extension}", std::process::id()));
        std::fs::write(&path, b"card").expect("could not write the test card");
        path
    }

    #[test]
    fn accepts_a_plain_path_with_a_drive_letter() {
        let path = card_file("catcup");
        assert_eq!(card_path(&path.to_string_lossy()), Some(path.clone()));
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn accepts_a_file_url() {
        let path = card_file("png");
        let url = tauri::Url::from_file_path(&path).expect("not an absolute path");
        assert_eq!(card_path(url.as_str()), Some(path.clone()));
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn ignores_a_file_that_is_not_a_card() {
        let path = card_file("txt");
        assert_eq!(card_path(&path.to_string_lossy()), None);
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn ignores_a_path_that_does_not_exist() {
        let mut path = std::env::temp_dir();
        path.push("catcup-card-that-is-not-there.catcup");
        assert_eq!(card_path(&path.to_string_lossy()), None);
    }

    #[test]
    fn ignores_arguments_that_are_not_files() {
        // A second launch forwards the whole command line, executable first.
        let args = vec!["C:\\Program Files\\CatCup\\catcup-desktop.exe".to_string(), "--flag".to_string()];
        assert!(card_paths(&args).is_empty());
    }
}

#[cfg(windows)]
mod job {
    use std::os::windows::io::AsRawHandle;
    use std::process::Child;

    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation, SetInformationJobObject,
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };

    /// A job object that kills everything inside it when its last handle closes.
    ///
    /// The shell already kills the child on a normal exit; this covers the case
    /// where the shell is killed outright, which leaves no chance to run any
    /// cleanup. If the process is already in a job that forbids nesting, the
    /// call is skipped and the shell still behaves as before.
    ///
    /// The handle is stored as an integer because a raw pointer is neither
    /// `Send` nor `Sync`, and this has to live inside Tauri-managed state.
    pub struct KillOnClose(isize);

    impl KillOnClose {
        pub fn new(child: &Child) -> Option<Self> {
            unsafe {
                let handle = CreateJobObjectW(std::ptr::null(), std::ptr::null());
                if handle.is_null() {
                    return None;
                }

                let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
                limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;

                let configured = SetInformationJobObject(
                    handle,
                    JobObjectExtendedLimitInformation,
                    &limits as *const _ as *const std::ffi::c_void,
                    std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                );
                if configured == 0 {
                    CloseHandle(handle);
                    return None;
                }

                if AssignProcessToJobObject(handle, child.as_raw_handle() as HANDLE) == 0 {
                    CloseHandle(handle);
                    return None;
                }

                Some(Self(handle as isize))
            }
        }
    }

    impl Drop for KillOnClose {
        fn drop(&mut self) {
            unsafe {
                CloseHandle(self.0 as HANDLE);
            }
        }
    }
}
