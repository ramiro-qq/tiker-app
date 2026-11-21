//! Shared Agent implementation. Tauri commands remain in the feature adapters.
pub(crate) mod completion;
pub(crate) mod contracts;
pub(crate) mod learning;
mod policy;
mod prompts;
mod research;
pub(crate) mod runtime;
#[cfg(test)]
mod tests;
pub(crate) mod validation;

mod crawl;
mod pages;

pub(crate) mod illustrations;
