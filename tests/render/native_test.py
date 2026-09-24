import importlib.util,io,unittest
from pathlib import Path
from pypdf import PdfWriter
from pypdf.generic import DictionaryObject,NameObject,DecodedStreamObject,ArrayObject,NumberObject,FloatObject
spec=importlib.util.spec_from_file_location('native',Path(__file__).resolve().parents[2]/'render-service/extract_pdf.py');native=importlib.util.module_from_spec(spec);spec.loader.exec_module(native)
def pdf(extra=b'',nested=False):
 w=PdfWriter();p=w.add_blank_page(612,792)
 font=DictionaryObject({NameObject('/Type'):NameObject('/Font'),NameObject('/Subtype'):NameObject('/Type1'),NameObject('/BaseFont'):NameObject('/Helvetica')})
 p[NameObject('/Resources')]=DictionaryObject({NameObject('/Font'):DictionaryObject({NameObject('/F1'):font})})
 text=b''.join(f'BT /F1 10 Tf 20 {y} Td (Complete issuer requirement text with clear native content.) Tj ET '.encode() for y in (700,680,660,640))
 if nested:
  form=DecodedStreamObject();form.set_data(extra);form[NameObject('/Subtype')]=NameObject('/Form');form[NameObject('/Resources')]=DictionaryObject()
  p['/Resources'][NameObject('/XObject')]=DictionaryObject({NameObject('/Fm'):w._add_object(form)});extra=b'/Fm Do'
 stream=DecodedStreamObject();stream.set_data(text+extra);p[NameObject('/Contents')]=w._add_object(stream)
 out=io.BytesIO();w.write(out);return out.getvalue()
class Tests(unittest.TestCase):
 def test_native_evidence(self):
  data=pdf();r=native.extract(data);p=r['page_results'][0]
  self.assertEqual(p['mode'],'native');self.assertTrue(r['complete_source']);self.assertEqual(p['evidence_lines'][0]['id'],'p1:l1');self.assertIn('issuer',p['text']);self.assertFalse(p['visual_content_verified'])
 def test_table_and_nested_graphics(self):
  for nested in (False,True):
   p=native.extract(pdf(b'0 0 m 200 200 l S',nested))['page_results'][0]
   self.assertEqual(p['mode'],'vision');self.assertIn('painted_vectors_or_tables',p['reasons'])
 def test_invisible_text_needs_review(self):
  p=native.extract(pdf(b'3 Tr'))['page_results'][0]
  self.assertEqual(p['mode'],'vision');self.assertIn('nonstandard_text_rendering',p['reasons'])
 def test_bounds_and_empty(self):
  for first,last in [(0,1),(1,65),(2,2)]:
   with self.assertRaises(ValueError):native.extract(pdf(),first,last)
  w=PdfWriter();w.add_blank_page(612,792);b=io.BytesIO();w.write(b)
  self.assertEqual(native.extract(b.getvalue())['page_results'][0]['mode'],'vision')
 def test_auto_ranges_for_short_and_final_batches(self):
  for count,first in [(1,1),(65,1),(65,65),(1155,1153)]:
   w=PdfWriter()
   for _ in range(count):w.add_blank_page(612,792)
   b=io.BytesIO();w.write(b)
   result=native.extract(b.getvalue(),first)
   self.assertEqual(result['page_to'],min(first+63,count))
   self.assertEqual([p['page'] for p in result['page_results']],list(range(first,min(first+63,count)+1)))
def mutate(data,change):
 from pypdf import PdfReader
 r=PdfReader(io.BytesIO(data));w=PdfWriter();w.add_page(r.pages[0]);change(w.pages[0]);out=io.BytesIO();w.write(out);return out.getvalue()
