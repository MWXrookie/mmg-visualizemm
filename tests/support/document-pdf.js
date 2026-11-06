// In-memory PDF fixture: spaced text items, including a zero-valued cell.
export function pdfTableFixture({ empty = false } = {}){
 const content=empty ? '0.9 g 50 600 300 100 re f' : ['BT /F1 14 Tf 50 760 Td (Table example) Tj ET',...['Region|Sales|Cost','East|12|4','West|0|8'].flatMap((r,i)=>r.split('|').map((c,j)=>'BT /F1 12 Tf '+(50+j*130)+' '+(710-i*28)+' Td ('+c+') Tj ET'))].join('\n');
 const objs=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>','<< /Length '+Buffer.byteLength(content)+' >>\nstream\n'+content+'\nendstream'];
 let s='%PDF-1.4\n',offset=[0];for(let i=0;i<objs.length;i++){offset.push(Buffer.byteLength(s));s+=(i+1)+' 0 obj\n'+objs[i]+'\nendobj\n';}const x=Buffer.byteLength(s);s+='xref\n0 6\n0000000000 65535 f \n'+offset.slice(1).map(v=>String(v).padStart(10,'0')+' 00000 n \n').join('')+'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n'+x+'\n%%EOF';return Buffer.from(s);
 }
