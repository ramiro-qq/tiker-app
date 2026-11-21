import ExcelJS from 'exceljs';
import FormulaParser from 'fast-formula-parser';
import { parseDelimited } from '../preview/csv.ts';
export type { Workbook, Worksheet, Cell } from 'exceljs';
export function createWorkbook() {const wb=new ExcelJS.Workbook();wb.addWorksheet('资料清单');wb.calcProperties.fullCalcOnLoad=true;return wb;}
export async function loadWorkbook(bytes:Uint8Array,name:string) {
 const wb=new ExcelJS.Workbook();
 if(/\.(csv|tsv)$/i.test(name)){const rows=parseDelimited(new TextDecoder().decode(bytes),/\.tsv$/i.test(name)?'\t':',');const sheet=wb.addWorksheet('资料清单');rows.forEach((row,r)=>row.forEach((input,c)=>setCellInput(sheet,sheet.getCell(r+1,c+1).address,input)));}
 else await wb.xlsx.load(bytes as unknown as ExcelJS.Buffer);
 if(!wb.worksheets.length)wb.addWorksheet('资料清单');wb.calcProperties.fullCalcOnLoad=true;return wb;
}
export function setCellInput(sheet:ExcelJS.Worksheet,address:string,input:string) {
 const cell=sheet.getCell(address);
 if(input.startsWith('=')){cell.value={formula:input.slice(1)};}
 else cell.value=input===''?null:/^-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(input)?Number(input):input;
}
export function cellInput(cell:ExcelJS.Cell):string {return cell.formula?'='+cell.formula:cell.value===null?'':cell.value instanceof Date?cell.value.toISOString().slice(0,10):cell.text;}
export function cellText(wb:ExcelJS.Workbook,sheet:ExcelJS.Worksheet,address:string):string {
 const seen=new Set<string>();let count=0;
 const value=(name:string,row:number,col:number):unknown=>{
  const sh=wb.getWorksheet(name);if(!sh)return '#REF!';const cell=sh.getCell(row,col);const key=name+'!'+cell.address;
  if(seen.has(key)||++count>10000)return '#REF!';
  if(!cell.formula)return cell.value instanceof Date?cell.value.toLocaleDateString('zh-CN'):cell.value===null?0:typeof cell.value==='object'?cell.text:cell.value;
  seen.add(key);
  try{const parser=new FormulaParser({onCell:(ref:{sheet?:string;row:number;col:number})=>value(ref.sheet||name,ref.row,ref.col),onRange:(ref:{sheet?:string;from:{row:number;col:number};to:{row:number;col:number}})=>{
   const target=wb.getWorksheet(ref.sheet||name);if(!target)return [[0]];const lastRow=Math.min(ref.to.row,Math.max(target.rowCount,ref.from.row));const lastCol=Math.min(ref.to.col,Math.max(target.columnCount,ref.from.col));
   if((lastRow-ref.from.row+1)*(lastCol-ref.from.col+1)>10000)throw new Error('#VALUE!');
   return Array.from({length:lastRow-ref.from.row+1},(_,r)=>Array.from({length:lastCol-ref.from.col+1},(_,c)=>value(ref.sheet||name,ref.from.row+r,ref.from.col+c)));
  }});const result=parser.parse(cell.formula,{sheet:name,row,col});return result instanceof Error?String(result):result;
  }catch(error){return String(error).match(/#[A-Z0-9/?!]+/)?.[0]||'#VALUE!';}finally{seen.delete(key);}
 };
 const cell=sheet.getCell(address);if(!cell.formula){if(typeof cell.value==='number'){if(cell.numFmt==='0.00')return cell.value.toFixed(2);if(cell.numFmt==='0.00%')return (cell.value*100).toFixed(2)+'%';if(cell.numFmt==='¥#,##0.00')return '¥'+cell.value.toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2});}return cell.value===null?'':cell.value instanceof Date?cell.value.toLocaleDateString('zh-CN'):cell.text;}
 const result=value(sheet.name,Number(cell.row),Number(cell.col));return String(result??'');
}
export function pasteCells(sheet:ExcelJS.Worksheet,row:number,col:number,text:string) {
 const rows=parseDelimited(text.replace(/\r\n/g,'\n'),'\t',100000);
 rows.forEach((values,r)=>values.forEach((input,c)=>setCellInput(sheet,sheet.getCell(row+r,col+c).address,input)));
}
export async function serializeWorkbook(wb:ExcelJS.Workbook) {
 for(const sh of wb.worksheets)sh.eachRow(row=>row.eachCell(cell=>{if(cell.formula){const result=cellText(wb,sh,cell.address);cell.value={formula:cell.formula,result:result.startsWith('#')?{error:result as ExcelJS.CellErrorValue['error']}:result!==''&&Number.isFinite(Number(result))?Number(result):result};}}));
 return new Uint8Array(await wb.xlsx.writeBuffer());
}
export function toBase64(bytes:Uint8Array){let s='';for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(s);}
export function fromBase64(s:string){return Uint8Array.from(atob(s),c=>c.charCodeAt(0));}
