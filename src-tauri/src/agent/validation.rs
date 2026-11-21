use super::contracts::*;
use std::collections::HashSet;

pub(crate) fn select_relevant_sources(
    sources: Vec<Source>,
    indices: &[usize],
) -> Result<Vec<Source>, String> {
    if indices.iter().any(|i| *i == 0 || *i > sources.len()) {
        return Err("模型返回的来源筛选编号无效，请重试。".into());
    }
    Ok(sources
        .into_iter()
        .enumerate()
        .filter_map(|(i, source)| indices.contains(&(i + 1)).then_some(source))
        .collect())
}

pub(crate) fn parse_json<T: serde::de::DeserializeOwned>(raw: &str) -> Result<T, String> {
    let raw = raw.trim();
    let raw = if raw.starts_with("```") {
        raw.split_once('\n')
            .map(|(_, x)| x.trim_end_matches('`').trim())
            .unwrap_or(raw)
    } else {
        raw
    };
    serde_json::from_str(raw).map_err(|_| "模型返回的材料格式不正确，请重试或更换模型。".into())
}

pub(crate) fn bounded(text: &str, max: usize) -> Result<(), String> {
    if text.trim().is_empty() || text.chars().count() > max {
        return Err(format!("请输入 1～{max} 字的学习需求。"));
    }
    Ok(())
}

pub(crate) fn validate_plan(plan: &StudyPlan) -> Result<(), String> {
    if plan.objective.trim().is_empty()
        || !(4..=10).contains(&plan.outline.len())
        || !plan.outline.iter().any(|s| s.priority == "essential")
        || plan.outline.iter().any(|s| {
            s.title.trim().is_empty()
                || s.reason.trim().is_empty()
                || !["essential", "optional"].contains(&s.priority.as_str())
        })
        || serde_json::to_string(plan)
            .map_err(|e| e.to_string())?
            .len()
            > 24000
    {
        return Err("模型未返回有效的渐进学习大纲，请重试。".into());
    }
    Ok(())
}

pub(crate) fn validate_materials(files: &[Material]) -> Result<(), String> {
    let mut names = HashSet::new();
    if !(1..=5).contains(&files.len())
        || files.iter().any(|f| {
            safe_component(&f.name).is_err()
                || !f.name.ends_with(".md")
                || f.name == "参考来源.md"
                || !names.insert(f.name.clone())
                || f.markdown.trim().is_empty()
                || f.markdown.len() > 60000
                || f.title.trim().is_empty()
                || f.title.chars().count() > 200
        })
    {
        return Err("模型未生成有效的学习材料，请重试。".into());
    }
    Ok(())
}

pub(crate) fn safe_component(name: &str) -> Result<(), String> {
    if name.trim().is_empty()
        || name.len() > 240
        || name == "."
        || name == ".."
        || name
            .chars()
            .any(|c| c.is_control() || "/\\:*?\"<>|".contains(c))
    {
        return Err("标题或目录包含无效字符，请修改后重试。".into());
    }
    Ok(())
}

// Specified material is a hard constraint: unrelated web results cannot replace it.
pub(crate) fn validate_source_evidence(sources: &[Source], roots: &[String]) -> Result<(), String> {
    for root in roots {
        if !sources.iter().any(|source| {
            source.origin_url.as_ref() == Some(root)
                && source.excerpt.trim().chars().count() > 100
                && !super::pages::is_restricted_preview(&source.excerpt)
        }) {
            return Err(format!(
                "未取得指定资料的相关有效正文：{root}。已暂停材料生成。请检查读取记录，提供可公开阅读的章节链接或正文后重试。"
            ));
        }
    }
    Ok(())
}

pub(crate) fn validate_source_citations(
    files: &[Material],
    source_count: usize,
    required: bool,
) -> Result<(), String> {
    if required
        && files.iter().any(|file| {
            !(1..=source_count).any(|index| file.markdown.contains(&format!("[{index}]")))
        })
    {
        return Err("指定资料的学习材料缺少有效来源引用，已暂停交付，请重试。".into());
    }
    Ok(())
}

pub(crate) fn validate_manifest(specs: &[MaterialSpec]) -> Result<(), String> {
    let files: Vec<Material> = specs
        .iter()
        .map(|s| Material {
            name: s.name.clone(),
            title: s.title.clone(),
            markdown: s.scope.clone(),
        })
        .collect();
    validate_materials(&files)
}

#[cfg(test)]
mod manifest_tests {
    use super::*;
    #[test]
    fn rejects_invalid_manifest_before_streaming_any_file() {
        let specs = |name: &str| {
            vec![MaterialSpec {
                name: name.into(),
                title: "指南".into(),
                scope: "学习目标和实践".into(),
            }]
        };
        assert!(validate_manifest(&specs("01-指南.md")).is_ok());
        assert!(validate_manifest(&specs("../指南.md")).is_err());
        assert!(validate_manifest(&specs("参考来源.md")).is_err());
        let mut duplicate = specs("01-指南.md");
        duplicate.extend(specs("01-指南.md"));
        assert!(validate_manifest(&duplicate).is_err());
        assert!(validate_manifest(&[]).is_err());
    }
}
