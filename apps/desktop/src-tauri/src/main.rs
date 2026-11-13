// The desktop shell.
//
// Starts the server as a child process on an OS-chosen port, shows it in a
// webview, and makes sure the child dies with the window. See docs/DESKTOP.md.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{mpsc, Mutex};
use std::thread;
use std::time::Duration;

use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};

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

/// Where the server keeps its data.
///
/// The desktop build normally uses the OS app-data directory, which keeps it
/// clear of the install directory and of the web build. `CATCUP_DATA_DIR`
/// overrides that, so the app can be pointed at an existing data folder — the
/// web build's `data/`, a backup, or a folder on another drive — without
/// copying it first.
fn data_directory(app: &tauri::App) -> Result<PathBuf, String> {
    if let Ok(value) = std::env::var("CATCUP_DATA_DIR") {
        let trimmed = value.trim();
        if !trimmed.is_empty() {
            return Ok(PathBuf::from(trimmed));
        }
    }
    app.path().app_data_dir().map_err(|e| e.to_string())
}

/// Start the server with an ephemeral port and wait for its readiness line.
fn start_server(app: &tauri::App) -> Result<(Child, u16), String> {
    let data_dir = data_directory(app)?;
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

fn main() {
    tauri::Builder::default()
        // A second launch focuses the window that already exists instead of
        // starting a second server on the same data directory.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
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
                .build()?;
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
