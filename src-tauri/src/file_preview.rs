use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs::{self, File, OpenOptions},
    io::{Read, Seek, SeekFrom, Write},
    path::PathBuf,
    sync::{Arc, Mutex},
    time::{Duration, Instant, UNIX_EPOCH},
};
use tauri::{
    Manager,
    http::{Request, Response},
};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

#[derive(Default)]
pub struct PreviewState {
    grants: Mutex<HashMap<String, PathBuf>>,
    names: Mutex<HashMap<String, String>>,
    sessions: Mutex<HashMap<String, Arc<Session>>>,
    writes: Mutex<()>,
}
struct Session {
    file: Mutex<File>,
    size: u64,
    mime: String,
    created: Instant,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Attachment {
    grant_id: String,
    name: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Descriptor {
    session_id: String,
    file_id: String,
    name: String,
    size: u64,
    mime: String,
    format: String,
    revision: String,
}
#[derive(Serialize, Deserialize)]
struct Grants {
    version: u8,
    files: HashMap<String, PathBuf>,
    #[serde(default)]
    names: HashMap<String, String>,
}
fn grants_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("file-grants.json"))
}
pub fn setup(app: &tauri::AppHandle) -> Result<(), String> {
    let path = grants_path(app)?;
    if path.exists() {
        let saved: Grants = serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?)
            .map_err(|e| format!("附件授权记录损坏：{e}"))?;
        if saved.version != 1 {
            return Err("不支持的附件授权版本".into());
        }
        *app.state::<PreviewState>()
            .names
            .lock()
            .map_err(|_| "附件名称锁不可用")? = saved.names;
        *app.state::<PreviewState>()
            .grants
            .lock()
            .map_err(|e| e.to_string())? = saved.files;
    }
    Ok(())
}
fn register(app: &tauri::AppHandle, path: PathBuf) -> Result<Attachment, String> {
    let path = path.canonicalize().map_err(|e| e.to_string())?;
    if !path.is_file() {
        return Err("请选择普通文件".into());
    }
    let state = app.state::<PreviewState>();
    let mut grants = state.grants.lock().map_err(|e| e.to_string())?;
    if let Some((id, _)) = grants.iter().find(|(_, p)| **p == path) {
        return Ok(Attachment {
            grant_id: id.clone(),
            name: path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into(),
        });
    }
    let id = uuid::Uuid::new_v4().to_string();
    let mut next = grants.clone();
    next.insert(id.clone(), path.clone());
    let target = grants_path(app)?;
    fs::create_dir_all(target.parent().unwrap()).map_err(|e| e.to_string())?;
    let temp = target.with_extension("tmp");
    fs::write(
        &temp,
        serde_json::to_vec(&Grants {
            version: 1,
            files: next.clone(),
            names: state.names.lock().map_err(|_| "附件名称锁不可用")?.clone(),
        })
        .map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    fs::rename(temp, target).map_err(|e| e.to_string())?;
    *grants = next;
    Ok(Attachment {
        grant_id: id,
        name: path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into(),
    })
}
#[tauri::command]
pub async fn pick_preview_file(app: tauri::AppHandle) -> Result<Option<Attachment>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(path) = app
            .dialog()
            .file()
            .set_title("添加本地附件（保留原文件）")
            .blocking_pick_file()
        else {
            return Ok(None);
        };
        register(&app, path.into_path().map_err(|e| e.to_string())?).map(Some)
    })
    .await
    .map_err(|e| e.to_string())?
}
fn granted_path(app: &tauri::AppHandle, id: &str) -> Result<PathBuf, String> {
    let path = app
        .state::<PreviewState>()
        .grants
        .lock()
        .map_err(|e| e.to_string())?
        .get(id)
        .cloned()
        .ok_or("文件未授权，请重新选择文件")?;
    let canonical = path
        .canonicalize()
        .map_err(|_| "原文件不存在或无法访问，请重新选择文件")?;
    if canonical != path || !canonical.is_file() {
        return Err("文件路径已改变，请重新选择文件".into());
    }
    Ok(path)
}
fn open_regular(path: &std::path::Path) -> Result<File, String> {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        options.custom_flags(0x00200000);
    }
    let file = options
        .open(path)
        .map_err(|e| format!("原文件无法打开：{e}"))?;
    let metadata = file.metadata().map_err(|e| e.to_string())?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err("只能预览普通文件".into());
    }
    Ok(file)
}
fn file_revision(path: &std::path::Path) -> Result<String, String> {
    let meta = open_regular(path)?.metadata().map_err(|e| e.to_string())?;
    Ok(format!(
        "{}-{}",
        meta.len(),
        meta.modified()
            .unwrap_or(UNIX_EPOCH)
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    ))
}
fn save_workbook(path: &std::path::Path, bytes: &[u8], expected: &str) -> Result<String, String> {
    let ext = path
        .extension()
        .unwrap_or_default()
        .to_string_lossy()
        .to_ascii_lowercase();
    if !["xlsx", "csv", "tsv"].contains(&ext.as_str()) {
        return Err("此格式不支持表格编辑保存".into());
    }
    if bytes.len() > 50 * 1024 * 1024 {
        return Err("表格超出 50 MiB，请导出副本".into());
    }
    if ext == "xlsx" && !bytes.starts_with(b"PK\x03\x04") {
        return Err("工作簿格式无效".into());
    }
    if file_revision(path)? != expected {
        return Err("原文件已被其他程序修改，请重新打开；当前编辑可导出为副本".into());
    }
    let temp = path.with_file_name(format!(".tiker-{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| {
        let mut output = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)
            .map_err(|e| e.to_string())?;
        output
            .set_permissions(fs::metadata(path).map_err(|e| e.to_string())?.permissions())
            .map_err(|e| e.to_string())?;
        output.write_all(bytes).map_err(|e| e.to_string())?;
        output.sync_all().map_err(|e| e.to_string())?;
        if file_revision(path)? != expected {
            return Err("原文件在保存期间发生变化，请导出副本".into());
        }
        fs::rename(&temp, path).map_err(|e| e.to_string())?;
        file_revision(path)
    })();
    if result.is_err() {
        let _ = fs::remove_file(temp);
    }
    result
}
#[tauri::command]
pub async fn save_spreadsheet(
    app: tauri::AppHandle,
    grant_id: String,
    bytes: Vec<u8>,
    expected_revision: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<PreviewState>();
        let _guard = state.writes.lock().map_err(|_| "保存锁不可用")?;
        save_workbook(&granted_path(&app, &grant_id)?, &bytes, &expected_revision)
    })
    .await
    .map_err(|e| e.to_string())?
}
fn detect(name: &str, header: &[u8]) -> (&'static str, &'static str) {
    if header.starts_with(b"%PDF-") {
        return ("pdf", "application/pdf");
    }
    if header.starts_with(b"\x89PNG\r\n\x1a\n") {
        return ("image", "image/png");
    }
    if header.starts_with(b"\xff\xd8\xff") {
        return ("image", "image/jpeg");
    }
    if header.starts_with(b"GIF87a") || header.starts_with(b"GIF89a") {
        return ("image", "image/gif");
    }
    if header.starts_with(b"RIFF") && header.get(8..12) == Some(b"WEBP") {
        return ("image", "image/webp");
    }
    if header.starts_with(b"PK\x03\x04") || header.starts_with(b"\xd0\xcf\x11\xe0") {
        return ("unsupported", "application/octet-stream");
    }
    let ext = name.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    match ext.as_str() {
        "md" | "markdown" => ("markdown", "text/plain"),
        "csv" | "tsv" => ("csv", "text/plain"),
        "txt" | "log" | "json" | "jsonl" | "yaml" | "yml" | "xml" | "html" | "htm" | "css"
        | "js" | "jsx" | "ts" | "tsx" | "vue" | "svelte" | "py" | "go" | "rs" | "java" | "c"
        | "h" | "cpp" | "sh" | "sql" | "ini" | "toml" | "conf" => ("text", "text/plain"),
        _ => ("unsupported", "application/octet-stream"),
    }
}
#[tauri::command]
pub async fn open_preview(app: tauri::AppHandle, grant_id: String) -> Result<Descriptor, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = granted_path(&app, &grant_id)?;
        let mut file = open_regular(&path)?;
        let meta = file.metadata().map_err(|e| e.to_string())?;
        if !meta.is_file() {
            return Err("不是普通文件".into());
        }
        let mut header = [0; 64];
        let n = file.read(&mut header).map_err(|e| e.to_string())?;
        file.seek(SeekFrom::Start(0)).map_err(|e| e.to_string())?;
        let name = app
            .state::<PreviewState>()
            .names
            .lock()
            .map_err(|_| "附件名称锁不可用")?
            .get(&grant_id)
            .cloned()
            .unwrap_or_else(|| {
                path.file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .to_string()
            });
        let (format, mime) = detect(&name, &header[..n]);
        let size = meta.len();
        let revision = format!(
            "{}-{}",
            size,
            meta.modified()
                .unwrap_or(UNIX_EPOCH)
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        );
        let id = uuid::Uuid::new_v4().to_string();
        let state = app.state::<PreviewState>();
        let mut sessions = state.sessions.lock().map_err(|e| e.to_string())?;
        sessions.retain(|_, s| s.created.elapsed() < Duration::from_secs(12 * 3600));
        if sessions.len() >= 8 {
            return Err("打开的预览过多，请先关闭已有文件".into());
        }
        sessions.insert(
            id.clone(),
            Arc::new(Session {
                file: Mutex::new(file),
                size,
                mime: mime.into(),
                created: Instant::now(),
            }),
        );
        Ok(Descriptor {
            session_id: id,
            file_id: grant_id,
            name,
            size,
            mime: mime.into(),
            format: format.into(),
            revision,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub fn close_preview(app: tauri::AppHandle, session_id: String) {
    if let Ok(mut sessions) = app.state::<PreviewState>().sessions.lock() {
        sessions.remove(&session_id);
    }
}
#[tauri::command]
pub async fn preview_original_action(
    app: tauri::AppHandle,
    grant_id: String,
    action: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = granted_path(&app, &grant_id)?;
        match action.as_str() {
            "open" => app
                .opener()
                .open_path(path.to_string_lossy(), None::<&str>)
                .map_err(|e| e.to_string()),
            "reveal" => app
                .opener()
                .reveal_item_in_dir(path)
                .map_err(|e| e.to_string()),
            "save" => {
                let Some(destination) = app
                    .dialog()
                    .file()
                    .set_file_name(path.file_name().unwrap_or_default().to_string_lossy())
                    .blocking_save_file()
                else {
                    return Ok(());
                };
                let destination = destination.into_path().map_err(|e| e.to_string())?;
                if destination.canonicalize().ok().as_ref() == Some(&path) {
                    return Err("目标是原文件，请选择其他位置".into());
                }
                fs::copy(path, destination)
                    .map(|_| ())
                    .map_err(|e| e.to_string())
            }
            _ => Err("不支持的文件操作".into()),
        }
    })
    .await
    .map_err(|e| e.to_string())?
}
// Only single-range requests are accepted. The handle is pinned for the session.
fn byte_range(value: &str, size: u64) -> Option<(u64, u64)> {
    if size == 0 {
        return None;
    }
    let (start, end) = value.strip_prefix("bytes=")?.split_once('-')?;
    if start.is_empty() {
        let count = end.parse::<u64>().ok()?.min(size);
        return (count > 0).then_some((size - count, size - 1));
    }
    let start = start.parse::<u64>().ok()?;
    let end = if end.is_empty() {
        size - 1
    } else {
        end.parse::<u64>().ok()?.min(size - 1)
    };
    (start <= end && start < size).then_some((start, end))
}
pub fn serve(app: &tauri::AppHandle, request: Request<Vec<u8>>) -> Response<Vec<u8>> {
    serve_state(&app.state::<PreviewState>(), request)
}
fn serve_state(state: &PreviewState, request: Request<Vec<u8>>) -> Response<Vec<u8>> {
    let origin = request
        .headers()
        .get("Origin")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let allowed = matches!(
        origin,
        "tauri://localhost" | "http://tauri.localhost" | "https://tauri.localhost"
    ) || (cfg!(debug_assertions)
        && matches!(origin, "http://localhost:1420" | "http://127.0.0.1:1420"));
    let respond = |status: u16, data: Vec<u8>| {
        let mut builder = Response::builder()
            .status(status)
            .header("Cache-Control", "no-store")
            .header("X-Content-Type-Options", "nosniff");
        if allowed {
            builder = builder
                .header("Access-Control-Allow-Origin", origin)
                .header(
                    "Access-Control-Expose-Headers",
                    "Content-Length, Content-Range, Accept-Ranges",
                )
                .header("Access-Control-Allow-Headers", "Range")
                .header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
        }
        builder.body(data).unwrap()
    };
    if !origin.is_empty() && !allowed {
        return respond(403, vec![]);
    }
    if request.method() == "OPTIONS" {
        return respond(204, vec![]);
    }
    if request.method() != "GET" && request.method() != "HEAD" {
        return respond(405, vec![]);
    }
    let token = request.uri().path().trim_start_matches('/');
    let session = state
        .sessions
        .lock()
        .ok()
        .and_then(|s| s.get(token).cloned());
    let Some(session) = session else {
        return respond(404, vec![]);
    };
    if session.created.elapsed() > Duration::from_secs(12 * 3600) {
        return respond(410, vec![]);
    }
    let range = request.headers().get("Range").and_then(|v| v.to_str().ok());
    let (start, end) = if let Some(range) = range {
        match byte_range(range, session.size) {
            Some(r) => r,
            None => {
                let mut response = respond(416, vec![]);
                response.headers_mut().insert(
                    "Content-Range",
                    format!("bytes */{}", session.size).parse().unwrap(),
                );
                return response;
            }
        }
    } else {
        (0, session.size.saturating_sub(1))
    };
    let length = if session.size == 0 {
        0
    } else {
        end - start + 1
    };
    // Protocol response API buffers a response; cap any individual allocation.
    let chunk_limit = if session.mime == "application/pdf" {
        1024 * 1024
    } else if session.mime.starts_with("image/") {
        40 * 1024 * 1024
    } else {
        10 * 1024 * 1024 + 1
    };
    if request.method() != "HEAD" && length > chunk_limit {
        return respond(413, vec![]);
    }
    let mut data = vec![];
    if request.method() != "HEAD" && length > 0 {
        let Ok(mut file) = session.file.lock() else {
            return respond(500, vec![]);
        };
        data.resize(length as usize, 0);
        if file
            .seek(SeekFrom::Start(start))
            .and_then(|_| file.read_exact(&mut data))
            .is_err()
        {
            return respond(409, vec![]);
        }
    }
    let mut response = respond(if range.is_some() { 206 } else { 200 }, data);
    let headers = response.headers_mut();
    headers.insert("Content-Type", session.mime.parse().unwrap());
    headers.insert("Content-Length", length.to_string().parse().unwrap());
    headers.insert("Accept-Ranges", "bytes".parse().unwrap());
    if range.is_some() {
        headers.insert(
            "Content-Range",
            format!("bytes {start}-{end}/{}", session.size)
                .parse()
                .unwrap(),
        );
    }
    response
}
pub(crate) fn sync_source(app: &tauri::AppHandle, id: &str) -> Result<PathBuf, String> {
    granted_path(app, id)
}

