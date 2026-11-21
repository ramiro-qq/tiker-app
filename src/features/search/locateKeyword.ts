export function locateKeyword(root: HTMLElement | null, keyword: string) {
 if(!root||!keyword)return false;
 const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let node:Node|null;
 while((node=walker.nextNode())){const index=(node.textContent||'').toLocaleLowerCase().indexOf(keyword.toLocaleLowerCase());if(index<0)continue;const range=document.createRange();range.setStart(node,index);range.setEnd(node,index+keyword.length);window.getSelection()?.removeAllRanges();window.getSelection()?.addRange(range);node.parentElement?.scrollIntoView({block:'center'});return true;}
 return false;
}
