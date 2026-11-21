import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import './Modal.css';
export default function Modal({title,onClose,children,className=''}:{title:string;onClose:()=>void;children:ReactNode;className?:string}) {
 const ref=useRef<HTMLDialogElement>(null); const close=useRef(onClose);close.current=onClose;
 useEffect(()=>{const previous=document.activeElement as HTMLElement|null;const node=ref.current!;node.showModal();(node.querySelector<HTMLElement>('[autofocus]')||node.querySelector<HTMLElement>('input,textarea,select')||node.querySelector<HTMLElement>('button'))?.focus();return()=>{node.close();previous?.focus();};},[]);
 return <dialog ref={ref} className={`app-dialog ${className}`} aria-label={title} onCancel={e=>{e.preventDefault();close.current();}}><header><h2>{title}</h2><button type="button" className="icon-button" aria-label={`关闭${title}`} onClick={onClose}><X size={18}/></button></header>{children}</dialog>;
}