RULES=b'60 752 450 .7 re f 60 40 450 .7 re f '
class MarginRuleTests(unittest.TestCase):
 def result(self,data):return native.extract(data)['page_results'][0]
 def test_decorative_only_is_native_candidate(self):
  p=self.result(pdf(RULES));self.assertEqual(p['mode'],'native');self.assertEqual(p['decorative_rule_count'],2);self.assertEqual(p['vector_paint_count'],2);self.assertFalse(p['table_candidate']);self.assertFalse(p['visual_content_verified'])
  self.assertEqual(native.extract(pdf(RULES))['parser_version'],'native-evidence-v2')
 def test_scaled_text_matrix_and_relative_line_positions(self):
  # Scaled text matrices are common in the real CDR mechanical volume.
  body=b'BT /F1 1 Tf 10 0 0 10 60 700 Tm (Body prose.) Tj 0 -1.2 TD (The contractor may sign later.) Tj ET '
  self.assertEqual(self.result(pdf(RULES+body))['mode'],'native')
  footer=b'BT /F1 1 Tf 10 0 0 10 60 700 Tm 0 -66 TD (Signature) Tj ET '
  self.assertEqual(self.result(pdf(RULES+footer))['mode'],'vision')
 def test_signature_or_footer_entry_stays_vision(self):
  for text in [b'Signature',b'Name and date',b'Authorized approval',b'Cachet et signature',b'________']:
   p=self.result(pdf(RULES+b'BT /F1 10 Tf 70 25 Td ('+text+b') Tj ET'))
   self.assertEqual(p['mode'],'vision',text);self.assertEqual(p['decorative_rule_count'],0)
  field=mutate(pdf(RULES),lambda p:p.__setitem__(NameObject('/Annots'),ArrayObject([DictionaryObject({NameObject('/Subtype'):NameObject('/Widget')})])))
  self.assertEqual(self.result(field)['mode'],'vision')
 def test_meaningful_graphics_stay_vision(self):
  cases=[b'100 450 400 .7 re f',b'100 300 300 200 re S',b'100 300 m 300 450 l S',b'100 300 300 100 re W n',b'1 0 0 1 0 1 cm',b'.5 g',b'60 752 450 3 re f',b'0 0 m 50 30 l 0 60 l f']
  for extra in cases:
   p=self.result(pdf(RULES+extra));self.assertEqual(p['mode'],'vision',extra);self.assertEqual(p['decorative_rule_count'],0)
  self.assertEqual(self.result(pdf(RULES,nested=True))['mode'],'vision')
  self.assertEqual(self.result(pdf(b'60 40 450 .7 re f'))['mode'],'vision')
  self.assertEqual(self.result(pdf(RULES+b'BT /F1 10 Tf 0 1 -1 0 80 200 Tm (Rotated label) Tj ET'))['mode'],'vision')
 def test_rotated_cropped_unknown_gstate(self):
  rotated=mutate(pdf(RULES),lambda p:p.__setitem__(NameObject('/Rotate'),NumberObject(90)))
  cropped=mutate(pdf(RULES),lambda p:p.__setitem__(NameObject('/CropBox'),ArrayObject([NumberObject(0),NumberObject(20),NumberObject(612),NumberObject(792)])))
  for data in (rotated,cropped,pdf(RULES+b'/Unknown gs')):self.assertEqual(self.result(data)['mode'],'vision')
 def test_opaque_normal_state_only(self):
  def state(extra):
   return mutate(pdf(b'/GS gs '+RULES),lambda p:p['/Resources'].__setitem__(NameObject('/ExtGState'),DictionaryObject({NameObject('/GS'):DictionaryObject({NameObject('/Type'):NameObject('/ExtGState'),**extra})})))
  opaque={NameObject('/ca'):FloatObject(1),NameObject('/BM'):NameObject('/Normal')}
  self.assertEqual(self.result(state(opaque))['mode'],'native')
  for attrs in [{NameObject('/ca'):FloatObject(.5)},{NameObject('/SMask'):NameObject('/None')},{NameObject('/BM'):NameObject('/Multiply')},{NameObject('/Unknown'):NumberObject(0)}]:self.assertEqual(self.result(state(attrs))['mode'],'vision')
 def test_other_routing_flags_never_removed(self):
  p=self.result(pdf(RULES+b'3 Tr'));self.assertEqual(p['mode'],'vision');self.assertIn('nonstandard_text_rendering',p['reasons'])
  # Image operators are a veto even if the image cannot be resolved.
  p=self.result(pdf(RULES+b'/Image Do'));self.assertEqual(p['mode'],'vision');self.assertEqual(p['decorative_rule_count'],0)
  def image_resource(p):
   img=DecodedStreamObject();img.set_data(bytes([255,255,255]));img.update({NameObject('/Subtype'):NameObject('/Image'),NameObject('/Width'):NumberObject(1),NameObject('/Height'):NumberObject(1),NameObject('/ColorSpace'):NameObject('/DeviceRGB'),NameObject('/BitsPerComponent'):NumberObject(8)})
   p['/Resources'][NameObject('/XObject')]=DictionaryObject({NameObject('/Image'):img})
  p=self.result(mutate(pdf(RULES+b'/Image Do'),image_resource));self.assertEqual(p['mode'],'vision');self.assertIn('embedded_images',p['reasons']);self.assertEqual(p['decorative_rule_count'],0)


if __name__=='__main__':unittest.main()
