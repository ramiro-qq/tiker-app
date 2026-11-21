//! Bounded content traversal. Source lineage is retained through every followed link.
use super::{
    contracts::Source,
    pages::{Page, read_page},
    policy::*,
    runtime::Progress,
};
use std::{
    collections::{HashMap, HashSet, VecDeque},
    future::Future,
    time::{Duration, Instant},
};

pub(crate) struct Crawl {
    sources: Vec<Source>,
    seen: HashSet<(String, Option<String>)>,
    pages: HashMap<String, Page>,
    warnings: Vec<String>,
    denied_hosts: HashSet<String>,
    started: Instant,
    requests: usize,
}
impl Default for Crawl {
    fn default() -> Self {
        Self {
            sources: vec![],
            seen: HashSet::new(),
            pages: HashMap::new(),
            warnings: vec![],
            denied_hosts: HashSet::new(),
            started: Instant::now(),
            requests: 0,
        }
    }
}
impl Crawl {
    pub(crate) async fn read(
        &mut self,
        client: &reqwest::Client,
        query: &str,
        roots: Vec<(String, Option<String>)>,
        progress: &Progress,
    ) {
        self.read_with(roots, progress, |url| async move {
            read_page(client, &url, query).await
        })
        .await;
        progress.send("research-read-summary", "资料读取汇总", if self.sources.is_empty() { "warning" } else { "done" },
            format!("已读取 {} 份正文，{} 条读取限制或缺口。单个来源不可读不代表整个研究失败；接下来筛选正文相关性。", self.sources.len(), self.warnings.len()));
    }
    async fn read_with<F, Fut>(
        &mut self,
        roots: Vec<(String, Option<String>)>,
        progress: &Progress,
        mut reader: F,
    ) where
        F: FnMut(String) -> Fut,
        Fut: Future<Output = Result<Page, String>>,
    {
        let mut queue: VecDeque<_> = roots
            .into_iter()
            .map(|(url, origin)| (url, origin, 0))
            .collect();
        while let Some((url, origin, depth)) = queue.pop_front() {
            let host = reqwest::Url::parse(&url)
                .ok()
                .and_then(|u| u.host_str().map(str::to_owned));
            // Explicit user sources must each be checked; automatic candidates can
            // move to another host after an access denial instead of wasting slots.
            if origin.is_none() && host.as_ref().is_some_and(|h| self.denied_hosts.contains(h)) {
                continue;
            }
            if (self.requests >= MAX_RESEARCH_REQUESTS && !self.pages.contains_key(&url))
                || self.sources.len() >= MAX_RESEARCH_SOURCES
            {
                self.warnings
                    .push("达到本轮阅读数量上限，可能仍有未读取章节".into());
                break;
            }
            let Some(remaining) =
                Duration::from_secs(RESEARCH_READ_TIMEOUT_SECS).checked_sub(self.started.elapsed())
            else {
                self.warnings.push("达到本轮资料读取时间上限".into());
                break;
            };
            if !self.seen.insert((url.clone(), origin.clone())) {
                continue;
            }
            let id = format!("read:{url}");
            progress.send(
                &id,
                if depth == 0 {
                    "读取学习来源"
                } else {
                    "下钻相关章节"
                },
                "running",
                format!("{url}\n阅读层级 {depth}"),
            );
            let result = match self.pages.get(&url) {
                Some(page) => Ok(Ok(page.clone())),
                None => {
                    self.requests += 1;
                    tokio::time::timeout(remaining, reader(url.clone())).await
                }
            };
            match result {
                Ok(Ok(mut page)) => {
                    let resolved = page.source.url.clone();
                    self.pages.insert(url, page.clone());
                    self.pages.insert(resolved.clone(), page.clone());
                    self.seen.insert((resolved.clone(), origin.clone()));
                    page.source.origin_url = origin.clone();
                    if page.source.excerpt.trim().chars().count() > 100 {
                        let count = page.source.excerpt.chars().count();
                        if !self
                            .sources
                            .iter()
                            .any(|source| source.url == resolved && source.origin_url == origin)
                        {
                            self.sources.push(page.source);
                        }
                        progress.send(
                            &id,
                            "正文已读取",
                            "done",
                            format!(
                                "{resolved}\n已读取 {count} 字符；待筛选资料 {} 份",
                                self.sources.len()
                            ),
                        );
                    } else {
                        let warning = format!(
                            "{resolved}：{}",
                            page.notice.unwrap_or_else(|| {
                                "未取得可用正文，页面可能是目录或需要动态加载".into()
                            })
                        );
                        progress.send(&id, "正文不可用", "warning", warning.clone());
                        self.warnings.push(warning);
                    }
                    if depth < MAX_RESEARCH_DEPTH {
                        for (_, child) in page.links {
                            if !self.seen.contains(&(child.clone(), origin.clone())) {
                                queue.push_back((child, origin.clone(), depth + 1));
                            }
                        }
                    } else if !page.links.is_empty() {
                        self.warnings
                            .push(format!("{resolved}：达到下钻深度上限，部分章节未读取"));
                    }
                }
                result => {
                    let reason = match result {
                        Ok(Err(error)) => error,
                        _ => "本轮资料读取超时".into(),
                    };
                    let warning = format!("{url}：{reason}");
                    if origin.is_none()
                        && ["HTTP 401", "HTTP 403", "HTTP 429"]
                            .iter()
                            .any(|code| reason.contains(code))
                    {
                        if let Some(host) = host {
                            self.denied_hosts.insert(host);
                        }
                    }
                    progress.send(
                        &id,
                        if origin.is_none() {
                            "此来源不可读，继续尝试其他候选"
                        } else {
                            "指定来源读取失败"
                        },
                        "warning",
                        warning.clone(),
                    );
                    self.warnings.push(warning);
                }
            }
        }
    }
    pub(crate) fn finish(self) -> (Vec<Source>, String) {
        let mut warnings = self.warnings;
        if self.sources.is_empty() {
            warnings.push("本次未取得可用于学习的公开正文".into());
        }
        (self.sources, warnings.join("；"))
    }
}

