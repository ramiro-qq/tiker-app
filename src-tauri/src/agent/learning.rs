use super::{contracts::*, policy::MODEL_TOTAL_TIMEOUT_SECS, prompts, research::*, validation::*};
use crate::models;
use serde_json::{Value, json};

pub(crate) async fn complete(
    app: &tauri::AppHandle,
    system: &str,
    input: Value,
    options: &LearningOptions,
    step: (&str, &str),
) -> Result<String, String> {
    complete_output(app, system, input, options, step, |_| {}).await
}

async fn complete_output(
    app: &tauri::AppHandle,
    system: &str,
    input: Value,
    options: &LearningOptions,
    step: (&str, &str),
    mut output: impl FnMut(&str) + Send,
) -> Result<String, String> {
    let (model, key) =
        models::resolve(app, options.model_id.as_deref().filter(|id| !id.is_empty()))?
            .ok_or("请先在设置 → 模型配置中添加并选择默认模型。")?;
    options.progress.send(
        step.0,
        step.1,
        "running",
        "正在等待模型响应；可以随时停止本轮任务。",
    );
    let result = super::completion::complete_with_progress(
        &model,
        &key,
        json!([{"role":"system","content":system},{"role":"user","content":input.to_string()}]),
        MODEL_TOTAL_TIMEOUT_SECS,
        |text| {
            output(text);
            let count = text.chars().count();
            options.progress.send(
                step.0,
                step.1,
                "running",
                format!("已接收 {count} 字符，模型正在继续输出。"),
            )
        },
    )
    .await;
    if !step.0.starts_with("file:") || result.is_err() {
        options.progress.send(
            step.0,
            step.1,
            if result.is_ok() { "done" } else { "error" },
            if result.is_ok() {
                "模型已返回结果，正在校验格式。"
            } else {
                "模型请求失败，请查看错误信息后重试。"
            },
        );
    }
    result.map_err(|error| format!("{}失败：{error}", step.1))
}

pub(crate) async fn intent(
    app: tauri::AppHandle,
    text: String,
    topic: String,
    messages: Value,
    options: LearningOptions,
) -> Result<Intent, String> {
    bounded(&text, 4000)?;
    let mut urls = input_urls(&text);
    // Clarification answers retain the original specified material.
    for url in required_source_urls(&messages, &options) {
        if !urls.contains(&url) && urls.len() < 3 {
            urls.push(url);
        }
    }
    let client = research_client()?;
    let mut pages = Vec::new();
    let mut failures = Vec::new();
    for url in urls.iter().take(3) {
        options
            .progress
            .send(url, "读取学习入口", "running", url.clone());
        match super::pages::read_page(&client, url, &text).await {
            Ok(page) => {
                options.progress.send(
                    url,
                    "学习入口分析完成",
                    if page.source.excerpt.is_empty() {
                        "warning"
                    } else {
                        "done"
                    },
                    format!(
                        "{}\n{}\n发现 {} 个相关内容链接；研究阶段将继续下钻。",
                        page.source.url,
                        page.notice.unwrap_or_default(),
                        page.links.len()
                    ),
                );
                pages.push(page.source);
            }
            Err(error) => {
                options
                    .progress
                    .send(url, "入口读取失败", "warning", format!("{url}：{error}"));
                failures.push(format!("{url}：{error}"));
            }
        }
    }
    let raw = complete(&app, prompts::INTENT, json!({"text":text,"topic":topic,"history":messages,"entryPages":pages,"unreadableUrls":failures}), &options, ("intent-model", "分析学习主题")).await?;
    let mut intent: Intent = parse_json(&raw)?;
    intent.seed_urls = urls;
    options.progress.send(
        "intent-result",
        if intent.kind == "clarify" {
            "等待补充学习目标"
        } else {
            "学习主题分析完成"
        },
        "done",
        intent.reply.clone(),
    );
    if !["learning", "clarify", "outside", "new_topic"].contains(&intent.kind.as_str()) {
        return Err("模型未返回有效的学习意图，请重试。".into());
    }
    if intent.title.chars().count() > 200
        || intent.query.chars().count() > 500
        || intent.reply.len() > 8000
    {
        return Err("模型返回的意图信息过长，请重试。".into());
    }
    Ok(intent)
}

