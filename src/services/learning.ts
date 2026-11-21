// Explore persistence adapter. Agent execution lives in shared/agent.
import { learningAgent } from '../shared/agent/learning';
import { requestAgent } from '../shared/agent/client';
export type { Intent, StudyPlan, Research, Generated } from '../shared/agent/contracts';

export const learning = {
  ...learningAgent,
  archive: (id: string, title: string, folders: string[], markdown: string): Promise<string> =>
    requestAgent('learning_archive', { id, title, folders, markdown }),
};
