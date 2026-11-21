//! Content readers. GitHub uses repository contents, not its navigation shell.
use super::{
    contracts::Source,
    policy::*,
    research::{body_text, fetch, page_title, public_url},
};
use base64::Engine;
use scraper::{Html, Selector};
use serde_json::Value;
use std::collections::HashSet;

#[derive(Clone)]
pub(crate) struct Page {
    pub(crate) source: Source,
    pub(crate) links: Vec<(String, String)>,
    pub(crate) notice: Option<String>,
}

pub(crate) fn is_restricted_preview(text: &str) -> bool {
    [
        "点击登录查看完整内容",
        "登录后查看全文",
        "登录后查看完整内容",
        "付费后查看全文",
        "订阅后阅读全文",
    ]
    .iter()
    .any(|marker| text.contains(marker))
        || text.to_lowercase().contains("sign in to read the full")
}

pub(crate) fn link_score(title: &str, path: &str, query: &str) -> usize {
    let hint = format!("{title} {path}").to_lowercase();
    let compact: String = hint.chars().filter(|c| c.is_alphanumeric()).collect();
    let mut score = 0;
    for token in query
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| w.chars().count() >= 2)
    {
        if compact.contains(&token.to_lowercase()) {
            score += 20;
        }
    }
    // A Chinese question often has no word separators; reward matching pairs without taking a whole sentence as a token.
    let chinese: Vec<char> = query
        .chars()
        .filter(|c| ('\u{4e00}'..='\u{9fff}').contains(c))
        .collect();
    for pair in chinese.windows(2) {
        if hint.contains(&pair.iter().collect::<String>()) {
            score += 3;
        }
    }
    for word in [
        "doc",
        "guide",
        "learn",
        "tutorial",
        "start",
        "concept",
        "faq",
        "example",
        "overview",
        "readme",
        "文档",
        "入门",
        "教程",
        "概念",
        "案例",
        "指南",
        "常见问题",
        "技巧",
        "实践",
        "章节",
        "上下文",
    ] {
        if hint.contains(word) {
            score += 2;
        }
    }
    if path.to_lowercase().ends_with(".md") {
        score += 3;
    }
    score
}

fn navigation(url: &reqwest::Url, title: &str) -> bool {
    let title = title.to_lowercase();
    let path = url.path().to_lowercase();
    if [
        "login", "signin", "signup", "privacy", "terms", "pricing", "登录", "注册",
    ]
    .iter()
    .any(|word| title.contains(word) || path.split('/').any(|part| part == *word))
    {
        return true;
    }
    if [".png", ".jpg", ".svg", ".gif", ".zip", ".mp4"]
        .iter()
        .any(|ext| path.ends_with(ext))
    {
        return true;
    }
    if url.host_str() == Some("github.com") {
        let parts: Vec<_> = path.trim_matches('/').split('/').collect();
        return parts.len() < 2
            || parts
                .get(2)
                .is_some_and(|part| !["blob", "tree", "raw"].contains(part));
    }
    [".png", ".jpg", ".svg", ".gif", ".zip", ".mp4"]
        .iter()
        .any(|ext| path.ends_with(ext))
}

pub(crate) fn rank_links(
    candidates: Vec<(String, String)>,
    base: &str,
    query: &str,
) -> Vec<(String, String)> {
    let Ok(base) = public_url(base) else {
        return vec![];
    };
    let mut seen = HashSet::new();
    let mut ranked = Vec::new();
    for (title, raw) in candidates {
        let Ok(mut url) = base.join(&raw) else {
            continue;
        };
        url.set_fragment(None);
        if public_url(url.as_str()).is_err()
            || url == base
            || navigation(&url, &title)
            || !seen.insert(url.to_string())
        {
            continue;
        }
        // Score the link itself, never the common repository/site prefix (e.g. ai-guide).
        let path = if url.host_str() == Some("github.com") {
            url.path().split('/').skip(5).collect::<Vec<_>>().join("/")
        } else {
            url.path().to_owned()
        };
        let score = link_score(&title, &path, query);
        if score > 0 {
            ranked.push((
                score,
                title.chars().take(200).collect::<String>(),
                url.to_string(),
            ));
        }
    }
    ranked.sort_by_key(|item| std::cmp::Reverse(item.0));
    ranked
        .into_iter()
        .take(MAX_PAGE_LINKS)
        .map(|(_, title, url)| (title, url))
        .collect()
}

