import { useEffect, type RefObject } from 'react';
// Native modal dialogs manage background isolation themselves and must stay
// available above a custom modal (for example, global search over a clip draft).
export function useModalIsolation(ref:RefObject<HTMLElement|null>,active:boolean|string) {
 useEffect(()=>{
  if(!active||!ref.current)return;
  const restored:{node:HTMLElement;inert:boolean}[]=[];
  let branch:HTMLElement=ref.current;
  while(branch.parentElement){for(const node of branch.parentElement.children){if(node!==branch&&node instanceof HTMLElement && !(node instanceof HTMLDialogElement)){restored.push({node,inert:node.inert});node.inert=true;}}branch=branch.parentElement;if(branch===document.body)break;}
  return()=>restored.forEach(({node,inert})=>{node.inert=inert;});
 },[active,ref]);
}
