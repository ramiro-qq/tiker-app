mod agent;
mod browser_clipper;
mod clip_tasks;
mod content_store;
mod content_sync;
mod file_preview;
mod github_client;
mod learning;
mod models;
mod sync_config;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::{
    fs::{self, OpenOptions},
    io::{ErrorKind, Write},
    path::{Path, PathBuf},
    sync::{
        Mutex,
        atomic::{AtomicU64, Ordering},
    },
};
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

type ConfigState = Mutex<Option<AppConfig>>;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct AppConfig {
    version: u8,
    app: AppSettings,
    workspace: WorkspaceSettings,
    window: WindowSettings,
    shortcuts: ShortcutSettings,
    #[serde(flatten)]
    extra: Map<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct AppSettings {
    language: String,
    theme: String,
    launch_page: String,
    font_size: String,
    #[serde(flatten)]
    extra: Map<String, Value>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct WorkspaceSettings {
    current_path: Option<String>,
    recent_paths: Vec<String>,
    #[serde(flatten)]
    extra: Map<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
struct WindowSettings {
    width: u32,
    height: u32,
    maximized: bool,
    #[serde(flatten)]
    extra: Map<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct ShortcutSettings {
    search: String,
    toggle_sidebar: String,
    save: String,
    #[serde(flatten)]
    extra: Map<String, Value>,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            version: 1,
            app: AppSettings::default(),
            workspace: WorkspaceSettings::default(),
            window: WindowSettings::default(),
            shortcuts: ShortcutSettings::default(),
            extra: Map::new(),
        }
    }
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            language: "zh-CN".into(),
            theme: "system".into(),
            launch_page: "search".into(),
            font_size: "medium".into(),
            extra: Map::new(),
        }
    }
}

impl Default for WindowSettings {
    fn default() -> Self {
        Self {
            width: 1180,
            height: 760,
            maximized: false,
            extra: Map::new(),
        }
    }
}

impl Default for ShortcutSettings {
    fn default() -> Self {
        Self {
            search: "k".into(),
            toggle_sidebar: "b".into(),
            save: "s".into(),
            extra: Map::new(),
        }
    }
}

fn minimum_window_size() -> (u32, u32) {
    let config: Value = serde_json::from_str(include_str!("../tauri.conf.json"))
        .expect("bundled Tauri configuration must be valid JSON");
    let window = &config["app"]["windows"][0];
    (
        window["minWidth"].as_u64().unwrap_or(960) as u32,
        window["minHeight"].as_u64().unwrap_or(640) as u32,
    )
}

fn validate_config(config: &AppConfig) -> Result<(), String> {
    if config.version != 1 {
        return Err(format!(
            "不支持配置版本 {}，仅支持 version 1",
            config.version
        ));
    }
    if config.app.language != "zh-CN" {
        return Err("app.language 仅支持 zh-CN".into());
    }
    if !["system", "light", "dark"].contains(&config.app.theme.as_str()) {
        return Err("app.theme 必须为 system、light 或 dark".into());
    }
    if ![
        "explore", "library", "clips", "tags", "history", "settings", "search",
    ]
    .contains(&config.app.launch_page.as_str())
    {
        return Err("app.launchPage 无效".into());
    }
    if !["small", "medium", "large"].contains(&config.app.font_size.as_str()) {
        return Err("app.fontSize 必须为 small、medium 或 large".into());
    }
    let (width, height) = minimum_window_size();
    if config.window.width < width || config.window.height < height {
        return Err(format!("窗口逻辑尺寸不能小于 {width}×{height}"));
    }
    let keys = [
        &config.shortcuts.search,
        &config.shortcuts.toggle_sidebar,
        &config.shortcuts.save,
    ];
    if keys
        .iter()
        .any(|key| key.len() != 1 || !key.as_bytes()[0].is_ascii_alphabetic())
    {
        return Err("快捷键必须为单个 ASCII 字母".into());
    }
    if keys[0].eq_ignore_ascii_case(keys[1])
        || keys[0].eq_ignore_ascii_case(keys[2])
        || keys[1].eq_ignore_ascii_case(keys[2])
    {
        return Err("快捷键不能重复（不区分大小写）".into());
    }
    Ok(())
}

fn config_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_config_dir()
        .map_err(|error| format!("无法定位配置目录：{error}"))?;
    Ok(directory.join("config.json"))
}

