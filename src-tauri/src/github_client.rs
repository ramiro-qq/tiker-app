//! GitHub OAuth Device Flow. Secrets never cross the Tauri IPC boundary.
use reqwest::{Client, Method, StatusCode};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use std::{
    sync::atomic::{AtomicU64, Ordering},
    time::{Duration, Instant},
};
use tauri::Manager;
use tokio::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct User {
    pub login: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Permissions {
    #[serde(default)]
    pub push: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Repository {
    pub id: u64,
    pub name: String,
    pub full_name: String,
    pub private: bool,
    pub html_url: String,
    #[serde(default)]
    pub archived: bool,
    pub permissions: Option<Permissions>,
}
impl Repository {
    fn writable(&self) -> bool {
        !self.archived && self.permissions.as_ref().is_some_and(|p| p.push)
    }
}
#[derive(Clone, Serialize, Deserialize)]
pub(crate) struct Credential {
    pub token: String,
    pub user: User,
    pub repository: Option<Repository>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    user: Option<User>,
    repository: Option<Repository>,
    authorization_available: bool,
}
/// IPC errors carry stable recovery codes; never serialize platform errors or secret bytes.
#[derive(Debug, Serialize)]
pub struct GithubError {
    code: &'static str,
    message: String,
}
impl GithubError {
    fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}
impl From<String> for GithubError {
    fn from(message: String) -> Self {
        Self::new("operation_failed", message)
    }
}
impl From<&str> for GithubError {
    fn from(message: &str) -> Self {
        Self::from(message.to_owned())
    }
}
fn credential_error(error: keyring::Error) -> GithubError {
    let (code, message) = match &error {
        keyring::Error::NoEntry => ("credential_missing", "本机 GitHub 凭据不存在，请重新授权。"),
        keyring::Error::BadEncoding(_) => (
            "credential_invalid",
            "本机 GitHub 凭据格式无效，请重新授权。",
        ),
        _ => (
            "credential_unavailable",
            "暂时无法访问系统 GitHub 凭据。请在系统权限提示中允许当前应用访问，或解锁钥匙串后重试；仍失败可重新授权。",
        ),
    };
    // Only expose numeric OSStatus, never the error's Debug representation (which may hold secrets).
    #[cfg(target_os = "macos")]
    let message = {
        use std::error::Error;
        match error
            .source()
            .and_then(|source| source.downcast_ref::<security_framework::base::Error>())
        {
            Some(platform) => format!("{message}（系统错误 {}）", platform.code()),
            None => message.to_owned(),
        }
    };
    GithubError::new(code, message)
}
/// Non-secret display view of a local synchronization connection.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct GithubConfig {
    pub initialized: bool,
    pub user: Option<User>,
    pub repository: Option<Repository>,
}
impl GithubConfig {
    fn from_credential(credential: Option<&Credential>) -> Self {
        Self {
            initialized: true,
            user: credential.map(|c| c.user.clone()),
            repository: credential.and_then(|c| c.repository.clone()),
        }
    }
    fn status(&self) -> Status {
        Status {
            user: self.user.clone(),
            repository: self.repository.clone(),
            authorization_available: !configured_client_id().is_empty(),
        }
    }
}
struct DeviceSession {
    id: u64,
    client_id: String,
    device_code: String,
    expires: Instant,
    next_poll: Instant,
    interval: u64,
    token: Option<String>,
}
#[derive(Default)]
pub struct Inner {
    session: Option<DeviceSession>,
    next_id: u64,
}
#[derive(Default)]
pub struct GithubState(Mutex<Inner>, AtomicU64);
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceCode {
    session_id: u64,
    user_code: String,
    verification_uri: String,
    expires_in: u64,
    interval: u64,
}
#[derive(Deserialize)]
struct DeviceResponse {
    device_code: String,
    user_code: String,
    verification_uri: String,
    expires_in: u64,
    interval: u64,
}
#[derive(Deserialize)]
struct TokenResponse {
    access_token: Option<String>,
    error: Option<String>,
    interval: Option<u64>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Poll {
    status: &'static str,
    interval: u64,
    account: Option<Status>,
}

fn configured_client_id() -> String {
    std::env::var("GITHUB_CLIENT_ID")
        .ok()
        .or_else(|| option_env!("GITHUB_CLIENT_ID").map(str::to_owned))
        .filter(|id| !id.trim().is_empty())
        .unwrap_or_else(|| {
            let config: serde_json::Value =
                serde_json::from_str(include_str!("../github-config.json"))
                    .expect("bundled GitHub configuration must be valid JSON");
            config["clientId"]
                .as_str()
                .unwrap_or_default()
                .trim()
                .to_owned()
        })
}
fn client() -> Result<Client, String> {
    Client::builder()
        .user_agent(concat!("Tiker/", env!("CARGO_PKG_VERSION")))
        .timeout(Duration::from_secs(20))
        .connect_timeout(Duration::from_secs(10))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "无法初始化 GitHub 客户端".into())
}
fn entry() -> Result<keyring::Entry, GithubError> {
    keyring::Entry::new("com.ai.reader.desktop.github", "oauth").map_err(credential_error)
}
/// Compatibility reader; only invoked by an explicitly pending one-time migration.
pub(crate) fn read_legacy_credential() -> Result<Option<Credential>, String> {
    match entry().map_err(|e| e.message)?.get_password() {
        Ok(value) => serde_json::from_str(&value)
            .map(Some)
            .map_err(|_| "旧 GitHub 凭据格式错误，请重新授权".into()),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(credential_error(error).message),
    }
}
impl Inner {
    fn credential(&mut self, app: &tauri::AppHandle) -> Result<Credential, GithubError> {
        crate::sync_config::credential(app)
            .map_err(|message| GithubError::new("credential_unavailable", message))?
            .ok_or_else(|| credential_error(keyring::Error::NoEntry))
    }
}
async fn decode<T: DeserializeOwned>(response: reqwest::Response) -> Result<T, GithubError> {
    let status = response.status();
    if !status.is_success() {
        return Err(match status {
            StatusCode::UNAUTHORIZED => {
                GithubError::new("unauthorized", "GitHub 授权已失效，请重新授权。")
            }
            StatusCode::FORBIDDEN | StatusCode::TOO_MANY_REQUESTS => GithubError::new(
                "forbidden",
                "GitHub 拒绝访问或请求受到限流，请检查权限后稍后重试",
            ),
            StatusCode::NOT_FOUND => "GitHub 仓库不存在或当前账号无权访问".into(),
            StatusCode::UNPROCESSABLE_ENTITY => {
                "GitHub 拒绝创建仓库，请检查名称是否已存在、格式和账号权限".into()
            }
            _ => GithubError::new("network", format!("GitHub 请求失败（HTTP {status}）")),
        });
    }
    response
        .json()
        .await
        .map_err(|_| "GitHub 返回了无法识别的数据".into())
}
// OAuth error bodies are meaningful even when GitHub responds with HTTP 400.
async fn decode_oauth(response: reqwest::Response) -> Result<serde_json::Value, GithubError> {
    let status = response.status();
    // Gateways often return HTML on outages. Classify by HTTP status before
    // decoding so the caller can retry the same device session.
    if status.is_server_error() || status == StatusCode::TOO_MANY_REQUESTS {
        return Err(GithubError::new(
            "network",
            format!("GitHub 授权服务暂不可用（HTTP {status}），正在重试"),
        ));
    }
    let value: serde_json::Value = response.json().await.map_err(network_error)?;
    if !status.is_success() && value["error"].as_str().is_none() {
        return Err(format!("GitHub 授权请求失败（HTTP {status}）").into());
    }
    Ok(value)
}
fn network_error(_: reqwest::Error) -> GithubError {
    GithubError::new("network", "连接 GitHub 失败，请检查网络或代理设置后重试")
}
async fn api<T: DeserializeOwned>(
    token: &str,
    method: Method,
    path: &str,
    body: Option<serde_json::Value>,
) -> Result<T, GithubError> {
    let mut request = client()?
        .request(method, format!("https://api.github.com{path}"))
        .bearer_auth(token)
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28");
    if let Some(body) = body {
        request = request.json(&body);
    }
    decode(request.send().await.map_err(network_error)?).await
}
fn oauth_error(error: &str) -> String {
    match error {
        "access_denied" => "你已拒绝 GitHub 授权，请重试",
        "expired_token" => "设备码已过期，请刷新设备码",
        "incorrect_client_credentials" => "Client ID 无效，请检查 GitHub OAuth App 配置",
        "device_flow_disabled" => "请在 GitHub OAuth App 设置中开启 Device Flow",
        _ => "GitHub 授权失败，请检查 OAuth App 配置后重试",
    }
    .into()
}
fn saved_config(app: &tauri::AppHandle) -> Result<GithubConfig, GithubError> {
    Ok(crate::sync_config::load_sync_settings(app.clone())?.github)
}
fn verify_account(config: &GithubConfig, credential: &Credential) -> Result<(), GithubError> {
    if !config
        .user
        .as_ref()
        .is_some_and(|saved| saved.login.eq_ignore_ascii_case(&credential.user.login))
    {
        return Err(GithubError::new(
            "account_mismatch",
            "本机凭据与保存的 GitHub 账号不一致，请重新授权确认账号。",
        ));
    }
    Ok(())
}
#[tauri::command]
pub async fn github_status(
    app: tauri::AppHandle,
    state: tauri::State<'_, GithubState>,
) -> Result<Status, GithubError> {
    let mut inner = state.0.lock().await;
    let mut credential = inner.credential(&app)?;
    let config = saved_config(&app)?;
    credential.user = api(&credential.token, Method::GET, "/user", None).await?;
    verify_account(&config, &credential)?;
    Ok(config.status())
}
#[tauri::command]
pub async fn github_begin_auth(
    state: tauri::State<'_, GithubState>,
) -> Result<DeviceCode, GithubError> {
    let mut inner = state.0.lock().await;
    inner.session = None;
    let client_id = configured_client_id();
    if client_id.is_empty() {
        return Err("GitHub 登录暂不可用，请联系应用维护者".into());
    }
    let response = client()?
        .post("https://github.com/login/device/code")
        .header("Accept", "application/json")
        .form(&[
            ("client_id", client_id.as_str()),
            ("scope", "repo read:user"),
        ])
        .send()
        .await
        .map_err(network_error)?;
    let value = decode_oauth(response).await?;
    if let Some(error) = value["error"].as_str() {
        return Err(oauth_error(error).into());
    }
    let device: DeviceResponse =
        serde_json::from_value(value).map_err(|_| "GitHub 设备码响应无效")?;
    if device.verification_uri != "https://github.com/login/device" {
        return Err("GitHub 授权地址无效".into());
    }
    inner.next_id += 1;
    let id = inner.next_id;
    let interval = device.interval.max(5);
    inner.session = Some(DeviceSession {
        id,
        client_id,
        device_code: device.device_code,
        expires: Instant::now() + Duration::from_secs(device.expires_in),
        next_poll: Instant::now() + Duration::from_secs(interval),
        interval,
        token: None,
    });
    Ok(DeviceCode {
        session_id: id,
        user_code: device.user_code,
        verification_uri: device.verification_uri,
        expires_in: device.expires_in,
        interval,
    })
}
fn poll_error(response: &TokenResponse, interval: u64) -> Result<u64, GithubError> {
    match response.error.as_deref() {
        Some("authorization_pending") => Ok(interval),
        Some("slow_down") => Ok(response.interval.unwrap_or(interval + 5).max(interval + 5)),
        Some(error) => Err(oauth_error(error).into()),
        None => Err("GitHub 未返回访问令牌".into()),
    }
}
#[tauri::command]
pub async fn github_poll_auth(
    app: tauri::AppHandle,
    state: tauri::State<'_, GithubState>,
    session_id: u64,
) -> Result<Poll, GithubError> {
    let mut inner = state.0.lock().await;
    let session = inner
        .session
        .as_mut()
        .filter(|s| s.id == session_id)
        .ok_or("授权已取消或已被新的授权替换")?;
    if session.id <= state.1.load(Ordering::SeqCst) {
        return Err("授权已取消".into());
    }
    if session.token.is_none() && Instant::now() >= session.expires {
        inner.session = None;
        return Err(oauth_error("expired_token").into());
    }
    if Instant::now() < session.next_poll {
        return Ok(Poll {
            status: "pending",
            interval: session.interval,
            account: None,
        });
    }
    let response = if let Some(token) = &session.token {
        TokenResponse {
            access_token: Some(token.clone()),
            error: None,
            interval: None,
        }
    } else {
        let result = client()?
            .post("https://github.com/login/oauth/access_token")
            .header("Accept", "application/json")
            .form(&[
                ("client_id", session.client_id.as_str()),
                ("device_code", session.device_code.as_str()),
                ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
            ])
            .send()
            .await
            .map_err(network_error);
        // Enforce spacing even after network failures or duplicate IPC calls.
        session.next_poll = Instant::now() + Duration::from_secs(session.interval);
        let response: TokenResponse = serde_json::from_value(decode_oauth(result?).await?)
            .map_err(|_| "GitHub 令牌响应无效")?;
        response
    };
    if let Some(token) = response.access_token {
        session.token = Some(token.clone());
        let user: User = api(&token, Method::GET, "/user", None).await?;
        if session_id <= state.1.load(Ordering::SeqCst) {
            inner.session = None;
            return Err("授权已取消".into());
        }
        let previous = saved_config(&app)?;
        let repository = previous
            .user
            .as_ref()
            .filter(|saved| saved.login.eq_ignore_ascii_case(&user.login))
            .and(previous.repository);
        let snapshot = GithubConfig {
            initialized: true,
            user: Some(user.clone()),
            repository,
        };
        crate::sync_config::save_github(&app, snapshot.clone(), Some(token))?;
        inner.session = None;
        Ok(Poll {
            status: "authorized",
            interval: 0,
            account: Some(snapshot.status()),
        })
    } else {
        match poll_error(&response, session.interval) {
            Ok(interval) => {
                session.interval = interval;
                session.next_poll = Instant::now() + Duration::from_secs(interval);
                Ok(Poll {
                    status: "pending",
                    interval,
                    account: None,
                })
            }
            Err(error) => {
                inner.session = None;
                Err(error)
            }
        }
    }
}
#[tauri::command]
pub async fn github_cancel_auth(
    state: tauri::State<'_, GithubState>,
    session_id: u64,
) -> Result<(), GithubError> {
    state.1.fetch_max(session_id, Ordering::SeqCst);
    let mut inner = state.0.lock().await;
    if inner.session.as_ref().is_some_and(|s| s.id == session_id) {
        inner.session = None;
    }
    Ok(())
}
#[tauri::command]
pub async fn github_list_repositories(
    app: tauri::AppHandle,
    state: tauri::State<'_, GithubState>,
) -> Result<Vec<Repository>, GithubError> {
    let mut inner = state.0.lock().await;
    let c = inner.credential(&app)?;
    verify_account(&saved_config(&app)?, &c)?;
    let mut repos = Vec::new();
    for page in 1.. {
        let batch: Vec<Repository> = api(&c.token, Method::GET, &format!("/user/repos?per_page=100&page={page}&sort=updated&affiliation=owner,collaborator,organization_member"), None).await?;
        let last = batch.len() < 100;
        repos.extend(batch.into_iter().filter(Repository::writable));
        if last {
            break;
        }
    }
    Ok(repos)
}
fn valid_repo_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 100
        && name != "."
        && name != ".."
        && name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"-_.".contains(&b))
}
fn repo_path(full_name: &str) -> Result<String, GithubError> {
    let parts: Vec<_> = full_name.split('/').collect();
    if parts.len() != 2 || !parts.iter().all(|p| valid_repo_name(p)) {
        return Err("仓库路径无效".into());
    }
    Ok(format!("/repos/{full_name}"))
}
#[tauri::command]
pub async fn github_create_repository(
    app: tauri::AppHandle,
    state: tauri::State<'_, GithubState>,
    name: String,
    description: String,
    private: bool,
) -> Result<Repository, GithubError> {
    if !valid_repo_name(&name) {
        return Err("仓库名称需为 1–100 个字母、数字、点、下划线或连字符".into());
    }
    let mut inner = state.0.lock().await;
    let c = inner.credential(&app)?;
    verify_account(&saved_config(&app)?, &c)?;
    api(&c.token, Method::POST, "/user/repos", Some(serde_json::json!({"name": name,"description": description,"private": private,"auto_init": true}))).await
}
#[tauri::command]
pub async fn github_bind_repository(
    app: tauri::AppHandle,
    state: tauri::State<'_, GithubState>,
    full_name: String,
) -> Result<Status, GithubError> {
    let path = repo_path(&full_name)?;
    let mut inner = state.0.lock().await;
    let c = inner.credential(&app)?;
    let mut snapshot = saved_config(&app)?;
    verify_account(&snapshot, &c)?;
    let repo: Repository = api(&c.token, Method::GET, &path, None).await?;
    if !repo.writable() {
        return Err("该仓库已归档或没有写入权限".into());
    }
    snapshot.repository = Some(repo);
    crate::sync_config::save_github(&app, snapshot.clone(), None)?;
    Ok(snapshot.status())
}
#[tauri::command]
pub async fn github_disconnect(
    app: tauri::AppHandle,
    state: tauri::State<'_, GithubState>,
) -> Result<(), GithubError> {
    let mut inner = state.0.lock().await;
    crate::sync_config::save_github(&app, GithubConfig::from_credential(None), None)?;
    inner.session = None;
    Ok(())
}