#[cfg(test)]
mod tests {
    use super::super::pages::page_from_text;
    use super::*;
    #[tokio::test]
    async fn explicit_sources_on_a_denied_host_are_still_checked_individually() {
        let mut crawl = Crawl::default();
        let first = "https://source.example.com/locked";
        let second = "https://source.example.com/open";
        crawl
            .read_with(
                vec![
                    (first.into(), Some(first.into())),
                    (second.into(), Some(second.into())),
                ],
                &Progress::default(),
                |url| async move {
                    if url.ends_with("locked") {
                        return Err("来源返回 HTTP 403".into());
                    }
                    Ok(page_from_text(
                        &"指定资料实际教学正文与实践步骤。".repeat(20),
                        &url,
                        "Guide",
                        "guide",
                    ))
                },
            )
            .await;
        let (sources, warning) = crawl.finish();
        assert_eq!(sources.len(), 1);
        assert_eq!(sources[0].origin_url.as_deref(), Some(second));
        assert!(warning.contains(first));
        assert!(
            super::super::validation::validate_source_evidence(
                &sources,
                &[first.into(), second.into()]
            )
            .is_err()
        );
    }
    #[tokio::test]
    async fn denied_automatic_hosts_do_not_consume_the_remaining_read_budget() {
        let mut crawl = Crawl::default();
        let roots = (0..20)
            .map(|i| (format!("https://blocked.example.com/{i}"), None))
            .chain(std::iter::once((
                "https://readable.example.org/guide".into(),
                None,
            )))
            .collect();
        crawl
            .read_with(roots, &Progress::default(), |url| async move {
                if url.contains("blocked.example.com") {
                    return Err("来源返回 HTTP 403".into());
                }
                Ok(page_from_text(
                    &"实际教学正文与具体实践步骤。".repeat(20),
                    &url,
                    "Guide",
                    "guide",
                ))
            })
            .await;
        assert_eq!(crawl.requests, 2);
        assert_eq!(crawl.finish().0.len(), 1);
    }
    #[tokio::test]
    async fn follows_relevant_chapters_across_domains_and_multiple_levels_with_origin() {
        let root = "https://github.com/liyupi/ai-guide";
        let mut crawl = Crawl::default();
        crawl
            .read_with(
                vec![(root.into(), Some(root.into()))],
                &Progress::default(),
                |url| async move {
                    let body = match url.as_str() {
                        "https://github.com/liyupi/ai-guide" => {
                            "# Vibe Coding\n[技巧教程](https://docs.example.com/guide)".into()
                        }
                        "https://docs.example.com/guide" => {
                            "# 教程目录\n[上下文实践](./practice.md)".into()
                        }
                        "https://docs.example.com/practice.md" => format!(
                            "# 上下文实践\n{}",
                            "先提供项目上下文，分步实现并使用测试验证实际结果。".repeat(10)
                        ),
                        _ => panic!("unexpected read {url}"),
                    };
                    Ok(page_from_text(
                        &body,
                        &url,
                        "Vibe Coding",
                        "Vibe Coding 技巧",
                    ))
                },
            )
            .await;
        let (sources, _) = crawl.finish();
        assert_eq!(sources.len(), 1);
        assert_eq!(sources[0].url, "https://docs.example.com/practice.md");
        assert_eq!(sources[0].origin_url.as_deref(), Some(root));
    }
    #[tokio::test]
    async fn cyclic_links_are_read_once_and_read_budget_is_enforced() {
        let root = "https://example.com/guide";
        let reads = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let counter = reads.clone();
        let mut crawl = Crawl::default();
        crawl
            .read_with(
                vec![(root.into(), Some(root.into()))],
                &Progress::default(),
                move |url| {
                    counter.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                    async move {
                        Ok(page_from_text(
                            "# Guide\n[guide](https://example.com/guide)",
                            &url,
                            "Guide",
                            "guide",
                        ))
                    }
                },
            )
            .await;
        assert_eq!(reads.load(std::sync::atomic::Ordering::SeqCst), 1);
        let mut crawl = Crawl::default();
        let roots = (0..50)
            .map(|i| (format!("https://example.com/docs/{i}"), None))
            .collect();
        crawl
            .read_with(roots, &Progress::default(), |url| async move {
                Ok(page_from_text("# short", &url, "Guide", "guide"))
            })
            .await;
        assert_eq!(crawl.requests, MAX_RESEARCH_REQUESTS);
    }

