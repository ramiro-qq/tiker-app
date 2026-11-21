use serde::Serialize;
use std::{collections::VecDeque, sync::Mutex};
use tauri::{Emitter, Manager};
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_dialog::DialogExt;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipRequest {
    request_id: String,
    url: String,
    title: String,
}

#[derive(Default)]
pub struct ClipperState {
    pending: VecDeque<ClipRequest>,
    seen: VecDeque<String>,
}

fn parse_request(link: &str) -> Option<ClipRequest> {
    if link.len() > 64000 {
        return None;
    }
    let link = reqwest::Url::parse(link).ok()?;
    if link.scheme() != "aireader"
        || link.host_str() != Some("clip")
        || !matches!(link.path(), "" | "/")
        || link.port().is_some()
        || !link.username().is_empty()
        || link.password().is_some()
        || link.fragment().is_some()
    {
        return None;
    }
    let pairs: Vec<_> = link.query_pairs().collect();
    let get = |key: &str| {
        let values: Vec<_> = pairs.iter().filter(|(k, _)| k == key).collect();
        (values.len() == 1).then(|| values[0].1.to_string())
    };
    let url = get("url")?;
    if url.len() > 16000 {
        return None;
    }
    let page = reqwest::Url::parse(&url).ok()?;
    if !matches!(page.scheme(), "http" | "https")
        || page.host_str().is_none()
        || !page.username().is_empty()
        || page.password().is_some()
    {
        return None;
    }
    let request_id = get("requestId")?;
    if request_id.is_empty()
        || request_id.len() > 128
        || !request_id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-')
    {
        return None;
    }
    let title = get("title")
        .unwrap_or_default()
        .chars()
        .filter(|c| !c.is_control())
        .take(500)
        .collect();
    Some(ClipRequest {
        request_id,
        url: page.to_string(),
        title,
    })
}

pub fn focus_main(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn receive(app: &tauri::AppHandle, link: &str) {
    let Some(request) = parse_request(link) else {
        return;
    };
    let state = app.state::<Mutex<ClipperState>>();
    if let Ok(mut state) = state.lock() {
        if state.seen.contains(&request.request_id) {
            return;
        }
        if state.seen.len() >= 256 {
            state.seen.pop_front();
        }
        state.seen.push_back(request.request_id.clone());
        state.pending.push_back(request);
    }
    focus_main(app);
    let _ = app.emit("clipper:pending", ());
}

pub fn setup(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let handle = app.clone();
    app.deep_link().on_open_url(move |event| {
        for link in event.urls() {
            receive(&handle, link.as_str());
        }
    });
    // Subscribe before reading current URLs; requestId prevents duplicate deliveries.
    if let Some(links) = app.deep_link().get_current()? {
        for link in links {
            receive(app, link.as_str());
        }
    }
    #[cfg(any(target_os = "linux", all(debug_assertions, windows)))]
    app.deep_link().register_all()?;
    Ok(())
}

#[tauri::command]
pub fn take_clip_requests(
    state: tauri::State<'_, Mutex<ClipperState>>,
) -> Result<Vec<ClipRequest>, String> {
    Ok(state
        .lock()
        .map_err(|_| "剪藏请求队列不可用")?
        .pending
        .drain(..)
        .collect())
}

#[tauri::command]
pub async fn download_browser_extension(app: tauri::AppHandle) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = app
            .dialog()
            .file()
            .set_title("保存浏览器插件")
            .set_file_name("tiker-clipper.zip")
            .add_filter("ZIP 压缩包", &["zip"])
            .blocking_save_file();
        let Some(path) = path else {
            return Ok(false);
        };
        let path = path.into_path().map_err(|e| format!("保存路径无效：{e}"))?;
        std::fs::write(
            path,
            include_bytes!("../../public/downloads/tiker-clipper.zip"),
        )
        .map_err(|e| format!("插件保存失败：{e}"))?;
        Ok(true)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    fn link(url: &str) -> String {
        let mut link = reqwest::Url::parse("aireader://clip").unwrap();
        link.query_pairs_mut()
            .append_pair("url", url)
            .append_pair("title", "中文 & 标题 #1\n")
            .append_pair("requestId", "test-123");
        link.to_string()
    }
    #[test]
    fn preserves_encoded_page_url_and_cleans_title() {
        let page = "https://example.com/a?x=1&name=%E4%B8%AD%E6%96%87#part";
        let request = parse_request(&link(page)).unwrap();
        assert_eq!(request.url, page);
        assert_eq!(request.title, "中文 & 标题 #1");
        assert_eq!(request.request_id, "test-123");
    }
    #[test]
    fn rejects_unsupported_urls_routes_and_ambiguous_parameters() {
        for page in [
            "javascript:alert(1)",
            "file:///tmp/a",
            "chrome://settings",
            "https://user:pass@example.com",
            "broken",
        ] {
            assert!(parse_request(&link(page)).is_none());
        }
        let valid = link("https://example.com");
        for invalid in [
            valid.replace("aireader:", "other:"),
            valid.replace("://clip?", "://other?"),
            valid.replace("://clip?", "://clip/path?"),
            format!("{valid}&url=https://other.com"),
            format!("{valid}#fragment"),
            "aireader://clip?url=https://example.com".into(),
        ] {
            assert!(parse_request(&invalid).is_none(), "accepted {invalid}");
        }
    }
}
