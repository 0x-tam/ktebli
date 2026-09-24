import io,sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'render-service'))
from native_layout import column_geometry
from extract_pdf import extract
from pypdf import PdfReader,PdfWriter
from pypdf.generic import DictionaryObject,NameObject,DecodedStreamObject,ArrayObject,NumberObject,TextStringObject

def fixture(body,extra_font=None):
 w=PdfWriter();p=w.add_blank_page(612,792)
 fonts={NameObject('/F1'):DictionaryObject({NameObject('/Type'):NameObject('/Font'),NameObject('/Subtype'):NameObject('/Type1'),NameObject('/BaseFont'):NameObject('/Helvetica')}),NameObject('/F2'):DictionaryObject({NameObject('/Type'):NameObject('/Font'),NameObject('/Subtype'):NameObject('/Type1'),NameObject('/BaseFont'):NameObject('/Helvetica-Bold')})}
 if extra_font:fonts[NameObject('/F3')]=extra_font
 p[NameObject('/Resources')]=DictionaryObject({NameObject('/Font'):DictionaryObject(fonts)})
 stream=DecodedStreamObject();stream.set_data(body);p[NameObject('/Contents')]=w._add_object(stream);out=io.BytesIO();w.write(out);return out.getvalue()
def geometry(data):
 r=PdfReader(io.BytesIO(data));return column_geometry(r.pages[0],r)
def at(text,x,y,font='F1',size=10):return f'BT /{font} {size} Tf {x} {y} Td ({text}) Tj ET '.encode()
class Tests(unittest.TestCase):
 def test_inline_font_and_hyphen_fragments_are_not_columns(self):
  body=b''
  for y in [700,675,650,625]:body+=f'BT /F1 10 Tf 70 {y} Td (The technical requirement is ) Tj /F2 10 Tf (MC) Tj /F1 10 Tf (-70 with approved works.) Tj ET '.encode()
  g=geometry(fixture(body));self.assertFalse(g['columns']);self.assertEqual(g['gap_bands'],0)
 def test_tables_and_real_columns(self):
  for right in [230,380]:
   body=b''.join(at('Item code',60,y)+at('Required value',right,y) for y in [700,670,640,610])
   self.assertTrue(geometry(fixture(body))['columns'])
 def test_tj_gaps_are_real_layout(self):
  body=b''.join(f'BT /F1 10 Tf 60 {y} Td [(Code) -16000 (Value)] TJ ET '.encode() for y in [700,670,640])
  self.assertTrue(geometry(fixture(body))['columns'])
  inline=b''.join(f'BT /F1 10 Tf 60 {y} Td [(Well) -20 (-formed text with) -100 ( spacing.)] TJ ET '.encode() for y in [700,670,640])
  self.assertFalse(geometry(fixture(inline))['columns'])
 def test_wordspacing_and_scaling(self):
  body=b''.join(f'BT /F1 10 Tf 60 {y} Td 100 Tw (Code Value) Tj ET '.encode() for y in [700,670,640])
  self.assertTrue(geometry(fixture(body))['columns'])
  body=b''.join(f'BT /F1 1 Tf 10 0 0 10 60 {y} Tm 80 Tz .05 Tc .2 Tw (Normal spaced prose) Tj ET '.encode() for y in [700,670,640])
  self.assertFalse(geometry(fixture(body))['columns'])
 def test_unknown_encoding_rotation_and_transforms_are_unverified(self):
  for body in [b'1 0 0 1 3 0 cm '+at('Text',60,700),b'BT /F1 10 Tf 0 1 -1 0 60 700 Tm (Text) Tj ET',b'/Missing Do',b'/Unknown gs',b'BT /Missing 10 Tf (Text) Tj ET']:
   self.assertIsNone(geometry(fixture(body)))
 def test_extreme_final_glyph_bounds_fail_closed(self):
  cases=[
   b'BT /F1 10 Tf 100000000000000000000 0 0 1 60 700 Tm (W) Tj ET',
   b'BT /F1 10 Tf 1 0 0 100000000000000000000 60 700 Tm (W) Tj ET',
   b'BT /F1 10 Tf 600 700 Td (WWWW) Tj ET',
   b'BT /F1 10 Tf 60 790 Td (W) Tj ET',
   b'BT /F1 10 Tf 100000 Tz 60 700 Td (W) Tj ET',
  ]
  for body in cases:self.assertIsNone(geometry(fixture(body)),body)
 def test_unknown_font_encoding_is_not_guessed(self):
  unknown=DictionaryObject({NameObject('/Type'):NameObject('/Font'),NameObject('/Subtype'):NameObject('/Type1'),NameObject('/BaseFont'):NameObject('/UnknownFont'),NameObject('/Encoding'):NameObject('/UnknownEncoding')})
  self.assertIsNone(geometry(fixture(b'BT /F3 10 Tf 60 700 Td (Unknown coded text) Tj ET',unknown)))
 def test_arabic_identity_font_fails_closed_until_shaping_qualified(self):
  cmap=DecodedStreamObject();cmap.set_data(b'/CIDInit /ProcSet findresource begin 12 dict begin begincmap 1 begincodespacerange <0000> <FFFF> endcodespacerange 1 beginbfchar <0001> <0627> endbfchar endcmap end end')
  descendant=DictionaryObject({NameObject('/Subtype'):NameObject('/CIDFontType2'),NameObject('/BaseFont'):NameObject('/Fixture'),NameObject('/W'):ArrayObject([NumberObject(1),ArrayObject([NumberObject(500)])])})
  font=DictionaryObject({NameObject('/Type'):NameObject('/Font'),NameObject('/Subtype'):NameObject('/Type0'),NameObject('/BaseFont'):NameObject('/Fixture'),NameObject('/Encoding'):NameObject('/Identity-H'),NameObject('/ToUnicode'):cmap,NameObject('/DescendantFonts'):ArrayObject([descendant])})
  self.assertIsNone(geometry(fixture(b'BT /F3 12 Tf 60 700 Td <0001> Tj ET',font)))
 def test_repeated_header_footer_gaps_alone_are_not_columns(self):
  body=at('Left heading',60,760)+at('Right heading',400,760)+at('File name',60,30)+at('Page1',450,30)
  body+=at('A continuous paragraph in the body of the source.',60,700)
  self.assertFalse(geometry(fixture(body))['columns'])
 def test_router_clears_only_proven_fragment_false_positive(self):
  body=b''.join(at('A'*20,60,y)+at(' continuing the same prose line.',193.4,y) for y in [700,670,640,610])
  p=extract(fixture(body))['page_results'][0]
  self.assertTrue(p['column_geometry_verified']);self.assertNotIn('aligned_text_columns',p['reasons']);self.assertEqual(p['mode'],'native')
  table=b''.join(at('A'*20,60,y)+at('Separate table value',350,y) for y in [700,670,640,610])
  self.assertIn('aligned_text_columns',extract(fixture(table))['page_results'][0]['reasons'])
  p=extract(fixture(body+b'60 600 350 .7 re f'))['page_results'][0];self.assertEqual(p['mode'],'vision');self.assertIn('painted_vectors_or_tables',p['reasons'])
 def test_body_underline_still_requires_vision(self):
  body=b''.join(at('Complete issuer technical requirement text with full prose.',60,y) for y in [700,670,640])+b'60 630 350 .7 re f'
  self.assertEqual(extract(fixture(body))['page_results'][0]['mode'],'vision')
if __name__=='__main__':unittest.main()
