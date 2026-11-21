use super::{contracts::*, research::*, runtime::Progress, validation::*};

#[tokio::test]
#[ignore = "requires live internet; run explicitly for research verification"]
async fn live_research_fetches_source_bodies() {
    let (sources, warning) = collect_sources(
        "TypeScript",
        vec!["https://www.typescriptlang.org/docs/".into()],
        &Progress::default(),
    )
    .await
    .unwrap();
    let research = (sources, warning);
    eprintln!("retrieved {} sources; {}", research.0.len(), research.1);
    for source in &research.0 {
        eprintln!(
            "{} · {} · {} chars",
            source.title,
            source.url,
            source.excerpt.chars().count()
        );
    }
    assert!(
        research
            .0
            .iter()
            .any(|s| s.url.starts_with("https://www.typescriptlang.org/docs/")),
        "the supplied official documentation entry must be read"
    );
}
#[test]
fn url_entry_preserves_context_and_filters_navigation() {
    assert_eq!(
        input_urls("请学习 https://example.com/guide。"),
        vec!["https://example.com/guide"]
    );
    let html = "<a href='/docs/start'>Getting started</a><a href='/docs/faq'>FAQ</a><a href='/login'>Login</a><a href='https://other.com/docs'>Other</a>";
    let links = related_links(html, "https://example.com/");
    assert_eq!(links.len(), 3);
    assert_eq!(links[0].1, "https://example.com/docs/start");
}
#[test]
fn materials_allow_adaptive_documents_but_reject_unsafe_or_duplicate_names() {
    let make = |name: &str| Material {
        name: name.into(),
        title: "学习指南".into(),
        markdown: "# 从概念到应用".into(),
    };
    assert!(validate_materials(&[make("学习指南.md")]).is_ok());
    assert!(validate_materials(&[make("01-入门.md"), make("02-实践.md")]).is_ok());
    assert!(validate_materials(&[]).is_err());
    assert!(validate_materials(&[make("../escape.md")]).is_err());
    assert!(validate_materials(&[make("参考来源.md")]).is_err());
    assert!(validate_materials(&[make("指南.md"), make("指南.md")]).is_err());
}
#[test]
fn plan_rejects_missing_learning_path_and_unrecognized_priorities() {
    let mut plan = StudyPlan {
        objective: "能解释检索与生成的关系".into(),
        prerequisites: vec![],
        outline: ["知识介绍", "核心概念", "应用案例", "自测总结"]
            .iter()
            .map(|title| StudySection {
                title: title.to_string(),
                priority: "essential".into(),
                reason: "建立后续学习所需的基础".into(),
            })
            .collect(),
        deferred: vec![],
        gaps: vec![],
    };
    assert!(validate_plan(&plan).is_ok());
    plan.outline[0].priority = "whatever".into();
    assert!(validate_plan(&plan).is_err());
    plan.outline[0].priority = "essential".into();
    plan.outline.truncate(1);
    assert!(validate_plan(&plan).is_err());
}
#[test]
fn irrelevant_search_hits_never_enter_generation_sources() {
    let source = |title: &str| Source {
        title: title.into(),
        url: format!("https://example.com/{title}"),
        excerpt: "body".into(),
        origin_url: None,
    };
    let selected = select_relevant_sources(
        vec![
            source("dictionary"),
            source("rag-guide"),
            source("marketing"),
        ],
        &[2, 2],
    )
    .unwrap();
    assert_eq!(selected.len(), 1);
    assert_eq!(selected[0].title, "rag-guide");
    assert!(
        select_relevant_sources(vec![source("dictionary")], &[])
            .unwrap()
            .is_empty()
    );
    assert!(select_relevant_sources(vec![source("guide")], &[0]).is_err());
    assert!(select_relevant_sources(vec![source("guide")], &[2]).is_err());
}
#[test]
fn research_uses_only_public_readable_sources() {
    assert!(public_url("http://127.0.0.1/private").is_err());
    assert!(public_url("file:///etc/passwd").is_err());
    let html = "<a class='result__a' href='//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fdocs'>Official docs</a>";
    assert_eq!(search_links(html)[0].1, "https://example.com/docs");
    let rss = "<rss><channel><item><title>Official &amp; docs</title><link>https://example.com/docs?q=a&amp;b=c</link></item><item><title>bad</title><link>http://127.0.0.1</link></item></channel></rss>";
    assert_eq!(
        rss_links(rss),
        vec![(
            "Official & docs".into(),
            "https://example.com/docs?q=a&b=c".into()
        )]
    );
    let article = format!(
        "<body><script>ignore me</script><main>{}</main></body>",
        "useful text ".repeat(20)
    );
    assert!(!source_text(&article).contains("ignore me"));
}

