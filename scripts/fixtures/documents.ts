import { seedLibrary } from './library';
import type { LibraryNode } from '../../src/features/library/model';
export function libraryFixture(board?:string):LibraryNode[] {
 const nodes=seedLibrary();nodes[0].title='产品与设计';nodes[1].tags=['设计规范'];nodes[1].visitedAt=Date.now();
 nodes[1].content='<p>好的设计系统，不只是组件的集合。它让团队在共同的语言下，把注意力放在真实的问题与用户体验上。</p><blockquote>一致性不是让所有页面长得一样，而是让每一次操作都符合预期。</blockquote><h2>03  让组件服务于真实场景</h2><p>设计组件之前，先理解任务本身：用户想完成什么？信息之间有什么关系？哪些内容需要优先出现？这些问题决定布局，而不是反过来。</p><h2>让层级清晰，而不是让装饰更多</h2><p>用留白区分信息组，用稳定的字阶建立阅读顺序。主操作保持明确，次要操作适度收敛；只有需要被注意的内容，才值得使用强调色。</p><ul class="rd-checklist"><li>使用一致的间距与对齐规则</li><li>保留清晰的文字对比度</li><li>为高频任务减少不必要的跳转</li></ul>';
 nodes[2].title='交互设计中的反馈机制';nodes[2].tags=['前端开发','知识管理'];nodes[3].title='技术与方法';nodes[4].title='阅读笔记';
 const titles=['我的设计灵感库','组件库的组织与命名','建立清晰的文字层级','可访问性设计检查清单','知识管理的实践'];
 if(board==='ZF00048b')nodes.splice(1,0,{...nodes[1],id:'table',parentId:'notes',kind:'table',title:'资料整理清单.xlsx',content:'',rows:[['资料名称','类型','标签','整理状态'],['设计系统参考手册','PDF','设计规范','已归类'],['界面布局参考','图片','灵感','已归类'],['产品研究笔记','文档','产品思考','待补充标签'],['组件清单','表格','前端开发','已归类'],['阅读方法','网页','知识管理','待读']]});
 if(board==='ZF00048b')nodes.find(n=>n.id==='design')!.parentId='tech';
 for(const [i,title] of titles.entries())nodes.push({...nodes.find(n=>n.id==='design')!,id:'reference-'+i,parentId:i===0?'notes':'tech',title,tags:i===0?['待读']:i===4?['知识管理']:['设计规范',...(i===1||i===3?['前端开发']:[])],visitedAt:0});
 for(const node of nodes)if(node.kind==='doc')node.sourcePath=`10-笔记/${node.title}.md`;
 if(board==='reader-style'){
  nodes.push({...nodes[0],id:'style-team',parentId:'notes',title:'方案研究'}, {...nodes[0],id:'style-topic',parentId:'style-team',title:'客户试点'});
  nodes[1].parentId='style-topic';nodes[1].title='产品方案 POC：从选型到验收的协作指南';
  const diagram=btoa('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="180" viewBox="0 0 640 180"><rect width="640" height="180" rx="16" fill="#f2f6ff"/><path d="M80 90H560" stroke="#a8c0ff" stroke-width="2"/><g fill="#3370ff"><circle cx="100" cy="90" r="28"/><circle cx="320" cy="90" r="28"/><circle cx="540" cy="90" r="28"/></g><g fill="white" font-family="sans-serif" font-size="18" text-anchor="middle"><text x="100" y="96">01</text><text x="320" y="96">02</text><text x="540" y="96">03</text></g></svg>');
  nodes[1].content=`<blockquote><p>检索后未获得与学习主题实质相关且可读取的资料；以下内容仅基于模型已有知识，未完成来源核验。来源返回 HTTP 403。</p></blockquote><h1>用清晰的标准推进协作</h1><p>一份好的方案文档，让团队在共同的语言下完成决策。先确认<strong>目标、边界与验收条件</strong>，再记录过程与结论。使用 <code>POC</code> 标记试点阶段，相关说明见<a href="https://example.com">协作规范</a>。</p><h2>01 明确任务与验证范围</h2><p>把重要信息放在读者最需要的位置，通过标题、留白与列表建立稳定的阅读顺序。</p><ul><li><p>确认参与角色，以及每个阶段的交付物</p></li><li><p>为关键结论保留证据和适用条件</p></li></ul><blockquote><p>资料状态：以下为团队自己的说明，应完整保留。</p><p>好的引用强调观点与出处，让正文保持清晰、连贯。</p></blockquote><hr><h2>02 记录验证结果</h2><h3>验收清单</h3><table><tbody><tr><th><p>验证项目</p></th><th><p>验收标准</p></th><th><p>负责人</p></th></tr><tr><td><p>业务流程</p></td><td><p>覆盖核心任务，保留完整记录</p></td><td><p>产品团队</p></td></tr><tr><td><p>交付质量</p></td><td><p>结论明确，证据可复查</p></td><td><p>研发团队</p></td></tr></tbody></table><aside data-type="callout"><p>重要提示：先对齐验收标准，再开展验证。每一个结论都应注明适用范围。</p></aside><p>以下示意图展示从目标、验证到复盘的三个阶段。</p><img src="data:image/svg+xml;base64,${diagram}" alt="协作的三个阶段"><h2>03 总结与下一步</h2><p>整理发现、风险与待办事项，让下一位参与者能够快速接续工作。</p>`;
 }
 return nodes;
}