static SYNC_RETRY_AT: AtomicU64 = AtomicU64::new(0);
fn sync_time() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
/// Authenticated repository transport, deliberately internal to Rust.
pub(crate) struct SyncClient {
    token: String,
    pub repository: String,
    pub account_login: String,
    pub repository_id: u64,
    generation: u64,
    #[cfg(test)]
    endpoint: String,
}
impl SyncClient {
    pub async fn open(app: &tauri::AppHandle) -> Result<Self, String> {
        let generation = crate::content_sync::generation();
        let state = app.state::<GithubState>();
        let mut inner = state.0.lock().await;
        let c = inner.credential(app).map_err(|e| e.message)?;
        let config = saved_config(app).map_err(|e| e.message)?;
        verify_account(&config, &c).map_err(|e| e.message)?;
        let repo = config.repository.ok_or("请先绑定 GitHub 仓库")?;
        let path = repo_path(&repo.full_name).map_err(|e| e.message)?;
        drop(inner);
        let actual: Repository = api(&c.token, Method::GET, &path, None)
            .await
            .map_err(|e| e.message)?;
        if actual.id != repo.id {
            return Err("GitHub 仓库身份已变化（同名仓库可能已被重建），请重新绑定并预览".into());
        }
        if !actual.writable() {
            return Err("GitHub 仓库已归档或当前账号没有写权限".into());
        }
        Ok(Self {
            token: c.token,
            account_login: c.user.login,
            repository: repo.full_name,
            repository_id: repo.id,
            generation,
            #[cfg(test)]
            endpoint: "https://api.github.com".into(),
        })
    }
    pub fn still_bound(&self, app: &tauri::AppHandle) -> bool {
        self.generation == crate::content_sync::generation()
            && saved_config(app)
                .ok()
                .and_then(|c| c.repository)
                .is_some_and(|r| r.id == self.repository_id)
    }
    pub async fn request(
        &self,
        method: Method,
        suffix: &str,
        body: Option<serde_json::Value>,
    ) -> Result<serde_json::Value, String> {
        if sync_time() < SYNC_RETRY_AT.load(Ordering::Relaxed) {
            return Err("GitHub 请求受到限流，正在等待服务器指定重试时间".into());
        }
        #[cfg(test)]
        let production = self.endpoint == "https://api.github.com";
        #[cfg(not(test))]
        let production = true;
        let _publication = if production && method != Method::GET {
            Some(crate::content_sync::publication(self.generation)?)
        } else {
            None
        };
        let mut request = client()?
            .request(method, self.url(suffix))
            .bearer_auth(&self.token)
            .header("Accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", "2022-11-28");
        if let Some(body) = body {
            request = request.json(&body);
        }
        let response = request
            .send()
            .await
            .map_err(|_| "连接 GitHub 失败，请检查网络后重试")?;
        sync_decode(response).await
    }
}
impl SyncClient {
    pub async fn optional(&self, suffix: &str) -> Result<Option<serde_json::Value>, String> {
        if sync_time() < SYNC_RETRY_AT.load(Ordering::Relaxed) {
            return Err("GitHub 请求受到限流，正在等待服务器指定重试时间".into());
        }
        let response = client()?
            .get(self.url(suffix))
            .bearer_auth(&self.token)
            .header("Accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", "2022-11-28")
            .send()
            .await
            .map_err(|_| "连接 GitHub 失败")?;
        if response.status() == StatusCode::NOT_FOUND {
            return Ok(None);
        }
        sync_decode(response).await.map(Some)
    }
}