pub(crate) fn html_links(html: &str, base: &str, query: &str) -> Vec<(String, String)> {
    let doc = Html::parse_document(html);
    let containers = [
        "article",
        "[data-testid='readme']",
        ".markdown-body",
        "main",
        "body",
    ];
    let root = containers
        .iter()
        .find_map(|selector| doc.select(&Selector::parse(selector).unwrap()).next());
    let selector = Selector::parse("a[href]").unwrap();
    let anchors: Vec<_> = match root {
        Some(root) => root.select(&selector).collect(),
        None => doc.select(&selector).collect(),
    };
    let candidates = anchors
        .into_iter()
        .filter(|anchor| {
            !anchor.ancestors().any(|node| {
                node.value()
                    .as_element()
                    .is_some_and(|el| ["nav", "header", "footer", "aside"].contains(&el.name()))
            })
        })
        .filter_map(|anchor| {
            let href = anchor.value().attr("href")?;
            if href.starts_with('#') {
                return None;
            }
            Some((anchor.text().collect::<Vec<_>>().join(" "), href.to_owned()))
        })
        .collect();
    rank_links(candidates, base, query)
}

// Inline, reference-style and autolinks from Markdown. Code fences are not crawl instructions.
pub(crate) fn markdown_links(text: &str, base: &str, query: &str) -> Vec<(String, String)> {
    let mut definitions = std::collections::HashMap::new();
    let mut body = String::new();
    let mut fenced = false;
    for line in text.lines() {
        if line.trim_start().starts_with("```") || line.trim_start().starts_with("~~~") {
            fenced = !fenced;
            continue;
        }
        if fenced {
            continue;
        }
        if let Some((key, target)) = line
            .trim()
            .strip_prefix('[')
            .and_then(|s| s.split_once("]:"))
        {
            definitions.insert(
                key.to_lowercase(),
                target
                    .split_whitespace()
                    .next()
                    .unwrap_or("")
                    .trim_matches(['<', '>'])
                    .to_owned(),
            );
        } else {
            body.push_str(line);
            body.push('\n');
        }
    }
    let mut candidates = Vec::new();
    let mut rest = body.as_str();
    while let Some(start) = rest.find('[') {
        let image = start > 0 && rest.as_bytes()[start - 1] == b'!';
        rest = &rest[start + 1..];
        let Some((label, after)) = rest.split_once(']') else {
            break;
        };
        rest = after;
        if image {
            continue;
        }
        if let Some(after) = after.strip_prefix('(') {
            let mut depth = 0;
            let end = after.char_indices().find_map(|(i, c)| {
                if c == ')' && depth == 0 {
                    Some(i)
                } else {
                    if c == '(' {
                        depth += 1;
                    }
                    if c == ')' {
                        depth -= 1;
                    }
                    None
                }
            });
            if let Some(end) = end {
                let raw = after[..end]
                    .split_whitespace()
                    .next()
                    .unwrap_or("")
                    .trim_matches(['<', '>']);
                candidates.push((label.to_owned(), raw.to_owned()));
                rest = &after[end + 1..];
            }
        } else {
            let key = after
                .strip_prefix('[')
                .and_then(|s| s.split_once(']'))
                .map(|(key, _)| if key.is_empty() { label } else { key })
                .unwrap_or(label);
            if let Some(target) = definitions.get(&key.to_lowercase()) {
                candidates.push((label.to_owned(), target.clone()));
            }
        }
    }
    for raw in super::research::input_urls(&body) {
        candidates.push((String::new(), raw));
    }
    rank_links(candidates, base, query)
}

fn focused_excerpt(text: &str, query: &str) -> String {
    let chars: Vec<_> = text.chars().collect();
    if chars.len() <= MAX_EXCERPT_CHARS {
        return text.to_owned();
    }
    let blocks: Vec<String> = chars
        .chunks(1100)
        .map(|part| part.iter().collect())
        .collect();
    let mut scores: Vec<_> = blocks
        .iter()
        .enumerate()
        .map(|(index, block)| (index, link_score(block, "", query)))
        .collect();
    scores.sort_by_key(|item| std::cmp::Reverse(item.1));
    let mut chosen = std::collections::BTreeSet::from([0]);
    for (index, _) in scores {
        if chosen.len() >= 7 {
            break;
        }
        chosen.insert(index);
        if index + 1 < blocks.len() && chosen.len() < 7 {
            chosen.insert(index + 1);
        }
    }
    let excerpt = chosen
        .into_iter()
        .map(|index| blocks[index].as_str())
        .collect::<Vec<_>>()
        .join("\n[正文节选分隔]\n");
    format!("[长文已按学习目标节选，未覆盖原文全部内容]\n{excerpt}")
        .chars()
        .take(MAX_EXCERPT_CHARS)
        .collect()
}

