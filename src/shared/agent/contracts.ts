export interface AgentMessage { role: "user" | "assistant"; text: string; }
export interface Source { title: string; url: string; excerpt: string; originUrl?: string; }
export interface AgentMaterial { name: string; title: string; markdown: string; }
export interface AgentModelOptions { modelId: string | null; sourceUrls?: string[]; }
export interface Intent {
  kind: "learning" | "clarify" | "outside" | "new_topic";
  title: string;
  query: string;
  reply: string;
  seedUrls: string[];
}
export interface StudyPlan {
  objective: string;
  prerequisites: string[];
  outline: { title: string; priority: "essential" | "optional"; reason: string }[];
  deferred: string[];
  gaps: string[];
}
export interface Research {
  sources: Source[];
  warning: string;
  plan: StudyPlan;
}
export interface Generated {
  reply: string;
  files: AgentMaterial[];
}
