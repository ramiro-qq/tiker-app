use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{Emitter, Manager};
pub(crate) static LOCK: Mutex<()> = Mutex::new(());
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentSnapshot {
    pub library_id: String,
    pub revision: u64,
    pub library: Vec<Value>,
    pub learning: Value,
}
pub fn directory(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let state = app.state::<crate::ConfigState>();
    let guard = state.lock().map_err(|_| "配置锁不可用")?;
    let dir = PathBuf::from(
        guard
            .as_ref()
            .and_then(|c| c.workspace.current_path.clone())
            .ok_or("资料库尚未初始化")?,
    )
    .join(".tiker");
    if fs::symlink_metadata(&dir).is_ok_and(|m| m.file_type().is_symlink()) {
        return Err("资料存储目录不能是符号链接".into());
    }
    Ok(dir)
}
pub fn atomic(path: &Path, value: &impl Serialize) -> Result<(), String> {
    fs::create_dir_all(path.parent().ok_or("无效路径")?).map_err(|e| e.to_string())?;
    let tmp = path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| {
        use std::io::Write;
        let mut f = fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&tmp)
            .map_err(|e| e.to_string())?;
        f.write_all(&serde_json::to_vec(value).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
        f.sync_all().map_err(|e| e.to_string())?;
        fs::rename(&tmp, path).map_err(|e| e.to_string())?;
        fs::File::open(path.parent().unwrap())
            .and_then(|f| f.sync_all())
            .map_err(|e| e.to_string())
    })();
    if result.is_err() {
        let _ = fs::remove_file(tmp);
    }
    result
}
pub fn read(dir: &Path) -> Result<ContentSnapshot, String> {
    serde_json::from_slice(&fs::read(dir.join("content.json")).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())
}
fn entities(value: &Value) -> Result<BTreeMap<String, Value>, String> {
    let mut out = BTreeMap::new();
    for item in value.as_array().ok_or("实体集合必须为数组")? {
        let id = item["id"]
            .as_str()
            .filter(|id| !id.is_empty())
            .ok_or("实体缺少 ID")?;
        if out.insert(id.to_owned(), item.clone()).is_some() {
            return Err("实体 ID 重复".into());
        }
    }
    Ok(out)
}
pub fn merge(base: &Value, local: &Value, remote: &Value) -> Result<Value, String> {
    if local == base {
        return Ok(remote.clone());
    }
    if remote == base || local == remote {
        return Ok(local.clone());
    }
    if let (Some(b), Some(l), Some(r)) = (base.as_object(), local.as_object(), remote.as_object()) {
        let mut out = serde_json::Map::new();
        let keys: std::collections::BTreeSet<_> =
            b.keys().chain(l.keys()).chain(r.keys()).collect();
        for key in keys {
            let bv = b.get(key).unwrap_or(&Value::Null);
            let lv = l.get(key).unwrap_or(&Value::Null);
            let rv = r.get(key).unwrap_or(&Value::Null);
            let v = if key == "updatedAt" && lv.is_number() && rv.is_number() {
                json!(lv.as_u64().unwrap_or(0).max(rv.as_u64().unwrap_or(0)))
            } else {
                merge(bv, lv, rv).map_err(|_| format!("字段冲突：{key}"))?
            };
            if !v.is_null() || l.contains_key(key) && r.contains_key(key) {
                out.insert(key.clone(), v);
            }
        }
        return Ok(Value::Object(out));
    }
    Err("并发内容冲突，请刷新后重试；原内容已保留".into())
}
pub fn merge_entities(base: &Value, local: &Value, remote: &Value) -> Result<Value, String> {
    let b = entities(base)?;
    let l = entities(local)?;
    let r = entities(remote)?;
    let keys: std::collections::BTreeSet<_> = b.keys().chain(l.keys()).chain(r.keys()).collect();
    let mut out = Vec::new();
    for key in keys {
        let v = merge(
            b.get(key).unwrap_or(&Value::Null),
            l.get(key).unwrap_or(&Value::Null),
            r.get(key).unwrap_or(&Value::Null),
        )?;
        if !v.is_null() {
            out.push(v);
        }
    }
    let order: Vec<_> = local
        .as_array()
        .unwrap()
        .iter()
        .chain(remote.as_array().unwrap().iter())
        .filter_map(|v| v["id"].as_str())
        .collect();
    out.sort_by_key(|v| {
        order
            .iter()
            .position(|id| Some(*id) == v["id"].as_str())
            .unwrap_or(usize::MAX)
    });
    let value = Value::Array(out);
    validate_hierarchy(&value)?;
    Ok(value)
}
pub(crate) fn validate_hierarchy(value: &Value) -> Result<(), String> {
    let map = entities(value)?;
    for (id, item) in &map {
        let mut seen = std::collections::BTreeSet::from([id.as_str()]);
        let mut parent = item.get("parentId").and_then(Value::as_str);
        while let Some(p) = parent {
            if !seen.insert(p) {
                return Err("目录包含循环引用".into());
            }
            let node = map.get(p).ok_or("父目录不存在")?;
            if node.get("kind").is_some_and(|v| v != "folder") {
                return Err("父节点不是文件夹".into());
            }
            parent = node.get("parentId").and_then(Value::as_str);
        }
    }
    Ok(())
}
pub(crate) fn initialize(
    dir: &Path,
    library: Option<Value>,
    learning: Option<Value>,
) -> Result<ContentSnapshot, String> {
    if dir.join("content.json").exists() {
        return read(dir);
    }
    let library = library.unwrap_or(json!([]));
    validate_hierarchy(&library)?;
    let learning = learning.unwrap_or(json!({"sessions":[],"activeId":null}));
    entities(&learning["sessions"])?;
    atomic(
        &dir.join("legacy-backup.json"),
        &json!({"library":library,"learning":learning}),
    )?;
    let snapshot = ContentSnapshot {
        library_id: uuid::Uuid::new_v4().to_string(),
        revision: 0,
        library: library.as_array().unwrap().clone(),
        learning,
    };
    atomic(&dir.join("content.json"), &snapshot)?;
    Ok(snapshot)
}
pub(crate) fn source_fingerprint(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    format!("{:x}", Sha256::digest(bytes))
}
fn managed_source(dir: &Path, path: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(path);
    if fs::symlink_metadata(&path)
        .map_err(|_| "归档源文件已缺失")?
        .file_type()
        .is_symlink()
    {
        return Err("归档源文件不能是符号链接".into());
    }
    let canonical = path.canonicalize().map_err(|_| "无法定位归档源文件")?;
    let root = dir
        .parent()
        .ok_or("资料库路径无效")?
        .canonicalize()
        .map_err(|e| e.to_string())?;
    if !canonical.starts_with(root) {
        return Err("归档源文件不在当前资料库中，请重新导入".into());
    }
    Ok(canonical)
}
pub(crate) fn check_source(dir: &Path, node: &Value) -> Result<(), String> {
    if let Some(path) = node["sourcePath"].as_str() {
        let bytes = crate::file_preview::sync_bytes(&managed_source(dir, path)?)?;
        let expected = node["sourceFingerprint"]
            .as_str()
            .map(str::to_owned)
            .or_else(|| {
                node["markdown"]
                    .as_str()
                    .map(|s| source_fingerprint(s.as_bytes()))
            })
            .ok_or("归档源文件缺少指纹，请重新导入后同步")?;
        if source_fingerprint(&bytes) != expected {
            return Err(format!(
                "外部文件冲突：{} 的归档文件已被修改。当前编辑内容和外部文件均已保留，请重新导入外部版本或恢复原文件后同步",
                node["title"].as_str().unwrap_or("文档")
            ));
        }
    }
    Ok(())
}
fn atomic_bytes(path: &Path, bytes: &[u8]) -> Result<(), String> {
    use std::io::Write;
    let tmp = path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&tmp)
        .map_err(|e| e.to_string())?;
    file.write_all(bytes)
        .and_then(|_| file.sync_all())
        .map_err(|e| e.to_string())?;
    fs::rename(tmp, path).map_err(|e| e.to_string())
}
#[derive(Clone, Serialize, Deserialize)]
pub(crate) struct SourceWrite {
    path: String,
    old_fingerprint: String,
    new_content: String,
}
#[derive(Serialize, Deserialize)]
struct ContentTransaction {
    snapshot: ContentSnapshot,
    sources: Vec<SourceWrite>,
}
pub(crate) fn apply_sources(dir: &Path, writes: &[SourceWrite]) -> Result<(), String> {
    for write in writes {
        let path = managed_source(dir, &write.path)?;
        let existing = crate::file_preview::sync_bytes(&path)?;
        let actual = source_fingerprint(&existing);
        let new_hash = source_fingerprint(write.new_content.as_bytes());
        if actual == new_hash {
            continue;
        }
        if actual != write.old_fingerprint {
            return Err(
                "归档文件在事务期间被外部修改，已保留恢复日志和两端内容，请先核对外部文件".into(),
            );
        }
        let backup = dir.join("source-backups").join(&write.old_fingerprint);
        fs::create_dir_all(backup.parent().unwrap()).map_err(|e| e.to_string())?;
        if !backup.exists() {
            atomic_bytes(&backup, &existing)?;
        }
        atomic_bytes(&path, write.new_content.as_bytes())?;
    }
    Ok(())
}
pub(crate) fn recover_content(dir: &Path) -> Result<(), String> {
    let file = dir.join("content-transaction.json");
    if !file.exists() {
        return Ok(());
    }
    let transaction: ContentTransaction =
        serde_json::from_slice(&fs::read(&file).map_err(|e| e.to_string())?)
            .map_err(|_| "内容恢复日志损坏")?;
    apply_sources(dir, &transaction.sources)?;
    atomic(&dir.join("content.json"), &transaction.snapshot)?;
    fs::remove_file(file).map_err(|e| e.to_string())
}
pub(crate) fn materialize_source(
    dir: &Path,
    node: &mut Value,
    old: Option<&Value>,
) -> Result<Option<SourceWrite>, String> {
    let Some(source) = node["sourcePath"].as_str().map(str::to_owned) else {
        return Ok(None);
    };
    let changed = old.is_some_and(|v| v["content"] != node["content"]);
    if changed {
        check_source(dir, old.unwrap())?;
        let path = managed_source(dir, &source)?;
        let previous = crate::file_preview::sync_bytes(&path)?;
        let content = node["content"]
            .as_str()
            .ok_or("文档正文必须是文本")?
            .to_owned();
        node["sourceFingerprint"] = json!(source_fingerprint(content.as_bytes()));
        node["format"] = json!("html");
        node.as_object_mut().unwrap().remove("markdown");
        return Ok(Some(SourceWrite {
            path: source,
            old_fingerprint: source_fingerprint(&previous),
            new_content: content,
        }));
    }
    if node.get("sourceFingerprint").is_none() {
        check_source(dir, node)?;
        let bytes = crate::file_preview::sync_bytes(&managed_source(dir, &source)?)?;
        node["sourceFingerprint"] = json!(source_fingerprint(&bytes));
    }
    Ok(None)
}

