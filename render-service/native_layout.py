"""Bounded glyph geometry for the pinned pypdf parser. No heuristic font widths.
Unsupported fonts, encodings, transforms and external content stay unverified.
"""
import math
import pypdf
from pypdf.generic import ContentStream
from pypdf._font import Font

def column_geometry(page, reader):
    try:
        if pypdf.__version__ != '6.6.2': return None
        if int(page.get('/Rotate',0))%360 or list(page.cropbox)!=list(page.mediabox): return None
        width,height=float(page.mediabox.width),float(page.mediabox.height)
        resources=page.get('/Resources',{}).get_object(); raw_fonts=resources.get('/Font',{}).get_object()
        if len(raw_fonts)>256:return None
        fonts={}; glyphs=[]; stack=[]
        state={'font':None,'size':0.,'Tc':0.,'Tw':0.,'Tz':100.,'TL':0.,'Ts':0.}
        line=[1.,0.,0.,1.,0.,0.]; cursor=0.
        operations=ContentStream(page.get_contents(),reader).operations
        if len(operations)>200000:return None
        def show(value):
            nonlocal cursor
            if not state['font'] or state['size']<=0 or not 0<state['Tz']<=1000:raise ValueError('unknown_text_state')
            font=state['font']
            raw=value.original_bytes if hasattr(value,'original_bytes') else value
            if not isinstance(raw,bytes):raise ValueError('unknown_raw_encoding')
            if isinstance(font.encoding,str):
                decoded=raw.decode(font.encoding,errors='strict')
                if font.encoding=='utf-16-be':
                    if len(raw)%2 or len(decoded)*2!=len(raw):raise ValueError('invalid_identity_h')
                elif len(decoded)!=len(raw):raise ValueError('multibyte_font')
            else:
                if any(c not in font.encoding for c in raw):raise ValueError('unknown_code')
                decoded=''.join(font.encoding[c] for c in raw)
            code_width=2 if font.encoding=='utf-16-be' else 1
            if len(decoded)*code_width!=len(raw):raise ValueError('nonbijective_encoding')
            for i,char in enumerate(decoded):
                byte=raw[i] if code_width==1 else None
                char=font.character_map.get(char,char)
                if len(char)!=1 or char not in font.character_widths:raise ValueError('missing_exact_glyph_width')
                # Composite/RTL shaping is deliberately not inferred here.
                if 0x590<=ord(char)<=0x8ff:raise ValueError('rtl_layout_unqualified')
                advance=(float(font.character_widths[char])*state['size']/1000+state['Tc']+(state['Tw'] if byte==32 else 0))*state['Tz']/100
                ink=float(font.character_widths[char])*state['size']/1000*state['Tz']/100
                x=line[4]+cursor*line[0];y=line[5]+state['Ts']*line[3]
                right=x+ink*line[0];glyph_height=abs(state['size']*line[3])
                if not all(math.isfinite(n) for n in (advance,ink,x,y,right,glyph_height)) or ink<0 or advance<0 or not -1<=x<=right<=width+1 or not -1<=y<=height+1 or not 0<glyph_height<=height or y+glyph_height>height+1:raise ValueError('unsafe_glyph_geometry')
                if not char.isspace():glyphs.append((x,right,y,glyph_height))
                cursor+=advance
                if len(glyphs)>200000:raise ValueError('glyph_limit')
        for args,op in operations:
            if op in (b'Do',b'INLINE IMAGE',b'W',b'W*'):return None
            if op==b'cm' and list(map(float,args))!=[1.,0.,0.,1.,0.,0.]:return None
            if op==b'gs':
                gs=resources.get('/ExtGState',{}).get_object().get(args[0]).get_object()
                if set(gs)-{'/OP','/op','/OPM','/SA','/SM','/Type','/BM','/ca','/CA'}:return None
                if any(getattr(gs.get(k,False),'value',gs.get(k,False)) for k in ('/OP','/op')):return None
                if gs.get('/BM','/Normal')!='/Normal' or float(gs.get('/ca',1))!=1 or float(gs.get('/CA',1))!=1:return None

            if op==b'q':stack.append(state.copy())
            elif op==b'Q':
                if not stack:return None
                state=stack.pop()
            elif op==b'BT':line=[1.,0.,0.,1.,0.,0.];cursor=0.
            elif op==b'Tf':
                name=args[0]
                if name not in fonts:
                    if len(fonts)>=64:return None
                    raw=raw_fonts.get(name).get_object()
                    if raw.get('/Subtype')=='/Type0':
                        if raw.get('/Encoding')!='/Identity-H' or not raw.get('/ToUnicode') or raw['/DescendantFonts'][0].get_object().get('/Subtype')!='/CIDFontType2':return None
                    elif raw.get('/Subtype') not in ('/Type1','/TrueType'):return None
                    fonts[name]=Font.from_font_resource(raw)
                    if not fonts[name].interpretable:return None
                    mapped=[v for k,v in fonts[name].character_map.items() if isinstance(k,str) and isinstance(v,str)]
                    if len(mapped)!=len(set(mapped)):return None  # ambiguous CID-to-Unicode widths
                state['font']=fonts[name];state['size']=float(args[1])
            elif op in (b'Tc',b'Tw',b'Tz',b'TL',b'Ts'):state[op.decode()]=float(args[0])
            elif op==b'Tm':
                line=list(map(float,args));cursor=0.
                if line[1]!=0 or line[2]!=0 or line[0]<=0 or line[3]<=0:return None
            elif op in (b'Td',b'TD'):
                tx,ty=map(float,args)
                if op==b'TD':state['TL']=-ty
                line[4]+=tx*line[0];line[5]+=ty*line[3];cursor=0.
            elif op in (b'T*',b"'",b'"'):
                line[5]-=state['TL']*line[3];cursor=0.
                if op==b'"':state['Tw']=float(args[0]);state['Tc']=float(args[1])
            if op in (b'Tj',b"'",b'"'):show(args[-1])
            elif op==b'TJ':
                for part in args[0]:
                    if isinstance(part,(int,float)):cursor-=float(part)/1000*state['size']*state['Tz']/100
                    else:show(part)
        # Merge adjacent/overlapping glyph runs before looking for empty gutters.
        bands={}
        for left,right,y,size in glyphs:bands.setdefault(round(y/3),[]).append((left,right,size))
        gaps=[]
        for band,items in bands.items():
            runs=[]
            for left,right,size in sorted(items):
                if runs and left-runs[-1][1]<=max(8,size*.75):runs[-1]=(runs[-1][0],max(right,runs[-1][1]),max(size,runs[-1][2]))
                else:runs.append((left,right,size))
            for a,b in zip(runs,runs[1:]):
                if b[0]-a[1]>=max(16,a[2]*1.5,b[2]*1.5):gaps.append((band,a[1],b[0]))
        if len(gaps)>512:return None  # bound the exact overlap comparison below
        # Three physical rows with a shared >=12pt empty gutter remain columns.
        columns=any(len({b for b,l,r in gaps if min(r,right)-max(l,left)>=12})>=3 for _,left,right in gaps)
        return {'columns':columns,'glyph_count':len(glyphs),'gap_bands':len({b for b,_,_ in gaps})}
    except Exception:
        return None