pub(crate) fn page_from_text(text: &str, url: &str, title: &str, query: &str) -> Page {
    let lower = text.trim_start().to_lowercase();
    let html = lower.starts_with("<!doctype")
        || lower.contains("<html")
        || lower.contains("<article")
        || lower.contains("<main")
        || lower.contains("<body");
    let restricted = is_restricted_preview(text);
    let excerpt = if restricted {
        String::new()
    } else if html {
        body_text(text)
    } else {
        text.to_owned()
    };
    Page {
        notice: restricted.then(|| "页面仅提供预览，需要登录或订阅才能阅读完整正文".into()),
        source: Source {
            title: if html {
                page_title(text, title)
            } else {
                title.to_owned()
            },
            url: url.to_owned(),
            excerpt: focused_excerpt(&excerpt, query),
            origin_url: None,
        },
        links: if html {
            html_links(text, url, query)
        } else {
            markdown_links(text, url, query)
        },
    }
}

pub(crate) fn github_api_url(url: &reqwest::Url) -> Option<reqwest::Url> {
    if url.host_str() != Some("github.com") {
        return None;
    }
    let parts: Vec<_> = url.path().trim_matches('/').split('/').collect();
    if parts.len() < 2 || parts[..2].iter().any(|p| p.is_empty()) {
        return None;
    }
    let root = format!(
        "https://api.github.com/repos/{}/{}",
        parts[0],
        parts[1].trim_end_matches(".git")
    );
    if parts.len() == 2 {
        return reqwest::Url::parse(&format!("{root}/readme")).ok();
    }
    if parts.len() < 4 || !["blob", "tree", "raw"].contains(&parts[2]) {
        return None;
    }
    let path = parts[4..].join("/");
    let mut api = reqwest::Url::parse(&format!("{root}/contents/{path}")).ok()?;
    api.set_query(Some(&format!("ref={}", parts[3])));
    Some(api)
}

pub(crate) fn github_page(value: &Value, input: &str, query: &str) -> Result<Page, String> {
    if let Some(entries) = value.as_array() {
        let candidates = entries
            .iter()
            .filter_map(|entry| {
                Some((
                    entry["name"].as_str()?.to_owned(),
                    entry["html_url"].as_str()?.to_owned(),
                ))
            })
            .collect();
        return Ok(Page {
            source: Source {
                title: "GitHub 文档目录".into(),
                url: input.into(),
                excerpt: String::new(),
                origin_url: None,
            },
            notice: None,
            links: rank_links(candidates, input, query),
        });
    }
    if value["encoding"] != "base64" {
        return Err("GitHub 未返回可读取文件内容".into());
    }
    let encoded = value["content"]
        .as_str()
        .ok_or("GitHub 文件正文缺失")?
        .split_whitespace()
        .collect::<String>();
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .map_err(|_| "GitHub 文件正文编码无效")?;
    if bytes.len() > MAX_SOURCE_BYTES {
        return Err("GitHub 文档过大".into());
    }
    let body = String::from_utf8(bytes).map_err(|_| "GitHub 文件不是 UTF-8 文本")?;
    let url = value["html_url"]
        .as_str()
        .ok_or("GitHub 文件来源链接缺失")?;
    public_url(url)?;
    Ok(page_from_text(
        &body,
        url,
        value["name"].as_str().unwrap_or("GitHub 文档"),
        query,
    ))
}

