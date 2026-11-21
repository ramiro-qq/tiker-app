//! Explore IPC adapters and idempotent material archive. Agent logic lives in crate::agent.
use crate::agent::validation::safe_component;
use crate::agent::{
    contracts::*,
    learning::{generate, intent, research},
    runtime::{AgentRuntime, LearningProgress, Progress, cancel_request, cancellable},
};
use serde_json::{Value, json};
use std::{fs, io::Write, path::Path, sync::Mutex};
use tauri::Manager;

#[derive(Default)]
pub struct LearningState(pub Mutex<()>, AgentRuntime);

#[tauri::command]
pub fn learning_cancel(app: tauri::AppHandle, request_id: String) -> Result<(), String> {
    cancel_request(&app.state::<LearningState>().1, &request_id)
}
#[tauri::command]
pub async fn learning_intent(
    app: tauri::AppHandle,
    text: String,
    topic: String,
    messages: Value,
    request_id: Option<String>,
    on_progress: tauri::ipc::Channel<LearningProgress>,
    options: Option<LearningOptions>,
) -> Result<Intent, String> {
    let mut options = options.unwrap_or_default();
    options.progress = Progress(Some(on_progress));
    let state = app.state::<LearningState>();
    cancellable(
        &state.1,
        request_id,
        intent(app.clone(), text, topic, messages, options),
    )
    .await
}
#[tauri::command]
pub async fn learning_research(
    app: tauri::AppHandle,
    query: String,
    seed_urls: Option<Vec<String>>,
    messages: Option<Value>,
    options: Option<LearningOptions>,
    request_id: Option<String>,
    on_progress: tauri::ipc::Channel<LearningProgress>,
) -> Result<Research, String> {
    let mut options = options.unwrap_or_default();
    options.progress = Progress(Some(on_progress));
    let state = app.state::<LearningState>();
    cancellable(
        &state.1,
        request_id,
        research(
            app.clone(),
            query,
            seed_urls.unwrap_or_default(),
            messages.unwrap_or(json!([])),
            options,
        ),
    )
    .await
}
#[tauri::command]
#[expect(
    clippy::too_many_arguments,
    reason = "Tauri IPC keeps the existing named frontend arguments stable"
)]
pub async fn learning_generate(
    app: tauri::AppHandle,
    topic: String,
    messages: Value,
    sources: Vec<Source>,
    files: Value,
    warning: String,
    plan: Option<StudyPlan>,
    request_id: Option<String>,
    on_progress: tauri::ipc::Channel<LearningProgress>,
    options: Option<LearningOptions>,
) -> Result<Generated, String> {
    let mut options = options.unwrap_or_default();
    options.progress = Progress(Some(on_progress));
    let state = app.state::<LearningState>();
    cancellable(
        &state.1,
        request_id,
        generate(
            app.clone(),
            topic,
            messages,
            Research {
                sources,
                warning,
                plan: plan.ok_or("缺少学习大纲，请重新研究资料后再生成。")?,
            },
            files,
            options,
        ),
    )
    .await
}

