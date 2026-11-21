//! Existing execution limits, centralized for future upgrades.
pub(crate) const MODEL_DEFAULT_TIMEOUT_SECS: u64 = 30;
pub(crate) const MODEL_TOTAL_TIMEOUT_SECS: u64 = 900;
pub(crate) const MODEL_CONNECT_TIMEOUT_SECS: u64 = 15;
pub(crate) const MODEL_IDLE_TIMEOUT_SECS: u64 = 120;
pub(crate) const SOURCE_TIMEOUT_SECS: u64 = 15;
pub(crate) const MAX_SOURCE_BYTES: usize = 2_000_000;
pub(crate) const MAX_COMPLETION_BYTES: usize = 2_000_000;
pub(crate) const MAX_EXCERPT_CHARS: usize = 10_000;
pub(crate) const EARLY_CANCELLATIONS: usize = 256;

// Bounded iterative source reading. One round may follow up to this many content links.
pub(crate) const MAX_RESEARCH_REQUESTS: usize = 18;
pub(crate) const MAX_RESEARCH_SOURCES: usize = 12;
pub(crate) const MAX_RESEARCH_DEPTH: usize = 3;
pub(crate) const MAX_PAGE_LINKS: usize = 8;
pub(crate) const RESEARCH_READ_TIMEOUT_SECS: u64 = 120;