#[tauri::command]
pub fn content_load(
    app: tauri::AppHandle,
    legacy_library: Option<Value>,
    legacy_learning: Option<Value>,
) -> Result<ContentSnapshot, String> {
    let _guard = LOCK.lock().map_err(|_| "内容锁不可用")?;
    let dir = directory(&app)?;
    recover_content(&dir)?;
    crate::content_sync::recover(&app, &dir)?;
    let marker = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("content-migration.json");
    let supplied_legacy = legacy_library.is_some() || legacy_learning.is_some();
    let migrated = marker.exists();
    let snapshot = initialize(
        &dir,
        if migrated { None } else { legacy_library },
        if migrated { None } else { legacy_learning },
    )?;
    if !migrated && supplied_legacy {
        atomic(&marker, &json!({"libraryId":snapshot.library_id}))?;
    }
    Ok(snapshot)
}
#[tauri::command]
pub fn content_save(
    app: tauri::AppHandle,
    collection: String,
    expected_library_id: String,
    base: Value,
    next: Value,
) -> Result<ContentSnapshot, String> {
    let _guard = LOCK.lock().map_err(|_| "内容锁不可用")?;
    let dir = directory(&app)?;
    recover_content(&dir)?;
    crate::content_sync::recover(&app, &dir)?;
    let mut snapshot = read(&dir)?;
    if snapshot.library_id != expected_library_id {
        return Err("资料库已切换，请重新加载后保存".into());
    }
    let mut sources = vec![];
    let previous_library = snapshot.library.clone();
    match collection.as_str() {
        "library" => {
            snapshot.library = merge_entities(&base, &next, &json!(snapshot.library))?
                .as_array()
                .unwrap()
                .clone();
            for node in &mut snapshot.library {
                let old = previous_library.iter().find(|v| v["id"] == node["id"]);
                if let Some(write) = materialize_source(&dir, node, old)? {
                    sources.push(write);
                }
                if node["kind"] == "doc"
                    && node.get("sourcePath").is_none()
                    && old.is_some_and(|v| {
                        v["content"] != node["content"] && v["markdown"] == node["markdown"]
                    })
                {
                    node.as_object_mut().unwrap().remove("markdown");
                    node["format"] = json!("html");
                }
            }
        }
        "learning" => {
            let sessions = merge_entities(
                &base["sessions"],
                &next["sessions"],
                &snapshot.learning["sessions"],
            )?;
            let active = merge(
                &base["activeId"],
                &next["activeId"],
                &snapshot.learning["activeId"],
            )?;
            snapshot.learning = json!({"sessions":sessions,"activeId":active});
        }
        _ => return Err("未知内容集合".into()),
    }
    snapshot.revision += 1;
    if sources.is_empty() {
        atomic(&dir.join("content.json"), &snapshot)?;
    } else {
        atomic(
            &dir.join("content-transaction.json"),
            &ContentTransaction {
                snapshot: snapshot.clone(),
                sources,
            },
        )?;
        recover_content(&dir)?;
    }
    crate::content_sync::edited();
    let _ = app.emit("content:changed", ());
    Ok(snapshot)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn content_wal_replays_partial_source_writes_before_snapshot() {
        let root = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        let dir = root.join(".tiker");
        fs::create_dir_all(&dir).unwrap();
        let first = root.join("a.md");
        let second = root.join("b.md");
        fs::write(&first, "old-a").unwrap();
        fs::write(&second, "old-b").unwrap();
        let writes = vec![
            SourceWrite {
                path: first.to_string_lossy().into(),
                old_fingerprint: source_fingerprint(b"old-a"),
                new_content: "new-a".into(),
            },
            SourceWrite {
                path: second.to_string_lossy().into(),
                old_fingerprint: source_fingerprint(b"old-b"),
                new_content: "new-b".into(),
            },
        ];
        let snapshot = ContentSnapshot {
            library_id: "local".into(),
            revision: 7,
            library: vec![],
            learning: json!({"sessions":[],"activeId":null}),
        };
        atomic(
            &dir.join("content-transaction.json"),
            &ContentTransaction {
                snapshot,
                sources: writes.clone(),
            },
        )
        .unwrap();
        apply_sources(&dir, &writes[..1]).unwrap();
        assert!(!dir.join("content.json").exists());
        recover_content(&dir).unwrap();
        assert_eq!(read(&dir).unwrap().revision, 7);
        assert_eq!(fs::read_to_string(first).unwrap(), "new-a");
        assert_eq!(fs::read_to_string(second).unwrap(), "new-b");
        assert!(!dir.join("content-transaction.json").exists());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn timestamps_do_not_turn_independent_edits_into_conflicts() {
        let base = json!({"id":"a","title":"old","content":"old","updatedAt":1});
        let local = json!({"id":"a","title":"renamed","content":"old","updatedAt":2});
        let remote = json!({"id":"a","title":"old","content":"edited","updatedAt":3});
        let value = merge(&base, &local, &remote).unwrap();
        assert_eq!(value["title"], "renamed");
        assert_eq!(value["content"], "edited");
        assert_eq!(value["updatedAt"], 3);
    }
    #[test]
    fn managed_source_writeback_preserves_backup_and_detects_external_edits() {
        let root = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        let dir = root.join(".tiker");
        fs::create_dir_all(&dir).unwrap();
        let source = root.join("note.md");
        fs::write(&source, "# Original").unwrap();
        let mut old = json!({"id":"a","kind":"doc","title":"Note","content":"<h1>Original</h1>","markdown":"# Original","sourcePath":source});
        materialize_source(&dir, &mut old, None).unwrap();
        check_source(&dir, &old).unwrap();
        let mut next = old.clone();
        next["content"] = json!("<p>Edited</p>");
        let write = materialize_source(&dir, &mut next, Some(&old))
            .unwrap()
            .unwrap();
        assert_eq!(fs::read_to_string(&source).unwrap(), "# Original");
        apply_sources(&dir, std::slice::from_ref(&write)).unwrap();
        apply_sources(&dir, &[write]).unwrap();
        assert_eq!(fs::read_to_string(&source).unwrap(), "<p>Edited</p>");
        assert!(next.get("markdown").is_none());
        assert_eq!(
            fs::read_to_string(
                dir.join("source-backups")
                    .join(source_fingerprint(b"# Original"))
            )
            .unwrap(),
            "# Original"
        );
        fs::write(&source, "External edit").unwrap();
        assert!(
            check_source(&dir, &next)
                .unwrap_err()
                .contains("外部文件冲突")
        );
        let mut later = next.clone();
        later["content"] = json!("<p>New</p>");
        assert!(materialize_source(&dir, &mut later, Some(&next)).is_err());
        assert_eq!(fs::read_to_string(source).unwrap(), "External edit");
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn independent_fields_merge() {
        assert_eq!(
            merge(
                &json!({"a":1,"b":1}),
                &json!({"a":2,"b":1}),
                &json!({"a":1,"b":2})
            )
            .unwrap(),
            json!({"a":2,"b":2})
        );
    }
    #[test]
    fn delete_edit_conflicts() {
        assert!(
            merge_entities(
                &json!([{ "id":"a","title":"old"}]),
                &json!([]),
                &json!([{ "id":"a","title":"new"}])
            )
            .is_err()
        )
    }
    #[test]
    fn migration_only_once() {
        let d = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        let a = initialize(&d, Some(json!([{ "id":"a"}])), None).unwrap();
        let b = initialize(&d, Some(json!([])), None).unwrap();
        assert_eq!(a.library, b.library);
        fs::remove_dir_all(d).unwrap();
    }
}