pub(crate) async fn read_page(
    client: &reqwest::Client,
    input: &str,
    query: &str,
) -> Result<Page, String> {
    let url = public_url(input)?;
    let mut api_error = None;
    if let Some(api) = github_api_url(&url) {
        match fetch(client, api)
            .await
            .and_then(|(body, _)| {
                serde_json::from_str::<Value>(&body).map_err(|_| "GitHub 返回的目录数据无效".into())
            })
            .and_then(|value| github_page(&value, input, query))
        {
            Ok(mut page) => {
                if page.links.is_empty() && url.path().trim_matches('/').split('/').count() == 2 {
                    let api = reqwest::Url::parse(&format!(
                        "https://api.github.com/repos/{}/contents",
                        url.path().trim_matches('/')
                    ))
                    .map_err(|_| "GitHub 仓库链接无效")?;
                    if let Ok((body, _)) = fetch(client, api).await
                        && let Ok(value) = serde_json::from_str::<Value>(&body)
                        && let Ok(directory) = github_page(&value, input, query)
                    {
                        page.links = directory.links;
                    }
                }
                return Ok(page);
            }
            Err(error) => api_error = Some(error),
        }
    }
    let (body, resolved) = fetch(client, url).await.map_err(|error| match api_error {
        Some(api) => format!("GitHub 正文接口：{api}；网页读取：{error}"),
        None => error,
    })?;
    Ok(page_from_text(&body, resolved.as_str(), input, query))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn github_readme_is_decoded_as_markdown_with_relative_and_reference_links() {
        let markdown = format!(
            "# Vibe Coding\n{}\n[上下文技巧](docs/context.md)\n[实践案例][practice]\n[practice]: https://docs.example.com/guide\n",
            "先提供上下文，再分步实现和测试验证。".repeat(10)
        );
        let value = serde_json::json!({"encoding":"base64","content":base64::engine::general_purpose::STANDARD.encode(markdown.as_bytes()),"name":"README.md","html_url":"https://github.com/owner/repo/blob/dev/README.md"});
        let page = github_page(&value, "https://github.com/owner/repo", "上下文技巧").unwrap();
        assert!(page.source.excerpt.contains("分步实现"));
        assert!(
            page.links
                .iter()
                .any(|(_, url)| url == "https://github.com/owner/repo/blob/dev/docs/context.md")
        );
        assert!(
            page.links
                .iter()
                .any(|(_, url)| url == "https://docs.example.com/guide")
        );
        assert_eq!(
            github_api_url(&public_url("https://github.com/owner/repo").unwrap())
                .unwrap()
                .as_str(),
            "https://api.github.com/repos/owner/repo/readme"
        );
        assert_eq!(
            github_api_url(
                &public_url("https://github.com/owner/repo/blob/dev/docs/context.md").unwrap()
            )
            .unwrap()
            .as_str(),
            "https://api.github.com/repos/owner/repo/contents/docs/context.md?ref=dev"
        );
    }
    #[test]
    fn github_directory_discovers_docs_but_rejects_navigation_and_binary_assets() {
        let page=github_page(&serde_json::json!([
            {"name":"docs","html_url":"https://github.com/owner/repo/tree/main/docs"},
            {"name":"编程技巧.md","html_url":"https://github.com/owner/repo/blob/main/tips.md"},
            {"name":"tutorial.svg","html_url":"https://github.com/owner/repo/blob/main/tutorial.svg"},
            {"name":"issues","html_url":"https://github.com/owner/repo/issues"}
        ]),"https://github.com/owner/repo","编程技巧").unwrap();
        assert!(page.links.iter().any(|(_, url)| url.ends_with("/docs")));
        assert!(page.links.iter().any(|(_, url)| url.ends_with("/tips.md")));
        assert!(
            !page
                .links
                .iter()
                .any(|(_, url)| url.ends_with(".svg") || url.ends_with("issues"))
        );
    }
    #[test]
    fn long_documents_retain_the_requested_topic_instead_of_only_the_introduction() {
        let text = format!(
            "# 项目介绍\n{}\n# Vibe Coding 上下文技巧\n先提供项目约束，再逐步实现并测试验证。这是目标章节中的独特步骤。\n{}",
            "无关的项目安装与公告信息。\n".repeat(1200),
            "其他背景资料。\n".repeat(500)
        );
        let page = page_from_text(
            &text,
            "https://example.com/guide.md",
            "Guide",
            "Vibe Coding 上下文技巧",
        );
        assert!(page.source.excerpt.contains("目标章节中的独特步骤"));
        assert!(page.source.excerpt.chars().count() <= MAX_EXCERPT_CHARS);
    }

    #[test]
    fn a_login_gate_outside_the_article_rejects_the_preview_but_keeps_content_links() {
        let html = format!(
            "<html><main><article>{}<a href='/guide/chapter'>实践章节</a></article><div>点击登录查看完整内容</div></main></html>",
            "Vibe Coding课程简介与宣传内容。".repeat(20)
        );
        let page = page_from_text(
            &html,
            "https://example.com/guide",
            "Guide",
            "Vibe Coding 实践",
        );
        assert!(page.notice.is_some());
        assert!(page.source.excerpt.is_empty());
        assert_eq!(page.links[0].1, "https://example.com/guide/chapter");
    }
}

#[cfg(test)]
mod live_tests {
    use super::*;
    #[tokio::test]
    #[ignore = "requires live GitHub and the machine's network/proxy configuration"]
    async fn supplied_github_repository_can_be_read_through_the_system_network() {
        let client = super::super::research::research_client().unwrap();
        let page = tokio::time::timeout(
            std::time::Duration::from_secs(40),
            read_page(
                &client,
                "https://github.com/liyupi/ai-guide",
                "Vibe Coding 技巧",
            ),
        )
        .await
        .unwrap()
        .unwrap();
        assert!(
            page.source.excerpt.chars().count() > 100,
            "must retrieve repository content, not merely a successful status"
        );
        assert!(
            !page.links.is_empty(),
            "must discover content links from the repository"
        );
        eprintln!(
            "Read {} characters from {}; content links: {:?}",
            page.source.excerpt.chars().count(),
            page.source.url,
            page.links
        );
        let tutorial = read_page(&client, "https://ai.codefather.cn/vibe", "Vibe Coding 技巧")
            .await
            .unwrap();
        eprintln!(
            "External tutorial: {}; readable characters: {}; boundary: {:?}",
            tutorial.source.url,
            tutorial.source.excerpt.chars().count(),
            tutorial.notice
        );
        if tutorial.notice.is_some() {
            assert!(
                tutorial.source.excerpt.is_empty(),
                "a restricted preview must not become teaching evidence"
            );
        }
    }
}
