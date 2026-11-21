import type { LibraryNode, Kind } from '../../src/features/library/model';
const node = (id: string, parentId: string | null, kind: Kind, title: string, content = ''): LibraryNode => ({ id, parentId, kind, title, content, tags: [], favorite: false, updatedAt: Date.now(), visitedAt: 0 });
export function seedLibrary(): LibraryNode[] {
 return [node('notes', null, 'folder', '10-笔记'), node('design','notes','doc','设计系统：从规范到体验','<p>好的设计系统，不只是组件的集合。它让团队在共同的语言下，把注意力放在真实的问题与用户体验上。</p><blockquote>一致性不是让所有页面长得一样，而是让每一次操作都符合预期。</blockquote><h2>让组件服务于真实场景</h2><p>设计组件之前，先理解任务本身：用户想完成什么？信息之间有什么关系？哪些内容需要优先出现？</p><h2>让层级清晰</h2><p>用留白区分信息组，用稳定的字阶建立阅读顺序。</p>'),node('knowledge','notes','doc','知识管理','<h2>收集与整理</h2><p>记录值得保留的内容，并通过文件夹与标签组织资料。</p>'),node('tech',null,'folder','20-技术与方法'),node('attachments',null,'folder','30-附件')];
}
