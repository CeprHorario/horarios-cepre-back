import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RequestPerson } from './request-person';

export interface LetterData {
  role:string; process:string; issued:string; date:string; applicant:RequestPerson; replacement:RequestPerson;
  address:string; district:string; cui:string; reason:string; exception?:string;
  full:boolean; classroom:string; shift:string; course:string; start:string; end:string;
  hours:{classroom:string;start:string;end:string}[];
}
export interface LetterBlock {text?:string; align?:'left'|'right'|'center'|'justify'; bold?:boolean; gap?:number; table?:string[][]; signature?:boolean}
export const cleanText=(s:string)=>s.normalize('NFC').replace(/[–—]/g,'-').replace(/[^\x20-\x7e\xa0-\xff\n]/g,' ');
export function letterBlocks(fields:{label:string;value:string}[], teacher=false, annexes:string[]=[]):LetterBlock[] {
  const field=(label:string)=>fields.find(f=>f.label===label)?.value??'';
  const raw=field('Ficha institucional');
  const d:LetterData=raw?JSON.parse(raw):{
    role:teacher?'profesor':'monitor',process:field('Proceso'),issued:field('Fecha de emisión'),date:field('Fecha del reemplazo'),
    applicant:{name:field('Solicitante'),dni:'',email:''} as RequestPerson,replacement:{name:field('Reemplazante propuesto')} as RequestPerson,
    address:field('Domicilio y distrito'),district:'',cui:field('CUI'),reason:field('Motivo'),full:false,classroom:'',shift:'',course:'',start:'',end:'',hours:[],
  };
  teacher=d.role==='profesor';
  const who=teacher?'PRESTADOR DE SERVICIO DE ENSEÑANZA':d.role==='monitor'?'MONITOR':'COORDINADOR DE MONITOREO';
  const coverage=d.full?`todo el turno ${d.shift}, de ${d.start} a ${d.end}`:d.hours.map(h=>`${h.start}–${h.end}`).join(', ');
  const b:LetterBlock[]=[
    {text:`SOLICITO: REEMPLAZO DE MIS FUNCIONES COMO ${who}${teacher?' DEL PROCESO '+d.process.replaceAll('_',' ').toUpperCase():''}`,bold:true,align:'center',gap:28},
    {text:`Arequipa, ${d.issued}`,align:'right',gap:22},
    {text:'Dr. Arnaldo Valdivia Loaiza',gap:3},
    {text:'COORDINADOR ACADÉMICO DEL CEPRUNSA',bold:true,gap:22},
    {text:'De mis consideraciones:',gap:16},
    {text:`Yo ${d.applicant.name}, domiciliado en ${d.address||'________________'}, distrito de ${d.district||'________________'}, con DNI N° ${d.applicant.dni||'________________'}${teacher?'':`, CUI N° ${d.cui||'________________'}`}, ${teacher?`prestador de servicio de enseñanza del curso de ${d.course}`:d.role==='monitor'?`monitor(a) del ${d.shift}, del aula ${d.classroom}, y coordinador de monitoreo ${d.applicant.supervisor||'________________'}`:`coordinador de monitoreo, código ${d.applicant.code}, del ${d.shift}`}, solicito permiso para ser reemplazado el día ${d.date}${teacher?' en el aula '+d.classroom:''}, durante ${coverage}, por los motivos que detallo a continuación:`,align:'justify',gap:10},
    {text:d.reason,align:'justify',gap:22},
  ];
  if(d.exception)b.push({text:d.exception,align:'justify',gap:12});
  if(teacher){
    b.push({text:'El/La/Los prestadores de servicio de enseñanza del reemplazo serán:',gap:16});
    b.push({table:[['N.°','Salones asignados al reemplazo','Prestador de servicio de enseñanza que reemplazará','Horas académicas a cubrir'],
      ...((d.full?[{classroom:d.classroom,start:d.start,end:d.end}]:d.hours).map((h,i)=>[String(i+1),h.classroom,d.replacement.name+(d.replacement.dni?' · DNI '+d.replacement.dni:''),d.full?'Todo el turno '+h.start+'–'+h.end:h.start+'–'+h.end]))],gap:10});
  }else b.push({text:d.role==='monitor'?`El/La monitor(a) de reemplazo será ${d.replacement.name}, con DNI N° ${d.replacement.dni||'________________'}, del ${d.replacement.shift||'________________'}, del aula ${d.replacement.classroom||'________________'} y coordinador de monitoreo ${d.replacement.supervisor||'________________'}.`:`El/La coordinador(a) de monitoreo de reemplazo será ${d.replacement.name}, código ${d.replacement.code}, con DNI N° ${d.replacement.dni||'________________'}, del ${d.replacement.shift||'________________'}.`,align:'justify',gap:20});
  b.push({text:'Por la atención brindada a la presente quedo de usted muy agradecido(a).',gap:18},
    {text:'Atentamente,',gap:12},
    {signature:true,text:d.applicant.name+'\nDNI N° '+(d.applicant.dni||'________________')+(teacher?'':'\nCUI N° '+(d.cui||'________________')),align:'center',gap:18},
    {text:'Adjunto:',gap:5},...annexes.map((name,i)=>({text:`${i+1}. ${name}`,gap:3})));
  return b;
}

