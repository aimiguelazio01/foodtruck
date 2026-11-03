"""Generate the two Portuguese PDF manuals from their versioned Markdown sources.
Requires reportlab and Pillow. Output: output/pdf and docs/manuals.
"""
from pathlib import Path
import re,html,shutil
from reportlab.platypus import BaseDocTemplate,PageTemplate,Frame,Paragraph,Spacer,PageBreak,Table,TableStyle,Image,KeepTogether
from reportlab.platypus.tableofcontents import TableOfContents
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet,ParagraphStyle
from reportlab.lib.enums import TA_LEFT
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.utils import ImageReader
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'output/pdf';OUT.mkdir(parents=True,exist_ok=True)
FONT_CANDIDATES=[Path('C:/Windows/Fonts'),Path('/usr/share/fonts/truetype/dejavu')]
for folder in FONT_CANDIDATES:
 regular=folder/('segoeui.ttf' if 'Windows' in str(folder) else 'DejaVuSans.ttf')
 bold=folder/('segoeuib.ttf' if 'Windows' in str(folder) else 'DejaVuSans-Bold.ttf')
 mono=folder/('consola.ttf' if 'Windows' in str(folder) else 'DejaVuSansMono.ttf')
 if regular.exists():break
else:raise RuntimeError('Install Segoe UI or DejaVu fonts before generating manuals.')
for n,p in [('FT',regular),('FTBold',bold),('FTMono',mono)]:pdfmetrics.registerFont(TTFont(n,str(p)))
pdfmetrics.registerFontFamily('FT',normal='FT',bold='FTBold',italic='FT',boldItalic='FTBold')
GREEN=colors.HexColor('#202b1d');ORANGE=colors.HexColor('#ed8735');MUTED=colors.HexColor('#56634e');LINE=colors.HexColor('#d8dfd3')
styles={
 'body':ParagraphStyle('body',fontName='FT',fontSize=10.2,leading=15.2,spaceAfter=10,textColor=GREEN,splitLongWords=True),
 'h':ParagraphStyle('h',fontName='FTBold',fontSize=24,leading=30,spaceAfter=20,textColor=GREEN,keepWithNext=True),
 'small':ParagraphStyle('small',fontName='FT',fontSize=9,leading=13,textColor=MUTED,spaceAfter=8),
 'cell':ParagraphStyle('cell',fontName='FT',fontSize=9.1,leading=13,textColor=GREEN),
 'headcell':ParagraphStyle('headcell',fontName='FTBold',fontSize=9.1,leading=13,textColor=colors.white),
 'code':ParagraphStyle('code',fontName='FTMono',fontSize=8.2,leading=12,spaceAfter=5,textColor=GREEN,backColor=colors.HexColor('#eff1eb'),borderPadding=10,splitLongWords=True),
}
def markup(s):
 s=html.escape(s.strip())
 s=re.sub(r'`([^`]+)`',r'<font name="FTMono">\1</font>',s)
 s=re.sub(r'\*\*([^*]+)\*\*',r'<b>\1</b>',s)
 s=re.sub(r'(https?://[^\s]+)',lambda m:'<link href="'+m[0]+'" color="#8a491f">'+m[0]+'</link>',s)
 return s
class Manual(BaseDocTemplate):
 def __init__(self,path,title):
  super().__init__(str(path),pagesize=(595.28,841.89),leftMargin=45,rightMargin=45,topMargin=62,bottomMargin=52,title=title,author='Food Truck Live',pageCompression=1)
  self.manual_title=title
  self.addPageTemplates(PageTemplate(id='manual',frames=[Frame(45,52,505.28,727.89,id='body',leftPadding=0,rightPadding=0,topPadding=0,bottomPadding=0)],onPage=self.decorate))
 def decorate(self,c,doc):
  c.saveState()
  if doc.page==1:
   c.setFillColor(GREEN);c.rect(0,0,595.28,841.89,fill=1,stroke=0)
   c.setFillColor(ORANGE);c.rect(45,749,44,5,fill=1,stroke=0)
  else:
   c.setFillColor(GREEN);c.setFont('FTBold',9);c.drawString(45,807,'FOOD TRUCK LIVE')
   c.setFont('FT',8);c.setFillColor(MUTED);c.drawRightString(550,807,self.manual_title)
   c.setStrokeColor(LINE);c.line(45,795,550,795)
   c.setFont('FT',8);c.drawString(45,29,'Edição 03.11.2026 | Português (Portugal)');c.drawRightString(550,29,str(doc.page))
  c.restoreState()
 def afterFlowable(self,f):
  if getattr(f,'is_chapter',False):
   key='chapter-'+str(self.page)+'-'+str(f.getPlainText().split('.')[0]);self.canv.bookmarkPage(key);self.canv.addOutlineEntry(f.getPlainText(),key,0);self.notify('TOCEntry',(0,f.getPlainText(),self.page,key))