    #[tokio::test]
    async fn overlapping_supplied_roots_keep_evidence_for_each_origin() {
        let root = "https://example.com/guide";
        let chapter = "https://example.com/guide/practice.md";
        let mut crawl = Crawl::default();
        crawl
            .read_with(
                vec![
                    (root.into(), Some(root.into())),
                    (chapter.into(), Some(chapter.into())),
                ],
                &Progress::default(),
                |url| async move {
                    let body = if url.ends_with(".md") {
                        format!(
                            "# Practice\n{}",
                            "Provide context and verify each step with tests. ".repeat(10)
                        )
                    } else {
                        "# Guide\n[Practice](./guide/practice.md)".into()
                    };
                    Ok(page_from_text(&body, &url, "Guide", "practice"))
                },
            )
            .await;
        assert_eq!(
            crawl.requests, 2,
            "overlapping roots must reuse the chapter read"
        );
        let (sources, _) = crawl.finish();
        super::super::validation::validate_source_evidence(
            &sources,
            &[root.into(), chapter.into()],
        )
        .unwrap();
    }
}

#[cfg(test)]
mod http_tests {
    use super::super::{pages::page_from_text, research::fetch};
    use super::*;
    use std::io::{Read, Write};
    #[tokio::test]
    async fn http_documents_are_read_before_a_deep_source_is_admitted() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        listener.set_nonblocking(true).unwrap();
        let server = std::thread::spawn(move || {
            let deadline = Instant::now() + Duration::from_secs(5);
            let mut paths = Vec::new();
            while paths.len() < 3 && Instant::now() < deadline {
                let (mut socket, _) = match listener.accept() {
                    Ok(value) => value,
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        std::thread::sleep(Duration::from_millis(5));
                        continue;
                    }
                    Err(error) => panic!("{error}"),
                };
                socket
                    .set_read_timeout(Some(Duration::from_secs(2)))
                    .unwrap();
                let mut request = Vec::new();
                let mut buffer = [0; 2048];
                while !request.windows(4).any(|w| w == b"\r\n\r\n") {
                    let size = socket.read(&mut buffer).unwrap();
                    if size == 0 {
                        break;
                    }
                    request.extend_from_slice(&buffer[..size]);
                }
                let request = String::from_utf8_lossy(&request);
                let path = request.split_whitespace().nth(1).unwrap().to_string();
                let body=match path.as_str(){
                    "/root"=>"<article><a href='https://docs.example.com/guide'>Vibe Coding 教程</a></article>".into(),
                    "/guide"=>"<article><a href='/chapter'>上下文技巧实践</a></article>".into(),
                    "/chapter"=>format!("<article><h1>上下文技巧</h1><p>{}</p></article>","先提供项目约束，再分步实现，最后执行测试验证。".repeat(15)),
                    _=>panic!("unexpected HTTP request {path}"),
                };
                paths.push(path);
                write!(socket,"HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",body.len()).unwrap();
            }
            paths
        });
        let client = reqwest::Client::new();
        let client_ref = &client;
        let root = "https://source.example.com/root";
        let mut crawl = Crawl::default();
        // Map public fixture URLs to a local server only in the test adapter.
        crawl
            .read_with(
                vec![(root.into(), Some(root.into()))],
                &Progress::default(),
                |url| async move {
                    let path = reqwest::Url::parse(&url).unwrap().path().to_string();
                    let local = reqwest::Url::parse(&format!("http://{address}{path}")).unwrap();
                    let (body, _) = fetch(client_ref, local).await?;
                    Ok(page_from_text(
                        &body,
                        &url,
                        "Guide",
                        "Vibe Coding 上下文技巧",
                    ))
                },
            )
            .await;
        let (sources, _) = crawl.finish();
        assert_eq!(server.join().unwrap(), vec!["/root", "/guide", "/chapter"]);
        assert_eq!(sources.len(), 1);
        assert_eq!(sources[0].origin_url.as_deref(), Some(root));
        assert!(sources[0].excerpt.contains("测试验证"));
    }
}
