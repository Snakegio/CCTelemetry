// Filesystem commands invoked from the Angular frontend (usage.service.ts).
// This replaces the old tauri-plugin-fs path: instead of the webview walking
// ~/.claude/projects itself, it calls these #[tauri::command]s. The trust
// boundary lives here — read_sessions only ever reads inside the projects root,
// never an arbitrary path handed over from JS.
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::Manager;

// Session file paths are RELATIVE to the projects root (~/.claude/projects),
// so the frontend cache and read_sessions speak the same short keys.
#[derive(Serialize)]
pub struct FileMeta {
    pub path: String,
    pub mtime_ms: u64,
    pub size: u64,
}

#[derive(Serialize)]
pub struct FileContent {
    pub path: String,
    pub content: String,
}

fn projects_root(app: &tauri::AppHandle) -> Option<PathBuf> {
    Some(app.path().home_dir().ok()?.join(".claude").join("projects"))
}

fn mtime_ms(meta: &std::fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

// Recursively collect *.jsonl files under `dir`, up to `depth` levels of
// subdirectories (matches the old walk(ROOT, 4) in tauri-provider.js).
fn walk(dir: &Path, depth: u32, root: &Path, out: &mut Vec<FileMeta>) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(meta) = entry.metadata() else { continue };
        if meta.is_dir() {
            if depth > 0 {
                walk(&path, depth - 1, root, out);
            }
        } else if path.extension().is_some_and(|e| e == "jsonl") {
            if let Ok(rel) = path.strip_prefix(root) {
                out.push(FileMeta {
                    path: rel.to_string_lossy().replace('\\', "/"),
                    mtime_ms: mtime_ms(&meta),
                    size: meta.len(),
                });
            }
        }
    }
}

#[tauri::command]
pub fn list_sessions(app: tauri::AppHandle) -> Vec<FileMeta> {
    let mut out = Vec::new();
    if let Some(root) = projects_root(&app) {
        walk(&root, 4, &root, &mut out);
    }
    out
}

#[tauri::command]
pub fn read_sessions(app: tauri::AppHandle, paths: Vec<String>) -> Vec<FileContent> {
    let Some(root) = projects_root(&app) else { return Vec::new() };
    let Ok(canon_root) = root.canonicalize() else { return Vec::new() };
    let mut out = Vec::new();
    for rel in paths {
        // Reject traversal outright, then confirm the resolved path stays inside
        // the projects root — a symlink or crafted rel-path can't escape.
        if rel.contains("..") {
            continue;
        }
        let full = root.join(&rel);
        let Ok(canon) = full.canonicalize() else { continue };
        if !canon.starts_with(&canon_root) {
            continue;
        }
        if let Ok(content) = std::fs::read_to_string(&canon) {
            out.push(FileContent { path: rel, content });
        }
    }
    out
}

#[tauri::command]
pub fn claude_exists(app: tauri::AppHandle) -> bool {
    app.path()
        .home_dir()
        .map(|h| h.join(".claude").is_dir())
        .unwrap_or(false)
}

// Returns the {fetchedAt, prices} object the pricing poller (lib.rs) writes to
// <AppData>/data/pricing.json, or null if it hasn't run yet. The frontend reads
// `.prices` and feeds it to AggCore.applyPriceOverrides.
#[tauri::command]
pub fn get_pricing(app: tauri::AppHandle) -> Option<serde_json::Value> {
    let path = app.path().app_data_dir().ok()?.join("data").join("pricing.json");
    let text = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&text).ok()
}

// Daily history survives Claude Code pruning old JSONL logs. Stored as raw JSON
// text so the shared aggregation core (core.ts) owns the shape, not Rust.
#[tauri::command]
pub fn read_history(app: tauri::AppHandle) -> String {
    app.path()
        .app_data_dir()
        .ok()
        .and_then(|d| std::fs::read_to_string(d.join("data").join("history.json")).ok())
        .unwrap_or_else(|| "{}".to_string())
}

#[tauri::command]
pub fn write_history(app: tauri::AppHandle, json: String) -> Result<(), String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("data");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    std::fs::write(dir.join("history.json"), json).map_err(|e| e.to_string())
}
