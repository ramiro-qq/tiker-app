import { File, FileType, FileText, FileImage, FileSpreadsheet, Presentation, FileAudio, FileVideo, FileArchive, Folder } from 'lucide-react';
export default function FileIcon({kind,title='',folder=false}:{kind?:string;title?:string;folder?:boolean}) {
 const ext=title.split('.').pop()?.toLowerCase();
 const Glyph=folder||kind==='folder'?Folder:kind==='pdf'||ext==='pdf'?FileText:kind==='image'||/^(png|jpe?g|gif|webp|svg|avif|bmp)$/.test(ext||'')?FileImage:kind==='table'||/^(xlsx?|csv|tsv|ods)$/.test(ext||'')?FileSpreadsheet:/^pptx?$/.test(ext||'')?Presentation:/^(mp3|wav|flac|ogg|m4a)$/.test(ext||'')?FileAudio:/^(mp4|mov|mkv|webm)$/.test(ext||'')?FileVideo:/^(zip|rar|7z|tar|gz)$/.test(ext||'')?FileArchive:kind==='doc'||/^(txt|md|markdown|docx?)$/.test(ext||'')?FileType:File;
 return <Glyph size={15} strokeWidth={1.6} aria-hidden="true"/>;
}