/** Institutional letter only; evidence pages are appended unchanged by RequestDocuments. */
export async function drawReplacementLetter(doc:PDFDocument,fields:{label:string;value:string}[],annexes:string[]) {
  const font=await doc.embedFont(StandardFonts.Helvetica),bold=await doc.embedFont(StandardFonts.HelveticaBold);
  let page=doc.addPage([595.28,841.89]),y=737;
  const black=rgb(0,0,0),width=505;
  const unsa=await doc.embedPng(await readFile(join(__dirname,'templates','unsa.png'))),cepr=await doc.embedPng(await readFile(join(__dirname,'templates','ceprunsa.png')));
  page.drawImage(unsa,{x:45,y:780,width:140,height:47});page.drawImage(cepr,{x:397,y:790,width:150,height:37});
  const room=(height:number)=>{if(y-height<45){page=doc.addPage([595.28,841.89]);y=790;}};
  const wrap=(text:string,max=width,f=font,size=10.5)=>{
    const lines:string[]=[];
    for(const paragraph of cleanText(text).split('\n')){let line='';for(const word of paragraph.split(/\s+/)){
      if(f.widthOfTextAtSize((line?line+' ':'')+word,size)>max&&line){lines.push(line);line=word;}else line+=(line?' ':'')+word;
    }lines.push(line);}return lines;
  };
  for(const block of letterBlocks(fields,false,annexes)){
    if(block.table){
      const widths=[25,135,195,150];
      for(const [ri,row] of block.table.entries()){
        const lines=row.map((cell,i)=>wrap(cell,widths[i]-10,ri===0?bold:font,9.5));
        const height=Math.max(24,...lines.map(l=>l.length*13+12));room(height);
        let x=45;for(let c=0;c<row.length;c++){
          page.drawRectangle({x,y:y-height,width:widths[c],height,borderWidth:0.6,borderColor:black});
          lines[c].forEach((line,j)=>page.drawText(line,{x:x+5,y:y-15-j*13,size:9.5,font:ri===0?bold:font,color:black}));x+=widths[c];
        }y-=height;
      }y-=block.gap??10;continue;
    }
    if(block.signature){room(110);y-=48;page.drawLine({start:{x:190,y},end:{x:405,y},thickness:0.6,color:black});y-=17;}
    const f=block.bold?bold:font,size=block.bold?10.5:10.5;
    for(const line of wrap(block.text??'',width,f,size)){
      room(15);const lineWidth=f.widthOfTextAtSize(line,size);
      const x=block.align==='right'?550-lineWidth:block.align==='center'?(595-lineWidth)/2:45;
      page.drawText(line,{x,y,size,font:f,color:black});y-=15;
    }y-=block.gap??8;
  }
  return {font,bold,safe:cleanText};
}