pub(crate) async fn research(
    app: tauri::AppHandle,
    query: String,
    seed_urls: Vec<String>,
    messages: Value,
    options: LearningOptions,
) -> Result<Research, String> {
    let mut roots = seed_urls;
    for url in required_source_urls(&messages, &options) {
        if !roots.contains(&url) && roots.len() < 3 {
            roots.push(url);
        }
    }
    let (sources, mut warning) = collect_sources(&query, roots.clone(), &options.progress).await?;
    if let Err(error) = validate_source_evidence(&sources, &roots) {
        options.progress.send(
            "research-evidence",
            "指定资料证据不足",
            "error",
            format!("{error}\n{warning}"),
        );
        return Err(format!("{error}\n读取详情：{warning}"));
    }
    let raw = complete(
        &app,
        prompts::PLAN,
        json!({"query":query,"history":messages,"sources":sources,"researchWarning":warning,"sourceMode": if roots.is_empty() {"topic"}else{"provided_sources"},"requiredUrls":roots}),
        &options,
        ("plan-model", "筛选资料并规划学习路线"),
    )
    .await?;
    let planned: PlannedResearch = parse_json(&raw)?;
    let mut plan = planned.plan;
    validate_plan(&plan)?;
    for (index, source) in sources.iter().enumerate() {
        let keep = planned.relevant_sources.contains(&(index + 1));
        let note = planned
            .source_notes
            .iter()
            .find(|note| note.index == index + 1)
            .map(|note| note.reason.as_str())
            .unwrap_or(if keep {
                "正文与目标相关，保留作为学习证据"
            } else {
                "正文未被判定为目标知识的有效教学证据"
            });
        options.progress.send(
            &format!("filter:{}", source.url),
            "筛选来源正文",
            if keep { "done" } else { "warning" },
            format!("{}\n{note}", source.url),
        );
    }
    let sources = select_relevant_sources(sources, &planned.relevant_sources)?;
    if let Err(error) = validate_source_evidence(&sources, &roots) {
        options.progress.send(
            "research-evidence",
            "指定资料证据不足",
            "error",
            error.clone(),
        );
        return Err(format!(
            "{error} 已读取的页面未能支持本次学习目标。\n读取详情：{warning}"
        ));
    }
    if sources.is_empty() {
        let gap = "检索后未获得与学习主题实质相关且可读取的资料；以下内容仅基于模型已有知识，未完成来源核验。";
        warning = if warning.is_empty() {
            gap.into()
        } else {
            format!("{gap}\n{warning}")
        };
        plan.gaps.push(gap.into());
    }
    options.progress.send(
        "research-summary",
        "学习路线已确定",
        "done",
        format!(
            "保留 {} 份相关资料。{}\n{}",
            sources.len(),
            plan.objective,
            plan.outline
                .iter()
                .map(|s| format!(
                    "{} · {}",
                    if s.priority == "essential" {
                        "必学"
                    } else {
                        "选学"
                    },
                    s.title
                ))
                .collect::<Vec<_>>()
                .join("\n")
        ),
    );
    if !warning.is_empty() {
        options
            .progress
            .send("research-gap", "资料缺口", "warning", warning.clone());
    }
    Ok(Research {
        sources,
        warning,
        plan,
    })
}

