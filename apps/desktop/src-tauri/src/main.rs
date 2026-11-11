// Spike: prove that a Tauri shell can start the CatCup server as a child
// process, wait for it, show it, and shut it down without leaving an orphan.
// This is throwaway code; the real desktop slice replaces it.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{mpsc, Mutex};
use std::thread;
use std::time::Duration;

use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};

struct Sidecar(Mutex<Option<Child>>);

fn server_entry() -> PathBuf {
    if let Ok(value) = std::env::var("CATCUP_SERVER_ENTRY") {
        return PathBuf::from(value);
    }
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../server/dist/index.js")
}

/// Start the server with an ephemeral port and wait for its readiness line.
fn start_server(app: &tauri::App) -> Result<(Child, u16), String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;

    let node = std::env::var("CATCUP_NODE").unwrap_or_else(|_| "node".to_string());
    let entry = server_entry();

    let mut child = Command::new(&node)
        .arg(&entry)
        .env("CATCUP_HOST", "127.0.0.1")
        .env("CATCUP_PORT", "0")
        .env("CATCUP_DATA_DIR", &data_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .map_err(|e| format!("could not start `{node} {}`: {e}", entry.display()))?;

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
        .setup(|app| {
            let (child, port) = start_server(app).map_err(Box::<dyn std::error::Error>::from)?;
            println!("[shell] server ready on port {port}");
            app.manage(Sidecar(Mutex::new(Some(child))));

            let url = format!("http://127.0.0.1:{port}");
            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url.parse()?))
                .title("CatCup Tavern")
                .inner_size(1280.0, 820.0)
                .build()?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("could not build the CatCup Tavern window")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                if let Some(state) = app.try_state::<Sidecar>() {
                    if let Some(mut child) = state.0.lock().unwrap().take() {
                        println!("[shell] stopping the server");
                        let _ = child.kill();
                        let _ = child.wait();
                    }
                }
            }
        });
}
