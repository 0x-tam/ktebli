"""Bounded native PDF evidence, not OCR. No network, no file references from PDF."""
import hashlib, io, json, sys, re
from pypdf import PdfReader
from pypdf.generic import ContentStream
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
from native_layout import column_geometry
MAX_BYTES=50*1024*1024
MAX_OUTPUT=8*1024*1024
PAINT={b'S',b's',b'f',b'F',b'f*',b'B',b'B*',b'b',b'b*',b'sh'}

SIGNATURE_FIELD = re.compile(r"\b(sign(?:ature|atures|ed|ing)?|stamp|seal|initials?|approval|approved|authorized|authorised|witness|name|date|cachet|visa|nom|date|signature|paraphe|approuv[ée])\b|توقيع|ختم|اسم|إسم|تاريخ|اعتماد", re.I)

def decorative_rules(page, reader):
    """Conservative geometry candidate only; never certifies semantic reading.

    All painted paths must be simple opaque filled horizontal rules in the outer
    margin. Anything uncertain retains the normal vision route. Footer text is
    still extracted, and signature/entry cues veto the exemption.
    """
    try:
        if int(page.get('/Rotate', 0)) % 360 or list(page.cropbox) != list(page.mediabox): return 0
        if float(page.mediabox.left) != 0 or float(page.mediabox.bottom) != 0: return 0
        if page.get('/Annots'): return 0
        width, height = float(page.mediabox.width), float(page.mediabox.height)
        resources = page.get('/Resources', {}).get_object()
        rules, path = [], []
        operations = ContentStream(page.get_contents(), reader).operations
        if len(operations) > 200000: return 0
        for operands, op in operations:
            if op == b'cm' and list(map(float, operands)) != [1., 0., 0., 1., 0., 0.]: return 0
            if op == b'Tm' and (float(operands[1]) != 0 or float(operands[2]) != 0 or float(operands[0]) <= 0 or float(operands[3]) <= 0): return 0
            if op in (b'Do', b'INLINE IMAGE', b'W', b'W*', b'CS', b'cs', b'SCN', b'scn'): return 0
            if op == b'gs':
                states = resources.get('/ExtGState', {}).get_object()
                gs = states.get(operands[0]).get_object()
                if set(gs) - {'/OP', '/op', '/OPM', '/SA', '/SM', '/Type', '/BM', '/ca', '/CA'}: return 0
                if any(getattr(gs.get(k, False), 'value', gs.get(k, False)) for k in ('/OP', '/op')): return 0
                if gs.get('/BM', '/Normal') != '/Normal' or float(gs.get('/ca', 1)) != 1 or float(gs.get('/CA', 1)) != 1: return 0
            if op in (b'g', b'G') and float(operands[0]) != 0: return 0
            if op in (b'rg', b'RG', b'k', b'K') and any(float(v) != 0 for v in operands): return 0
            if op in (b'm', b'l', b'c', b'v', b'y', b'h', b're'): path.append((op, list(map(float, operands))))
            if op == b'n': path = []
            if op in PAINT:
                if op not in (b'f', b'F', b'f*') or len(path) != 1 or path[0][0] != b're': return 0
                x, y, rw, rh = path[0][1]
                box = (min(x,x+rw), min(y,y+rh), max(x,x+rw), max(y,y+rh))
                if not (0 < box[3]-box[1] <= 1 and box[2]-box[0] >= width*.5 and 0 <= box[0] < box[2] <= width): return 0
                if not (0 <= box[1] < box[3] <= height*.07 or height*.93 <= box[1] < box[3] <= height): return 0
                rules.append(box); path = []
        # Require a paired header/footer pattern, never a lone signing line or axis.
        if len(rules) != 2 or sum(r[3] <= height*.07 for r in rules) != 1 or sum(r[1] >= height*.93 for r in rules) != 1: return 0
        # Track text-line matrices directly. pypdf's visitor tm can drift on
        # scaled-Tm/TD documents, so it cannot establish safe body clearance.
        positions = []; matrix = [1.,0.,0.,1.,0.,0.]; leading = 0.; font_size = 0.; stack = []
        for operands, op in operations:
            if op == b'q': stack.append((font_size,leading))
            elif op == b'Q':
                if not stack: return 0
                font_size,leading = stack.pop()
            elif op == b'BT': matrix = [1.,0.,0.,1.,0.,0.]
            elif op == b'Tf': font_size = float(operands[1])
            elif op == b'Tm': matrix = list(map(float,operands))
            elif op == b'TL': leading = float(operands[0])
            elif op in (b'Td',b'TD'):
                tx,ty = map(float,operands)
                if op == b'TD': leading = -ty
                matrix[4] += tx*matrix[0] + ty*matrix[2]
                matrix[5] += tx*matrix[1] + ty*matrix[3]
            elif op in (b'T*',b"'",b'"'):
                matrix[4] -= leading*matrix[2]; matrix[5] -= leading*matrix[3]
            if op in (b'Tj',b'TJ',b"'",b'"'):
                pieces = operands[0] if op == b'TJ' else [operands[-1]]
                if any(not isinstance(v,(str,int,float)) for v in pieces): return 0
                text = ''.join(v for v in pieces if isinstance(v,str))
                if text.strip():
                    if not 0 <= matrix[5] <= height: return 0
                    positions.append((matrix[4],matrix[5],font_size*abs(matrix[3]),text))
        body = [p for p in positions if height*.08 <= p[1] <= height*.92]
        if not body or any(abs(p[1]-r[1]) < max(12,p[2]) for p in body for r in rules): return 0
        margin_text = ' '.join(p[3] for p in positions if p[1] < height*.08 or p[1] > height*.92)
        if SIGNATURE_FIELD.search(margin_text) or re.search(r'_{3,}|\.{4,}', margin_text): return 0
        return len(rules)
    except Exception:
        return 0

def graphics(page, reader):
    flags=set(); counts={'image_count':0,'vector_paint_count':0,'decorative_rule_count':0}; seen=set(); operations=0
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
    if counts['vector_paint_count']:
        counts['decorative_rule_count']=decorative_rules(page,reader)
        if counts['decorative_rule_count'] != counts['vector_paint_count']:flags.add('painted_vectors_or_tables')
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
        column_geometry_verified=False
        legacy_columns=sum(1 for xs in bands.values() if len(xs)>=2 and max(xs)-min(xs)>70)>=3
        if legacy_columns or not flags:
            measured=column_geometry(page,reader)
            column_geometry_verified=measured is not None
            if measured is None:flags.add('aligned_text_columns' if legacy_columns else 'text_geometry_unverified')
            elif measured['columns']:flags.add('aligned_text_columns')
        # Layout tables need visual review even without painted rules.
        if any('\t' in line or '    ' in line.strip() for line in text.splitlines()):flags.add('layout_sensitive_spacing')
        lines=[{'id':f'p{number}:l{i+1}','text':line} for i,line in enumerate(text.splitlines())]
        result.append({'page':number,'text':text,'evidence_lines':lines,'mode':'vision' if flags else 'native',
          'reasons':sorted(flags),'column_geometry_verified':column_geometry_verified,**counts,'table_candidate':bool(counts['vector_paint_count']>counts['decorative_rule_count'] or 'layout_sensitive_spacing' in flags),
          'visual_content_verified':False,'native_text_sha256':hashlib.sha256(text.encode()).hexdigest()})
    value={'ok':True,'parser_version':'native-evidence-v2','source_sha256':hashlib.sha256(data).hexdigest(),'pages':total,
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
