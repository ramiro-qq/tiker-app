//! Chat Completions transport, streamed output validation and bounded retry.
use super::policy::*;
use crate::models::{Model, normalize};
use std::time::Duration;

pub async fn complete(
    model: &Model,
    api_key: &str,
    messages: serde_json::Value,
) -> Result<String, String> {
    complete_with_timeout(model, api_key, messages, MODEL_DEFAULT_TIMEOUT_SECS).await
}
pub async fn complete_with_timeout(
    model: &Model,
    api_key: &str,
    messages: serde_json::Value,
    seconds: u64,
) -> Result<String, String> {
    let model = normalize(model.clone())?;
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(MODEL_CONNECT_TIMEOUT_SECS))
        .timeout(Duration::from_secs(seconds))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| e.to_string())?;
    let mut request = client
        .post(format!("{}/chat/completions", model.base_url))
        .json(&serde_json::json!({"model":model.model,"messages":messages,"stream":false}));
    if !api_key.is_empty() {
        request = request.bearer_auth(api_key);
    }
    let response = request.send().await.map_err(|e| {
        if e.is_timeout() {
            format!("模型响应超过 {seconds} 秒，请重试或更换模型")
        } else {
            "无法连接模型服务，请检查 Base URL 和网络".to_string()
        }
    })?;
    if !response.status().is_success() {
        return Err(completion_http_error(response.status().as_u16()));
    }
    let value: serde_json::Value = response
        .json()
        .await
        .map_err(|_| "模型服务未返回有效 JSON")?;
    check_finish_reason(&value)?;
    value["choices"][0]["message"]["content"]
        .as_str()
        .filter(|s| !s.trim().is_empty())
        .map(String::from)
        .ok_or("模型未返回有效内容，请确认接口兼容 Chat Completions".into())
}
#[cfg(test)]
mod learning_stream_tests {
    use super::*;
    #[test]
    fn streamed_completion_handles_split_utf8_and_ignores_reasoning() {
        let wire = "data: {\"choices\":[{\"delta\":{\"reasoning_content\":\"private\"}}]}\n\ndata: {\"choices\":[{\"delta\":{\"content\":\"你好\"}}]}\n\ndata: [DONE]\n\n";
        let mut stream = CompletionStream::default();
        for byte in wire.as_bytes() {
            stream.feed(&[*byte]).unwrap();
        }
        assert_eq!(stream.finish().unwrap(), "你好");
    }
    #[test]
    fn interrupted_or_error_stream_cannot_be_used_as_completed_material() {
        let mut stream = CompletionStream::default();
        stream
            .feed(b"data: {\"choices\":[{\"delta\":{\"content\":\"partial\"}}]}\n\n")
            .unwrap();
        assert!(stream.finish().is_err());
        let mut stream = CompletionStream::default();
        assert!(
            stream
                .feed(b"data: {\"error\":{\"message\":\"failed\"}}\n\n")
                .is_err()
        );
    }
    #[tokio::test]
    async fn completion_accepts_streams_and_reports_incomplete_output() {
        use std::io::{Read, Write};
        for (body, expected) in [
            (
                "data: {\"choices\":[{\"delta\":{\"content\":\"教材\"}}]}\r\n\r\ndata: {\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n",
                "教材",
            ),
            (
                "data: {\"choices\":[{\"delta\":{\"content\":\"部分教材\"},\"finish_reason\":\"length\"}]}\n\n",
                "输出长度上限",
            ),
            (
                "data: {\"choices\":[{\"delta\":{\"content\":\"部分教材\"}}]}\n\n",
                "连接中断",
            ),
            (
                r#"{"choices":[{"message":{"content":"部分教材"},"finish_reason":"length"}]}"#,
                "输出长度上限",
            ),
        ] {
            let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            let address = listener.local_addr().unwrap();
            let server = std::thread::spawn(move || {
                let (mut socket, _) = listener.accept().unwrap();
                socket
                    .set_read_timeout(Some(Duration::from_secs(5)))
                    .unwrap();
                let mut buffer = [0; 8192];
                let mut request = Vec::new();
                loop {
                    let size = socket.read(&mut buffer).unwrap();
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
                let kind = if body.starts_with("data:") {
                    "text/event-stream"
                } else {
                    "application/json"
                };
                write!(socket, "HTTP/1.1 200 OK\r\nContent-Type: {kind}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len()).unwrap();
                // Split even inside UTF-8 characters, as real network frames may do.
                for byte in body.as_bytes() {
                    socket.write_all(&[*byte]).unwrap();
                }
            });
            let model: Model = serde_json::from_value(serde_json::json!({"id":"test", "name":"Test", "provider":"custom", "baseUrl":format!("http://{address}/v1"), "model":"test-model"})).unwrap();
            let mut observed = Vec::new();
            let result =
                complete_with_progress(&model, "test-key", serde_json::json!([]), 5, |text| {
                    observed.push(text.to_owned())
                })
                .await;
            if expected == "教材" {
                assert_eq!(result.unwrap(), expected);
                assert_eq!(observed.last().map(String::as_str), Some(expected));
                assert!(
                    observed
                        .iter()
                        .all(|text| !text.contains("reasoning_content"))
                );
            } else {
                assert!(result.unwrap_err().contains(expected));
            }
            server.join().unwrap();
        }
    }
}

// Only the public content delta is assembled. Provider reasoning fields are never surfaced.
#[derive(Default)]
struct CompletionStream {
    pending: Vec<u8>,
    data: Vec<String>,
    text: String,
    done: bool,
}
impl CompletionStream {
    fn feed(&mut self, bytes: &[u8]) -> Result<(), String> {
        self.pending.extend_from_slice(bytes);
        if self.pending.len() + self.text.len() > MAX_COMPLETION_BYTES {
            return Err("模型输出过大，请缩小学习范围".into());
        }
        while let Some(end) = self.pending.iter().position(|b| *b == b'\n') {
            let line = self.pending.drain(..=end).collect::<Vec<_>>();
            let line = std::str::from_utf8(&line)
                .map_err(|_| "模型流编码无效")?
                .trim_end_matches(['\r', '\n']);
            if line.is_empty() {
                self.event()?;
            } else if let Some(data) = line.strip_prefix("data:") {
                self.data.push(data.trim_start().to_owned());
            }
        }
        Ok(())
    }
    fn event(&mut self) -> Result<(), String> {
        if self.data.is_empty() || self.done {
            return Ok(());
        }
        let raw = std::mem::take(&mut self.data).join("\n");
        if raw == "[DONE]" {
            self.done = true;
            return Ok(());
        }
        let value: serde_json::Value =
            serde_json::from_str(&raw).map_err(|_| "模型流数据格式无效")?;
        if value.get("error").is_some() {
            return Err("模型服务在输出过程中返回错误，请重试或更换模型".into());
        }
        check_finish_reason(&value)?;
        if let Some(content) = value["choices"][0]["delta"]["content"].as_str() {
            self.text.push_str(content);
        }
        Ok(())
    }
    fn finish(mut self) -> Result<String, String> {
        self.feed(b"\n\n")?;
        if !self.done || self.text.trim().is_empty() {
            return Err("模型连接中断或未返回完整内容，草稿已保留，请重试".into());
        }
        Ok(self.text)
    }
}
fn check_finish_reason(value: &serde_json::Value) -> Result<(), String> {
    match value["choices"][0]["finish_reason"].as_str() {
        Some("length") => Err(
            "模型达到输出长度上限，材料未生成完整，请缩小学习范围或更换支持更长输出的模型".into(),
        ),
        Some("content_filter") => Err("模型服务的内容过滤中止了生成，请调整学习问题后重试".into()),
        Some("tool_calls" | "function_call") => {
            Err("模型返回了工具调用，未生成完整教材，请更换兼容 Chat Completions 的模型".into())
        }
        _ => Ok(()),
    }
}
fn completion_http_error(status: u16) -> String {
    let reason = match status {
        401 | 403 => "认证失败或无访问权限，请检查 API Key 和模型权限",
        429 => "请求限流或额度不足，请稍后重试并检查服务额度",
        500..=599 => "模型服务暂时不可用，请稍后重试",
        _ => "请求被拒绝，请检查模型 ID、Base URL 和接口兼容性",
    };
    format!("模型服务返回 HTTP {status}：{reason}")
}
pub async fn complete_with_progress(
    model: &Model,
    api_key: &str,
    messages: serde_json::Value,
    seconds: u64,
    mut on_progress: impl FnMut(&str) + Send,
) -> Result<String, String> {
    let model = normalize(model.clone())?;
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(MODEL_CONNECT_TIMEOUT_SECS))
        .timeout(Duration::from_secs(seconds))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| e.to_string())?;
    let idle = Duration::from_secs(seconds.min(MODEL_IDLE_TIMEOUT_SECS));
    // Retry only transient failures BEFORE output. Never silently replay partial generations.
    let mut attempt = 0;
    let mut response = loop {
        let mut request = client
            .post(format!("{}/chat/completions", model.base_url))
            .json(&serde_json::json!({"model":model.model,"messages":messages,"stream":true}));
        if !api_key.is_empty() {
            request = request.bearer_auth(api_key);
        }
        let result = tokio::time::timeout(idle, request.send()).await;
        match result {
            Ok(Ok(response)) => {
                let status = response.status().as_u16();
                if [502, 503, 504].contains(&status) && attempt == 0 {
                    attempt += 1;
                    tokio::time::sleep(Duration::from_secs(1)).await;
                    continue;
                }
                // Older custom gateways can reject the stream parameter.
                if [400, 422, 501].contains(&status) {
                    let text = complete_with_timeout(&model, api_key, messages, seconds).await?;
                    on_progress(&text);
                    return Ok(text);
                }
                if !response.status().is_success() {
                    return Err(completion_http_error(status));
                }
                break response;
            }
            Ok(Err(e)) if e.is_connect() && attempt == 0 => {
                attempt += 1;
                tokio::time::sleep(Duration::from_secs(1)).await;
            }
            Ok(Err(e)) if e.is_timeout() => {
                return Err("等待模型响应超时，服务可能繁忙，请重试或更换模型".into());
            }
            Ok(Err(_)) => return Err("无法连接模型服务，请检查 Base URL 和网络".into()),
            Err(_) => return Err("模型连续 120 秒未响应，请重试或更换模型".into()),
        }
    };
    let streaming = response
        .headers()
        .get("content-type")
        .and_then(|s| s.to_str().ok())
        .is_some_and(|s| s.contains("text/event-stream"));
    if !streaming {
        let value: serde_json::Value = response.json().await.map_err(|e| {
            if e.is_timeout() {
                format!("模型生成超过 {seconds} 秒，材料尚未完成，请缩小学习范围或更换模型")
            } else {
                "模型响应读取失败或未返回有效 JSON，请重试".into()
            }
        })?;
        check_finish_reason(&value)?;
        let text = value["choices"][0]["message"]["content"]
            .as_str()
            .filter(|s| !s.trim().is_empty())
            .map(String::from)
            .ok_or_else(|| "模型未返回有效内容，请确认接口兼容 Chat Completions".to_string())?;
        on_progress(&text);
        return Ok(text);
    }
    let mut stream = CompletionStream::default();
    let mut reported = 0;
    loop {
        let chunk = tokio::time::timeout(idle, response.chunk())
            .await
            .map_err(|_| "模型连续 120 秒未输出，连接可能已停滞，请重试或更换模型")?
            .map_err(|e| {
                if e.is_timeout() {
                    format!("模型生成超过 {seconds} 秒，材料尚未完成，请缩小学习范围或更换模型")
                } else {
                    "模型连接中断，未收到完整材料，请重试".into()
                }
            })?;
        let Some(chunk) = chunk else {
            break;
        };
        stream.feed(&chunk)?;
        let count = stream.text.chars().count();
        if count >= reported + 200 || (reported == 0 && count > 0) {
            on_progress(&stream.text);
            reported = count;
        }
        if stream.done {
            break;
        }
    }
    let text = stream.finish()?;
    on_progress(&text);
    Ok(text)
}