#[test]
fn chinese_prose_does_not_become_part_of_the_github_repository_url() {
    assert_eq!(
        input_urls("我要学习 https://github.com/liyupi/ai-guide中的 vibecoding 技巧"),
        vec!["https://github.com/liyupi/ai-guide"]
    );
    assert_eq!(
        input_urls("总结 [文档](https://example.com/docs)中的内容"),
        vec!["https://example.com/docs"]
    );
    assert_eq!(
        input_urls("https://example.com/中文文档/开始"),
        vec!["https://example.com/%E4%B8%AD%E6%96%87%E6%96%87%E6%A1%A3/%E5%BC%80%E5%A7%8B"]
    );
}
#[test]
fn github_readme_external_tutorial_is_followed_but_repo_navigation_is_not() {
    let html = "<nav><a href='https://ads.example.com/tutorial'>Tutorial advertisement</a></nav><main><article><a href='/liyupi/ai-guide/issues'>Issues</a><a href='/liyupi/ai-guide/pulls'>Pull requests</a><a href='https://ai.codefather.cn/vibe'>Vibe Coding 零基础入门教程</a><a href='/liyupi/ai-guide/blob/main/技巧.md'>编程技巧</a></article></main>";
    let links = related_links(html, "https://github.com/liyupi/ai-guide");
    assert!(
        links
            .iter()
            .any(|(_, url)| url == "https://ai.codefather.cn/vibe")
    );
    assert!(
        links
            .iter()
            .any(|(_, url)| url.ends_with("%E6%8A%80%E5%B7%A7.md"))
    );
    assert!(!links.iter().any(|(_, url)| url.contains("/issues")
        || url.contains("/pulls")
        || url.contains("ads.example")));
}
#[test]
fn article_body_wins_over_a_long_site_shell_and_login_previews_are_not_evidence() {
    let body = "Vibe Coding 的上下文管理实践，应先提供项目约束再逐步验证代码。".repeat(10);
    let html = format!(
        "<main><div>{}</div><article>{body}</article></main>",
        "平台资讯导航推荐内容".repeat(100)
    );
    let extracted = source_text(&html);
    assert!(extracted.starts_with("Vibe Coding"));
    assert!(!extracted.contains("平台资讯"));
    let preview = format!(
        "<main><article>{}<p>点击登录查看完整内容</p></article></main>",
        "课程简介".repeat(40)
    );
    assert!(source_text(&preview).is_empty());
}

#[test]
fn specified_material_requires_readable_evidence_from_its_own_link_chain() {
    let root = "https://github.com/liyupi/ai-guide".to_string();
    let source = |origin: Option<String>| Source {
        title: "Guide".into(),
        url: "https://docs.example.com/guide".into(),
        excerpt: "具体的上下文管理技巧和实践步骤。".repeat(20),
        origin_url: origin,
    };
    assert!(validate_source_evidence(&[], std::slice::from_ref(&root)).is_err());
    assert!(validate_source_evidence(&[source(None)], std::slice::from_ref(&root)).is_err());
    assert!(
        validate_source_evidence(&[source(Some(root.clone()))], std::slice::from_ref(&root))
            .is_ok()
    );
    assert!(validate_source_evidence(&[], &[]).is_ok());
    let mut preview = source(Some(root.clone()));
    preview.excerpt = "点击登录查看完整内容".into();
    assert!(validate_source_evidence(&[preview], &[root]).is_err());
}
#[test]
fn grounded_documents_must_cite_available_sources() {
    let mut files = vec![Material {
        name: "01-guide.md".into(),
        title: "Guide".into(),
        markdown: "通用教材，没有任何来源引用".into(),
    }];
    assert!(validate_source_citations(&files, 1, true).is_err());
    files[0].markdown = "上下文管理：先提供约束，再逐步验证。[1]".into();
    assert!(validate_source_citations(&files, 1, true).is_ok());
    assert!(validate_source_citations(&files, 0, true).is_err());
    files[0].markdown = "通用学习内容".into();
    assert!(validate_source_citations(&files, 0, false).is_ok());
}

#[test]
fn persisted_source_constraint_does_not_disappear_when_history_is_trimmed() {
    let options:LearningOptions=serde_json::from_value(serde_json::json!({"modelId":"custom","sourceUrls":["https://github.com/liyupi/ai-guide"],"requirements":"ignored"})).unwrap();
    assert_eq!(
        required_source_urls(
            &serde_json::json!([{ "role":"user","text":"继续讲上下文技巧" }]),
            &options
        ),
        vec!["https://github.com/liyupi/ai-guide"]
    );
}

#[tokio::test]
async fn source_timeouts_report_the_actual_failure_category() {
    // Keep the listener alive without serving HTTP so the response deterministically times out.
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let url = reqwest::Url::parse(&format!("http://{}", listener.local_addr().unwrap())).unwrap();
    let client = reqwest::Client::builder()
        .no_proxy()
        .timeout(std::time::Duration::from_millis(30))
        .build()
        .unwrap();
    let error = fetch(&client, url).await.unwrap_err();
    assert!(error.contains("来源请求超时"), "{error}");
}

#[tokio::test]
#[ignore = "requires live search engines; run explicitly for source fallback verification"]
async fn live_prompt_search_reads_alternative_sources() {
    let (sources, warning) = collect_sources(
        "Prompt 提示词 设计原则 实践案例",
        vec![],
        &Progress::default(),
    )
    .await
    .unwrap();
    eprintln!("read {} sources; {}", sources.len(), warning);
    for source in &sources {
        eprintln!("{} · {} chars", source.url, source.excerpt.chars().count());
    }
    assert!(
        sources
            .iter()
            .any(|source| source.url.contains("prompt") && source.excerpt.chars().count() > 100),
        "search must reach a readable Prompt alternative: {warning}"
    );
}
