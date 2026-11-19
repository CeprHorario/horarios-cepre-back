import { letterBlocks } from './request-letter';
import JSZip from 'jszip';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';

const escape=(value:string)=>value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
const paragraph=(text:string,bold=false,align='left',gap=8)=>`<w:p><w:pPr><w:jc w:val="${align==='justify'?'both':align}"/><w:spacing w:after="${gap*20}" w:line="276" w:lineRule="auto"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="22"/>${bold?'<w:b/>':''}</w:rPr><w:t xml:space="preserve">${escape(text)}</w:t></w:r></w:p>`;
/** Original institutional DOCX assets retain their logos, relationships and page margins. */
export async function replacementWord(fields:{label:string;value:string}[], evidence:Express.Multer.File[], teacher:boolean) {
  const zip=await JSZip.loadAsync(await readFile(join(__dirname,'templates',teacher?'teacher.docx':'staff.docx')));
  const document=await zip.file('word/document.xml')!.async('string');
  const body=document.match(/<w:body>([\s\S]*?)<\/w:body>/)![1];
  const logos=(body.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)??[]).filter(p=>p.includes('<w:drawing')||p.includes('<w:pict')).join('');
  let content=logos;
  for(const block of letterBlocks(fields,teacher,evidence.map(f=>f.originalname))){
    if(block.signature)content+=paragraph('')+paragraph('')+paragraph('________________________________',false, 'center');
    if(block.table){
      const widths=[450,2400,3500,2650];
      content+='<w:tbl><w:tblPr><w:tblW w:w="9000" w:type="dxa"/><w:tblBorders>'+['top','left','bottom','right','insideH','insideV'].map(side=>`<w:${side} w:val="single" w:sz="4" w:color="000000"/>`).join('')+'</w:tblBorders></w:tblPr><w:tblGrid>'+widths.map(w=>`<w:gridCol w:w="${w}"/>`).join('')+'</w:tblGrid>';
      block.table.forEach((row,ri)=>{content+='<w:tr>'+row.map((cell,ci)=>`<w:tc><w:tcPr><w:tcW w:w="${widths[ci]}" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr>${paragraph(cell,ri===0,'center',4)}</w:tc>`).join('')+'</w:tr>';});content+='</w:tbl>'+paragraph('');
    }else content+=(block.text??'').split('\n').map(line=>paragraph(line,block.bold,block.align,block.gap)).join('');
  }
  content+='<w:p><w:r><w:br w:type="page"/></w:r></w:p>'+paragraph('EVIDENCIAS QUE CORROBORAN LA SOLICITUD',true);
  let rel=await zip.file('word/_rels/document.xml.rels')!.async('string');
  let types=await zip.file('[Content_Types].xml')!.async('string');
  if(!types.includes('Extension="jpeg"'))types=types.replace('</Types>','<Default Extension="jpeg" ContentType="image/jpeg"/></Types>');
  for(const [index,file] of evidence.entries()){
    content+=paragraph(`${index+1}. ${file.originalname}`,true);
    if(file.buffer.subarray(0,5).toString()==='%PDF-'){
      content+=paragraph('Documento PDF adjunto íntegramente al expediente PDF de esta solicitud.');continue;
    }
    const {data,info}=await sharp(file.buffer,{limitInputPixels:20000000}).rotate().resize({width:1200,height:1600,fit:'inside',withoutEnlargement:true}).jpeg({quality:80}).toBuffer({resolveWithObject:true});
    const id=`replacementEvidence${index}`,name=`replacement-evidence-${index}.jpeg`;
    zip.file('word/media/'+name,data);
    rel=rel.replace('</Relationships>',`<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${name}"/></Relationships>`);
    const width=480*9525,height=Math.round(width*info.height/info.width);
    content+=`<w:p><w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><wp:extent cx="${width}" cy="${height}"/><wp:docPr id="${900+index}" name="Anexo ${index+1}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${900+index}" name="Anexo"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${id}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${width}" cy="${height}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
  }
  content+=body.match(/<w:sectPr(?:\s[^>]*)?>[\s\S]*?<\/w:sectPr>/)?.[0]??'';
  zip.file('word/document.xml',document.replace(/<w:body>[\s\S]*?<\/w:body>/,`<w:body>${content}</w:body>`));
  zip.file('word/_rels/document.xml.rels',rel);zip.file('[Content_Types].xml',types);
  return zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'});
}
