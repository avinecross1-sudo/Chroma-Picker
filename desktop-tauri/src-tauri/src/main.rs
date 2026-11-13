// Chroma Picker desktop app: a Tauri window around the shared panel UI in ../ui (copied from plugin/).
// It uses the system web view (WebView2 on Windows) instead of shipping a browser, which keeps it small.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{fs, path::PathBuf};
use tauri::{AppHandle, Manager};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_dialog::DialogExt;

fn prefs_file(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("prefs.json"))
}
fn read_prefs(app: &AppHandle) -> serde_json::Value {
    prefs_file(app)
        .and_then(|f| fs::read_to_string(f).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| serde_json::json!({}))
}
fn write_pref(app: &AppHandle, key: &str, value: serde_json::Value) {
    let mut p = read_prefs(app);
    p[key] = value;
    if let Some(f) = prefs_file(app) {
        if let Some(dir) = f.parent() {
            let _ = fs::create_dir_all(dir);
        }
        let _ = fs::write(f, p.to_string());
    }
}

#[tauri::command]
fn copy_text(app: AppHandle, text: String) -> Result<bool, String> {
    app.clipboard().write_text(text).map_err(|e| e.to_string())?;
    Ok(true)
}

/* Asks where to save a swatch file (.ase is binary, .gpl is text) and writes it. False when cancelled. */
#[tauri::command]
async fn save_file(app: AppHandle, name: String, ext: String, text: Option<String>, bytes: Option<Vec<u8>>) -> Result<bool, String> {
    let mut dialog = app
        .dialog()
        .file()
        .set_file_name(&name)
        .add_filter(format!("{} swatches", ext.to_uppercase()), &[ext.as_str()]);
    if let Ok(dir) = app.path().document_dir() {
        dialog = dialog.set_directory(dir);
    }
    let Some(picked) = dialog.blocking_save_file() else { return Ok(false) };
    let path = picked.into_path().map_err(|e| e.to_string())?;
    let data = match bytes {
        Some(b) => b,
        None => text.unwrap_or_default().into_bytes(),
    };
    fs::write(path, data).map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
fn toggle_always_on_top(app: AppHandle) -> Result<bool, String> {
    let on = !read_prefs(&app)["alwaysOnTop"].as_bool().unwrap_or(false);
    if let Some(w) = app.get_webview_window("main") {
        w.set_always_on_top(on).map_err(|e| e.to_string())?;
    }
    write_pref(&app, "alwaysOnTop", serde_json::json!(on));
    Ok(on)
}

/* Scales the whole interface, like the Electron app's Larger / Smaller Interface. */
#[tauri::command]
fn set_ui_zoom(app: AppHandle, factor: f64) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("main") {
        w.set_zoom(factor.clamp(0.5, 3.0)).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn main() {
    tauri::Builder::default()
        // a second launch brings the open window forward instead
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .invoke_handler(tauri::generate_handler![copy_text, save_file, toggle_always_on_top, set_ui_zoom])
        .setup(|app| {
            let on_top = read_prefs(app.handle())["alwaysOnTop"].as_bool().unwrap_or(false);
            if let Some(w) = app.get_webview_window("main") {
                w.set_always_on_top(on_top)?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Chroma Picker");
}