impl SyncClient {
    fn url(&self, suffix: &str) -> String {
        #[cfg(test)]
        let endpoint = &self.endpoint;
        #[cfg(not(test))]
        let endpoint = "https://api.github.com";
        format!("{endpoint}/repos/{}{suffix}", self.repository)
    }
    #[cfg(test)]
    pub(crate) fn fixture(endpoint: String) -> Self {
        Self {
            token: "fixture-only".into(),
            account_login: "fixture".into(),
            repository: "test/repo".into(),
            repository_id: 1,
            generation: crate::content_sync::generation(),
            endpoint,
        }
    }
}
async fn sync_decode(mut response: reqwest::Response) -> Result<serde_json::Value, String> {
    if matches!(
        response.status(),
        StatusCode::TOO_MANY_REQUESTS | StatusCode::FORBIDDEN
    ) {
        let seconds = response
            .headers()
            .get("retry-after")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.parse::<u64>().ok());
        let exhausted = response
            .headers()
            .get("x-ratelimit-remaining")
            .is_some_and(|v| v == "0");
        let reset = response
            .headers()
            .get("x-ratelimit-reset")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.parse::<u64>().ok());
        if let Some(delay) = seconds {
            SYNC_RETRY_AT.fetch_max(sync_time().saturating_add(delay), Ordering::Relaxed);
        } else if exhausted {
            SYNC_RETRY_AT.fetch_max(reset.unwrap_or_else(|| sync_time() + 60), Ordering::Relaxed);
        }
    }
    if !response.status().is_success() {
        return decode::<serde_json::Value>(response)
            .await
            .map_err(|e| e.message);
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| "读取 GitHub 数据失败")? {
        if bytes.len() + chunk.len() > 72 * 1024 * 1024 {
            return Err("GitHub 响应超出安全大小限制".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&bytes).map_err(|_| "GitHub 返回了无法识别的数据".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    async fn http_response(status: u16, body: &str) -> reqwest::Response {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let body = body.to_owned();
        std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0; 4096];
            let received = stream.read(&mut request).unwrap();
            assert!(received > 0);
            write!(stream, "HTTP/1.1 {status} Test\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).unwrap();
        });
        client()
            .unwrap()
            .get(format!("http://{address}"))
            .send()
            .await
            .unwrap()
    }
    #[tokio::test]
    async fn oauth_http_errors_preserve_device_flow_error_codes() {
        let value = decode_oauth(http_response(400, r#"{"error":"device_flow_disabled"}"#).await)
            .await
            .unwrap();
        assert!(oauth_error(value["error"].as_str().unwrap()).contains("Device Flow"));
        let response: TokenResponse = serde_json::from_value(
            decode_oauth(http_response(400, r#"{"error":"slow_down","interval":15}"#).await)
                .await
                .unwrap(),
        )
        .unwrap();
        assert_eq!(poll_error(&response, 5).unwrap(), 15);
        assert!(
            decode_oauth(http_response(502, "not json").await)
                .await
                .is_err()
        );
    }
    #[tokio::test]
    async fn oauth_transient_failures_can_be_retried_without_leaking_response_body() {
        for status in [429, 500, 502, 503, 504] {
            let error = decode_oauth(http_response(status, "private-secret").await)
                .await
                .unwrap_err();
            let encoded = serde_json::to_value(error).unwrap();
            assert_eq!(encoded["code"], "network");
            assert!(!encoded.to_string().contains("private-secret"));
        }
    }
    #[tokio::test]
    async fn api_errors_do_not_expose_response_secrets() {
        for status in [401, 403, 404, 422, 500] {
            let result =
                decode::<User>(http_response(status, r#"{"token":"private-secret"}"#).await).await;
            let error = result.err().unwrap();
            assert!(
                !serde_json::to_string(&error)
                    .unwrap()
                    .contains("private-secret")
            );
        }
        assert!(
            decode::<User>(http_response(200, "{}").await)
                .await
                .is_err()
        );
    }
    #[tokio::test]
    async fn revoked_token_is_distinct_from_permissions_and_network() {
        for (status, expected) in [
            (401, "unauthorized"),
            (403, "forbidden"),
            (429, "forbidden"),
            (503, "network"),
        ] {
            let error = decode::<User>(http_response(status, "{}").await)
                .await
                .err()
                .unwrap();
            assert_eq!(error.code, expected);
        }
    }
    #[test]
    fn credential_failures_are_actionable_and_do_not_leak_secret_bytes() {
        let missing = credential_error(keyring::Error::NoEntry);
        assert_eq!(missing.code, "credential_missing");
        let corrupt = credential_error(keyring::Error::BadEncoding(b"private-secret".to_vec()));
        assert_eq!(corrupt.code, "credential_invalid");
        assert!(
            !serde_json::to_string(&corrupt)
                .unwrap()
                .contains("private-secret")
        );
        #[cfg(target_os = "macos")]
        {
            let denied = credential_error(keyring::Error::PlatformFailure(Box::new(
                security_framework::base::Error::from_code(-25293),
            )));
            assert_eq!(denied.code, "credential_unavailable");
            assert!(denied.message.contains("-25293"));
        }
    }
    #[test]
    fn snapshot_cannot_authorize_a_different_keychain_account() {
        let credential = Credential {
            token: "private-secret".into(),
            user: User {
                login: "actual-user".into(),
            },
            repository: None,
        };
        let mut config = GithubConfig {
            initialized: true,
            user: Some(User {
                login: "stale-user".into(),
            }),
            repository: None,
        };
        assert_eq!(
            verify_account(&config, &credential).unwrap_err().code,
            "account_mismatch"
        );
        config.user = Some(User {
            login: "ACTUAL-USER".into(),
        });
        assert!(verify_account(&config, &credential).is_ok());
        config.user = None;
        assert!(verify_account(&config, &credential).is_err());
    }
    #[test]
    fn only_unarchived_writable_repositories_can_be_bound() {
        let mut repo: Repository = serde_json::from_value(serde_json::json!({"id":1,"name":"notes","full_name":"org/notes","private":true,"html_url":"https://github.com/org/notes","permissions":{"push":true}})).unwrap();
        assert!(repo.writable());
        repo.archived = true;
        assert!(!repo.writable());
        repo.archived = false;
        repo.permissions = None;
        assert!(!repo.writable());
        repo.permissions = Some(Permissions { push: false });
        assert!(!repo.writable());
    }
    #[test]
    fn polling_obeys_github_backoff_and_terminal_errors() {
        let response = |error: &str, interval| TokenResponse {
            access_token: None,
            error: Some(error.into()),
            interval,
        };
        assert_eq!(
            poll_error(&response("authorization_pending", None), 5).unwrap(),
            5
        );
        assert_eq!(poll_error(&response("slow_down", None), 5).unwrap(), 10);
        assert_eq!(poll_error(&response("slow_down", Some(20)), 5).unwrap(), 20);
        assert_eq!(poll_error(&response("slow_down", Some(1)), 10).unwrap(), 15);
        for error in [
            "access_denied",
            "expired_token",
            "incorrect_client_credentials",
            "device_flow_disabled",
        ] {
            assert!(poll_error(&response(error, None), 5).is_err());
        }
    }
    #[test]
    fn repository_paths_cannot_escape_api_endpoint() {
        for path in [
            "../user",
            "owner/repo?foo",
            "owner/repo/extra",
            "/repo",
            "owner/..",
            "https://evil.test",
        ] {
            assert!(repo_path(path).is_err(), "{path}");
        }
        assert!(repo_path("org/project.name-1").is_ok());
        assert!(!valid_repo_name(&"a".repeat(101)));
    }
    #[test]
    fn persisted_display_snapshot_excludes_credentials() {
        let credential = Credential {
            token: "private-secret".into(),
            user: User {
                login: "test-user".into(),
            },
            repository: None,
        };
        let snapshot = GithubConfig::from_credential(Some(&credential));
        let encoded = serde_json::to_string(&snapshot).unwrap();
        assert!(!encoded.contains("private-secret"));
        assert!(!encoded.contains("token"));
        let restored: GithubConfig = serde_json::from_str(&encoded).unwrap();
        assert!(restored.initialized);
        assert_eq!(restored.user.unwrap().login, "test-user");
        let disconnected = GithubConfig::from_credential(None);
        assert!(disconnected.initialized);
        assert!(disconnected.user.is_none());
    }
    #[test]
    fn ipc_status_never_serializes_token() {
        let credential = Credential {
            token: "private-secret".into(),
            user: User {
                login: "test".into(),
            },
            repository: None,
        };
        let json =
            serde_json::to_string(&GithubConfig::from_credential(Some(&credential)).status())
                .unwrap();
        assert!(!json.contains("private-secret"));
        assert!(!json.contains("token"));
    }
}
