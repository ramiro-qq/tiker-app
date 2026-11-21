use super::policy::EARLY_CANCELLATIONS;
use serde::Serialize;
use std::{
    collections::{HashMap, VecDeque},
    future::Future,
    sync::Mutex,
};

#[derive(Clone, Serialize)]
pub(crate) struct LearningProgress {
    id: String,
    label: String,
    detail: String,
    state: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    kind: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    material: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    response: Option<String>,
}
#[derive(Clone, Default)]
pub(crate) struct Progress(pub(crate) Option<tauri::ipc::Channel<LearningProgress>>);
impl Progress {
    pub(crate) fn send(&self, id: &str, label: &str, state: &str, detail: impl Into<String>) {
        if let Some(channel) = &self.0 {
            let _ = channel.send(LearningProgress {
                id: id.into(),
                label: label.into(),
                state: state.into(),
                detail: detail.into(),
                kind: None,
                material: None,
                response: None,
            });
        }
    }
    pub(crate) fn material(&self, file: &super::contracts::Material, state: &str) {
        if let Some(channel) = &self.0 {
            let _ = channel.send(LearningProgress {
                id: format!("file:{}", file.name),
                label: format!("file-write   {}", file.name),
                detail: format!(
                    "{} 字符 · {}",
                    file.markdown.chars().count(),
                    if state == "done" {
                        "已校验"
                    } else {
                        "正在写入"
                    }
                ),
                state: state.into(),
                kind: Some("material".into()),
                material: serde_json::to_value(file).ok(),
                response: None,
            });
        }
    }
    pub(crate) fn response(&self, text: &str) {
        if text.trim().is_empty() {
            return;
        }
        if let Some(channel) = &self.0 {
            let _ = channel.send(LearningProgress {
                id: "formal-response".into(),
                label: "正式响应".into(),
                detail: String::new(),
                state: "running".into(),
                kind: Some("response".into()),
                material: None,
                response: Some(text.into()),
            });
        }
    }
}
#[derive(Default)]
pub(crate) struct AgentRuntime(Mutex<RequestRegistry>);
#[derive(Default)]
struct RequestRegistry {
    active: HashMap<String, tokio::sync::watch::Sender<bool>>,
    early_cancelled: VecDeque<String>,
}
pub(crate) fn cancel_request(state: &AgentRuntime, id: &str) -> Result<(), String> {
    uuid::Uuid::parse_str(id).map_err(|_| "无效请求标识")?;
    let mut registry = state.0.lock().map_err(|_| "任务状态不可用")?;
    if let Some(sender) = registry.active.get(id) {
        sender.send_replace(true);
    } else if !registry.early_cancelled.iter().any(|item| item == id) {
        // Cancellation IPC may reach the backend before the task IPC.
        registry.early_cancelled.push_back(id.to_owned());
        while registry.early_cancelled.len() > EARLY_CANCELLATIONS {
            registry.early_cancelled.pop_front();
        }
    }
    Ok(())
}
pub(crate) async fn cancellable<T>(
    state: &AgentRuntime,
    request_id: Option<String>,
    future: impl Future<Output = Result<T, String>>,
) -> Result<T, String> {
    let Some(id) = request_id else {
        return future.await;
    };
    uuid::Uuid::parse_str(&id).map_err(|_| "无效请求标识")?;
    let mut receiver = {
        let mut registry = state.0.lock().map_err(|_| "任务状态不可用")?;
        if registry.active.contains_key(&id) {
            return Err("请求已在执行".into());
        }
        if let Some(index) = registry.early_cancelled.iter().position(|item| item == &id) {
            registry.early_cancelled.remove(index);
            return Err("本轮已停止".into());
        }
        let (sender, receiver) = tokio::sync::watch::channel(false);
        registry.active.insert(id.clone(), sender);
        receiver
    };
    let result = tokio::select! {
        biased;
        _ = receiver.changed() => Err("本轮已停止".into()),
        result = future => result,
    };
    state
        .0
        .lock()
        .map_err(|_| "任务状态不可用")?
        .active
        .remove(&id);
    result
}
#[cfg(test)]
mod cancellation_tests {
    use super::*;
    #[tokio::test]
    async fn cancellation_drops_the_running_future_and_rejects_early_cancellation() {
        let state = AgentRuntime::default();
        let id = uuid::Uuid::new_v4().to_string();
        let cancel = async {
            tokio::task::yield_now().await;
            cancel_request(&state, &id).unwrap();
        };
        struct Dropped(std::sync::Arc<std::sync::atomic::AtomicBool>);
        impl Drop for Dropped {
            fn drop(&mut self) {
                self.0.store(true, std::sync::atomic::Ordering::SeqCst);
            }
        }
        let dropped = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let guard = Dropped(dropped.clone());
        let task = cancellable(&state, Some(id.clone()), async move {
            let _guard = guard;
            std::future::pending::<Result<(), String>>().await
        });
        let (result, _) = tokio::join!(task, cancel);
        assert_eq!(result.unwrap_err(), "本轮已停止");
        assert!(dropped.load(std::sync::atomic::Ordering::SeqCst));
        assert!(state.0.lock().unwrap().active.is_empty());
        let id = uuid::Uuid::new_v4().to_string();
        cancel_request(&state, &id).unwrap();
        let result = cancellable(&state, Some(id), async { Ok::<_, String>(42) }).await;
        assert_eq!(result.unwrap_err(), "本轮已停止");
    }
}
