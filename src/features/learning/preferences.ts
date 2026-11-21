import type { AgentModelOptions } from "../../shared/agent/contracts";
export type LearningPreferences = AgentModelOptions;

export const preferencesKey = "tiker.learning.preferences.v1";
export const defaultPreferences: LearningPreferences = { modelId: null };

export function readPreferences(): LearningPreferences {
  const raw = localStorage.getItem(preferencesKey);
  if (!raw) return defaultPreferences;
  const value = JSON.parse(raw);
  if (!value || (value.modelId !== null && typeof value.modelId !== "string")) {
    throw new Error("探知模型无法读取，请重新选择模型。");
  }
  return { modelId: value.modelId };
}