pub(crate) fn sync_register(
    app: &tauri::AppHandle,
    path: PathBuf,
    name: &str,
) -> Result<String, String> {
    let id = register(app, path)?.grant_id;
    let state = app.state::<PreviewState>();
    state
        .names
        .lock()
        .map_err(|_| "附件名称锁不可用")?
        .insert(id.clone(), name.to_owned());
    let grants = state.grants.lock().map_err(|_| "附件锁不可用")?;
    let saved = Grants {
        version: 1,
        files: grants.clone(),
        names: state.names.lock().map_err(|_| "附件名称锁不可用")?.clone(),
    };
    crate::content_store::atomic(&grants_path(app)?, &saved)?;
    Ok(id)
}
pub(crate) fn sync_bytes(path: &std::path::Path) -> Result<Vec<u8>, String> {
    let file = open_regular(path)?;
    if file.metadata().map_err(|e| e.to_string())?.len() > 50 * 1024 * 1024 {
        return Err("附件超出 50 MiB".into());
    }
    let mut bytes = vec![];
    file.take(50 * 1024 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > 50 * 1024 * 1024 {
        return Err("附件超出 50 MiB".into());
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn spreadsheet_save_roundtrip_and_external_change_conflict() {
        let dir = std::env::temp_dir().join(format!("tiker-sheet-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&dir).unwrap();
        let path = dir.join("sheet.csv");
        fs::write(&path, b"name,value\nfirst,1").unwrap();
        let revision = file_revision(&path).unwrap();
        let updated = save_workbook(&path, b"name,value\nfirst,22", &revision).unwrap();
        assert_ne!(revision, updated);
        assert_eq!(fs::read(&path).unwrap(), b"name,value\nfirst,22");
        assert!(save_workbook(&path, b"stale", &revision).is_err());
        fs::write(&path, b"external edit changed length").unwrap();
        assert!(save_workbook(&path, b"overwrite", &updated).is_err());
        assert_eq!(fs::read(&path).unwrap(), b"external edit changed length");
        let unsupported = dir.join("sheet.pdf");
        fs::write(&unsupported, b"PDF").unwrap();
        assert!(
            save_workbook(&unsupported, b"test", &file_revision(&unsupported).unwrap()).is_err()
        );
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn resource_protocol_handles_ranges_head_origin_and_revocation() {
        let path = std::env::temp_dir().join(format!("tiker-preview-{}", uuid::Uuid::new_v4()));
        fs::write(&path, b"0123456789").unwrap();
        let state = PreviewState::default();
        state.sessions.lock().unwrap().insert(
            "token".into(),
            Arc::new(Session {
                file: Mutex::new(File::open(&path).unwrap()),
                size: 10,
                mime: "text/plain".into(),
                created: Instant::now(),
            }),
        );
        let request = |method: &str, range: Option<&str>, origin: &str| {
            let mut builder = Request::builder()
                .method(method)
                .uri("preview://localhost/token")
                .header("Origin", origin);
            if let Some(r) = range {
                builder = builder.header("Range", r);
            }
            builder.body(vec![]).unwrap()
        };
        let response = serve_state(
            &state,
            request("GET", Some("bytes=2-5"), "tauri://localhost"),
        );
        assert_eq!(response.status(), 206);
        assert_eq!(response.body(), b"2345");
        assert_eq!(response.headers()["Content-Range"], "bytes 2-5/10");
        assert_eq!(
            response.headers()["Access-Control-Allow-Origin"],
            "tauri://localhost"
        );
        let head = serve_state(&state, request("HEAD", None, "tauri://localhost"));
        assert_eq!(head.status(), 200);
        assert!(head.body().is_empty());
        assert_eq!(head.headers()["Content-Length"], "10");
        assert_eq!(
            serve_state(
                &state,
                request("GET", Some("bytes=10-"), "tauri://localhost")
            )
            .status(),
            416
        );
        assert_eq!(
            serve_state(&state, request("GET", None, "https://external.example")).status(),
            403
        );
        assert_eq!(
            serve_state(&state, request("POST", None, "tauri://localhost")).status(),
            405
        );
        state.sessions.lock().unwrap().clear();
        assert_eq!(
            serve_state(&state, request("GET", None, "tauri://localhost")).status(),
            404
        );
        fs::remove_file(path).unwrap();
    }
    #[test]
    #[cfg(unix)]
    fn rejects_replaced_symlinks_and_special_files_without_blocking() {
        let directory =
            std::env::temp_dir().join(format!("tiker-preview-link-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&directory).unwrap();
        let original = directory.join("original");
        fs::write(&original, b"data").unwrap();
        let link = directory.join("link");
        std::os::unix::fs::symlink(&original, &link).unwrap();
        assert!(open_regular(&link).is_err());
        assert!(open_regular(&directory).is_err());
        let fifo = directory.join("fifo");
        let name = std::ffi::CString::new(fifo.to_str().unwrap()).unwrap();
        unsafe {
            assert_eq!(libc::mkfifo(name.as_ptr(), 0o600), 0);
        }
        assert!(open_regular(&fifo).is_err());
        fs::remove_dir_all(directory).unwrap();
    }
    #[test]
    fn ranges() {
        assert_eq!(byte_range("bytes=0-9", 100), Some((0, 9)));
        assert_eq!(byte_range("bytes=90-", 100), Some((90, 99)));
        assert_eq!(byte_range("bytes=-10", 100), Some((90, 99)));
        for value in ["bytes=100-", "bytes=5-2", "bytes=0-1,3-4", "bytes=-0"] {
            assert_eq!(byte_range(value, 100), None);
        }
        assert_eq!(byte_range("bytes=0-0", 0), None);
    }
    #[test]
    fn signatures_override_extension() {
        assert_eq!(detect("fake.txt", b"%PDF-1.7").0, "pdf");
        assert_eq!(detect("fake.csv", b"PK\x03\x04").0, "unsupported");
        assert_eq!(detect("fake.pdf", b"<script>").0, "unsupported");
    }
}
