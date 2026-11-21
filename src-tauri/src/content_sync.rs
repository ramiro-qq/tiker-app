//! Repository-scoped three-way content replication. Network calls never hold the content lock.
use crate::{content_store as store, github_client::SyncClient};
use base64::{Engine, engine::general_purpose::STANDARD};
use reqwest::Method;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};
use tauri::Emitter;
const LIMIT: usize = 50 * 1024 * 1024;
static RUN: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
static GENERATION: AtomicU64 = AtomicU64::new(0);
static PUBLISHING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
pub(crate) fn generation() -> u64 {
    GENERATION.load(Ordering::SeqCst)
}
pub(crate) fn binding_writable() -> Result<(), String> {
    if PUBLISHING.load(Ordering::SeqCst) {
        Err("同步正在提交最终版本，请稍后重试切换资料库或账号".into())
    } else {
        Ok(())
    }
}
pub(crate) fn binding_changed() {
    GENERATION.fetch_add(1, Ordering::SeqCst);
}
pub(crate) struct Publication;
impl Drop for Publication {
    fn drop(&mut self) {
        PUBLISHING.store(false, Ordering::SeqCst);
    }
}
pub(crate) fn publication(expected: u64) -> Result<Publication, String> {
    let _guard = store::LOCK.lock().map_err(|_| "内容锁不可用")?;
    if generation() != expected || PUBLISHING.swap(true, Ordering::SeqCst) {
        return Err("同步绑定已变化或正在提交，本轮已停止".into());
    }
    Ok(Publication)
}
static EDITED: AtomicU64 = AtomicU64::new(0);
pub(crate) fn edited() {
    EDITED.store(now(), Ordering::Relaxed);
}
fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
#[derive(Clone, Default, Serialize, Deserialize, Debug, PartialEq)]
struct Data {
    #[serde(default)]
    library: Vec<Value>,
    #[serde(default)]
    learning: Vec<Value>,
    #[serde(default)]
    clips: Vec<Value>,
    #[serde(default)]
    categories: Vec<Value>,
    #[serde(default)]
    tombstones: BTreeSet<String>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Conflict {
    id: String,
    collection: String,
    entity_id: String,
    title: String,
    base: Value,
    local: Value,
    remote: Value,
}
#[derive(Clone, Serialize, Deserialize)]
struct Decision {
    conflict: Conflict,
    choice: String,
    #[serde(default)]
    merged: Option<Value>,
}
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(default)]
struct State {
    remote_library_id: Option<String>,
    account_login: String,
    excluded_attachments: BTreeSet<String>,
    enabled: bool,
    paused: bool,
    repository: String,
    repository_id: u64,
    branch: String,
    baseline: Option<Data>,
    head: Option<String>,
    last_success: Option<u64>,
    conflicts: Vec<Conflict>,
    decisions: Vec<Decision>,
    message: String,
    blocked: Vec<String>,
    revision: u64,
    phase: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncStatus {
    remote_library_id: Option<String>,
    attachment_issues: Vec<AttachmentIssue>,
    state: String,
    message: String,
    enabled: bool,
    paused: bool,
    pending: usize,
    conflicts: Vec<Conflict>,
    last_success: Option<u64>,
    branch: Option<String>,
    library_id: String,
    blocked: Vec<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentIssue {
    entity_id: String,
    title: String,
    reason: String,
    excluded: bool,
}
fn embedded_workbook(node: &Value) -> bool {
    node["kind"] == "table"
        && (node["content"]
            .as_str()
            .is_some_and(|s| s.starts_with("xlsx:"))
            || node["rows"].is_array())
}
fn attachment_issues(
    app: &tauri::AppHandle,
    snapshot: &store::ContentSnapshot,
    state: &State,
) -> Vec<AttachmentIssue> {
    let mut issues = vec![];
    for node in &snapshot.library {
        if matches!(node["kind"].as_str(), Some("folder" | "doc")) || embedded_workbook(node) {
            continue;
        }
        let id = node["id"].as_str().unwrap_or_default();
        let excluded =
            state.excluded_attachments.contains(id) || node["attachmentExcluded"] == true;
        let reason = if let Some(grant) = node["sourceGrant"].as_str() {
            match crate::file_preview::sync_source(app, grant)
                .and_then(|p| fs::symlink_metadata(p).map_err(|_| "附件文件缺失".into()))
            {
                Ok(m) if m.file_type().is_symlink() => Some("附件不能是符号链接".into()),
                Ok(m) if m.len() > LIMIT as u64 => Some("单个附件超过 50 MiB".into()),
                Ok(m) if !m.is_file() => Some("附件不是普通文件".into()),
                Ok(_) => None,
                Err(e) => Some(e),
            }
        } else if node["attachmentHash"].is_string() {
            None
        } else {
            Some("此设备没有可上传的附件文件".into())
        };
        if reason.is_some() || excluded {
            issues.push(AttachmentIssue {
                entity_id: id.into(),
                title: node["title"].as_str().unwrap_or(id).into(),
                reason: reason.unwrap_or_else(|| "已由用户明确排除附件内容，仅同步条目".into()),
                excluded,
            });
        }
    }
    issues
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteLibrary {
    library_id: String,
    count: usize,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncPreview {
    preview_id: String,
    repository: String,
    branch: String,
    local_count: usize,
    remote_libraries: Vec<RemoteLibrary>,
    warnings: Vec<String>,
}
#[derive(Serialize, Deserialize)]
struct Preview {
    #[serde(default)]
    local_fingerprint: String,
    view: SyncPreview,
    revision: u64,
    library_id: String,
    head: String,
    repository_id: u64,
}
#[derive(Serialize, Deserialize)]
struct Attempt {
    #[serde(default)]
    proposed_commit: Option<String>,
    repository_id: u64,
    account_login: String,
    remote_library_id: String,
    base_head: Option<String>,
    baseline: Option<Data>,
    revision: u64,
    local: Data,
    merged: Data,
}
#[derive(Serialize, Deserialize)]
struct Journal {
    #[serde(default)]
    source_writes: Vec<store::SourceWrite>,
    snapshot: store::ContentSnapshot,
    state: State,
    clips: Value,
}
fn state(dir: &Path) -> Result<State, String> {
    let p = dir.join("sync.json");
    if !p.exists() {
        return Ok(State::default());
    }
    serde_json::from_slice(&fs::read(p).map_err(|e| e.to_string())?)
        .map_err(|e| format!("同步记录损坏：{e}"))
}
fn persist(dir: &Path, s: &State) -> Result<(), String> {
    store::atomic(&dir.join("sync.json"), s)
}
fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 200
        && id != "."
        && id != ".."
        && id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"-_.".contains(&c))
}
fn text<'a>(v: &'a Value, key: &str) -> Result<&'a str, String> {
    v[key]
        .as_str()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| format!("远端字段无效：{key}"))
}
fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn object_path(dir: &Path, digest: &str) -> Result<PathBuf, String> {
    if digest.len() != 64
        || !digest
            .bytes()
            .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase())
    {
        return Err("附件散列无效".into());
    }
    let objects = dir.join("objects");
    fs::create_dir_all(&objects).map_err(|e| e.to_string())?;
    if fs::symlink_metadata(&objects)
        .map_err(|e| e.to_string())?
        .file_type()
        .is_symlink()
    {
        return Err("附件目录不能是符号链接".into());
    }
    let p = objects.join(digest);
    if p.symlink_metadata()
        .is_ok_and(|m| m.file_type().is_symlink())
    {
        return Err("附件不能是符号链接".into());
    }
    Ok(p)
}
fn save_object(dir: &Path, digest: &str, bytes: &[u8]) -> Result<(), String> {
    if bytes.len() > LIMIT || hash(bytes) != digest {
        return Err("附件大小或校验值不正确".into());
    }
    let p = object_path(dir, digest)?;
    if p.exists() {
        if hash(&fs::read(&p).map_err(|e| e.to_string())?) == digest {
            return Ok(());
        }
        return Err("本地附件对象损坏".into());
    }
    let tmp = p.with_extension(uuid::Uuid::new_v4().to_string());
    use std::io::Write;
    let mut f = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&tmp)
        .map_err(|e| e.to_string())?;
    f.write_all(bytes)
        .and_then(|_| f.sync_all())
        .map_err(|e| e.to_string())?;
    fs::rename(tmp, p).map_err(|e| e.to_string())
}
fn select(v: &Value, keys: &[&str]) -> Value {
    let mut out = serde_json::Map::new();
    for k in keys {
        if let Some(v) = v.get(*k) {
            out.insert((*k).into(), v.clone());
        }
    }
    Value::Object(out)
}
fn stable_session(v: &Value) -> Value {
    let mut out = select(
        v,
        &[
            "id",
            "title",
            "createdAt",
            "updatedAt",
            "deletedAt",
            "archivedCount",
        ],
    );
    for (key, fields) in [
        ("messages", vec!["id", "role", "text", "liked"]),
        ("files", vec!["id", "name", "title", "markdown"]),
        ("sources", vec!["title", "url", "excerpt"]),
    ] {
        out[key] = json!(
            v[key]
                .as_array()
                .map(|a| a.iter().map(|x| select(x, &fields)).collect::<Vec<_>>())
                .unwrap_or_default()
        );
    }
    out
}
fn normalize_session(v: &Value) -> Value {
    let mut out = v.clone();
    let ready = v["files"].as_array().is_some_and(|a| !a.is_empty());
    for (k, val) in [
        ("status", json!(if ready { "ready" } else { "idle" })),
        ("queued", json!([])),
        ("pending", json!("")),
        ("error", json!("")),
        ("stage", json!(0)),
        ("selectedId", Value::Null),
    ] {
        out[k] = val;
    }
    out
}
fn capture_local(
    app: &tauri::AppHandle,
    dir: &Path,
    snapshot: &store::ContentSnapshot,
) -> Result<Data, String> {
    let mut library = Vec::new();
    let sync_state = state(dir)?;
    for node in &snapshot.library {
        store::check_source(dir, node)?;
        let mut n = select(
            node,
            &[
                "id",
                "title",
                "kind",
                "parentId",
                "content",
                "tags",
                "favorite",
                "createdAt",
                "updatedAt",
                "format",
                "attachmentHash",
                "attachmentName",
                "attachmentExcluded",
                "markdown",
                "rows",
            ],
        );
        if sync_state
            .excluded_attachments
            .contains(node["id"].as_str().unwrap_or_default())
            || node["attachmentExcluded"] == true
        {
            n["attachmentExcluded"] = json!(true);
            n.as_object_mut().unwrap().remove("attachmentHash");
            library.push(n);
            continue;
        }
        if let Some(grant) = node["sourceGrant"]
            .as_str()
            .filter(|_| !embedded_workbook(node))
        {
            let path = crate::file_preview::sync_source(app, grant)?;
            let bytes = crate::file_preview::sync_bytes(&path)
                .map_err(|e| format!("附件 {}：{e}", node["title"]))?;
            if n["attachmentName"].is_null() {
                n["attachmentName"] = json!(path.file_name().unwrap_or_default().to_string_lossy());
            }
            let digest = hash(&bytes);
            save_object(dir, &digest, &bytes)?;
            n["attachmentHash"] = json!(digest);
        }
        if !matches!(n["kind"].as_str(), Some("folder" | "doc"))
            && !embedded_workbook(&n)
            && n["attachmentHash"].is_null()
        {
            return Err(format!("附件未登记或缺失：{}", n["title"]));
        }
        library.push(n);
    }
    let archives = crate::clip_tasks::sync_export(app)?;
    let data = Data {
        library,
        learning: snapshot.learning["sessions"]
            .as_array()
            .ok_or("探知内容无效")?
            .iter()
            .map(stable_session)
            .collect(),
        clips: archives["tasks"].as_array().cloned().unwrap_or_default(),
        categories: archives["categories"]
            .as_array()
            .cloned()
            .unwrap_or_default(),
        tombstones: BTreeSet::new(),
    };
    validate(&data)?;
    Ok(data)
}
fn validate(d: &Data) -> Result<(), String> {
    for (name, items) in [
        ("library", &d.library),
        ("learning", &d.learning),
        ("clips", &d.clips),
        ("categories", &d.categories),
    ] {
        let mut ids = BTreeSet::new();
        for v in items {
            let id = text(v, "id")?;
            if !valid_id(id) || !ids.insert(id) {
                return Err(format!("{name} 的实体 ID 无效或重复"));
            }
        }
    }
    crate::clip_tasks::validate_sync(&d.clips, &d.categories)?;
    store::validate_hierarchy(&json!(d.library))?;
    for n in &d.library {
        if !matches!(
            n["kind"].as_str(),
            Some("folder" | "doc" | "pdf" | "image" | "table" | "attachment")
        ) || !n["title"].is_string()
        {
            return Err("资料类型或标题无效".into());
        }
        if !matches!(n["kind"].as_str(), Some("folder" | "doc"))
            && !embedded_workbook(n)
            && n["attachmentExcluded"] != true
            && n["attachmentHash"].as_str().is_none_or(|h| {
                h.len() != 64
                    || !h
                        .bytes()
                        .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase())
            })
        {
            return Err("远端附件缺少有效内容引用或明确排除标记".into());
        }
        if embedded_workbook(n)
            && n["content"]
                .as_str()
                .is_some_and(|s| s.starts_with("xlsx:"))
        {
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(&n["content"].as_str().unwrap()[5..])
                .map_err(|_| "表格内容编码无效")?;
            if !bytes.starts_with(b"PK\x03\x04") || bytes.len() > LIMIT {
                return Err("表格工作簿内容无效".into());
            }
        }
        for key in ["content", "markdown", "attachmentHash", "attachmentName"] {
            if n.get(key).is_some_and(|v| !v.is_string()) {
                return Err(format!("资料字段 {key} 必须为文本"));
            }
        }
        if n.get("tags").is_some_and(|v| {
            v.as_array()
                .is_none_or(|a| a.iter().any(|x| !x.is_string()))
        }) || n.get("favorite").is_some_and(|v| !v.is_boolean())
            || n.get("parentId")
                .is_some_and(|v| !v.is_null() && !v.is_string())
            || n.get("updatedAt").is_some_and(|v| !v.is_u64())
            || n.get("attachmentExcluded").is_some_and(|v| !v.is_boolean())
        {
            return Err("资料属性格式无效".into());
        }
        if let Some(rows) = n.get("rows")
            && rows.as_array().is_none_or(|rows| {
                rows.iter().any(|row| {
                    row.as_array()
                        .is_none_or(|cells| cells.iter().any(|v| !v.is_string()))
                })
            })
        {
            return Err("表格内容格式无效".into());
        }
        for k in [
            "sourcePath",
            "sourceGrant",
            "sourceFingerprint",
            "path",
            "token",
            "apiKey",
        ] {
            if n.get(k).is_some() {
                return Err("远端记录含本机路径或凭据字段".into());
            }
        }
    }
    for s in &d.learning {
        if stable_session(s) != *s {
            return Err("远端探知包含运行状态或未知字段".into());
        }
        if !s["messages"].is_array()
            || !s["files"].is_array()
            || !s["title"].is_string()
            || !s["createdAt"].is_u64()
            || !s["updatedAt"].is_u64()
            || !s["archivedCount"].is_u64()
        {
            return Err("探知内容格式无效".into());
        }
        for message in s["messages"].as_array().unwrap() {
            if !message["id"].is_string()
                || !message["text"].is_string()
                || !matches!(message["role"].as_str(), Some("user" | "assistant"))
                || message.get("liked").is_some_and(|v| !v.is_boolean())
            {
                return Err("探知消息格式无效".into());
            }
        }
        for file in s["files"].as_array().unwrap() {
            for key in ["id", "title", "name", "markdown"] {
                if !file[key].is_string() {
                    return Err("探知材料格式无效".into());
                }
            }
        }
        for source in s["sources"].as_array().ok_or("探知来源格式无效")? {
            for key in ["title", "url", "excerpt"] {
                if !source[key].is_string() {
                    return Err("探知来源格式无效".into());
                }
            }
        }
    }
    Ok(())
}
fn merge_collection(
    name: &str,
    b: &[Value],
    l: &[Value],
    r: &[Value],
    decisions: &[Decision],
    conflicts: &mut Vec<Conflict>,
) -> Vec<Value> {
    let map = |a: &[Value]| {
        a.iter()
            .map(|v| (v["id"].as_str().unwrap_or_default().to_owned(), v.clone()))
            .collect::<BTreeMap<_, _>>()
    };
    let (b, l, r) = (map(b), map(l), map(r));
    let ids: BTreeSet<_> = b.keys().chain(l.keys()).chain(r.keys()).cloned().collect();
    let mut out = Vec::new();
    for id in ids {
        let (bv, lv, rv) = (
            b.get(&id).unwrap_or(&Value::Null),
            l.get(&id).unwrap_or(&Value::Null),
            r.get(&id).unwrap_or(&Value::Null),
        );
        match store::merge(bv, lv, rv) {
            Ok(v) => {
                if !v.is_null() {
                    out.push(v)
                }
            }
            Err(_) => {
                let c = Conflict {
                    id: format!("{name}:{id}"),
                    collection: name.into(),
                    entity_id: id.clone(),
                    title: lv["title"]
                        .as_str()
                        .or(rv["title"].as_str())
                        .unwrap_or(&id)
                        .into(),
                    base: bv.clone(),
                    local: lv.clone(),
                    remote: rv.clone(),
                };
                if let Some(d) = decisions.iter().find(|d| {
                    d.conflict.id == c.id
                        && d.conflict.local == *lv
                        && d.conflict.remote == *rv
                        && d.conflict.base == *bv
                }) {
                    let chosen = if d.choice == "merged" {
                        d.merged.as_ref().unwrap_or(lv)
                    } else if d.choice == "remote" {
                        rv
                    } else {
                        lv
                    };
                    if !chosen.is_null() {
                        out.push(chosen.clone());
                    }
                    if d.choice == "both" && !rv.is_null() {
                        let mut copy = rv.clone();
                        copy["id"] = json!(uuid::Uuid::new_v4().to_string());
                        copy["title"] = json!(format!("{}（远端副本）", c.title));
                        out.push(copy);
                    }
                } else {
                    conflicts.push(c);
                }
            }
        }
    }
    out
}
fn merge_data(
    b: &Data,
    l: &Data,
    r: &Data,
    decisions: &[Decision],
) -> Result<(Data, Vec<Conflict>), String> {
    let mut base = b.clone();
    for (name, items, locals, remotes) in [
        ("library", &mut base.library, &l.library, &r.library),
        ("learning", &mut base.learning, &l.learning, &r.learning),
        ("clips", &mut base.clips, &l.clips, &r.clips),
    ] {
        for v in locals {
            let id = v["id"].as_str().unwrap_or_default();
            if (r.tombstones.contains(&format!("{name}:{id}"))
                || b.tombstones.contains(&format!("{name}:{id}")))
                && !items.iter().any(|x| x["id"] == id)
                && !remotes.iter().any(|x| x["id"] == id)
            {
                items.push(json!({"id":id,"deleted":true}));
            }
        }
    }
    let b = &base;
    let mut c = vec![];
    let mut out = Data {
        library: merge_collection(
            "library", &b.library, &l.library, &r.library, decisions, &mut c,
        ),
        learning: merge_collection(
            "learning",
            &b.learning,
            &l.learning,
            &r.learning,
            decisions,
            &mut c,
        ),
        clips: merge_collection("clips", &b.clips, &l.clips, &r.clips, decisions, &mut c),
        categories: merge_collection(
            "categories",
            &b.categories,
            &l.categories,
            &r.categories,
            decisions,
            &mut c,
        ),
        tombstones: b.tombstones.union(&r.tombstones).cloned().collect(),
    };
    for (name, base, merged) in [
        ("library", &b.library, &out.library),
        ("learning", &b.learning, &out.learning),
        ("clips", &b.clips, &out.clips),
    ] {
        for v in base {
            if !merged.iter().any(|m| m["id"] == v["id"]) {
                out.tombstones
                    .insert(format!("{name}:{}", v["id"].as_str().unwrap()));
            }
        }
    }
    if c.is_empty() && store::validate_hierarchy(&json!(out.library)).is_err() {
        let conflict = Conflict {
            id: "library:hierarchy".into(),
            collection: "library".into(),
            entity_id: "hierarchy".into(),
            title: "目录删除或移动冲突（选择整个目录树，保留两份会复制远端目录树）".into(),
            base: json!(b.library),
            local: json!(l.library),
            remote: json!(r.library),
        };
        if let Some(d) = decisions.iter().find(|d| {
            d.conflict.id == conflict.id
                && d.conflict.base == conflict.base
                && d.conflict.local == conflict.local
                && d.conflict.remote == conflict.remote
        }) {
            out.library = if d.choice == "remote" {
                r.library.clone()
            } else {
                l.library.clone()
            };
            if d.choice == "both" {
                let ids: BTreeMap<_, _> = r
                    .library
                    .iter()
                    .map(|v| {
                        (
                            v["id"].as_str().unwrap().to_owned(),
                            uuid::Uuid::new_v4().to_string(),
                        )
                    })
                    .collect();
                for v in &r.library {
                    let mut copy = v.clone();
                    copy["id"] = json!(ids[v["id"].as_str().unwrap()]);
                    if let Some(p) = v["parentId"].as_str() {
                        copy["parentId"] = json!(ids[p]);
                    }
                    out.library.push(copy);
                }
            }
        } else {
            c.push(conflict);
        }
    }
    if c.is_empty() {
        validate(&out)?;
    }
    Ok((out, c))
}
struct Remote {
    head: String,
    tree: String,
    entries: BTreeMap<String, String>,
}
fn encode(s: &str) -> String {
    let mut url = reqwest::Url::parse("https://github.com").unwrap();
    url.path_segments_mut().unwrap().push(s);
    url.path().trim_start_matches('/').to_owned()
}
async fn inspect(client: &SyncClient, branch: &str) -> Result<Remote, String> {
    let Some(reference) = client
        .optional(&format!("/git/ref/heads/{}", encode(branch)))
        .await?
    else {
        return Ok(Remote {
            head: String::new(),
            tree: String::new(),
            entries: BTreeMap::new(),
        });
    };
    let head = text(&reference["object"], "sha")?.to_owned();
    inspect_commit(client, &head).await
}
async fn inspect_commit(client: &SyncClient, head: &str) -> Result<Remote, String> {
    let head = head.to_owned();
    let commit = client
        .request(Method::GET, &format!("/git/commits/{head}"), None)
        .await?;
    let tree = text(&commit["tree"], "sha")?.to_owned();
    let listing = client
        .request(Method::GET, &format!("/git/trees/{tree}?recursive=1"), None)
        .await?;
    if listing["truncated"] == true {
        return Err("仓库文件清单过大，GitHub 返回不完整数据".into());
    }
    let mut entries = BTreeMap::new();
    for e in listing["tree"].as_array().ok_or("Git tree 数据无效")? {
        if e["type"] == "blob" {
            entries.insert(text(e, "path")?.into(), text(e, "sha")?.into());
        }
    }
    Ok(Remote {
        head,
        tree,
        entries,
    })
}
async fn blob(client: &SyncClient, sha: &str) -> Result<Vec<u8>, String> {
    let b = client
        .request(Method::GET, &format!("/git/blobs/{sha}"), None)
        .await?;
    if b["size"].as_u64().unwrap_or(u64::MAX) > LIMIT as u64 || b["encoding"] != "base64" {
        return Err("远端对象超出限制或编码无效".into());
    }
    let data = STANDARD
        .decode(text(&b, "content")?.split_whitespace().collect::<String>())
        .map_err(|_| "附件编码无效")?;
    if data.len() > LIMIT {
        return Err("附件超出 50 MiB".into());
    }
    Ok(data)
}
async fn remote_data(
    client: &SyncClient,
    remote: &Remote,
    id: &str,
    dir: &Path,
) -> Result<Option<Data>, String> {
    if !valid_id(id) {
        return Err("资料库 ID 无效".into());
    }
    let prefix = format!("tiker/{id}/");
    let Some(sha) = remote.entries.get(&format!("{prefix}manifest.json")) else {
        return Ok(None);
    };
    let manifest: Value =
        serde_json::from_slice(&blob(client, sha).await?).map_err(|_| "远端清单损坏")?;
    if manifest["version"] != 1 || manifest["libraryId"] != id {
        return Err("远端资料库协议或身份不匹配，请核对或升级".into());
    }
    let mut data = Data::default();
    for name in ["library", "learning", "clips", "categories"] {
        let mut values = vec![];
        for entity in manifest[name].as_array().ok_or("远端清单集合无效")? {
            let entity = entity
                .as_str()
                .filter(|id| valid_id(id))
                .ok_or("远端实体路径无效")?;
            let sha = remote
                .entries
                .get(&format!("{prefix}{name}/{entity}.json"))
                .ok_or("远端实体缺失")?;
            let value: Value =
                serde_json::from_slice(&blob(client, sha).await?).map_err(|_| "远端实体损坏")?;
            if value["id"] != entity {
                return Err("远端实体身份不匹配".into());
            }
            values.push(value);
        }
        match name {
            "library" => data.library = values,
            "learning" => data.learning = values,
            "clips" => data.clips = values,
            _ => data.categories = values,
        }
    }
    data.tombstones =
        serde_json::from_value(manifest["tombstones"].clone()).map_err(|_| "删除记录无效")?;
    validate(&data)?;
    for item in &data.library {
        if let Some(digest) = item["attachmentHash"].as_str() {
            let path = object_path(dir, digest)?;
            let sha = remote
                .entries
                .get(&format!("{prefix}attachments/{digest}"))
                .ok_or("远端附件缺失")?;
            // Verify the repository object even when a local cache exists. A cache must not
            // conceal remote corruption that would prevent another device restoring it.
            let bytes = blob(client, sha).await?;
            save_object(dir, digest, &bytes)?;
            if hash(&fs::read(path).map_err(|e| e.to_string())?) != digest {
                return Err("本地附件校验失败".into());
            }
        }
    }
    Ok(Some(data))
}
async fn upload(
    client: &SyncClient,
    remote: &Remote,
    id: &str,
    branch: &str,
    data: &Data,
    dir: &Path,
) -> Result<String, String> {
    if remote.head.is_empty() {
        let initial = json!({"version":1,"libraryId":id,"library":[],"learning":[],"clips":[],"categories":[],"tombstones":[]});
        client.request(Method::PUT,&format!("/contents/tiker/{id}/manifest.json"),Some(json!({"message":"Initialize Tiker content","content":STANDARD.encode(serde_json::to_vec(&initial).map_err(|e|e.to_string())?),"branch":branch}))).await?;
        return Err("仓库已初始化，正在重新读取远端状态".into());
    }
    let prefix = format!("tiker/{id}/");
    let mut files = BTreeMap::<String, Vec<u8>>::new();
    let mut manifest = json!({"version":1,"libraryId":id,"tombstones":data.tombstones});
    for (name, values) in [
        ("library", &data.library),
        ("learning", &data.learning),
        ("clips", &data.clips),
        ("categories", &data.categories),
    ] {
        manifest[name] = json!(values.iter().map(|v| v["id"].clone()).collect::<Vec<_>>());
        for v in values {
            files.insert(
                format!("{prefix}{name}/{}.json", text(v, "id")?),
                serde_json::to_vec(v).map_err(|e| e.to_string())?,
            );
        }
    }
    files.insert(
        format!("{prefix}manifest.json"),
        serde_json::to_vec(&manifest).map_err(|e| e.to_string())?,
    );
    for v in &data.library {
        if let Some(d) = v["attachmentHash"].as_str() {
            let p = format!("{prefix}attachments/{d}");
            if !remote.entries.contains_key(&p) {
                files.insert(
                    p,
                    fs::read(object_path(dir, d)?).map_err(|e| e.to_string())?,
                );
            }
        }
    }
    let mut changes = vec![];
    for (path, bytes) in files {
        let mut digest = sha1::Sha1::new();
        digest.update(format!("blob {}\0", bytes.len()).as_bytes());
        digest.update(&bytes);
        let git_sha = format!("{:x}", digest.finalize());
        if remote.entries.get(&path) == Some(&git_sha) {
            continue;
        }
        let b = client
            .request(
                Method::POST,
                "/git/blobs",
                Some(json!({"content":STANDARD.encode(bytes),"encoding":"base64"})),
            )
            .await?;
        let sha = text(&b, "sha")?;
        if remote.entries.get(&path).map(String::as_str) != Some(sha) {
            changes.push(json!({"path":path,"mode":"100644","type":"blob","sha":sha}));
        }
    }
    if changes.is_empty() {
        return Ok(remote.head.clone());
    }
    let tree = client
        .request(
            Method::POST,
            "/git/trees",
            Some(json!({"base_tree":remote.tree,"tree":changes})),
        )
        .await?;
    let commit=client.request(Method::POST,"/git/commits",Some(json!({"message":"Sync Tiker content","tree":text(&tree,"sha")?,"parents":[remote.head]}))).await?;
    let sha = text(&commit, "sha")?.to_owned();
    let attempt_path = dir.join("sync-attempt.json");
    if attempt_path.exists() {
        let mut attempt: Attempt =
            serde_json::from_slice(&fs::read(&attempt_path).map_err(|e| e.to_string())?)
                .map_err(|_| "同步尝试日志损坏")?;
        attempt.proposed_commit = Some(sha.clone());
        store::atomic(&attempt_path, &attempt)?;
    }
    client
        .request(
            Method::PATCH,
            &format!("/git/refs/heads/{}", encode(branch)),
            Some(json!({"sha":sha,"force":false})),
        )
        .await?;
    Ok(sha)
}
fn restore_snapshot(
    app: &tauri::AppHandle,
    dir: &Path,
    previous: &store::ContentSnapshot,
    data: &Data,
) -> Result<(store::ContentSnapshot, Vec<store::SourceWrite>), String> {
    let mut source_writes = vec![];
    let mut library = data.library.clone();
    for n in &mut library {
        for (key, value) in [
            ("content", json!("")),
            ("tags", json!([])),
            ("favorite", json!(false)),
            ("updatedAt", json!(0)),
            ("parentId", Value::Null),
        ] {
            if n.get(key).is_none() {
                n[key] = value;
            }
        }
        let old = previous.library.iter().find(|v| v["id"] == n["id"]);
        if let Some(old) = old {
            for field in ["sourcePath", "sourceFingerprint"] {
                if let Some(v) = old.get(field) {
                    n[field] = v.clone();
                }
            }
            if let Some(write) = store::materialize_source(dir, n, Some(old))? {
                source_writes.push(write);
            }
        }
        n["visitedAt"] = previous
            .library
            .iter()
            .find(|v| v["id"] == n["id"])
            .and_then(|v| v.get("visitedAt"))
            .cloned()
            .unwrap_or(json!(0));
        if n["attachmentExcluded"] == true
            && let Some(grant) = previous
                .library
                .iter()
                .find(|v| v["id"] == n["id"])
                .and_then(|v| v.get("sourceGrant"))
        {
            n["sourceGrant"] = grant.clone();
        }
        if let Some(d) = n["attachmentHash"].as_str() {
            n["sourceGrant"] = json!(crate::file_preview::sync_register(
                app,
                object_path(dir, d)?,
                n["attachmentName"]
                    .as_str()
                    .or(n["title"].as_str())
                    .unwrap_or("attachment")
            )?);
        }
    }
    let sessions: Vec<_> = data
        .learning
        .iter()
        .map(|v| {
            previous.learning["sessions"]
                .as_array()
                .and_then(|a| {
                    a.iter()
                        .find(|old| old["id"] == v["id"] && stable_session(old) == *v)
                })
                .cloned()
                .unwrap_or_else(|| normalize_session(v))
        })
        .collect();
    Ok((
        store::ContentSnapshot {
            library_id: previous.library_id.clone(),
            revision: previous.revision + 1,
            library,
            learning: json!({"sessions":sessions,"activeId":previous.learning["activeId"]}),
        },
        source_writes,
    ))
}
fn complete(app: &tauri::AppHandle, dir: &Path, journal: &Journal) -> Result<(), String> {
    store::apply_sources(dir, &journal.source_writes)?;
    crate::clip_tasks::sync_import(app, &journal.clips)?;
    store::atomic(&dir.join("content.json"), &journal.snapshot)?;
    let mut finished = journal.state.clone();
    if finished.phase == "synced" {
        finished.last_success = Some(now());
    }
    persist(dir, &finished)?;
    fs::remove_file(dir.join("sync-transaction.json")).map_err(|e| e.to_string())?;
    let _ = app.emit("content:changed", ());
    Ok(())
}
pub(crate) fn recover(app: &tauri::AppHandle, dir: &Path) -> Result<(), String> {
    let p = dir.join("sync-transaction.json");
    if p.exists() {
        let j: Journal = serde_json::from_slice(&fs::read(p).map_err(|e| e.to_string())?)
            .map_err(|_| "同步恢复日志损坏")?;
        complete(app, dir, &j)?;
    }
    Ok(())
}
#[tauri::command]
pub fn sync_status(app: tauri::AppHandle) -> Result<SyncStatus, String> {
    let dir = store::directory(&app)?;
    let mut s = state(&dir)?;
    let snapshot = store::read(&dir)?;
    {
        let connection = crate::sync_config::load_sync_settings(app.clone())?.github;
        let matches = connection
            .repository
            .as_ref()
            .is_some_and(|r| r.id == s.repository_id)
            && connection
                .user
                .as_ref()
                .is_some_and(|u| u.login.eq_ignore_ascii_case(&s.account_login));
        if s.enabled && !matches {
            s.enabled = false;
            s.message = "GitHub 账号或仓库绑定已变化，请重新预览并启用同步".into();
        }
    }
    let archives_modified = fs::metadata(dir.join("archives.json"))
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map_or(0, |d| d.as_millis() as u64);
    let pending = usize::from(
        s.baseline.is_none()
            || archives_modified > s.last_success.unwrap_or(0)
            || snapshot.revision != s.revision
            || EDITED.load(Ordering::Relaxed) > s.last_success.unwrap_or(0),
    );
    let phase = if !s.enabled {
        "disabled"
    } else if s.paused {
        "paused"
    } else if !s.conflicts.is_empty() {
        "conflict"
    } else if s.phase == "error" {
        "error"
    } else if s.phase == "syncing" {
        "syncing"
    } else if pending > 0 {
        "pending"
    } else {
        "synced"
    };
    Ok(SyncStatus {
        remote_library_id: s.remote_library_id.clone(),
        attachment_issues: attachment_issues(&app, &snapshot, &s),
        state: phase.into(),
        message: s.message,
        enabled: s.enabled,
        paused: s.paused,
        pending,
        conflicts: s.conflicts,
        last_success: s.last_success,
        branch: if s.branch.is_empty() {
            None
        } else {
            Some(s.branch)
        },
        library_id: snapshot.library_id,
        blocked: s.blocked,
    })
}
#[tauri::command]
pub async fn sync_preview(app: tauri::AppHandle) -> Result<SyncPreview, String> {
    let _run = RUN.lock().await;
    let dir = store::directory(&app)?;
    let snapshot = store::read(&dir)?;
    let client = SyncClient::open(&app).await?;
    let repo = client.request(Method::GET, "", None).await?;
    let branch = text(&repo, "default_branch")?.to_owned();
    let remote = inspect(&client, &branch).await?;
    let mut libraries = vec![];
    for p in remote.entries.keys() {
        let parts: Vec<_> = p.split('/').collect();
        if parts.len() == 3
            && parts[0] == "tiker"
            && parts[2] == "manifest.json"
            && valid_id(parts[1])
        {
            let d = remote_data(&client, &remote, parts[1], &dir)
                .await?
                .ok_or("清单不存在")?;
            libraries.push(RemoteLibrary {
                library_id: parts[1].into(),
                count: d.library.len() + d.learning.len() + d.clips.len(),
            });
        }
    }
    let mut warnings = vec![];
    if repo["private"] == false {
        warnings.push("此仓库公开，上传内容可被任何人查看".into());
    }
    let local_data = capture_local(&app, &dir, &snapshot);
    let local_fingerprint = match &local_data {
        Ok(d) => hash(&serde_json::to_vec(d).map_err(|e| e.to_string())?),
        Err(e) => {
            warnings.push(e.clone());
            String::new()
        }
    };
    let view = SyncPreview {
        preview_id: uuid::Uuid::new_v4().to_string(),
        repository: client.repository,
        branch,
        local_count: snapshot.library.len()
            + snapshot.learning["sessions"].as_array().map_or(0, Vec::len),
        remote_libraries: libraries,
        warnings,
    };
    store::atomic(
        &dir.join("sync-preview.json"),
        &Preview {
            local_fingerprint,
            view: view.clone(),
            revision: snapshot.revision,
            library_id: snapshot.library_id,
            head: remote.head,
            repository_id: client.repository_id,
        },
    )?;
    Ok(view)
}
#[tauri::command]
pub async fn sync_enable(
    app: tauri::AppHandle,
    preview_id: String,
    remote_library_id: Option<String>,
) -> Result<SyncStatus, String> {
    {
        let _run = RUN.lock().await;
        let dir = store::directory(&app)?;
        let p: Preview = serde_json::from_slice(
            &fs::read(dir.join("sync-preview.json")).map_err(|_| "请先预览同步内容")?,
        )
        .map_err(|_| "预览记录损坏")?;
        let client = SyncClient::open(&app).await?;
        let remote = inspect(&client, &p.view.branch).await?;
        let _guard = store::LOCK.lock().map_err(|_| "内容锁不可用")?;
        if store::directory(&app)? != dir || !client.still_bound(&app) {
            return Err("同步目标已变化，请重新预览".into());
        }
        let snapshot = store::read(&dir)?;
        if p.view.preview_id != preview_id
            || p.revision != snapshot.revision
            || p.library_id != snapshot.library_id
            || p.repository_id != client.repository_id
            || p.head != remote.head
        {
            return Err("内容或仓库已变化，请重新预览后启用".into());
        }
        if !p.local_fingerprint.is_empty()
            && hash(
                &serde_json::to_vec(&capture_local(&app, &dir, &snapshot)?)
                    .map_err(|e| e.to_string())?,
            ) != p.local_fingerprint
        {
            return Err("剪藏或附件已变化，请重新预览".into());
        }
        if let Some(id) = &remote_library_id {
            if !p.view.remote_libraries.iter().any(|l| l.library_id == *id) {
                return Err("远端资料库不在预览中".into());
            }
            store::atomic(&dir.join(format!("before-join-{}.json", now())), &snapshot)?;
        }
        let previous = state(&dir)?;
        if previous.enabled {
            store::atomic(
                &dir.join(format!("sync-binding-backup-{}.json", now())),
                &previous,
            )?;
        }
        let s = State {
            remote_library_id,
            account_login: client.account_login.clone(),
            enabled: true,
            repository: client.repository,
            repository_id: client.repository_id,
            branch: p.view.branch,
            phase: "pending".into(),
            ..Default::default()
        };
        persist(&dir, &s)?;
    }
    sync_now(app).await
}
async fn run(app: &tauri::AppHandle) -> Result<(), String> {
    let dir = {
        let _guard = store::LOCK.lock().map_err(|_| "内容锁不可用")?;
        let dir = store::directory(app)?;
        store::recover_content(&dir)?;
        recover(app, &dir)?;
        dir
    };
    let mut s = state(&dir)?;
    if !s.enabled || s.paused {
        return Ok(());
    }
    s.phase = "syncing".into();
    s.message = "正在比较本地与 GitHub 内容".into();
    persist(&dir, &s)?;
    let _ = app.emit("sync:changed", ());
    let client = SyncClient::open(app).await?;
    if client.repository_id != s.repository_id
        || !client.account_login.eq_ignore_ascii_case(&s.account_login)
    {
        return Err("绑定仓库已变化，请重新预览并启用同步".into());
    }
    for _ in 0..3 {
        let snapshot = store::read(&dir)?;
        let target_id = s
            .remote_library_id
            .as_deref()
            .unwrap_or(&snapshot.library_id)
            .to_owned();
        let local = capture_local(app, &dir, &snapshot)?;
        let remote = inspect(&client, &s.branch).await?;
        if let Some(old) = &s.head {
            if remote.head.is_empty() {
                return Err("远端分支已被删除，请重新核对".into());
            }
            if old != &remote.head {
                let compare = client
                    .request(
                        Method::GET,
                        &format!("/compare/{old}...{}", remote.head),
                        None,
                    )
                    .await?;
                if !matches!(compare["status"].as_str(), Some("ahead" | "identical")) {
                    return Err("远端历史已重写，请重新核对同步绑定".into());
                }
            }
        }
        let rd = remote_data(&client, &remote, &target_id, &dir).await?;
        if rd.is_none() && s.baseline.is_some() {
            return Err("远端资料库清单已被删除，请重新核对".into());
        }
        let remote_exists = rd.is_some();
        let rd = rd.unwrap_or_default();
        if s.baseline
            .as_ref()
            .is_some_and(|b| !b.tombstones.is_subset(&rd.tombstones))
        {
            return Err(
                "远端删除记录缺失，可能被手动移除；为避免已删除内容复活，请核对远端历史".into(),
            );
        }
        // A crash or timeout may occur after publishing but before the local transaction.
        // Acknowledge exact plans or a durably recorded proposed commit reachable from HEAD.
        // Rebase edits since capture on that plan; never treat unapplied downloads as deletions.
        let attempt = fs::read(dir.join("sync-attempt.json"))
            .ok()
            .and_then(|b| serde_json::from_slice::<Attempt>(&b).ok());
        if let Some(a) = attempt
            && a.repository_id == s.repository_id
            && a.account_login == s.account_login
            && a.remote_library_id == target_id
            && a.base_head == s.head
            && a.baseline == s.baseline
            && (a.local != a.merged || a.baseline.as_ref() != Some(&a.merged))
        {
            let published_head = if a.merged == rd {
                Some(remote.head.clone())
            } else if let Some(commit) = &a.proposed_commit {
                let comparison = client
                    .request(
                        Method::GET,
                        &format!("/compare/{commit}...{}", remote.head),
                        None,
                    )
                    .await?;
                if matches!(comparison["status"].as_str(), Some("ahead" | "identical")) {
                    Some(commit.clone())
                } else {
                    None
                }
            } else {
                None
            };
            if let Some(published_head) = published_head {
                let (recovered, recovery_conflicts) =
                    merge_data(&a.local, &local, &a.merged, &s.decisions)?;
                if recovery_conflicts.is_empty() {
                    let _guard = store::LOCK.lock().map_err(|_| "内容锁不可用")?;
                    if store::directory(app)? != dir || !client.still_bound(app) {
                        return Err("同步目标已变化，本轮已停止".into());
                    }
                    let current = store::read(&dir)?;
                    if current.revision != snapshot.revision
                        || capture_local(app, &dir, &current)? != local
                    {
                        continue;
                    }
                    crate::clip_tasks::sync_check_import(
                        app,
                        &recovered.clips,
                        &recovered.categories,
                    )?;
                    let (next, source_writes) = restore_snapshot(app, &dir, &current, &recovered)?;
                    s.baseline = Some(a.merged);
                    s.head = Some(published_head);
                    s.phase = "pending".into();
                    s.message = "已恢复远端已提交事务，继续同步新修改".into();
                    let j = Journal {
                        source_writes,
                        snapshot: next,
                        state: s.clone(),
                        clips: json!({"tasks":recovered.clips,"categories":recovered.categories}),
                    };
                    store::atomic(&dir.join("sync-transaction.json"), &j)?;
                    complete(app, &dir, &j)?;
                    let _ = fs::remove_file(dir.join("sync-attempt.json"));
                    continue;
                }
            }
        }
        let (merged, conflicts) = merge_data(
            s.baseline.as_ref().unwrap_or(&Data::default()),
            &local,
            &rd,
            &s.decisions,
        )?;
        if !conflicts.is_empty() {
            let fingerprint = hash(&serde_json::to_vec(&conflicts).map_err(|e| e.to_string())?);
            store::atomic(
                &dir.join("conflict-backups")
                    .join(format!("{fingerprint}.json")),
                &conflicts,
            )?;
            s.conflicts = conflicts;
            s.phase = "conflict".into();
            s.message = "内容冲突，原始版本已保留".into();
            persist(&dir, &s)?;
            return Ok(());
        }
        if store::directory(app)? != dir || !client.still_bound(app) {
            return Err("同步目标已变化，本轮已停止".into());
        }
        crate::clip_tasks::sync_check_import(app, &merged.clips, &merged.categories)?;
        // Persist the compared versions before any remote ref update. Re-reading after an ambiguous
        // response converges on this same three-way merge without overwriting newer local edits.
        store::atomic(
            &dir.join("sync-attempt.json"),
            &Attempt {
                proposed_commit: None,
                repository_id: s.repository_id,
                account_login: s.account_login.clone(),
                remote_library_id: target_id.clone(),
                base_head: s.head.clone(),
                baseline: s.baseline.clone(),
                revision: snapshot.revision,
                local: local.clone(),
                merged: merged.clone(),
            },
        )?;
        let head = if merged != rd || !remote_exists {
            match upload(&client, &remote, &target_id, &s.branch, &merged, &dir).await {
                Ok(h) => h,
                Err(e) => {
                    let newest = inspect(&client, &s.branch).await?;
                    if newest.head != remote.head {
                        continue;
                    }
                    return Err(e);
                }
            }
        } else {
            remote.head
        };
        let _guard = store::LOCK.lock().map_err(|_| "内容锁不可用")?;
        if store::directory(app)? != dir || !client.still_bound(app) {
            return Err("同步目标已变化，本轮已停止".into());
        }
        let current = store::read(&dir)?;
        if current.revision != snapshot.revision {
            continue;
        }
        // Archives are separately locked; ensure background clipping has not changed the captured content.
        if capture_local(app, &dir, &current)? != local {
            continue;
        }
        crate::clip_tasks::sync_check_import(app, &merged.clips, &merged.categories)?;
        let requires_import = merged.library != local.library
            || merged.learning != local.learning
            || merged.clips != local.clips
            || merged.categories != local.categories
            || current
                .library
                .iter()
                .any(|v| v.get("sourceGrant").is_some() && v.get("attachmentHash").is_none());
        let (next, source_writes) = if requires_import {
            restore_snapshot(app, &dir, &current, &merged)?
        } else {
            (current, vec![])
        };
        s.baseline = Some(merged.clone());
        s.head = Some(head);
        s.revision = next.revision;
        s.last_success = Some(now());
        s.conflicts.clear();
        s.decisions.clear();
        s.blocked.clear();
        s.message = "内容已与 GitHub 同步".into();
        s.phase = "synced".into();
        if !requires_import {
            persist(&dir, &s)?;
            let _ = fs::remove_file(dir.join("sync-attempt.json"));
            return Ok(());
        }
        let j = Journal {
            source_writes,
            snapshot: next,
            state: s,
            clips: json!({"tasks":merged.clips,"categories":merged.categories}),
        };
        store::atomic(&dir.join("sync-transaction.json"), &j)?;
        complete(app, &dir, &j)?;
        let _ = fs::remove_file(dir.join("sync-attempt.json"));
        return Ok(());
    }
    Err("内容持续变化，已保留修改，稍后重试同步".into())
}
#[tauri::command]
pub async fn sync_now(app: tauri::AppHandle) -> Result<SyncStatus, String> {
    let _run = RUN.lock().await;
    let dir = store::directory(&app)?;
    if let Err(e) = run(&app).await {
        let mut s = state(&dir)?;
        s.phase = "error".into();
        s.message = e.clone();
        s.blocked = vec![e];
        persist(&dir, &s)?;
    }
    let _ = app.emit("sync:changed", ());
    sync_status(app)
}
#[tauri::command]
pub async fn sync_pause(app: tauri::AppHandle, paused: bool) -> Result<SyncStatus, String> {
    let _run = RUN.lock().await;
    let dir = store::directory(&app)?;
    let mut s = state(&dir)?;
    s.paused = paused;
    persist(&dir, &s)?;
    let _ = app.emit("sync:changed", ());
    sync_status(app)
}
#[tauri::command]
pub fn sync_conflicts(app: tauri::AppHandle) -> Result<Vec<Conflict>, String> {
    Ok(state(&store::directory(&app)?)?.conflicts)
}
#[tauri::command]
pub async fn sync_resolve(
    app: tauri::AppHandle,
    conflict_id: String,
    choice: String,
    merged: Option<Value>,
) -> Result<SyncStatus, String> {
    if !matches!(choice.as_str(), "local" | "remote" | "both" | "merged") {
        return Err("无效冲突选择".into());
    }
    {
        let _run = RUN.lock().await;
        let dir = store::directory(&app)?;
        let mut s = state(&dir)?;
        let c = s
            .conflicts
            .iter()
            .find(|c| c.id == conflict_id)
            .cloned()
            .ok_or("冲突已变化，请重新加载")?;
        if choice == "merged"
            && merged
                .as_ref()
                .is_none_or(|v| v["id"] != c.entity_id || !v.is_object())
        {
            return Err("合并结果必须保留原实体 ID".into());
        }
        s.decisions.retain(|d| d.conflict.id != conflict_id);
        s.decisions.push(Decision {
            conflict: c,
            choice,
            merged,
        });
        persist(&dir, &s)?;
    }
    sync_now(app).await
}
#[tauri::command]
pub async fn sync_exclude_attachment(
    app: tauri::AppHandle,
    entity_id: String,
    excluded: bool,
) -> Result<SyncStatus, String> {
    let _run = RUN.lock().await;
    let _guard = store::LOCK.lock().map_err(|_| "内容锁不可用")?;
    let dir = store::directory(&app)?;
    let mut s = state(&dir)?;
    let mut snapshot = store::read(&dir)?;
    let node = snapshot
        .library
        .iter_mut()
        .find(|v| v["id"] == entity_id)
        .ok_or("附件不存在")?;
    if matches!(node["kind"].as_str(), Some("folder" | "doc")) || embedded_workbook(node) {
        return Err("该条目不是附件".into());
    }
    if excluded {
        s.excluded_attachments.insert(entity_id);
        node["attachmentExcluded"] = json!(true);
    } else {
        s.excluded_attachments.remove(&entity_id);
        node.as_object_mut()
            .ok_or("附件格式无效")?
            .remove("attachmentExcluded");
    }
    snapshot.revision += 1;
    s.phase = "pending".into();
    s.blocked.clear();
    s.message = "附件同步范围已更新".into();
    store::atomic(&dir.join("content.json"), &snapshot)?;
    persist(&dir, &s)?;
    edited();
    let _ = app.emit("content:changed", ());
    let _ = app.emit("sync:changed", ());
    sync_status(app)
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryItem {
    sha: String,
    message: String,
    created_at: u64,
}
#[tauri::command]
pub async fn sync_history(app: tauri::AppHandle) -> Result<Vec<HistoryItem>, String> {
    let _run = RUN.lock().await;
    let dir = store::directory(&app)?;
    let s = state(&dir)?;
    let snapshot = store::read(&dir)?;
    if !s.enabled {
        return Err("请先完成首次同步以查看远端版本历史".into());
    }
    let client = SyncClient::open(&app).await?;
    if client.repository_id != s.repository_id
        || !client.account_login.eq_ignore_ascii_case(&s.account_login)
    {
        return Err("仓库绑定已变化".into());
    }
    let entries = client
        .request(
            Method::GET,
            &format!(
                "/commits?sha={}&path={}&per_page=30",
                encode(&s.branch),
                encode(&format!(
                    "tiker/{}/",
                    s.remote_library_id
                        .as_deref()
                        .unwrap_or(&snapshot.library_id)
                ))
            ),
            None,
        )
        .await?;
    entries
        .as_array()
        .ok_or("版本历史格式无效")?
        .iter()
        .map(|v| {
            let date = text(&v["commit"]["committer"], "date")?;
            let created = chrono::DateTime::parse_from_rfc3339(date)
                .map_err(|_| "版本时间无效")?
                .timestamp_millis();
            Ok(HistoryItem {
                sha: text(v, "sha")?.into(),
                message: text(&v["commit"], "message")?.into(),
                created_at: created.max(0) as u64,
            })
        })
        .collect()
}
#[tauri::command]
pub async fn sync_restore(app: tauri::AppHandle, sha: String) -> Result<SyncStatus, String> {
    if sha.len() != 40 || !sha.bytes().all(|c| c.is_ascii_hexdigit()) {
        return Err("版本 ID 无效".into());
    }
    {
        let _run = RUN.lock().await;
        let (dir, snapshot, mut s, initial_archives) = {
            let _guard = store::LOCK.lock().map_err(|_| "内容锁不可用")?;
            let dir = store::directory(&app)?;
            store::recover_content(&dir)?;
            recover(&app, &dir)?;
            let snapshot = store::read(&dir)?;
            let s = state(&dir)?;
            let archives = crate::clip_tasks::sync_export(&app)?;
            (dir, snapshot, s, archives)
        };
        if !s.enabled {
            return Err("请先启用同步".into());
        }
        let client = SyncClient::open(&app).await?;
        if client.repository_id != s.repository_id
            || !client.account_login.eq_ignore_ascii_case(&s.account_login)
        {
            return Err("仓库绑定已变化".into());
        }
        let head = inspect(&client, &s.branch).await?;
        let ancestry = client
            .request(
                Method::GET,
                &format!("/compare/{sha}...{}", head.head),
                None,
            )
            .await?;
        if !matches!(ancestry["status"].as_str(), Some("ahead" | "identical")) {
            return Err("所选版本不在当前分支历史中".into());
        }
        let historical = inspect_commit(&client, &sha).await?;
        let data = remote_data(
            &client,
            &historical,
            s.remote_library_id
                .as_deref()
                .unwrap_or(&snapshot.library_id),
            &dir,
        )
        .await?
        .ok_or("该版本没有当前资料库")?;
        let _guard = store::LOCK.lock().map_err(|_| "内容锁不可用")?;
        if store::directory(&app)? != dir
            || !client.still_bound(&app)
            || store::read(&dir)?.revision != snapshot.revision
        {
            return Err("本地内容或同步目标已变化，请重新选择版本".into());
        }
        crate::clip_tasks::sync_check_import(&app, &data.clips, &data.categories)?;
        let archives = crate::clip_tasks::sync_export(&app)?;
        if archives != initial_archives {
            return Err("剪藏已在下载期间变化，请重新选择恢复版本".into());
        }
        store::atomic(
            &dir.join(format!("before-restore-{}.json", now())),
            &json!({"snapshot":snapshot,"archives":archives,"sync":s}),
        )?;
        let (mut next, source_writes) = restore_snapshot(&app, &dir, &snapshot, &data)?;
        next.learning["sessions"] = json!(
            data.learning
                .iter()
                .map(normalize_session)
                .collect::<Vec<_>>()
        );
        s.conflicts.clear();
        s.decisions.clear();
        s.phase = "pending".into();
        s.message = "已恢复为新的本地修改，等待同步提交".into();
        let j = Journal {
            source_writes,
            snapshot: next,
            state: s,
            clips: json!({"tasks":data.clips,"categories":data.categories}),
        };
        store::atomic(&dir.join("sync-transaction.json"), &j)?;
        complete(&app, &dir, &j)?;
        edited();
    }
    sync_now(app).await
}
fn debounce(app: &tauri::AppHandle) -> u64 {
    crate::sync_config::load_sync_settings(app.clone())
        .map(|c| u64::from(c.auto_sync_delay_seconds) * 1000)
        .unwrap_or(4000)
}
pub fn setup(app: &tauri::AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut last = 0;
        let mut first_edit = 0;
        let mut failures = 0u32;
        let mut retry_at = 0;
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
            let current = now();
            if current < retry_at {
                continue;
            }
            let edit = EDITED.load(Ordering::Relaxed);
            if edit > last && first_edit == 0 {
                first_edit = current;
            }
            if current.saturating_sub(last) >= 60_000
                || (edit > last
                    && (current.saturating_sub(edit) >= debounce(&app)
                        || current.saturating_sub(first_edit) >= 30_000))
            {
                let result = sync_now(app.clone()).await;
                if result.as_ref().is_ok_and(|s| s.state == "error") {
                    failures = (failures + 1).min(5);
                    retry_at = now() + 30_000 * (1u64 << failures);
                } else {
                    failures = 0;
                    retry_at = 0;
                }
                last = now();
                first_edit = 0;
            }
        }
    });
}
#[cfg(test)]
mod tests {
    use super::*;
    fn fixture(
        responses: Vec<(u16, Value)>,
    ) -> (SyncClient, std::thread::JoinHandle<Vec<(String, Value)>>) {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let handle = std::thread::spawn(move || {
            let mut requests = vec![];
            for (status, body) in responses {
                let (mut stream, _) = listener.accept().unwrap();
                stream
                    .set_read_timeout(Some(std::time::Duration::from_secs(5)))
                    .unwrap();
                let mut bytes = vec![];
                let mut chunk = [0u8; 4096];
                let (header_end, length) = loop {
                    let n = stream.read(&mut chunk).unwrap();
                    assert!(n > 0);
                    bytes.extend_from_slice(&chunk[..n]);
                    if let Some(p) = bytes.windows(4).position(|x| x == b"\r\n\r\n") {
                        let headers = String::from_utf8_lossy(&bytes[..p]);
                        let len = headers
                            .lines()
                            .find_map(|line| {
                                line.to_ascii_lowercase()
                                    .strip_prefix("content-length: ")
                                    .map(|v| v.parse::<usize>().unwrap())
                            })
                            .unwrap_or(0);
                        break (p + 4, len);
                    }
                };
                while bytes.len() < header_end + length {
                    let n = stream.read(&mut chunk).unwrap();
                    assert!(n > 0);
                    bytes.extend_from_slice(&chunk[..n]);
                }
                let first = String::from_utf8_lossy(&bytes)
                    .lines()
                    .next()
                    .unwrap()
                    .to_owned();
                let payload = if length == 0 {
                    Value::Null
                } else {
                    serde_json::from_slice(&bytes[header_end..header_end + length]).unwrap()
                };
                requests.push((first, payload));
                let body = body.to_string();
                write!(stream,"HTTP/1.1 {status} Test\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",body.len()).unwrap();
            }
            requests
        });
        (SyncClient::fixture(format!("http://{address}")), handle)
    }
    #[tokio::test]
    async fn git_commit_preserves_base_tree_parent_and_ref_safety() {
        let (client, server) = fixture(vec![
            (201, json!({"sha":"blob"})),
            (201, json!({"sha":"new-tree"})),
            (201, json!({"sha":"new-commit"})),
            (200, json!({})),
        ]);
        let remote = Remote {
            head: "observed-head".into(),
            tree: "observed-tree".into(),
            entries: BTreeMap::from([("README.md".into(), "unrelated".into())]),
        };
        let head = upload(
            &client,
            &remote,
            "lib",
            "main",
            &Data::default(),
            Path::new("/unused"),
        )
        .await
        .unwrap();
        assert_eq!(head, "new-commit");
        let requests = server.join().unwrap();
        assert_eq!(requests[1].1["base_tree"], "observed-tree");
        assert!(
            requests[1].1["tree"]
                .as_array()
                .unwrap()
                .iter()
                .all(|v| v["path"].as_str().unwrap().starts_with("tiker/lib/"))
        );
        assert_eq!(requests[2].1["parents"], json!(["observed-head"]));
        assert_eq!(requests[3].1["force"], false);
    }
    #[tokio::test]
    async fn unchanged_tree_does_not_create_commit() {
        let (client, server) = fixture(vec![(201, json!({"sha":"same"}))]);
        let remote = Remote {
            head: "head".into(),
            tree: "tree".into(),
            entries: BTreeMap::from([("tiker/lib/manifest.json".into(), "same".into())]),
        };
        assert_eq!(
            upload(
                &client,
                &remote,
                "lib",
                "main",
                &Data::default(),
                Path::new("/unused")
            )
            .await
            .unwrap(),
            "head"
        );
        assert_eq!(server.join().unwrap().len(), 1);
    }
    #[tokio::test]
    async fn rejected_ref_never_falls_back_to_force() {
        let (client, server) = fixture(vec![
            (201, json!({"sha":"blob"})),
            (201, json!({"sha":"tree"})),
            (201, json!({"sha":"commit"})),
            (422, json!({"private":"sensitive"})),
        ]);
        let remote = Remote {
            head: "head".into(),
            tree: "base".into(),
            entries: BTreeMap::new(),
        };
        let error = upload(
            &client,
            &remote,
            "lib",
            "main",
            &Data::default(),
            Path::new("/unused"),
        )
        .await
        .unwrap_err();
        assert!(!error.contains("sensitive"));
        let requests = server.join().unwrap();
        assert_eq!(requests.len(), 4);
        assert_eq!(requests[3].1["force"], false);
    }
    #[test]
    fn own_publication_rebase_preserves_delete_when_remote_advances() {
        let a = json!({"id":"a","kind":"doc","title":"A"});
        let b = json!({"id":"b","kind":"doc","title":"B"});
        let captured = Data {
            library: vec![a.clone()],
            ..Default::default()
        };
        let published = captured.clone();
        let current = Data::default();
        let (recovered, c) = merge_data(&captured, &current, &published, &[]).unwrap();
        assert!(c.is_empty());
        assert!(recovered.library.is_empty());
        let descendant = Data {
            library: vec![a, b],
            ..Default::default()
        };
        let (final_data, c) = merge_data(&published, &recovered, &descendant, &[]).unwrap();
        assert!(c.is_empty());
        assert_eq!(final_data.library.len(), 1);
        assert_eq!(final_data.library[0]["id"], "b");
        assert!(final_data.tombstones.contains("library:a"));
    }
    #[test]
    fn baseline_tombstone_cannot_be_silently_removed() {
        let b = Data {
            tombstones: BTreeSet::from(["library:a".into()]),
            ..Default::default()
        };
        let l = Data {
            library: vec![json!({"id":"a","kind":"doc","title":"old"})],
            ..Default::default()
        };
        assert_eq!(
            merge_data(&b, &l, &Data::default(), &[]).unwrap().1.len(),
            1
        );
    }
    #[tokio::test]
    async fn remote_corruption_is_detected_even_with_valid_local_cache() {
        let dir = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        let digest = hash(b"valid");
        save_object(&dir, &digest, b"valid").unwrap();
        let manifest = json!({"version":1,"libraryId":"lib","library":["a"],"learning":[],"clips":[],"categories":[],"tombstones":[]});
        let entity = json!({"id":"a","title":"a.pdf","kind":"pdf","attachmentHash":digest});
        let wrap =
            |v: Vec<u8>| json!({"size":v.len(),"encoding":"base64","content":STANDARD.encode(v)});
        let (client, server) = fixture(vec![
            (200, wrap(serde_json::to_vec(&manifest).unwrap())),
            (200, wrap(serde_json::to_vec(&entity).unwrap())),
            (200, wrap(b"corrupt".to_vec())),
        ]);
        let remote = Remote {
            head: "head".into(),
            tree: "tree".into(),
            entries: BTreeMap::from([
                ("tiker/lib/manifest.json".into(), "manifest".into()),
                ("tiker/lib/library/a.json".into(), "entity".into()),
                (format!("tiker/lib/attachments/{digest}"), "blob".into()),
            ]),
        };
        assert!(remote_data(&client, &remote, "lib", &dir).await.is_err());
        assert_eq!(server.join().unwrap().len(), 3);
        assert_eq!(
            fs::read(object_path(&dir, &digest).unwrap()).unwrap(),
            b"valid"
        );
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn inline_workbook_sync_roundtrip_retains_content_without_attachment_grant() {
        let value = json!({"id":"sheet","kind":"table","title":"Sheet.xlsx","content":"xlsx:UEsDBHdvcmtib29r","tags":[],"parentId":null});
        let data = Data {
            library: vec![value.clone()],
            ..Default::default()
        };
        assert!(validate(&data).is_ok());
        let serialized = serde_json::to_vec(&data).unwrap();
        let restored: Data = serde_json::from_slice(&serialized).unwrap();
        assert_eq!(restored.library[0]["content"], value["content"]);
        let invalid = Data {
            library: vec![
                json!({"id":"sheet","kind":"table","title":"Sheet.xlsx","content":"xlsx:not-valid!"}),
            ],
            ..Default::default()
        };
        assert!(validate(&invalid).is_err());
    }
    #[test]
    fn malformed_remote_clip_cannot_enter_transaction() {
        let data = Data {
            clips: vec![json!({"id":"a","url":"https://example.com"})],
            ..Default::default()
        };
        assert!(validate(&data).is_err());
    }
    #[test]
    fn malformed_nested_content_is_rejected() {
        let data = Data {
            library: vec![json!({"id":"a","kind":"doc","title":"A","tags":"invalid"})],
            ..Default::default()
        };
        assert!(validate(&data).is_err());
    }
    #[test]
    fn stale_generation_cannot_acquire_publication() {
        assert!(publication(u64::MAX).is_err());
    }
    #[cfg(unix)]
    #[test]
    fn registered_attachment_replaced_with_symlink_is_rejected() {
        use std::os::unix::fs::symlink;
        let root = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("private"), "secret").unwrap();
        symlink(root.join("private"), root.join("attachment")).unwrap();
        assert!(crate::file_preview::sync_bytes(&root.join("attachment")).is_err());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn stale_device_cannot_silently_resurrect_tombstone() {
        let l = Data {
            library: vec![json!({"id":"a","kind":"doc","title":"old"})],
            ..Default::default()
        };
        let r = Data {
            tombstones: BTreeSet::from(["library:a".into()]),
            ..Default::default()
        };
        let (_, conflicts) = merge_data(&Data::default(), &l, &r, &[]).unwrap();
        assert_eq!(conflicts.len(), 1);
    }
    #[test]
    fn deleting_parent_with_remote_new_child_is_actionable_conflict() {
        let b = Data {
            library: vec![json!({"id":"folder","kind":"folder","title":"Folder","parentId":null})],
            ..Default::default()
        };
        let mut r = b.clone();
        r.library
            .push(json!({"id":"child","kind":"doc","title":"New","parentId":"folder"}));
        let (_, conflicts) = merge_data(&b, &Data::default(), &r, &[]).unwrap();
        assert_eq!(conflicts.len(), 1);
        assert_eq!(conflicts[0].id, "library:hierarchy");
    }
    #[test]
    fn independent_edits_and_delete_edit_conflict() {
        let b = Data {
            library: vec![json!({"id":"a","title":"A","kind":"doc","content":"base"})],
            ..Default::default()
        };
        let mut l = b.clone();
        l.library[0]["title"] = json!("new");
        let mut r = b.clone();
        r.library[0]["content"] = json!("remote");
        let (m, c) = merge_data(&b, &l, &r, &[]).unwrap();
        assert!(c.is_empty());
        assert_eq!(m.library[0]["title"], "new");
        assert_eq!(m.library[0]["content"], "remote");
        l.library.clear();
        assert_eq!(merge_data(&b, &l, &r, &[]).unwrap().1.len(), 1);
    }
    #[test]
    fn decision_cannot_overwrite_newer_edit() {
        let b = json!({"id":"a","title":"base"});
        let l = json!({"id":"a","title":"local"});
        let r = json!({"id":"a","title":"remote"});
        let mut c = vec![];
        merge_collection(
            "library",
            std::slice::from_ref(&b),
            std::slice::from_ref(&l),
            std::slice::from_ref(&r),
            &[],
            &mut c,
        );
        let d = Decision {
            conflict: c[0].clone(),
            choice: "local".into(),
            merged: None,
        };
        c.clear();
        merge_collection(
            "library",
            &[b],
            &[json!({"id":"a","title":"newer"})],
            &[r],
            &[d],
            &mut c,
        );
        assert_eq!(c.len(), 1);
    }
    #[test]
    fn runtime_and_paths_are_not_stable_content() {
        let v = stable_session(
            &json!({"id":"a","messages":[],"files":[],"queued":[1],"pending":"secret","requirements":"secret","modelId":"secret","status":"research"}),
        );
        assert!(v.get("queued").is_none());
        assert!(!v.to_string().contains("secret"));
        assert_eq!(normalize_session(&v)["status"], "idle");
    }
    #[test]
    fn strict_paths_and_hashes() {
        for id in ["../escape", "a/b", "a\\b", "..", ""] {
            assert!(!valid_id(id));
        }
        let dir = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        assert!(object_path(&dir, "../escape").is_err());
        let d = hash(b"hello");
        save_object(&dir, &d, b"hello").unwrap();
        assert!(save_object(&dir, &d, b"wrong").is_err());
        fs::remove_dir_all(dir).unwrap();
    }
}
