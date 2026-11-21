const palette=['frost','sage','sand','rose','lavender','seafoam','apricot','pink','cyan','slate'];
const assignedTones: Record<string,string> = {
 '设计规范':'frost','前端开发':'sage','知识管理':'sand','待读':'rose',
 '产品设计':'lavender','设计系统':'seafoam','组件化':'frost','团队协作':'sage',
 '交互设计':'sand','布局':'rose','阅读方法':'lavender','笔记':'seafoam',
 '检索':'frost','本地优先':'sage','架构':'sand',
};
const registries=new Map<string,string[]>();
export function tagStyle(tag:string,allTags:string[],libraryId:string) {
 let order=registries.get(libraryId);
 if(!order){try{const saved=JSON.parse(localStorage.getItem(`tiker.tag-order.${libraryId}`)||'[]');order=Array.isArray(saved)?saved.filter((s):s is string=>typeof s==='string'):[];}catch{order=['设计规范','前端开发','知识管理','待读'];}if(!order.length)order=['设计规范','前端开发','知识管理','待读'];registries.set(libraryId,order);}
 let changed=false;for(const name of [...allTags,tag])if(!order.includes(name)){order.push(name);changed=true;}
 if(changed)try{localStorage.setItem(`tiker.tag-order.${libraryId}`,JSON.stringify(order));}catch{/* Styling remains available when storage is full. */}
 const tone=assignedTones[tag] || palette[order.indexOf(tag)%palette.length];return {backgroundColor:`var(--tag-nordic-${tone})`,color:`var(--tag-nordic-${tone}-ink)`};
}