pub(crate) async fn generate(
    app: tauri::AppHandle,
    topic: String,
    messages: Value,
    research: Research,
    files: Value,
    options: LearningOptions,
) -> Result<Generated, String> {
    bounded(&topic, 200)?;
    let Research {
        sources,
        warning,
        plan,
    } = research;
    validate_plan(&plan)?;
    let roots = required_source_urls(&messages, &options);
    validate_source_evidence(&sources, &roots)?;
    let context = json!({"topic":topic,"history":messages,"sources":sources,"plan":plan,"previousFiles":without_image_data(files),"researchWarning":warning,"sourceMode":if roots.is_empty(){"topic"}else{"provided_sources"},"requiredUrls":roots});
    let raw = complete(
        &app,
        prompts::MANIFEST,
        context.clone(),
        &options,
        ("material-manifest", "规划学习文件"),
    )
    .await?;
    let manifest: Vec<MaterialSpec> = parse_json(&raw)?;
    validate_manifest(&manifest)?;
    let mut result = Generated {
        reply: String::new(),
        files: Vec::new(),
    };
    for spec in &manifest {
        let step_id = format!("file:{}", spec.name);
        let label = format!("file-write   {}", spec.name);
        let mut input = context.clone();
        input["file"] = json!({"name":spec.name,"title":spec.title,"scope":spec.scope});
        input["manifest"] = serde_json::to_value(&manifest).map_err(|e| e.to_string())?;
        let markdown = complete_output(
            &app,
            prompts::MATERIAL,
            input,
            &options,
            (&step_id, &label),
            |text| {
                options.progress.material(
                    &Material {
                        name: spec.name.clone(),
                        title: spec.title.clone(),
                        markdown: text.into(),
                    },
                    "running",
                );
            },
        )
        .await?;
        let mut file = Material {
            name: spec.name.clone(),
            title: spec.title.clone(),
            markdown,
        };
        validate_materials(std::slice::from_ref(&file))?;
        validate_source_citations(
            std::slice::from_ref(&file),
            sources.len(),
            !roots.is_empty(),
        )?;
        super::illustrations::illustrate(&app, &topic, &mut file, &options).await;
        file.markdown = append_references(&file.markdown, &sources, &warning);
        options.progress.material(&file, "done");
        result.files.push(file);
        if result.files.len() == 1 && manifest.len() > 1 {
            result.reply = complete_output(&app, prompts::REPLY,
                json!({"topic":topic,"plan":plan,"files":result.files.iter().map(|f| json!({"name":f.name,"title":f.title,"excerpt":super::illustrations::text_only(&f.markdown).chars().take(2000).collect::<String>()})).collect::<Vec<_>>(),"pendingFiles":manifest.iter().skip(1).map(|f| &f.name).collect::<Vec<_>>(),"warning":warning}),
                &options, ("reply-model", "组织正式答复"), |text| options.progress.response(text)).await?;
        }
    }
    options.progress.send(
        "validate-materials",
        "学习材料校验完成",
        "done",
        format!("{} 份材料已就绪，正在组织正式答复。", result.files.len()),
    );
    if result.reply.is_empty() {
        result.reply = complete_output(&app, prompts::REPLY, json!({"topic":topic,"plan":plan,"files":result.files.iter().map(|f| json!({"name":f.name,"title":f.title,"excerpt":super::illustrations::text_only(&f.markdown).chars().take(2000).collect::<String>()})).collect::<Vec<_>>(),"warning":warning}), &options, ("reply-model", "组织正式答复"), |text| options.progress.response(text)).await?;
    } else {
        result.reply.push_str(&format!(
            "\n\n全部 {} 份学习材料已完成校验，可点击对话中的文档卡片预览。",
            result.files.len()
        ));
        options.progress.response(&result.reply);
    }
    Ok(result)
}
// Keep original citation numbers so references still resolve in split materials.
fn append_references(markdown: &str, sources: &[Source], warning: &str) -> String {
    let cited: Vec<_> = sources
        .iter()
        .enumerate()
        .filter(|(i, _)| markdown.contains(&format!("[{}]", i + 1)))
        .collect();
    let selected: Vec<_> = if cited.is_empty() {
        sources.iter().enumerate().collect()
    } else {
        cited
    };
    let refs = selected
        .into_iter()
        .map(|(i, source)| {
            format!(
                "[{}] [{}]({})",
                i + 1,
                source.title.replace(['[', ']'], ""),
                source.url
            )
        })
        .collect::<Vec<_>>()
        .join("\n\n");
    let note = if warning.is_empty() {
        if sources.is_empty() {
            "暂无可核验来源，内容仅供基础学习参考。"
        } else {
            "以下来源为实际读取的资料，请结合正文判断适用范围。"
        }
    } else {
        warning
    };
    format!("{}\n\n## 参考来源\n\n{note}\n\n{refs}", markdown.trim_end())
        .trim_end()
        .to_string()
}

#[cfg(test)]
mod options_tests {
    use super::*;
    #[test]
    fn references_are_embedded_with_original_numbers_and_warnings() {
        let sources = vec![
            Source {
                title: "第一份".into(),
                url: "https://example.com/1".into(),
                excerpt: "".into(),
                origin_url: None,
            },
            Source {
                title: "第二份".into(),
                url: "https://example.com/2".into(),
                excerpt: "".into(),
                origin_url: None,
            },
        ];
        let text = append_references("# 正文\n\n依据[2]。", &sources, "版本尚未核验");
        assert!(text.starts_with("# 正文\n\n依据[2]。"));
        assert!(text.contains("## 参考来源"));
        assert!(text.contains("[2] [第二份](https://example.com/2)"));
        assert!(!text.contains("https://example.com/1"));
        assert!(text.contains("版本尚未核验"));
        let empty = append_references("# 正文", &[], "暂无可核验来源");
        assert!(empty.ends_with("暂无可核验来源"));
    }
    #[test]
    fn learning_options_keep_model_selection_and_ignore_retired_fields() {
        let options: LearningOptions = serde_json::from_value(json!({
            "modelId": "chosen-model", "requirements": "旧版描述"
        }))
        .unwrap();
        assert_eq!(options.model_id.as_deref(), Some("chosen-model"));
        let legacy: LearningOptions = serde_json::from_value(json!({})).unwrap();
        assert!(legacy.model_id.is_none());
    }
}

// Do not send embedded image bytes back to the text model on follow-up questions.
fn without_image_data(mut value: Value) -> Value {
    match &mut value {
        Value::String(text) => *text = super::illustrations::text_only(text),
        Value::Array(items) => {
            for item in items {
                *item = without_image_data(item.take());
            }
        }
        Value::Object(items) => {
            for item in items.values_mut() {
                *item = without_image_data(item.take());
            }
        }
        _ => {}
    }
    value
}
