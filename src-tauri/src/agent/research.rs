use super::{contracts::Source, policy::*, runtime::Progress, validation::bounded};
use scraper::{Html, Selector};
use std::{collections::HashSet, net::IpAddr, time::Duration};

pub(crate) fn public_url(raw: &str) -> Result<reqwest::Url, String> {
    let url = reqwest::Url::parse(raw).map_err(|_| "无效来源链接")?;
    let host = url.host_str().ok_or("无效来源域名")?;
    if !matches!(url.scheme(), "https" | "http")
        || !url.username().is_empty()
        || url.password().is_some()
        || host == "localhost"
        || host.ends_with(".local")
        || host.ends_with(".localhost")
        || url.port().is_some()
    {
        return Err("来源不是公开网页".into());
    }
    if let Ok(ip) = host.trim_matches(['[', ']']).parse::<IpAddr>() {
        let private = match ip {
            IpAddr::V4(ip) => {
                ip.is_private() || ip.is_loopback() || ip.is_link_local() || ip.is_unspecified()
            }
            IpAddr::V6(ip) => {
                ip.is_loopback()
                    || ip.is_unspecified()
                    || ip.is_unique_local()
                    || ip.is_unicast_link_local()
            }
        };
        if private {
            return Err("来源不是公开网页".into());
        }
    }
    Ok(url)
}
pub(crate) async fn fetch(
    client: &reqwest::Client,
    mut url: reqwest::Url,
) -> Result<(String, reqwest::Url), String> {
    let mut redirects = 0;
    let mut response = loop {
        let response = client
            .get(url.clone())
            .send()
            .await
            .map_err(source_request_error)?;
        if !response.status().is_redirection() {
            if !response.status().is_success() {
                let status = response.status().as_u16();
                return Err(match status {
                    401 | 403 => format!("来源返回 HTTP {status}：站点拒绝自动读取或要求授权"),
                    429 => "来源返回 HTTP 429：站点限制请求频率".into(),
                    _ => format!("来源返回 HTTP {status}"),
                });
            }
            break response;
        }
        if redirects >= 5 {
            return Err("来源重定向过多".into());
        }
        let next = response
            .headers()
            .get("location")
            .and_then(|h| h.to_str().ok())
            .ok_or("来源重定向无效")?;
        url = public_url(url.join(next).map_err(|_| "来源重定向无效")?.as_str())?;
        redirects += 1;
    };
    if !response
        .headers()
        .get("content-type")
        .and_then(|s| s.to_str().ok())
        .is_some_and(|s| {
            s.contains("text/html")
                || s.contains("text/plain")
                || s.contains("application/xhtml")
                || s.contains("xml")
                || s.contains("markdown")
                || (url.host_str() == Some("api.github.com") && s.contains("json"))
        })
    {
        return Err("来源不是可读取网页".into());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(source_request_error)? {
        if bytes.len() + chunk.len() > MAX_SOURCE_BYTES {
            return Err("来源页面过大".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok((String::from_utf8_lossy(&bytes).into_owned(), url))
}

fn source_request_error(error: reqwest::Error) -> String {
    if error.is_timeout() {
        return "来源请求超时，请检查网络、代理或网站响应后重试".into();
    }
    let connect = error.is_connect();
    let error = error.without_url();
    let mut cause: &dyn std::error::Error = &error;
    while let Some(next) = cause.source() {
        cause = next;
    }
    format!(
        "{}：{cause}",
        if connect {
            "来源连接失败，请检查网络、代理或站点证书"
        } else {
            "来源读取失败"
        }
    )
}
pub(crate) fn body_text(html: &str) -> String {
    let document = Html::parse_document(html);
    for selector in [
        "article",
        "[data-testid='readme']",
        ".markdown-body",
        "main",
        "body",
    ] {
        let selector = Selector::parse(selector).unwrap();
        if let Some(el) = document.select(&selector).next() {
            let text = el
                .descendants()
                .filter_map(|node| {
                    if node.ancestors().any(|a| {
                        a.value().as_element().is_some_and(|e| {
                            [
                                "script", "style", "nav", "footer", "header", "aside", "form",
                            ]
                            .contains(&e.name())
                        })
                    }) {
                        None
                    } else {
                        node.value().as_text().map(|s| s.to_string())
                    }
                })
                .collect::<Vec<_>>()
                .join(" ");
            let text = text.split_whitespace().collect::<Vec<_>>().join(" ");
            if super::pages::is_restricted_preview(&text) {
                return String::new();
            }
            if text.chars().count() > 100 {
                return text;
            }
        }
    }
    String::new()
}
#[cfg(test)]
pub(crate) fn source_text(html: &str) -> String {
    body_text(html).chars().take(MAX_EXCERPT_CHARS).collect()
}
pub(crate) fn search_links(html: &str) -> Vec<(String, String)> {
    let document = Html::parse_document(html);
    let selector = Selector::parse("a.result__a").unwrap();
    document
        .select(&selector)
        .filter_map(|a| {
            let href = a.value().attr("href")?;
            let resolved = reqwest::Url::parse(&format!(
                "https://duckduckgo.com{}",
                if href.starts_with('/') { href } else { "" }
            ))
            .ok();
            let target = resolved
                .and_then(|u| {
                    u.query_pairs()
                        .find(|(k, _)| k == "uddg")
                        .map(|(_, v)| v.into_owned())
                })
                .unwrap_or_else(|| href.to_string());
            public_url(&target)
                .ok()
                .map(|_| (a.text().collect::<String>(), target))
        })
        .take(10)
        .collect()
}
pub(crate) fn rss_links(xml: &str) -> Vec<(String, String)> {
    fn field(item: &str, tag: &str) -> Option<String> {
        let raw = item
            .split_once(&format!("<{tag}>"))?
            .1
            .split_once(&format!("</{tag}>"))?
            .0;
        Some(
            Html::parse_fragment(raw.trim_start_matches("<![CDATA[").trim_end_matches("]]>"))
                .root_element()
                .text()
                .collect(),
        )
    }
    xml.split("<item>")
        .skip(1)
        .filter_map(|item| {
            let title = field(item, "title")?;
            let url = field(item, "link")?;
            public_url(&url).ok().map(|_| (title, url))
        })
        .take(10)
        .collect()
}
pub(crate) fn research_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(SOURCE_TIMEOUT_SECS))
        .redirect(reqwest::redirect::Policy::none())
        .user_agent("Mozilla/5.0 (compatible; Tiker/1.0)")
        .build()
        .map_err(|e| e.to_string())
}
pub(crate) fn input_urls(text: &str) -> Vec<String> {
    let mut urls = Vec::new();
    let mut rest = text;
    while let Some(start) = rest
        .find("http://")
        .into_iter()
        .chain(rest.find("https://"))
        .min()
    {
        rest = &rest[start..];
        let mut depth = 0;
        let mut end = rest.len();
        for (i, c) in rest.char_indices() {
            if c.is_whitespace()
                || "<>\"'`，。；！？、（）【】]".contains(c)
                || (c == ')' && depth == 0)
            {
                end = i;
                break;
            }
            if c == '(' {
                depth += 1;
            }
            if c == ')' {
                depth -= 1;
            }
        }
        let candidate = rest[..end].trim_end_matches([',', '.', ';']);
        // Chinese prose adjoining an ASCII URL is not part of its path. Preserve real Unicode URLs.
        let raw = ["里面的", "中的", "里的", "上的"]
            .iter()
            .filter_map(|suffix| {
                let (prefix, _) = candidate.split_once(suffix)?;
                prefix.is_ascii().then_some(prefix)
            })
            .min_by_key(|prefix| prefix.len())
            .unwrap_or(candidate);
        if let Ok(mut url) = public_url(raw) {
            url.set_fragment(None);
            let url = url.to_string();
            if !urls.contains(&url) {
                urls.push(url);
            }
        }
        if urls.len() >= 3 || end == rest.len() {
            break;
        }
        rest = &rest[end..];
    }
    urls
}

pub(crate) fn history_urls(messages: &serde_json::Value) -> Vec<String> {
    let mut urls = Vec::new();
    if let Some(history) = messages.as_array() {
        for item in history.iter().rev().filter(|m| m["role"] == "user").take(8) {
            for url in input_urls(item["text"].as_str().unwrap_or("")) {
                if !urls.contains(&url) && urls.len() < 3 {
                    urls.push(url);
                }
            }
        }
    }
    urls
}
pub(crate) fn required_source_urls(
    messages: &serde_json::Value,
    options: &super::contracts::LearningOptions,
) -> Vec<String> {
    let mut urls = Vec::new();
    for raw in &options.source_urls {
        for url in input_urls(raw) {
            if !urls.contains(&url) && urls.len() < 3 {
                urls.push(url);
            }
        }
    }
    for url in history_urls(messages) {
        if !urls.contains(&url) && urls.len() < 3 {
            urls.push(url);
        }
    }
    urls
}
pub(crate) fn page_title(html: &str, fallback: &str) -> String {
    Html::parse_document(html)
        .select(&Selector::parse("title").unwrap())
        .next()
        .map(|e| e.text().collect::<String>())
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| fallback.to_owned())
        .chars()
        .take(200)
        .collect()
}
#[cfg(test)]
pub(crate) fn related_links(html: &str, base: &str) -> Vec<(String, String)> {
    super::pages::html_links(html, base, "")
}
pub(crate) async fn search_candidates(
    client: &reqwest::Client,
    query: &str,
    progress: &Progress,
    id: &str,
    label: &str,
) -> Vec<(String, String)> {
    progress.send(id, label, "running", query);
    let links = search_candidates_inner(client, query).await;
    progress.send(
        id,
        label,
        if links.is_empty() { "warning" } else { "done" },
        format!(
            "找到 {} 个候选页面，接下来读取正文并筛选相关性。",
            links.len()
        ),
    );
    links
}
pub(crate) async fn search_candidates_inner(
    client: &reqwest::Client,
    query: &str,
) -> Vec<(String, String)> {
    let mut search = reqwest::Url::parse("https://html.duckduckgo.com/html/").unwrap();
    search.query_pairs_mut().append_pair("q", query);
    let links = fetch(client, search)
        .await
        .map(|(h, _)| search_links(&h))
        .unwrap_or_default();
    if !links.is_empty() {
        return links;
    }
    let mut fallback = reqwest::Url::parse("https://www.bing.com/search").unwrap();
    fallback
        .query_pairs_mut()
        .append_pair("format", "rss")
        .append_pair("q", query);
    fetch(client, fallback)
        .await
        .map(|(h, _)| rss_links(&h))
        .unwrap_or_default()
}
// Search rank is only a candidate signal. Keep alternatives and prefer teaching
// content over dictionary/navigation results, then validate actual page bodies.
fn candidate_roots(
    groups: &[&Vec<(String, String)>],
    query: &str,
) -> Vec<(String, Option<String>)> {
    let mut ranked: Vec<_> = groups
        .iter()
        .map(|group| {
            let mut group = (*group).clone();
            group.sort_by_cached_key(|(title, url)| {
                let lexical = ["英文单词", "词典", "翻译", "dictionary", "工具导航"]
                    .iter()
                    .any(|word| title.to_lowercase().contains(word));
                let path = reqwest::Url::parse(url)
                    .map(|url| url.path().to_owned())
                    .unwrap_or_default();
                (
                    lexical,
                    std::cmp::Reverse(super::pages::link_score(title, &path, query)),
                )
            });
            group
        })
        .collect();
    let mut seen = HashSet::new();
    let mut roots = Vec::new();
    let count = ranked.iter().map(Vec::len).max().unwrap_or(0);
    for index in 0..count {
        for group in &mut ranked {
            if let Some((_, raw)) = group.get(index) {
                if let Ok(mut url) = public_url(raw) {
                    url.set_fragment(None);
                    if seen.insert(url.to_string()) {
                        roots.push((url.to_string(), None));
                    }
                }
            }
        }
    }
    roots
}

pub(crate) async fn collect_sources(
    query: &str,
    seed_urls: Vec<String>,
    progress: &Progress,
) -> Result<(Vec<Source>, String), String> {
    bounded(query, 500)?;
    let client = research_client()?;
    let mut crawl = super::crawl::Crawl::default();
    // Specified material gets the entire reading budget; general search must not replace it.
    if !seed_urls.is_empty() {
        let roots = seed_urls
            .into_iter()
            .map(|url| (url.clone(), Some(url)))
            .collect();
        crawl.read(&client, query, roots, progress).await;
    } else {
        let docs_query = format!("{query} official documentation concepts guide");
        let examples_query = format!("{query} tutorial practical example technical blog");
        let faq_query = format!("{query} FAQ common mistakes limitations troubleshooting");
        let (docs, examples, faq) = tokio::join!(
            search_candidates(
                &client,
                &docs_query,
                progress,
                "search-docs",
                "检索官方与技术文档"
            ),
            search_candidates(
                &client,
                &examples_query,
                progress,
                "search-examples",
                "检索实践案例与技术文章"
            ),
            search_candidates(
                &client,
                &faq_query,
                progress,
                "search-faq",
                "检索常见问题与限制"
            ),
        );
        let roots = candidate_roots(&[&docs, &examples, &faq], query);
        crawl.read(&client, query, roots, progress).await;
    }
    Ok(crawl.finish())
}

#[cfg(test)]
mod candidate_tests {
    use super::*;
    #[test]
    fn alternatives_are_retained_deduplicated_and_teaching_pages_precede_dictionary_entries() {
        let docs = vec![
            (
                "prompt（英文单词）_百度百科".into(),
                "https://baike.baidu.com/item/prompt/1".into(),
            ),
            (
                "Prompt 教程".into(),
                "https://docs.example.com/guide".into(),
            ),
            (
                "Prompt 实践".into(),
                "https://learn.example.org/tutorial".into(),
            ),
        ];
        let roots = candidate_roots(&[&docs, &docs], "Prompt");
        assert_eq!(roots.len(), 3);
        assert_eq!(roots[0].0, "https://docs.example.com/guide");
        assert!(
            roots
                .iter()
                .any(|(url, _)| url == "https://learn.example.org/tutorial")
        );
    }
}
