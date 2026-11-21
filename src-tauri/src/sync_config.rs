//! Local-only synchronization connections. Disk credentials never use the IPC view.
use crate::github_client::{Credential, GithubConfig, Repository, User};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::Manager;
static LOCK: Mutex<()> = Mutex::new(());

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Credentials {
    #[serde(default)]
    access_token: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Connection {
    id: String,
    provider: String,
    account: Option<User>,
    credentials: Credentials,
    // The currently selected target for the existing repository picker.
    // Each enabled library retains its actual target and baseline in .tiker/sync.json.
    repository: Option<Repository>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Config {
    version: u8,
    auto_sync_delay_seconds: u32,
    selected_connection_id: Option<String>,
    connections: Vec<Connection>,
    #[serde(default)]
    legacy_credential_pending: bool,
}
impl Default for Config {
    fn default() -> Self {
        Self {
            version: 1,
            auto_sync_delay_seconds: 4,
            selected_connection_id: None,
            connections: Vec::new(),
            legacy_credential_pending: false,
        }
    }
}
/// Explicit public view: never return Config or Connection over IPC.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub auto_sync_delay_seconds: u32,
    pub github: GithubConfig,
}
fn validate(c: &Config) -> Result<(), String> {
    if c.version != 1 {
        return Err("不支持的同步配置版本".into());
    }
    if ![2, 4, 10].contains(&c.auto_sync_delay_seconds) {
        return Err("同步等待时间必须为 2、4 或 10 秒".into());
    }
    let mut ids = std::collections::HashSet::new();
    for connection in &c.connections {
        if connection.id.is_empty() || !ids.insert(&connection.id) {
            return Err("同步连接 ID 无效或重复".into());
        }
    }
    if c.selected_connection_id
        .as_ref()
        .is_some_and(|id| !ids.contains(id))
    {
        return Err("所选同步连接不存在".into());
    }
    Ok(())
}
fn read(file: &Path) -> Result<Config, String> {
    let bytes = fs::read(file).map_err(|_| "无法读取本机同步配置，请检查文件权限")?;
    let c = serde_json::from_slice(&bytes).map_err(|_| "本机同步配置格式错误，原文件已保留")?;
    validate(&c)?;
    Ok(c)
}
fn write(file: &Path, c: &Config) -> Result<(), String> {
    validate(c)?;
    let bytes = serde_json::to_vec_pretty(c).map_err(|_| "无法编码同步配置")?;
    fs::create_dir_all(file.parent().ok_or("无效同步配置路径")?)
        .map_err(|_| "无法创建同步配置目录")?;
    let tmp = file.with_file_name(format!(".sync-config-{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| {
        let mut options = fs::OpenOptions::new();
        options.create_new(true).write(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut handle = options.open(&tmp).map_err(|_| "无法创建同步配置临时文件")?;
        handle.write_all(&bytes).map_err(|_| "写入同步配置失败")?;
        handle.sync_all().map_err(|_| "同步配置落盘失败")?;
        fs::rename(&tmp, file).map_err(|_| "保存同步配置失败")?;
        #[cfg(unix)]
        fs::File::open(file.parent().ok_or("无效同步配置路径")?)
            .and_then(|directory| directory.sync_all())
            .map_err(|_| "同步配置目录落盘失败")?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(tmp);
    }
    result
}
pub(crate) fn path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|_| "无法定位同步配置目录")?
        .join("sync-config.json"))
}
fn github_connection(c: &Config) -> Option<&Connection> {
    c.connections
        .iter()
        .find(|x| x.provider == "github" && c.selected_connection_id.as_deref() == Some(&x.id))
}
fn snapshot(c: &Config) -> GithubConfig {
    let connection = github_connection(c);
    GithubConfig {
        // Metadata-only boot cannot claim that an orphaned legacy account is known.
        initialized: !c.legacy_credential_pending
            || connection.is_some_and(|x| x.account.is_some()),
        user: connection.and_then(|x| x.account.clone()),
        repository: connection.and_then(|x| x.repository.clone()),
    }
}
fn view(c: &Config) -> Settings {
    Settings {
        auto_sync_delay_seconds: c.auto_sync_delay_seconds,
        github: snapshot(c),
    }
}
fn set_github(c: &mut Config, state: GithubConfig, token: Option<String>) {
    if state.user.is_none() {
        c.connections.retain(|x| x.provider != "github");
        if c.selected_connection_id
            .as_ref()
            .is_some_and(|id| !c.connections.iter().any(|x| &x.id == id))
        {
            c.selected_connection_id = None;
        }
        c.legacy_credential_pending = false;
        return;
    }
    let index = c.connections.iter().position(|x| x.provider == "github");
    let index = index.unwrap_or_else(|| {
        c.connections.push(Connection {
            id: "github-main".into(),
            provider: "github".into(),
            account: None,
            credentials: Credentials::default(),
            repository: None,
        });
        c.connections.len() - 1
    });
    let connection = &mut c.connections[index];
    connection.account = state.user;
    connection.repository = state.repository;
    if let Some(token) = token {
        connection.credentials.access_token = token;
        c.legacy_credential_pending = false;
    }
    c.selected_connection_id = Some(connection.id.clone());
}
/// Run before removing legacy application fields. No keychain/network access here.
fn initialize_file(
    file: &Path,
    legacy: Option<GithubConfig>,
    delay: Option<u32>,
) -> Result<(), String> {
    if file.exists() {
        read(file)?;
        return Ok(());
    }
    let mut c = Config {
        auto_sync_delay_seconds: delay.unwrap_or(4),
        ..Default::default()
    };
    if let Some(legacy) = legacy {
        let pending = legacy.user.is_some() || !legacy.initialized;
        set_github(&mut c, legacy, None);
        c.legacy_credential_pending = pending;
    }
    write(file, &c)
}
pub(crate) fn initialize(
    app: &tauri::AppHandle,
    legacy: Option<GithubConfig>,
    delay: Option<u32>,
) -> Result<(), String> {
    let _guard = LOCK.lock().map_err(|_| "同步配置锁不可用")?;
    initialize_file(&path(app)?, legacy, delay)
}
#[tauri::command]
pub fn load_sync_settings(app: tauri::AppHandle) -> Result<Settings, String> {
    let file = path(&app)?;
    if !file.exists() {
        // Retry a failed first initialization without touching the keychain or
        // requiring local content to close. Only clean the persisted app fields
        // during a later successful application save/startup.
        let mut previous = {
            let state = app.state::<crate::ConfigState>();
            let current = state.lock().map_err(|_| "配置锁不可用")?;
            current.clone().ok_or("应用配置尚未初始化")?
        };
        crate::migrate_sync_fields(&mut previous, |legacy, delay| {
            initialize(&app, legacy, delay)
        })?;
    }
    let _guard = LOCK.lock().map_err(|_| "同步配置锁不可用")?;
    Ok(view(&read(&path(&app)?)?))
}
#[tauri::command]
pub fn save_sync_delay(app: tauri::AppHandle, seconds: u32) -> Result<Settings, String> {
    let _guard = LOCK.lock().map_err(|_| "同步配置锁不可用")?;
    let file = path(&app)?;
    let mut c = read(&file)?;
    c.auto_sync_delay_seconds = seconds;
    write(&file, &c)?;
    Ok(view(&c))
}
pub(crate) fn save_github(
    app: &tauri::AppHandle,
    state: GithubConfig,
    token: Option<String>,
) -> Result<(), String> {
    let _content = crate::content_store::LOCK
        .lock()
        .map_err(|_| "内容锁不可用")?;
    crate::content_sync::binding_writable()?;
    let _guard = LOCK.lock().map_err(|_| "同步配置锁不可用")?;
    let file = path(app)?;
    let mut c = read(&file)?;
    set_github(&mut c, state, token);
    write(&file, &c)?;
    crate::content_sync::binding_changed();
    Ok(())
}
fn credential_from_file(
    file: &Path,
    loader: impl FnOnce() -> Result<Option<Credential>, String>,
) -> Result<Option<Credential>, String> {
    let mut c = read(file)?;
    if c.legacy_credential_pending {
        let legacy = loader()?;
        if let Some(credential) = legacy {
            let saved = snapshot(&c);
            if saved
                .user
                .as_ref()
                .is_some_and(|u| !u.login.eq_ignore_ascii_case(&credential.user.login))
            {
                return Err("旧凭据与保存的 GitHub 账号不一致，请重新授权".into());
            }
            let state = GithubConfig {
                initialized: true,
                user: Some(credential.user),
                repository: saved.repository.or(credential.repository),
            };
            set_github(&mut c, state, Some(credential.token));
        } else {
            c.legacy_credential_pending = false;
        }
        write(file, &c)?;
    }
    Ok(github_connection(&c)
        .filter(|x| !x.credentials.access_token.is_empty())
        .and_then(|x| {
            x.account.clone().map(|user| Credential {
                token: x.credentials.access_token.clone(),
                user,
                repository: x.repository.clone(),
            })
        }))
}
pub(crate) fn credential(app: &tauri::AppHandle) -> Result<Option<Credential>, String> {
    let _guard = LOCK.lock().map_err(|_| "同步配置锁不可用")?;
    credential_from_file(&path(app)?, crate::github_client::read_legacy_credential)
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Directory(PathBuf);
    impl Directory {
        fn new() -> Self {
            let path =
                std::env::temp_dir().join(format!("tiker-sync-config-{}", uuid::Uuid::new_v4()));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }
        fn file(&self) -> PathBuf {
            self.0.join("sync-config.json")
        }
    }
    impl Drop for Directory {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    fn account(login: &str) -> GithubConfig {
        GithubConfig {
            initialized: true,
            user: Some(User {
                login: login.into(),
            }),
            repository: None,
        }
    }
    fn legacy() -> Credential {
        Credential {
            token: "test-only-secret".into(),
            user: User {
                login: "alice".into(),
            },
            repository: None,
        }
    }
    #[test]
    fn migrates_metadata_without_credentials_then_reads_legacy_only_once() {
        let dir = Directory::new();
        let file = dir.file();
        let mut saved = account("alice");
        saved.repository = Some(
            serde_json::from_value(serde_json::json!({
                "id":42,"name":"notes","full_name":"alice/notes","private":true,
                "html_url":"https://github.com/alice/notes"
            }))
            .unwrap(),
        );
        initialize_file(&file, Some(saved), Some(10)).unwrap();
        let metadata = read(&file).unwrap();
        assert_eq!(view(&metadata).auto_sync_delay_seconds, 10);
        assert!(metadata.legacy_credential_pending);
        assert!(
            github_connection(&metadata)
                .unwrap()
                .credentials
                .access_token
                .is_empty()
        );
        assert_eq!(
            credential_from_file(&file, || Ok(Some(legacy())))
                .unwrap()
                .unwrap()
                .token,
            "test-only-secret"
        );
        assert_eq!(
            credential_from_file(&file, || panic!("must use local file after migration"))
                .unwrap()
                .unwrap()
                .user
                .login,
            "alice"
        );
        let migrated = credential_from_file(&file, || {
            panic!("repository bind must use local credentials")
        })
        .unwrap()
        .unwrap();
        assert_eq!(migrated.repository.unwrap().id, 42);
        let mut rebound = read(&file).unwrap();
        set_github(&mut rebound, account("alice"), None);
        write(&file, &rebound).unwrap();
        assert_eq!(
            credential_from_file(&file, || panic!("rebinding must retain token"))
                .unwrap()
                .unwrap()
                .token,
            "test-only-secret"
        );
        let disk = fs::read_to_string(&file).unwrap();
        assert!(disk.contains("test-only-secret"));
        let ipc = serde_json::to_string(&view(&read(&file).unwrap())).unwrap();
        assert!(!ipc.contains("test-only-secret"));
        assert!(!ipc.contains("credentials"));
        assert!(!ipc.contains("accessToken"));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(&file).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
    }
    #[test]
    fn failed_or_mismatched_legacy_read_preserves_original_for_retry() {
        let dir = Directory::new();
        let file = dir.file();
        initialize_file(&file, Some(account("bob")), Some(4)).unwrap();
        let before = fs::read(&file).unwrap();
        assert!(credential_from_file(&file, || Err("denied".into())).is_err());
        assert_eq!(fs::read(&file).unwrap(), before);
        assert!(credential_from_file(&file, || Ok(Some(legacy()))).is_err());
        assert_eq!(fs::read(&file).unwrap(), before);
    }
    #[test]
    fn new_authorization_and_disconnect_never_resurrect_keychain_credentials() {
        let dir = Directory::new();
        let file = dir.file();
        initialize_file(&file, Some(account("alice")), Some(4)).unwrap();
        let mut c = read(&file).unwrap();
        set_github(&mut c, account("bob"), Some("new-token".into()));
        write(&file, &c).unwrap();
        assert_eq!(
            credential_from_file(&file, || panic!("new login supersedes legacy"))
                .unwrap()
                .unwrap()
                .token,
            "new-token"
        );
        c.auto_sync_delay_seconds = 2;
        write(&file, &c).unwrap();
        assert_eq!(
            credential_from_file(&file, || panic!("delay save must retain credentials"))
                .unwrap()
                .unwrap()
                .user
                .login,
            "bob"
        );
        set_github(&mut c, GithubConfig::default(), None);
        write(&file, &c).unwrap();
        // Restart initialization receives stale application metadata but the sync file owns it.
        initialize_file(&file, Some(account("alice")), Some(10)).unwrap();
        assert!(
            credential_from_file(&file, || panic!("disconnect must remain disconnected"))
                .unwrap()
                .is_none()
        );
        assert!(read(&file).unwrap().connections.is_empty());
        assert_eq!(read(&file).unwrap().auto_sync_delay_seconds, 2);
    }
    #[test]
    fn corrupt_existing_configuration_and_invalid_changes_are_not_overwritten() {
        let dir = Directory::new();
        let file = dir.file();
        fs::write(&file, "{ invalid secret bytes").unwrap();
        assert!(initialize_file(&file, None, None).is_err());
        assert_eq!(fs::read_to_string(&file).unwrap(), "{ invalid secret bytes");
        assert!(!read(&file).err().unwrap().contains("secret bytes"));
        fs::remove_file(&file).unwrap();
        initialize_file(&file, None, None).unwrap();
        assert!(view(&read(&file).unwrap()).github.initialized);
        let before = fs::read(&file).unwrap();
        let invalid = Config {
            auto_sync_delay_seconds: 3,
            ..Default::default()
        };
        assert!(write(&file, &invalid).is_err());
        assert_eq!(fs::read(&file).unwrap(), before);
    }
    #[test]
    fn missing_legacy_credential_is_checked_only_once() {
        let dir = Directory::new();
        let file = dir.file();
        initialize_file(&file, Some(GithubConfig::default()), None).unwrap();
        assert!(!view(&read(&file).unwrap()).github.initialized);
        assert!(credential_from_file(&file, || Ok(None)).unwrap().is_none());
        assert!(
            credential_from_file(&file, || panic!("missing legacy already checked"))
                .unwrap()
                .is_none()
        );
    }
}