fn archive_at(
    root: &Path,
    id: &str,
    title: &str,
    folders: &[String],
    markdown: &str,
) -> Result<String, String> {
    safe_component(title)?;
    if uuid::Uuid::parse_str(id).is_err() {
        return Err("材料标识无效".into());
    }
    fs::create_dir_all(root).map_err(|e| format!("无法创建资料库目录：{e}"))?;
    let root = root.canonicalize().map_err(|e| e.to_string())?;
    let mut directory = root.clone();
    for folder in folders {
        safe_component(folder)?;
        directory.push(folder);
        fs::create_dir_all(&directory).map_err(|e| format!("无法创建归档目录：{e}"))?;
        directory = directory.canonicalize().map_err(|e| e.to_string())?;
        if !directory.starts_with(&root) {
            return Err("归档目录不能位于资料库外部".into());
        }
    }
    // A per-draft receipt makes retries safe after the file write but before UI storage succeeds.
    let receipts = root.join(".tiker-learning");
    fs::create_dir_all(&receipts).map_err(|e| e.to_string())?;
    let receipts = receipts.canonicalize().map_err(|e| e.to_string())?;
    if !receipts.starts_with(&root) {
        return Err("归档记录目录不能位于资料库外部".into());
    }
    let receipt = receipts.join(format!("{id}.json"));
    if receipt.exists() {
        let saved: String = serde_json::from_slice(&fs::read(&receipt).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
        if Path::new(&saved)
            .canonicalize()
            .is_ok_and(|p| p.starts_with(&root) && p.is_file())
        {
            if fs::read_to_string(&saved).map_err(|e| e.to_string())? != markdown {
                return Err("已归档文件的内容与当前草稿不同，请先核对资料库中的文件。".into());
            }
            return Ok(saved);
        }
        return Err("已归档的文件已被移动或删除，请先恢复该文件再重试。".into());
    }
    for index in 1..1000 {
        let name = if index == 1 {
            format!("{title}.md")
        } else {
            format!("{title}（{index}）.md")
        };
        let path = directory.join(name);
        match fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
        {
            Ok(mut file) => {
                if let Err(error) = file
                    .write_all(markdown.as_bytes())
                    .and_then(|_| file.sync_all())
                {
                    let _ = fs::remove_file(&path);
                    return Err(format!("材料写入失败：{error}"));
                }
                let saved = path.to_string_lossy().into_owned();
                if let Err(error) = fs::write(&receipt, serde_json::to_vec(&saved).unwrap()) {
                    let _ = fs::remove_file(&path);
                    return Err(format!("归档记录写入失败：{error}"));
                }
                return Ok(saved);
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(format!("无法写入资料库：{error}")),
        }
    }
    Err("同名文件过多，请修改标题。".into())
}
#[tauri::command]
pub fn learning_archive(
    app: tauri::AppHandle,
    id: String,
    title: String,
    folders: Vec<String>,
    markdown: String,
) -> Result<String, String> {
    let state = app.state::<LearningState>();
    let _guard = state.0.lock().map_err(|_| "归档服务不可用")?;
    let config = crate::load_app_config(app.clone(), app.state::<crate::ConfigState>())?;
    let root = config
        .workspace
        .current_path
        .ok_or("请先在设置中选择资料库目录")?;
    archive_at(
        Path::new(&root),
        &id,
        title.trim().trim_end_matches(".md"),
        &folders,
        &markdown,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn illustrated_material_archives_as_a_portable_document() {
        let root = std::env::temp_dir().join(format!("tiker-illustrated-{}", uuid::Uuid::new_v4()));
        let card = serde_json::from_value(serde_json::json!({
            "title":"RAG 的三个关键环节", "subtitle":"从问题出发，让回答有据可查",
            "items":[{"label":"检索原文","detail":"从知识库找出与问题相关的片段"},
                {"label":"组织回答","detail":"根据检索片段解释问题，并保留来源"},
                {"label":"核对证据","detail":"检查引用是否支持结论，资料不足时明确说明"}]
        }))
        .unwrap();
        let md = crate::agent::illustrations::insert_card("# RAG 学习指南\n\n先查资料，再组织回答。\n\n## 核心原理\n检索与生成共同决定回答质量。[1]", &card).unwrap();
        let id = uuid::Uuid::new_v4().to_string();
        let saved = archive_at(&root, &id, "RAG 学习指南", &[], &md).unwrap();
        assert_eq!(fs::read_to_string(&saved).unwrap(), md);
        assert_eq!(
            archive_at(&root, &id, "RAG 学习指南", &[], &md).unwrap(),
            saved
        );
        assert!(md.contains("data:image/svg+xml;base64,"));
        // Leave the generated sample outside the repository for browser visual QA.
        fs::write(std::env::temp_dir().join("tiker-image-crafter-qa.md"), &md).unwrap();
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn archive_is_idempotent_and_does_not_overwrite() {
        let root = std::env::temp_dir().join(format!("tiker-learning-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("笔记.md"), "existing").unwrap();
        let id = uuid::Uuid::new_v4().to_string();
        let path = archive_at(&root, &id, "笔记", &[], "new").unwrap();
        assert!(path.ends_with("笔记（2）.md"));
        assert_eq!(
            archive_at(&root, &id, "重试标题", &[], "new").unwrap(),
            path
        );
        assert_eq!(
            fs::read_to_string(root.join("笔记.md")).unwrap(),
            "existing"
        );
        assert_eq!(fs::read_to_string(path).unwrap(), "new");
        assert!(
            archive_at(
                &root,
                &uuid::Uuid::new_v4().to_string(),
                "../escape",
                &[],
                "bad"
            )
            .is_err()
        );
        fs::remove_dir_all(root).unwrap();
    }
}
