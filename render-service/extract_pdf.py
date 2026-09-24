"""Bounded native PDF evidence, not OCR. No network, no file references from PDF."""
import hashlib, io, json, sys
from pypdf import PdfReader
from pypdf.generic import ContentStream
MAX_BYTES=50*1024*1024
MAX_OUTPUT=8*1024*1024
PAINT={b'S',b's',b'f',b'F',b'f*',b'B',b'B*',b'b',b'b*',b'sh'}

def graphics(page, reader):
    flags=set(); counts={'image_count':0,'vector_paint_count':0}; seen=set(); operations=0
    def walk(stream, resources, depth=0):
        nonlocal operations
        if depth>16: flags.add('graphics_recursion_limit'); return
        if stream is None:return
        for operands, op in ContentStream(stream,reader).operations:
            operations+=1
            if operations>200000: raise ValueError('page_operation_limit')
            if op in PAINT: counts['vector_paint_count']+=1
            elif op==b'Tr' and operands and operands[0]!=0:flags.add('nonstandard_text_rendering')
            elif op==b'INLINE IMAGE':counts['image_count']+=1
            elif op==b'Do':
                objects=resources.get('/XObject',{}).get_object() if resources.get('/XObject') else {}
                obj=objects.get(operands[0])
                if obj is None:flags.add('unresolved_graphics');continue
                key=(getattr(obj,'idnum',None),getattr(obj,'generation',None))
                obj=obj.get_object()
                if obj.get('/Subtype')=='/Image':counts['image_count']+=1
                elif obj.get('/Subtype')=='/Form':
                    if key in seen:flags.add('repeated_or_recursive_form');continue
                    seen.add(key);walk(obj,obj.get('/Resources',resources).get_object(),depth+1)
                else:flags.add('unknown_graphics')
        fonts=resources.get('/Font',{}).get_object() if resources.get('/Font') else {}
        if any(f.get_object().get('/Subtype')=='/Type3' for f in fonts.values()):flags.add('type3_font')
    try:walk(page.get_contents(),page.get('/Resources',{}).get_object())
    except Exception:flags.add('graphics_inspection_failed')
    if counts['image_count']:flags.add('embedded_images')
    if counts['vector_paint_count']:flags.add('painted_vectors_or_tables')
    if page.get('/Annots'):flags.add('annotations_or_form_fields')
    return counts,flags

def extract(data, first=1, last=None):
    if len(data)>MAX_BYTES:raise ValueError('too_large')
    if not data.startswith(b'%PDF-'):raise ValueError('invalid_pdf')
    reader=PdfReader(io.BytesIO(data),strict=True)
    if reader.is_encrypted:raise ValueError('encrypted_pdf')
    total=len(reader.pages)
    if not 1<=total<=2000:raise ValueError('too_many_pages')
    last=min(first+63,total) if last is None else last
    if not 1<=first<=last<=total or last-first+1>64:raise ValueError('invalid_page_range')
    result=[]
    for number in range(first,last+1):
        page=reader.pages[number-1];counts,flags=graphics(page,reader)
        positions=[]
        def visit(text, cm, tm, font, size):
            if text.strip():positions.append((round(float(tm[4]),1),round(float(tm[5]),1)))
        try:text=page.extract_text(visitor_text=visit) or ''
        except Exception:text='';flags.add('text_extraction_failed')
        if len(''.join(text.split()))<100:flags.add('insufficient_native_text')
        if '\ufffd' in text or any(ord(c)<32 and c not in '\n\r\t' for c in text):flags.add('invalid_text_glyphs')
        # Aligned independent text cells can be borderless tables or columns.
        bands={}
        for x,y in positions:bands.setdefault(round(y/3),set()).add(x)
        if sum(1 for xs in bands.values() if len(xs)>=2 and max(xs)-min(xs)>70)>=3:flags.add('aligned_text_columns')
        # Layout tables need visual review even without painted rules.
        if any('\t' in line or '    ' in line.strip() for line in text.splitlines()):flags.add('layout_sensitive_spacing')
        lines=[{'id':f'p{number}:l{i+1}','text':line} for i,line in enumerate(text.splitlines())]
        result.append({'page':number,'text':text,'evidence_lines':lines,'mode':'vision' if flags else 'native',
          'reasons':sorted(flags),**counts,'table_candidate':bool(counts['vector_paint_count'] or 'layout_sensitive_spacing' in flags),
          'visual_content_verified':False,'native_text_sha256':hashlib.sha256(text.encode()).hexdigest()})
    value={'ok':True,'parser_version':'native-evidence-v1','source_sha256':hashlib.sha256(data).hexdigest(),'pages':total,
      'page_from':first,'page_to':last,'complete_source':first==1 and last==total,'text_truncated':False,
      'page_results':result,'classification_scope':'Conservative content-operator inspection; native is a text-routing candidate, not a guarantee of semantic or reading-order completeness.'}
    if len(json.dumps(value,ensure_ascii=False).encode())>MAX_OUTPUT:raise ValueError('extraction_output_too_large')
    return value

if __name__=='__main__':
    try:
        # A corrupt compressed stream cannot consume all container memory.
        try:
            import resource
            if sys.platform.startswith('linux'):resource.setrlimit(resource.RLIMIT_AS,(512*1024*1024,512*1024*1024))
        except (ImportError,ValueError):pass
        with open(sys.argv[1],'rb') as f:data=f.read(MAX_BYTES+1)
        print(json.dumps(extract(data,int(sys.argv[2]),int(sys.argv[3]) if sys.argv[3]!='auto' else None),ensure_ascii=False))
    except Exception:
        # Never leak source text, filesystem paths or parser diagnostics to HTTP.
        sys.exit(2)
