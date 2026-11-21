// Explore's model eligibility and fallback rules. Structural types avoid a UI dependency.
interface ConfiguredModel { id: string; provider: string; configured: boolean; status?: string; }
export function availableAgentModels<T extends ConfiguredModel>(models: T[]): T[] {
  return models.filter(model => model.provider === 'custom' && model.configured && model.status !== 'unavailable');
}
export function selectAgentModel(models: {id: string}[], selected: string | null): string | null {
  return (models.find(model => model.id === selected) ?? models[0])?.id ?? null;
}
