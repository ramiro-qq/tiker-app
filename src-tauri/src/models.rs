use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs,
    path::Path,
    sync::{
        Mutex,
        atomic::{AtomicU64, Ordering},
    },
};
use tauri::Manager;

#[derive(Default)]
pub struct ModelState(Mutex<()>);
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Model {
    pub id: String,
    pub name: String,
    pub provider: String,
    pub base_url: String,
    pub model: String,
    #[serde(default)]
    pub configured: bool,
    #[serde(default)]
    pub status: String,
}
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelConfig {
    pub models: Vec<Model>,
    pub default_model_id: Option<String>,
    // Only the disk writer serializes credentials; IPC serialization never includes them.
    #[serde(skip)]
    api_keys: HashMap<String, String>,
}
fn path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("model.json"))
}
fn read(path: &Path) -> Result<ModelConfig, String> {
    let legacy = path.with_file_name("clip-ai.json");
    let file = if path.exists() {
        path
    } else if legacy.exists() {
        &legacy
    } else {
        return Ok(ModelConfig::default());
    };
    let value: serde_json::Value =
        serde_json::from_slice(&fs::read(file).map_err(|e| e.to_string())?)
            .map_err(|e| format!("模型配置格式错误：{e}"))?;
    if let Some(models) = value.get("models") {
        let mut api_keys = HashMap::new();
        for model in models.as_array().ok_or("模型列表格式错误")? {
            if let Some(key) = model.get("apiKey") {
                let key = key.as_str().ok_or("模型密钥字段格式错误")?;
                let id = model["id"].as_str().ok_or("模型缺少 ID")?;
                api_keys.insert(id.to_owned(), key.to_owned());
            }
        }
        let mut config: ModelConfig =
            serde_json::from_value(value).map_err(|e| format!("模型列表格式错误：{e}"))?;
        config.api_keys = api_keys;
        for model in &mut config.models {
            model.configured = config
                .api_keys
                .get(&model.id)
                .is_some_and(|key| !key.is_empty());
            if !model.configured && model.provider != "ollama" && model.status == "verified" {
                model.status = "untested".into();
            }
        }
        deduplicate(&mut config);
        return Ok(config);
    }
    let endpoint = value["endpoint"].as_str().ok_or("旧模型配置缺少接口地址")?;
    let model = value["model"].as_str().ok_or("旧模型配置缺少模型名称")?;
    if endpoint.is_empty() || model.is_empty() {
        return Ok(ModelConfig::default());
    }
    Ok(ModelConfig {
        models: vec![Model {
            id: "legacy".into(),
            name: model.into(),
            provider: "custom".into(),
            base_url: endpoint
                .trim_end_matches('/')
                .trim_end_matches("/chat/completions")
                .into(),
            model: model.into(),
            configured: value
                .get("apiKey")
                .and_then(|key| key.as_str())
                .is_some_and(|key| !key.is_empty()),
            status: String::new(),
        }],
        default_model_id: Some("legacy".into()),
        api_keys: match value.get("apiKey") {
            Some(key) => HashMap::from([(
                "legacy".into(),
                key.as_str().ok_or("模型密钥字段格式错误")?.into(),
            )]),
            None => HashMap::new(),
        },
    })
}
fn deduplicate(config: &mut ModelConfig) {
    let mut names: HashMap<String, String> = HashMap::new();
    let mut aliases = HashMap::new();
    config.models.retain(|model| {
        let name = model.name.trim().to_lowercase();
        if let Some(id) = names.get(&name) {
            aliases.insert(model.id.clone(), id.clone());
            false
        } else {
            names.insert(name, model.id.clone());
            true
        }
    });
    if let Some(id) = config
        .default_model_id
        .as_ref()
        .and_then(|id| aliases.get(id))
    {
        config.default_model_id = Some(id.clone());
    }
}
fn ensure_unique_name(config: &ModelConfig, model: &Model) -> Result<(), String> {
    if config.models.iter().any(|m| {
        m.id != model.id && m.name.trim().to_lowercase() == model.name.trim().to_lowercase()
    }) {
        return Err("显示名称已存在，请使用其他名称".into());
    }
    Ok(())
}
fn write(path: &Path, config: &ModelConfig) -> Result<(), String> {
    use std::io::Write;
    let mut value = serde_json::to_value(config).map_err(|_| "无法编码模型配置")?;
    for model in value["models"].as_array_mut().ok_or("模型列表格式错误")? {
        if let Some(key) = config
            .api_keys
            .get(model["id"].as_str().unwrap_or_default())
        {
            model["apiKey"] = serde_json::json!(key);
        }
    }
    let bytes = serde_json::to_vec_pretty(&value).map_err(|_| "无法编码模型配置")?;
    fs::create_dir_all(path.parent().ok_or("无效配置路径")?).map_err(|_| "无法创建模型配置目录")?;
    let tmp = path.with_file_name(format!(".model-{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| {
        let mut options = fs::OpenOptions::new();
        options.create_new(true).write(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&tmp).map_err(|_| "无法创建模型配置临时文件")?;
        file.write_all(&bytes).map_err(|_| "写入模型配置失败")?;
        file.sync_all().map_err(|_| "同步模型配置失败")?;
        fs::rename(&tmp, path).map_err(|_| "保存模型配置失败")?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(tmp);
    }
    result
}
// Model credentials are read exclusively from the local configuration file.
// Missing legacy credentials require explicit re-entry, never a keychain prompt.
fn local_key(file: &Path, snapshot: &Model) -> Result<String, String> {
    let config = read(file)?;
    let current = config
        .models
        .iter()
        .find(|m| m.id == snapshot.id)
        .ok_or("模型已被删除，请重新选择模型")?;
    if current != snapshot {
        return Err("模型配置已变更，请重试".into());
    }
    match config.api_keys.get(&snapshot.id) {
        Some(key) if !key.is_empty() => Ok(key.clone()),
        _ if snapshot.provider == "ollama" => Ok(String::new()),
        _ => Err(format!(
            "「{}」的本机 model.json 中未保存 API Key，请在设置 → 模型配置中编辑该模型并重新填写 API Key。",
            snapshot.name
        )),
    }
}
fn key(app: &tauri::AppHandle, model: &Model) -> Result<String, String> {
    let state = app.state::<ModelState>();
    let _guard = state.0.lock().map_err(|_| "模型配置锁不可用")?;
    local_key(&path(app)?, model)
}
pub(crate) fn normalize(mut model: Model) -> Result<Model, String> {
    model.name = model.name.trim().into();
    model.model = model.model.trim().into();
    model.base_url = model
        .base_url
        .trim()
        .trim_end_matches('/')
        .trim_end_matches("/chat/completions")
        .into();
    if model.name.is_empty() || model.model.is_empty() {
        return Err("请输入显示名称和模型 ID".into());
    }
    if !["openai", "deepseek", "qwen", "ollama", "custom"].contains(&model.provider.as_str()) {
        return Err("不支持此 Provider，请选择自定义 OpenAI 兼容接口".into());
    }
    let url = reqwest::Url::parse(&model.base_url).map_err(|_| "请输入有效的 Base URL")?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("Base URL 必须为不含账号密码、查询参数和片段的 HTTP / HTTPS 地址".into());
    }
    Ok(model)
}
pub(crate) use crate::agent::completion::complete;
#[tauri::command]
pub fn model_settings(
    app: tauri::AppHandle,
    state: tauri::State<'_, ModelState>,
) -> Result<ModelConfig, String> {
    let _guard = state.0.lock().map_err(|_| "模型配置锁不可用")?;
    read(&path(&app)?)
}
#[tauri::command]
pub async fn save_model_settings(
    app: tauri::AppHandle,
    settings: Model,
    api_key: Option<String>,
) -> Result<ModelConfig, String> {
    let mut model = normalize(settings)?;
    let before = model_settings(app.clone(), app.state::<ModelState>())?;
    ensure_unique_name(&before, &model)?;
    let existing = before.models.iter().find(|m| m.id == model.id);
    if !model.id.is_empty() && existing.is_none() {
        return Err("模型已被删除，请重新添加".into());
    }
    let api_key = match api_key.filter(|k| !k.trim().is_empty()) {
        Some(k) => k.trim().to_string(),
        None => match existing {
            Some(m) => key(&app, m)?,
            None => String::new(),
        },
    };
    if api_key.is_empty() && model.provider != "ollama" {
        return Err("请输入 API Key".into());
    }
    complete(
        &model,
        &api_key,
        serde_json::json!([{"role":"user","content":"Reply with OK."}]),
    )
    .await?;
    let state = app.state::<ModelState>();
    let _guard = state.0.lock().map_err(|_| "模型配置锁不可用")?;
    let file = path(&app)?;
    let mut config = read(&file)?;
    ensure_unique_name(&config, &model)?;
    if !model.id.is_empty() && !config.models.iter().any(|m| m.id == model.id) {
        return Err("模型已被删除，请重新添加".into());
    }
    if model.id.is_empty() {
        model.id = new_model_id();
    }
    model.configured = !api_key.is_empty();
    model.status = "verified".into();
    config.api_keys.insert(model.id.clone(), api_key);
    if config.default_model_id.is_none() {
        config.default_model_id = Some(model.id.clone());
    }
    match config.models.iter().position(|m| m.id == model.id) {
        Some(index) => config.models[index] = model.clone(),
        None => config.models.push(model.clone()),
    }
    write(&file, &config)?;
    Ok(config)
}
fn new_model_id() -> String {
    static NEXT: AtomicU64 = AtomicU64::new(0);
    format!(
        "{}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    )
}

fn duplicate_settings(config: &ModelConfig, source: &Model) -> Model {
    let mut copy = source.clone();
    copy.id = new_model_id();
    copy.name = format!("{}_copy", source.name);
    let mut suffix = 2;
    while ensure_unique_name(config, &copy).is_err() {
        copy.name = format!("{}_copy_{suffix}", source.name);
        suffix += 1;
    }
    copy
}

fn record_test_result(
    config: &mut ModelConfig,
    snapshot: &Model,
    available: bool,
) -> Result<(), String> {
    let model = config
        .models
        .iter_mut()
        .find(|m| m.id == snapshot.id)
        .ok_or("模型已被删除，请重新读取列表")?;
    if model != snapshot {
        return Err("模型配置已变更，请重新测试".into());
    }
    model.status = if available { "verified" } else { "unavailable" }.into();
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelTestResult {
    config: ModelConfig,
    error: Option<String>,
}

#[tauri::command]
pub async fn test_model(app: tauri::AppHandle, id: String) -> Result<ModelTestResult, String> {
    let before = model_settings(app.clone(), app.state::<ModelState>())?;
    let model = before
        .models
        .iter()
        .find(|m| m.id == id)
        .ok_or("模型已被删除，请重新读取列表")?;
    let result = match key(&app, model) {
        Ok(api_key) => complete(
            model,
            &api_key,
            serde_json::json!([{"role":"user","content":"Reply with OK."}]),
        )
        .await
        .map(|_| ()),
        Err(error) => Err(error),
    };
    let state = app.state::<ModelState>();
    let _guard = state.0.lock().map_err(|_| "模型配置锁不可用")?;
    let file = path(&app)?;
    let mut config = read(&file)?;
    record_test_result(&mut config, model, result.is_ok())?;
    write(&file, &config)?;
    Ok(ModelTestResult {
        config,
        error: result.err(),
    })
}

#[tauri::command]
pub fn duplicate_model(
    app: tauri::AppHandle,
    state: tauri::State<'_, ModelState>,
    id: String,
) -> Result<ModelConfig, String> {
    let _guard = state.0.lock().map_err(|_| "模型配置锁不可用")?;
    let file = path(&app)?;
    let config = read(&file)?;
    let source = config
        .models
        .iter()
        .find(|m| m.id == id)
        .ok_or("模型已被删除，请重新读取列表")?;
    let source = source.clone();
    let api_key = local_key(&file, &source)?;
    let mut config = read(&file)?;
    let copy = duplicate_settings(&config, &source);
    config.api_keys.insert(copy.id.clone(), api_key);
    config.models.push(copy);
    write(&file, &config)?;
    Ok(config)
}

#[tauri::command]
pub fn delete_model(
    app: tauri::AppHandle,
    state: tauri::State<'_, ModelState>,
    id: String,
) -> Result<ModelConfig, String> {
    let _guard = state.0.lock().map_err(|_| "模型配置锁不可用")?;
    let file = path(&app)?;
    let mut config = read(&file)?;
    config.models.retain(|m| m.id != id);
    if config.default_model_id.as_ref() == Some(&id) {
        config.default_model_id = config.models.first().map(|m| m.id.clone());
    }
    config.api_keys.remove(&id);
    write(&file, &config)?;
    Ok(config)
}
pub fn selected<'a>(
    config: &'a ModelConfig,
    id: Option<&str>,
) -> Result<Option<&'a Model>, String> {
    match id {
        Some(id) => config
            .models
            .iter()
            .find(|m| m.id == id)
            .map(Some)
            .ok_or("所选模型已被删除，请重新选择模型".into()),
        None => Ok(config
            .default_model_id
            .as_ref()
            .and_then(|id| config.models.iter().find(|m| &m.id == id))
            .or_else(|| config.models.first())),
    }
}
pub fn resolve(
    app: &tauri::AppHandle,
    id: Option<&str>,
) -> Result<Option<(Model, String)>, String> {
    let config = model_settings(app.clone(), app.state::<ModelState>())?;
    selected(&config, id)?
        .map(|m| key(app, m).map(|k| (m.clone(), k)))
        .transpose()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn missing_local_key_does_not_request_keychain_access() {
        let directory = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        fs::create_dir_all(&directory).unwrap();
        let file = directory.join("model.json");
        let mut old_model = model("https://example.com/v1");
        old_model.configured = true;
        old_model.status = "verified".into();
        write(
            &file,
            &ModelConfig {
                models: vec![old_model],
                ..Default::default()
            },
        )
        .unwrap();
        let original = fs::read(&file).unwrap();
        let config = read(&file).unwrap();
        let error = local_key(&file, &config.models[0]).unwrap_err();
        assert!(error.contains("API Key"));
        assert!(!config.models[0].configured);
        assert_eq!(config.models[0].status, "untested");
        assert_eq!(fs::read(&file).unwrap(), original);
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn local_key_survives_status_save_without_exposing_it_in_ipc() {
        let directory = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        fs::create_dir_all(&directory).unwrap();
        let file = directory.join("model.json");
        fs::write(&file, r#"{"models":[{"id":"test","name":"Local","provider":"custom","baseUrl":"https://example.com/v1","model":"test-model","configured":true,"apiKey":"fixture-local-key"}],"defaultModelId":"test"}"#).unwrap();
        let mut config = read(&file).unwrap();
        let snapshot = config.models[0].clone();
        record_test_result(&mut config, &snapshot, false).unwrap();
        write(&file, &config).unwrap();
        let disk: serde_json::Value = serde_json::from_slice(&fs::read(&file).unwrap()).unwrap();
        assert_eq!(disk["models"][0]["apiKey"], "fixture-local-key");
        let restarted = read(&file).unwrap();
        assert_eq!(restarted.models[0].status, "unavailable");
        let ipc = serde_json::to_string(&restarted).unwrap();
        assert!(!ipc.contains("fixture-local-key"));
        assert!(!ipc.contains("apiKey"));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(&file).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn explicit_key_replacement_recovers_missing_local_credentials() {
        let directory = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        fs::create_dir_all(&directory).unwrap();
        let file = directory.join("model.json");
        write(
            &file,
            &ModelConfig {
                models: vec![model("https://example.com/v1")],
                ..Default::default()
            },
        )
        .unwrap();
        let mut config = read(&file).unwrap();
        assert!(local_key(&file, &config.models[0]).is_err());
        config
            .api_keys
            .insert("test".into(), "fixture-replacement".into());
        write(&file, &config).unwrap();
        let restarted = read(&file).unwrap();
        assert!(restarted.models[0].configured);
        assert_eq!(
            local_key(&file, &restarted.models[0]).unwrap(),
            "fixture-replacement"
        );
        assert!(
            !serde_json::to_string(&restarted)
                .unwrap()
                .contains("fixture-replacement")
        );
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn legacy_file_with_inline_key_remains_usable_without_keychain() {
        let directory = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        fs::create_dir_all(&directory).unwrap();
        let file = directory.join("model.json");
        fs::write(directory.join("clip-ai.json"), r#"{"endpoint":"https://example.com/v1/chat/completions","model":"legacy-model","apiKey":"fixture-legacy-key"}"#).unwrap();
        let config = read(&file).unwrap();
        assert!(config.models[0].configured);
        assert_eq!(
            local_key(&file, &config.models[0]).unwrap(),
            "fixture-legacy-key"
        );
        assert!(!file.exists());
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn local_ollama_allows_missing_or_empty_key_without_modifying_config() {
        let directory = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        fs::create_dir_all(&directory).unwrap();
        let file = directory.join("model.json");
        for explicit_empty in [false, true] {
            let mut config = ModelConfig {
                models: vec![model("http://localhost:11434/v1")],
                ..Default::default()
            };
            config.models[0].provider = "ollama".into();
            if explicit_empty {
                config.api_keys.insert("test".into(), String::new());
            }
            write(&file, &config).unwrap();
            let original = fs::read(&file).unwrap();
            let config = read(&file).unwrap();
            assert_eq!(local_key(&file, &config.models[0]).unwrap(), "");
            assert_eq!(fs::read(&file).unwrap(), original);
        }
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn malformed_key_fails_without_echoing_secret_or_overwriting_file() {
        let directory = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        fs::create_dir_all(&directory).unwrap();
        let file = directory.join("model.json");
        let original = r#"{"models":[{"id":"test","apiKey":{"secret":"fixture-must-not-leak"}}]}"#;
        fs::write(&file, original).unwrap();
        let error = read(&file).err().unwrap();
        assert!(!error.contains("fixture-must-not-leak"));
        assert_eq!(fs::read_to_string(&file).unwrap(), original);
        fs::remove_dir_all(directory).unwrap();
    }
    fn model(base_url: &str) -> Model {
        Model {
            id: "test".into(),
            name: "测试模型".into(),
            provider: "custom".into(),
            base_url: base_url.into(),
            model: "test-model".into(),
            configured: false,
            status: String::new(),
        }
    }
    #[test]
    fn copying_preserves_configuration_with_independent_identity_and_unique_name() {
        let mut source = model("https://example.com/v1");
        source.configured = true;
        source.status = "verified".into();
        let mut config = ModelConfig {
            models: vec![source.clone()],
            default_model_id: Some(source.id.clone()),
            ..Default::default()
        };
        let copy = duplicate_settings(&config, &source);
        assert_ne!(copy.id, source.id);
        assert_eq!(copy.name, "测试模型_copy");
        assert_eq!(copy.provider, source.provider);
        assert_eq!(copy.base_url, source.base_url);
        assert_eq!(copy.model, source.model);
        assert_eq!(copy.configured, source.configured);
        assert_eq!(copy.status, source.status);
        config.models.push(copy);
        let next = duplicate_settings(&config, &source);
        assert_eq!(next.name, "测试模型_copy_2");
        assert!(ensure_unique_name(&config, &next).is_ok());
        assert_eq!(config.default_model_id, Some(source.id));
    }

    #[test]
    fn refresh_replaces_stale_status_and_persists_failure_and_recovery() {
        let directory =
            std::env::temp_dir().join(format!("tiker-refresh-test-{}", std::process::id()));
        let file = directory.join("model.json");
        let mut original = model("https://example.com/v1");
        original.status = "verified".into();
        original.configured = true;
        let mut config = ModelConfig {
            models: vec![original.clone()],
            default_model_id: Some(original.id.clone()),
            ..Default::default()
        };
        config
            .api_keys
            .insert(original.id.clone(), "fixture-refresh-key".into());
        record_test_result(&mut config, &original, false).unwrap();
        write(&file, &config).unwrap();
        assert_eq!(read(&file).unwrap().models[0].status, "unavailable");
        let snapshot = config.models[0].clone();
        record_test_result(&mut config, &snapshot, true).unwrap();
        write(&file, &config).unwrap();
        assert_eq!(read(&file).unwrap().models[0].status, "verified");
        let mut edited = original.clone();
        edited.base_url = "https://changed.example/v1".into();
        config.models[0] = edited;
        assert!(record_test_result(&mut config, &original, false).is_err());
        assert_eq!(config.models[0].status, "verified");
        config.models.clear();
        assert!(record_test_result(&mut config, &original, true).is_err());
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn names_are_unique_for_add_edit_and_old_lists() {
        let first = model("https://example.com/v1");
        let config = ModelConfig {
            models: vec![first.clone()],
            default_model_id: Some(first.id.clone()),
            ..Default::default()
        };
        let mut duplicate = first.clone();
        duplicate.id = "second".into();
        duplicate.name = format!("  {}  ", first.name);
        assert!(ensure_unique_name(&config, &duplicate).is_err());
        assert!(ensure_unique_name(&config, &first).is_ok());
        let mut old = ModelConfig {
            models: vec![first, duplicate],
            default_model_id: Some("second".into()),
            ..Default::default()
        };
        deduplicate(&mut old);
        assert_eq!(old.models.len(), 1);
        assert_eq!(old.default_model_id.as_deref(), Some("test"));
        let mut renamed = old.models[0].clone();
        renamed.id = "third".into();
        renamed.name = "Other".into();
        assert!(ensure_unique_name(&old, &renamed).is_ok());
    }
    #[test]
    fn clip_model_choice_is_explicit_and_never_silently_replaced() {
        let mut first = model("https://example.com/v1");
        first.id = "first".into();
        let mut second = first.clone();
        second.id = "second".into();
        let config = ModelConfig {
            models: vec![first, second],
            default_model_id: Some("first".into()),
            ..Default::default()
        };
        assert_eq!(selected(&config, None).unwrap().unwrap().id, "first");
        assert_eq!(
            selected(&config, Some("second")).unwrap().unwrap().id,
            "second"
        );
        assert!(selected(&config, Some("deleted")).is_err());
        assert!(selected(&ModelConfig::default(), None).unwrap().is_none());
    }
    #[test]
    fn normalizes_endpoint_and_rejects_invalid_addresses() {
        assert_eq!(
            normalize(model(" https://example.com/v1/chat/completions/ "))
                .unwrap()
                .base_url,
            "https://example.com/v1"
        );
        for url in [
            "file:///tmp/model",
            "https://user:secret@example.com/v1",
            "https://example.com/v1?key=secret",
            "https://example.com/v1#x",
            "invalid",
        ] {
            assert!(normalize(model(url)).is_err(), "accepted {url}");
        }
        let mut empty = model("https://example.com/v1");
        empty.model = "  ".into();
        assert!(normalize(empty).is_err());
    }
    #[test]
    fn legacy_migration_list_restart_and_corruption() {
        let directory =
            std::env::temp_dir().join(format!("tiker-model-test-{}", std::process::id()));
        fs::create_dir_all(&directory).unwrap();
        let file = directory.join("model.json");
        let legacy = directory.join("clip-ai.json");
        fs::write(&legacy, r#"{"endpoint":"https://example.com/v1/chat/completions","model":"old-model","configured":true}"#).unwrap();
        let mut config = read(&file).unwrap();
        assert_eq!(config.default_model_id.as_deref(), Some("legacy"));
        assert_eq!(config.models[0].base_url, "https://example.com/v1");
        assert!(!config.models[0].configured);
        config.models.push(model("http://localhost:11434/v1"));
        config.default_model_id = Some("test".into());
        write(&file, &config).unwrap();
        let restored = read(&file).unwrap();
        assert_eq!(restored.models.len(), 2);
        assert_eq!(restored.default_model_id.as_deref(), Some("test"));
        assert!(!fs::read_to_string(&file).unwrap().contains("apiKey"));
        config.models.clear();
        config.default_model_id = None;
        write(&file, &config).unwrap();
        assert!(read(&file).unwrap().models.is_empty()); // Do not resurrect the legacy file.
        fs::write(&file, "{broken").unwrap();
        assert!(read(&file).is_err());
        assert_eq!(fs::read_to_string(&file).unwrap(), "{broken");
        fs::remove_dir_all(directory).unwrap();
    }
    #[tokio::test]
    async fn connection_test_checks_actual_generation_and_sanitizes_errors() {
        use std::io::{Read, Write};
        for (status, body, success) in [
            (200, r#"{"choices":[{"message":{"content":"OK"}}]}"#, true),
            (200, r#"{"data":[{"id":"test-model"}]}"#, false),
            (401, r#"{"error":"secret-must-not-leak"}"#, false),
            (200, "invalid json", false),
        ] {
            let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            let address = listener.local_addr().unwrap();
            let server = std::thread::spawn(move || {
                let (mut stream, _) = listener.accept().unwrap();
                stream
                    .set_read_timeout(Some(Duration::from_secs(5)))
                    .unwrap();
                let mut request = Vec::new();
                let mut buffer = [0; 8192];
                loop {
                    let size = stream.read(&mut buffer).unwrap();
                    if size == 0 {
                        break;
                    }
                    request.extend_from_slice(&buffer[..size]);
                    if let Some(end) = request.windows(4).position(|w| w == b"\r\n\r\n") {
                        let headers = String::from_utf8_lossy(&request[..end]);
                        let length: usize = headers
                            .lines()
                            .find_map(|line| {
                                line.to_ascii_lowercase()
                                    .strip_prefix("content-length:")
                                    .map(|s| s.trim().parse().unwrap())
                            })
                            .unwrap_or(0);
                        if request.len() >= end + 4 + length {
                            break;
                        }
                    }
                }
                let request = String::from_utf8_lossy(&request);
                assert!(request.starts_with("POST /v1/chat/completions "));
                assert!(request.contains("test-model"));
                write!(stream, "HTTP/1.1 {status} Test\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).unwrap();
            });
            let result = complete(
                &model(&format!("http://{address}/v1")),
                "test-key",
                serde_json::json!([{"role":"user","content":"OK"}]),
            )
            .await;
            assert_eq!(result.is_ok(), success, "{result:?}");
            if let Err(error) = result {
                assert!(!error.contains("secret-must-not-leak"));
                assert!(!error.contains("test-key"));
            }
            server.join().unwrap();
        }
    }
}