def build(source,filename,title,subtitle):
 lines=source.read_text(encoding='utf-8-sig').splitlines();story=[]
 white=ParagraphStyle('cover',fontName='FTBold',fontSize=40,leading=47,textColor=colors.white,spaceAfter=25)
 light=ParagraphStyle('covertext',fontName='FT',fontSize=13,leading=20,textColor=colors.HexColor('#d9e2d2'))
 story += [Spacer(1,45),Paragraph('Food Truck Live',ParagraphStyle('brand',parent=light,fontName='FTBold',fontSize=18)),Spacer(1,37),Paragraph(title,white),Paragraph(subtitle,light),Spacer(1,28),Paragraph('Guia ilustrado | 3 de novembro de 2026',light)]
 truck=ROOT/'apps/management/public/images/food-truck-live-hero.webp'
 if truck.exists():
  from PIL import Image as PILImage
  import io
  im=PILImage.open(truck).convert('RGBA');buf=io.BytesIO();im.save(buf,format='PNG');buf.seek(0);pic=Image(buf,width=420,height=280,mask='auto');pic.hAlign='LEFT';story.extend([Spacer(1,32),pic])
 story += [PageBreak(),Paragraph('Índice',styles['h'])]
 toc=TableOfContents();toc.levelStyles=[ParagraphStyle('toc',fontName='FT',fontSize=10.2,leading=15,spaceBefore=2,textColor=GREEN,leftIndent=0,rightIndent=20)];toc.tableStyle=TableStyle([('TOPPADDING',(0,0),(-1,-1),0),('BOTTOMPADDING',(0,0),(-1,-1),3),('LEFTPADDING',(0,0),(-1,-1),0),('RIGHTPADDING',(0,0),(-1,-1),0)]);story += [toc]
 i=0;first=True
 # The title/date are rendered on the cover; chapter 1 starts after the contents.
 while i<len(lines):
  line=lines[i].strip()
  if line.startswith('## '):
   story.append(PageBreak());p=Paragraph(markup(line[3:]),styles['h']);p.is_chapter=True;story.append(p);first=False;i+=1;continue
  if first:i+=1;continue
  if not line:i+=1;continue
  figure=re.fullmatch(r'!\[(.*?)\]\((.*?)\)',line)
  if figure:
   from PIL import Image as PILImage
   caption,relative=figure.groups();path=(source.parent/relative).resolve()
   if not path.is_file():raise RuntimeError('Missing manual screenshot: '+str(path))
   with PILImage.open(path) as im:iw,ih=im.size
   scale=min(505.28/iw,390/ih);pic=Image(str(path),width=iw*scale,height=ih*scale);pic.hAlign='LEFT'
   elements=[Spacer(1,12),pic,Spacer(1,8),Paragraph(markup(caption),styles['small'])]
   following=i+1
   while following<len(lines) and not lines[following].strip():following+=1
   if following<len(lines) and lines[following].strip().startswith('Fonte: '):
    elements.append(Paragraph(markup(lines[following]),styles['small']));i=following
   story.append(KeepTogether(elements));i+=1;continue
  if line.startswith('```'):
   code=[];i+=1
   while i<len(lines) and not lines[i].strip().startswith('```'):code.append(lines[i]);i+=1
   for cmd in code:story.append(Paragraph(html.escape(cmd).replace(' ','&#160;'),styles['code']))
   story.append(Spacer(1,8));i+=1;continue
  if line.startswith('|'):
   rows=[]
   while i<len(lines) and lines[i].strip().startswith('|'):
    cells=[x.strip() for x in lines[i].strip().strip('|').split('|')]
    if not all(re.fullmatch(r'[-: ]+',x or '-') for x in cells):rows.append(cells)
    i+=1
   cols=len(rows[0]);widths=([155,350.28] if cols==2 else [110,185,210.28])
   table=Table([[Paragraph(markup(v),styles['headcell'] if r==0 else styles['cell']) for v in row] for r,row in enumerate(rows)],colWidths=widths,repeatRows=1,hAlign='LEFT')
   table.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),GREEN),('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),10),('RIGHTPADDING',(0,0),(-1,-1),10),('TOPPADDING',(0,0),(-1,-1),9),('BOTTOMPADDING',(0,0),(-1,-1),9),('ROWBACKGROUNDS',(0,1),(-1,-1),[colors.HexColor('#f0f2ec'),colors.white]),('LINEBELOW',(0,1),(-1,-1),.4,LINE)]))
   story.extend([table,Spacer(1,16)]);continue
  story.append(Paragraph(markup(line),styles['body']));i+=1
 doc=Manual(OUT/filename,title);doc.multiBuild(story);shutil.copy2(OUT/filename,ROOT/'docs/manuals'/filename);print(filename,doc.page,'pages')
build(ROOT/'docs/manuals/UTILIZACAO_PT.md','Manual_Food_Truck_Live_PT.pdf','Manual de utilização','Do primeiro negócio à última recolha.\nGestão, clientes, encomendas, eventos e modo Touch.')
build(ROOT/'docs/manuals/INSTALACAO_PT.md','Manual_Instalacao_Food_Truck_Live_PT.pdf','Manual de instalação','GitHub, PostgreSQL, Supabase, Brevo, Vercel,\nCloudflare e alojamento Node.js/Docker.')
