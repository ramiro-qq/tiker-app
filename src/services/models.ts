import { invoke, isTauri } from '@tauri-apps/api/core';
export interface ModelSettings {
  id: string;
  name: string;
  provider: string;
  baseUrl: string;
  model: string;
  configured: boolean;
  status?: 'verified' | 'untested' | 'unavailable';
}
export interface ModelConfig { models: ModelSettings[]; defaultModelId: string | null }
export const providers = [
  { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { id: 'qwen', name: '通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
  { id: 'ollama', name: 'Ollama', baseUrl: 'http://localhost:11434/v1', model: '' },
  { id: 'custom', name: '自定义（OpenAI 兼容）', baseUrl: '', model: '' },
];
function desktop<T>(command: string, args: Record<string, unknown>): Promise<T> {
  if (!isTauri()) return Promise.reject(new Error('请在桌面应用中测试并保存模型配置。'));
  return invoke<T>(command, args);
}
export const models = {
  load: (): Promise<ModelConfig> => isTauri() ? invoke('model_settings') : Promise.resolve({ models: [], defaultModelId: null }),
  save: (settings: ModelSettings, apiKey: string) => desktop<ModelConfig>('save_model_settings', { settings, apiKey: apiKey || null }),
  test: (id: string) => desktop<{ config: ModelConfig; error: string | null }>('test_model', { id }),
  duplicate: (id: string) => desktop<ModelConfig>('duplicate_model', { id }),
  remove: (id: string) => desktop<ModelConfig>('delete_model', { id }),
};