fn write_config(path: &Path, config: &AppConfig) -> Result<(), String> {
    validate_config(config)?;
    let contents =
        serde_json::to_vec_pretty(config).map_err(|error| format!("配置序列化失败：{error}"))?;
    let directory = path.parent().ok_or("配置路径缺少父目录")?;
    fs::create_dir_all(directory).map_err(|error| format!("无法创建配置目录：{error}"))?;
    static NEXT_TEMP: AtomicU64 = AtomicU64::new(0);
    let (temporary, mut file) = loop {
        let temporary = directory.join(format!(
            ".config-{}-{}.tmp",
            std::process::id(),
            NEXT_TEMP.fetch_add(1, Ordering::Relaxed)
        ));
        match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
        {
            Ok(file) => break (temporary, file),
            Err(error) if error.kind() == ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(format!("无法创建配置临时文件：{error}")),
        }
    };
    let result = (|| {
        file.write_all(&contents)
            .map_err(|error| format!("写入配置失败：{error}"))?;
        file.sync_all()
            .map_err(|error| format!("同步配置失败：{error}"))?;
        drop(file);
        fs::rename(&temporary, path).map_err(|error| format!("原子替换配置失败：{error}"))
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

fn read_config(path: &Path) -> Result<AppConfig, String> {
    match fs::read_to_string(path) {
        Ok(contents) => {
            let config = serde_json::from_str(&contents)
                .map_err(|error| format!("配置格式错误（{}）：{error}", path.display()))?;
            validate_config(&config)?;
            Ok(config)
        }
        Err(error) if error.kind() == ErrorKind::NotFound => {
            let config = AppConfig::default();
            write_config(path, &config)?;
            Ok(config)
        }
        Err(error) => Err(format!("无法读取配置（{}）：{error}", path.display())),
    }
}

fn restore_window(app: &tauri::AppHandle, config: &AppConfig) -> Result<(), String> {
    let window = app.get_webview_window("main").ok_or("找不到主窗口")?;
    window
        .set_size(tauri::LogicalSize::new(
            config.window.width,
            config.window.height,
        ))
        .map_err(|error| format!("恢复窗口尺寸失败：{error}"))?;
    if config.window.maximized {
        window
            .maximize()
            .map_err(|error| format!("恢复窗口最大化失败：{error}"))?;
    }
    Ok(())
}

// Resolve the system Documents directory rather than assuming a home-folder layout.
fn ensure_workspace(
    config: &mut AppConfig,
    default_path: impl FnOnce() -> Result<PathBuf, String>,
) -> Result<bool, String> {
    let missing = config
        .workspace
        .current_path
        .as_ref()
        .is_none_or(|path| path.trim().is_empty());
    let path = if missing {
        default_path()?
    } else {
        PathBuf::from(config.workspace.current_path.as_ref().unwrap())
    };
    fs::create_dir_all(&path)
        .map_err(|error| format!("无法创建资料库目录（{}）：{error}", path.display()))?;
    if missing {
        let path = path.to_string_lossy().into_owned();
        config.workspace.current_path = Some(path.clone());
        if !config.workspace.recent_paths.contains(&path) {
            config.workspace.recent_paths.insert(0, path);
        }
    }
    Ok(missing)
}

#[tauri::command]
async fn pick_workspace_directory(app: tauri::AppHandle) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut dialog = app.dialog().file().set_title("选择资料库目录");
        if let Some(path) = app
            .state::<ConfigState>()
            .lock()
            .map_err(|_| "配置锁不可用")?
            .as_ref()
            .and_then(|config| config.workspace.current_path.as_ref())
        {
            dialog = dialog.set_directory(path);
        }
        let Some(path) = dialog.blocking_pick_folder() else {
            return Ok(None);
        };
        let path = path.into_path().map_err(|error| error.to_string())?;
        if !path.is_dir() {
            return Err("请选择有效的文件夹目录".into());
        }
        Ok(Some(path.to_string_lossy().into_owned()))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
fn open_workspace_directory(
    app: tauri::AppHandle,
    state: tauri::State<'_, ConfigState>,
) -> Result<(), String> {
    let path = state
        .lock()
        .map_err(|_| "配置锁不可用")?
        .as_ref()
        .and_then(|config| config.workspace.current_path.clone())
        .ok_or("资料库目录尚未初始化")?;
    app.opener()
        .open_path(path, None::<&str>)
        .map_err(|error| format!("打开目录失败：{error}"))
}

#[tauri::command]
fn load_app_config(
    app: tauri::AppHandle,
    state: tauri::State<'_, ConfigState>,
) -> Result<AppConfig, String> {
    let mut current = state.lock().map_err(|_| "配置锁不可用")?;
    if let Some(config) = current.as_ref() {
        let mut view = config.clone();
        strip_sync_fields(&mut view);
        return Ok(view);
    }
    let path = config_path(&app)?;
    let had_application_config = path.exists();
    let mut config = read_config(&path)?;
    // Keep local content available if the independent sync file needs repair.
    // Retain legacy fields in memory/on disk until initialization succeeds.
    let sync_ready = if had_application_config {
        migrate_sync_fields(&mut config, |legacy, delay| {
            sync_config::initialize(&app, legacy, delay)
        })
    } else {
        sync_config::initialize(&app, None, None)
    }
    .is_ok();
    ensure_workspace(&mut config, || {
        app.path()
            .document_dir()
            .map(|path| path.join("tiker"))
            .map_err(|error| format!("无法定位文稿目录：{error}"))
    })?;
    // Upgrade previous defaults once; later explicit launch preferences remain intact.
    if config.app.extra.get("searchLaunchInitialized") != Some(&Value::Bool(true)) {
        if config.app.launch_page == "library" || config.app.launch_page == "explore" {
            config.app.launch_page = "search".into();
        }
        config
            .app
            .extra
            .insert("searchLaunchInitialized".into(), Value::Bool(true));
    }
    if sync_ready {
        write_config(&path, &config)?;
    }
    restore_window(&app, &config)?;
    *current = Some(config.clone());
    strip_sync_fields(&mut config);
    Ok(config)
}

fn strip_sync_fields(config: &mut AppConfig) {
    config.extra.remove("github");
    config.app.extra.remove("autoRecordInterval");
}

fn migrate_sync_fields(
    config: &mut AppConfig,
    initialize: impl FnOnce(Option<github_client::GithubConfig>, Option<u32>) -> Result<(), String>,
) -> Result<(), String> {
    let legacy = config
        .extra
        .get("github")
        .map(|value| serde_json::from_value(value.clone()))
        .transpose()
        .map_err(|_| "旧同步账号配置格式错误，原文件已保留")?;
    let delay = config
        .app
        .extra
        .get("autoRecordInterval")
        .map(|value| {
            value
                .as_u64()
                .and_then(|v| u32::try_from(v).ok())
                .ok_or("旧同步等待时间无效，原文件已保留")
        })
        .transpose()?;
    initialize(
        legacy.or_else(|| Some(github_client::GithubConfig::default())),
        delay,
    )?;
    strip_sync_fields(config);
    Ok(())
}

fn retain_unknown(previous: &Map<String, Value>, incoming: &mut Map<String, Value>) {
    for (key, value) in previous {
        incoming.entry(key.clone()).or_insert_with(|| value.clone());
    }
}

fn prepare_save(previous: &AppConfig, mut config: AppConfig) -> Result<AppConfig, String> {
    validate_config(&config)?;
    retain_unknown(&previous.extra, &mut config.extra);
    retain_unknown(&previous.app.extra, &mut config.app.extra);
    retain_unknown(&previous.workspace.extra, &mut config.workspace.extra);
    retain_unknown(&previous.shortcuts.extra, &mut config.shortcuts.extra);
    config.window = previous.window.clone();
    // Old frontend snapshots must never reintroduce migrated sync settings.
    strip_sync_fields(&mut config);
    Ok(config)
}

#[tauri::command]
fn save_app_config(
    app: tauri::AppHandle,
    state: tauri::State<'_, ConfigState>,
    config: AppConfig,
) -> Result<AppConfig, String> {
    let _content = content_store::LOCK.lock().map_err(|_| "内容锁不可用")?;
    let mut current = state.lock().map_err(|_| "配置锁不可用")?;
    let path = config_path(&app)?;
    let mut previous = match current.as_ref() {
        Some(config) => config.clone(),
        None => {
            let config = read_config(&path)?;
            restore_window(&app, &config)?;
            config
        }
    };
    migrate_sync_fields(&mut previous, |legacy, delay| {
        sync_config::initialize(&app, legacy, delay)
    })?;
    let config = prepare_save(&previous, config)?;
    let switched = config.workspace.current_path != previous.workspace.current_path;
    if switched {
        content_sync::binding_writable()?;
    }
    write_config(&path, &config)?;
    *current = Some(config.clone());
    if switched {
        content_sync::binding_changed();
    }
    Ok(config)
}

fn save_window_state(window: &tauri::Window) -> Result<(), String> {
    let state = window.state::<ConfigState>();
    let mut current = state.lock().map_err(|_| "配置锁不可用")?;
    let Some(previous) = current.as_ref() else {
        return Ok(());
    };
    if window.is_minimized().map_err(|error| error.to_string())? {
        return Ok(());
    }
    let mut config = previous.clone();
    config.window.maximized = window.is_maximized().map_err(|error| error.to_string())?;
    if !config.window.maximized {
        let size = window
            .inner_size()
            .map_err(|error| error.to_string())?
            .to_logical::<u32>(window.scale_factor().map_err(|error| error.to_string())?);
        let (width, height) = minimum_window_size();
        if size.width < width || size.height < height {
            return Ok(());
        }
        config.window.width = size.width;
        config.window.height = size.height;
    }
    if config.window.width == previous.window.width
        && config.window.height == previous.window.height
        && config.window.maximized == previous.window.maximized
    {
        return Ok(());
    }
    write_config(&config_path(window.app_handle())?, &config)?;
    *current = Some(config);
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(file_preview::PreviewState::default())
        .register_asynchronous_uri_scheme_protocol("preview", |context, request, responder| {
            let app = context.app_handle().clone();
            std::thread::spawn(move || responder.respond(file_preview::serve(&app, request)));
        })
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            browser_clipper::focus_main(app)
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(Mutex::new(browser_clipper::ClipperState::default()))
        .manage(clip_tasks::ClipTasks::default())
        .manage(models::ModelState::default())
        .setup(|app| {
            file_preview::setup(app.handle()).map_err(std::io::Error::other)?;
            browser_clipper::setup(app.handle())?;
            content_sync::setup(app.handle());
            clip_tasks::setup(app.handle()).map_err(std::io::Error::other)?;
            // Initialize persisted state before the webview can display a stale page.
            let state = app.state::<ConfigState>();
            if let Err(error) = load_app_config(app.handle().clone(), state) {
                eprintln!("初始化应用配置失败：{error}");
            }
            Ok(())
        })
        .manage(ConfigState::new(None))
        .manage(github_client::GithubState::default())
        .plugin(tauri_plugin_opener::init())
        .on_window_event(|window, event| {
            if window.label() == "main"
                && matches!(
                    event,
                    tauri::WindowEvent::Resized(_) | tauri::WindowEvent::CloseRequested { .. }
                )
                && let Err(error) = save_window_state(window)
            {
                eprintln!("保存窗口配置失败：{error}");
            }
        })
        .manage(learning::LearningState::default())
        .invoke_handler(tauri::generate_handler![
            content_sync::sync_exclude_attachment,
            content_sync::sync_history,
            content_sync::sync_restore,
            content_sync::sync_status,
            content_sync::sync_preview,
            content_sync::sync_enable,
            content_sync::sync_now,
            content_sync::sync_pause,
            content_sync::sync_conflicts,
            content_sync::sync_resolve,
            content_store::content_load,
            content_store::content_save,
            learning::learning_cancel,
            learning::learning_intent,
            learning::learning_research,
            learning::learning_generate,
            learning::learning_archive,
            pick_workspace_directory,
            open_workspace_directory,
            file_preview::pick_preview_file,
            file_preview::open_preview,
            file_preview::save_spreadsheet,
            file_preview::close_preview,
            file_preview::preview_original_action,
            clip_tasks::list_clip_tasks,
            clip_tasks::list_clip_categories,
            clip_tasks::create_clip_task,
            clip_tasks::retry_clip_task,
            clip_tasks::cancel_clip_task,
            clip_tasks::archive_clip_task,
            clip_tasks::move_clip_task,
            clip_tasks::save_clip_draft,
            clip_tasks::delete_clip_category,
            clip_tasks::delete_clip_tasks,
            clip_tasks::check_clip_links,
            clip_tasks::cancel_clip_check,
            models::model_settings,
            models::save_model_settings,
            models::delete_model,
            models::test_model,
            models::duplicate_model,
            clip_tasks::clip_extraction_settings,
            clip_tasks::save_clip_extraction_settings,
            browser_clipper::take_clip_requests,
            browser_clipper::download_browser_extension,
            load_app_config,
            save_app_config,
            sync_config::load_sync_settings,
            sync_config::save_sync_delay,
            github_client::github_status,
            github_client::github_begin_auth,
            github_client::github_poll_auth,
            github_client::github_cancel_auth,
            github_client::github_list_repositories,
            github_client::github_create_repository,
            github_client::github_bind_repository,
            github_client::github_disconnect
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TestDirectory(PathBuf);
    impl TestDirectory {
        fn new() -> Self {
            static NEXT: AtomicU64 = AtomicU64::new(0);
            let path = std::env::temp_dir().join(format!(
                "ai-reader-config-test-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir(&path).unwrap();
            Self(path)
        }
        fn config_path(&self) -> PathBuf {
            self.0.join("config.json")
        }
    }
    impl Drop for TestDirectory {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn workspace_defaults_to_documents_and_survives_restart() {
        let directory = TestDirectory::new();
        let default = directory.0.join("Documents/tiker");
        let mut config = AppConfig::default();
        assert!(ensure_workspace(&mut config, || Ok(default.clone())).unwrap());
        assert!(default.is_dir());
        write_config(&directory.config_path(), &config).unwrap();
        let mut restored = read_config(&directory.config_path()).unwrap();
        assert!(
            !ensure_workspace(&mut restored, || panic!(
                "saved directory must take precedence"
            ))
            .unwrap()
        );
        assert_eq!(
            restored.workspace.current_path,
            config.workspace.current_path
        );
        assert_eq!(restored.workspace.recent_paths.len(), 1);
        // A selected directory and its files are preserved; missing directories are recreated.
        let selected = directory.0.join("selected");
        fs::create_dir(&selected).unwrap();
        fs::write(selected.join("notes.txt"), "keep").unwrap();
        restored.workspace.current_path = Some(selected.to_string_lossy().into_owned());
        ensure_workspace(&mut restored, || panic!("do not reset selected directory")).unwrap();
        assert_eq!(
            fs::read_to_string(selected.join("notes.txt")).unwrap(),
            "keep"
        );
        fs::remove_dir_all(&selected).unwrap();
        ensure_workspace(&mut restored, || panic!("do not reset selected directory")).unwrap();
        assert!(selected.is_dir());
    }

    #[test]
    fn workspace_initialization_reports_file_conflicts() {
        let directory = TestDirectory::new();
        let conflict = directory.0.join("tiker");
        fs::write(&conflict, "keep").unwrap();
        let mut config = AppConfig::default();
        assert!(ensure_workspace(&mut config, || Ok(conflict.clone())).is_err());
        assert!(config.workspace.current_path.is_none());
        assert_eq!(fs::read_to_string(conflict).unwrap(), "keep");
    }

    #[test]
    fn failed_sync_migration_keeps_legacy_fields_for_retry() {
        let mut config: AppConfig = serde_json::from_value(serde_json::json!({
            "github":{"initialized":true,"user":{"login":"legacy"}},
            "app":{"autoRecordInterval":10}
        }))
        .unwrap();
        assert!(migrate_sync_fields(&mut config, |_, _| Err("disk unavailable".into())).is_err());
        assert!(config.extra.contains_key("github"));
        assert_eq!(config.app.extra["autoRecordInterval"], 10);
        migrate_sync_fields(&mut config, |legacy, delay| {
            assert_eq!(legacy.unwrap().user.unwrap().login, "legacy");
            assert_eq!(delay, Some(10));
            Ok(())
        })
        .unwrap();
        assert!(!config.extra.contains_key("github"));
        assert!(!config.app.extra.contains_key("autoRecordInterval"));
    }

    #[test]
    fn ordinary_application_save_does_not_persist_sync_fields() {
        let directory = TestDirectory::new();
        let path = directory.config_path();
        let previous = AppConfig::default();
        let incoming: AppConfig = serde_json::from_value(serde_json::json!({
            "app":{"theme":"dark","autoRecordInterval":10},
            "github":{"initialized":true,"user":{"login":"stale-account"}},
            "future":{"keep":true}
        }))
        .unwrap();
        let prepared = prepare_save(&previous, incoming).unwrap();
        write_config(&path, &prepared).unwrap();
        let disk: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert!(disk.get("github").is_none());
        assert!(disk["app"].get("autoRecordInterval").is_none());
        assert_eq!(disk["app"]["theme"], "dark");
        assert_eq!(disk["future"]["keep"], true);
    }

    #[test]
    fn old_config_defaults_each_missing_field() {
        let config: AppConfig = serde_json::from_str(r#"{"app":{"theme":"dark"},"workspace":{},"window":{"width":1200},"shortcuts":{"search":"a"}}"#).unwrap();
        validate_config(&config).unwrap();
        assert_eq!(config.version, 1);
        assert_eq!(config.app.language, "zh-CN");
        assert_eq!(config.app.font_size, "medium");
        assert_eq!(config.app.launch_page, "search");
        assert_eq!(config.window.height, 760);
        assert_eq!(config.shortcuts.toggle_sidebar, "b");
        assert_eq!(config.shortcuts.save, "s");
        assert!(config.workspace.recent_paths.is_empty());
        validate_config(&serde_json::from_str::<AppConfig>("{}").unwrap()).unwrap();
    }

    #[test]
    fn invalid_values_are_rejected() {
        for value in [
            serde_json::json!({"version":2}),
            serde_json::json!({"app":{"language":"en"}}),
            serde_json::json!({"app":{"theme":"unknown"}}),
            serde_json::json!({"app":{"launchPage":"unknown"}}),
            serde_json::json!({"app":{"fontSize":"huge"}}),
            serde_json::json!({"window":{"width":979}}),
            serde_json::json!({"window":{"height":639}}),
            serde_json::json!({"shortcuts":{"search":"K","save":"k"}}),
            serde_json::json!({"shortcuts":{"search":"é"}}),
            serde_json::json!({"shortcuts":{"search":"ab"}}),
            serde_json::json!({"shortcuts":{"search":""}}),
        ] {
            let config: AppConfig = serde_json::from_value(value.clone()).unwrap();
            assert!(validate_config(&config).is_err(), "accepted {value}");
        }
        for page in [
            "explore", "library", "clips", "tags", "history", "settings", "search",
        ] {
            let mut config = AppConfig::default();
            config.app.launch_page = page.into();
            validate_config(&config).unwrap();
        }
    }

    #[test]
    fn unknown_fields_survive_round_trip_and_stale_save() {
        let value = serde_json::json!({"future":{"enabled":true},"app":{"futureApp":7},"workspace":{"futureWorkspace":8},"window":{"width":1300,"futureWindow":9},"shortcuts":{"futureShortcut":10}});
        let previous: AppConfig = serde_json::from_value(value.clone()).unwrap();
        let saved = prepare_save(&previous, AppConfig::default()).unwrap();
        let encoded = serde_json::to_value(saved).unwrap();
        for (section, field) in [
            ("app", "futureApp"),
            ("workspace", "futureWorkspace"),
            ("window", "futureWindow"),
            ("shortcuts", "futureShortcut"),
        ] {
            assert_eq!(encoded[section][field], value[section][field]);
        }
        assert_eq!(encoded["future"], value["future"]);
        assert_eq!(encoded["window"]["width"], 1300);
    }

    #[test]
    fn missing_file_is_created_and_existing_file_is_not_rewritten() {
        let directory = TestDirectory::new();
        let path = directory.config_path();
        let config = read_config(&path).unwrap();
        assert_eq!(config.app.font_size, "medium");
        assert!(path.exists());
        fs::write(&path, r#"{"app":{"theme":"dark"}}"#).unwrap();
        let before = fs::read(&path).unwrap();
        assert_eq!(read_config(&path).unwrap().app.theme, "dark");
        assert_eq!(fs::read(&path).unwrap(), before);
    }

    #[test]
    fn damaged_or_invalid_file_is_never_overwritten() {
        let directory = TestDirectory::new();
        let path = directory.config_path();
        for contents in [
            "{broken",
            r#"{"version":2}"#,
            r#"{"app":{"language":"en"}}"#,
        ] {
            fs::write(&path, contents).unwrap();
            assert!(read_config(&path).is_err());
            assert_eq!(fs::read_to_string(&path).unwrap(), contents);
        }
        fs::remove_file(&path).unwrap();
        fs::create_dir(&path).unwrap();
        assert!(read_config(&path).unwrap_err().contains("无法读取配置"));
        assert!(path.is_dir());
    }

    #[test]
    fn atomic_save_validates_before_replacing_file() {
        let directory = TestDirectory::new();
        let path = directory.config_path();
        let mut config = read_config(&path).unwrap();
        let before = fs::read(&path).unwrap();
        config.version = 2;
        assert!(write_config(&path, &config).is_err());
        assert_eq!(fs::read(&path).unwrap(), before);
        config.version = 1;
        config.app.font_size = "large".into();
        write_config(&path, &config).unwrap();
        assert_eq!(read_config(&path).unwrap().app.font_size, "large");
        assert_eq!(fs::read_dir(&directory.0).unwrap().count(), 1);
    }
}
