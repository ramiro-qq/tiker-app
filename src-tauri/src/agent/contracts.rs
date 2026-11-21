use super::runtime::Progress;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct Intent {
    pub(crate) kind: String,
    pub(crate) title: String,
    pub(crate) query: String,
    pub(crate) reply: String,
    #[serde(default, rename = "seedUrls")]
    pub(crate) seed_urls: Vec<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Source {
    pub(crate) title: String,
    pub(crate) url: String,
    pub(crate) excerpt: String,
    #[serde(default, rename = "originUrl", skip_serializing_if = "Option::is_none")]
    pub(crate) origin_url: Option<String>,
}
#[derive(Serialize)]
pub struct Research {
    pub(crate) sources: Vec<Source>,
    pub(crate) warning: String,
    pub(crate) plan: StudyPlan,
}
#[derive(Debug, Serialize, Deserialize)]
pub struct StudyPlan {
    pub(crate) objective: String,
    pub(crate) prerequisites: Vec<String>,
    pub(crate) outline: Vec<StudySection>,
    pub(crate) deferred: Vec<String>,
    pub(crate) gaps: Vec<String>,
}
#[derive(Deserialize)]
pub(crate) struct PlannedResearch {
    #[serde(flatten)]
    pub(crate) plan: StudyPlan,
    #[serde(rename = "relevantSources")]
    pub(crate) relevant_sources: Vec<usize>,
    #[serde(default, rename = "sourceNotes")]
    pub(crate) source_notes: Vec<SourceNote>,
}
#[derive(Debug, Serialize, Deserialize)]
pub struct StudySection {
    pub(crate) title: String,
    pub(crate) priority: String,
    pub(crate) reason: String,
}
#[derive(Debug, Serialize, Deserialize)]
pub struct Material {
    pub(crate) name: String,
    pub(crate) title: String,
    pub(crate) markdown: String,
}
#[derive(Serialize, Deserialize)]
pub struct Generated {
    pub(crate) reply: String,
    pub(crate) files: Vec<Material>,
}
#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct LearningOptions {
    pub(crate) model_id: Option<String>,
    pub(crate) source_urls: Vec<String>,
    #[serde(skip)]
    pub(crate) progress: Progress,
}

#[derive(Deserialize)]
pub(crate) struct SourceNote {
    pub(crate) index: usize,
    pub(crate) reason: String,
}

#[derive(Serialize, Deserialize)]
pub(crate) struct MaterialSpec {
    pub(crate) name: String,
    pub(crate) title: String,
    pub(crate) scope: String,
}
