import importlib.util,io,unittest
from pathlib import Path
from pypdf import PdfWriter
from pypdf.generic import DictionaryObject,NameObject,DecodedStreamObject,ArrayObject
spec=importlib.util.spec_from_file_location('native',Path(__file__).resolve().parents[2]/'render-service/extract_pdf.py');native=importlib.util.module_from_spec(spec);spec.loader.exec_module(native)
def pdf(extra=b'',nested=False):
 w=PdfWriter();p=w.add_blank_page(612,792)
 font=DictionaryObject({NameObject('/Type'):NameObject('/Font'),NameObject('/Subtype'):NameObject('/Type1'),NameObject('/BaseFont'):NameObject('/Helvetica')})
 p[NameObject('/Resources')]=DictionaryObject({NameObject('/Font'):DictionaryObject({NameObject('/F1'):font})})
 text=b'BT /F1 10 Tf 20 700 Td ('+b'Complete issuer requirement text with clear native content. '*4+b') Tj ET '
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
if __name__=='__main__':unittest.main()
