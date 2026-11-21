import test from 'node:test';
import assert from 'node:assert/strict';
const module=()=>import('../src/features/spreadsheet/workbook.ts');
test('spreadsheet changes retain values, styles, sheets and formulas through XLSX save/reopen',async()=>{
 const {createWorkbook,setCellInput,serializeWorkbook,loadWorkbook,cellText}=await module();const wb=createWorkbook();const sh=wb.worksheets[0];
 setCellInput(sh,'A1','12');setCellInput(sh,'A2','8');setCellInput(sh,'A3','=SUM(A1:A2)');sh.getCell('A1').font={bold:true};wb.addWorksheet('第二页').getCell('C2').value='保留';
 assert.equal(cellText(wb,sh,'A3'),'20');const bytes=await serializeWorkbook(wb);const opened=await loadWorkbook(bytes,'test.xlsx');
 assert.equal(opened.worksheets.length,2);assert.equal(opened.worksheets[1].getCell('C2').value,'保留');assert.equal(opened.worksheets[0].getCell('A1').font.bold,true);assert.equal(cellText(opened,opened.worksheets[0],'A3'),'20');
});
test('CSV import keeps quoted cells and clipboard multi-cell paste stays rectangular',async()=>{
 const {loadWorkbook,pasteCells,cellText}=await module();const wb=await loadWorkbook(new TextEncoder().encode('名称,备注\n资料,"包含,逗号"'),'test.csv');const sh=wb.worksheets[0];assert.equal(sh.getCell('B2').value,'包含,逗号');pasteCells(sh,3,1,'1\t2\n3\t=SUM(A3:B3)');assert.equal(cellText(wb,sh,'B4'),'3');
});
test('formula errors and cycles return errors without executing arbitrary input',async()=>{
 const {createWorkbook,setCellInput,cellText}=await module();const wb=createWorkbook();const sh=wb.worksheets[0];setCellInput(sh,'A1','=A1+1');assert.match(cellText(wb,sh,'A1'),/#/);setCellInput(sh,'B1','=1/0');assert.match(cellText(wb,sh,'B1'),/#/);
});
