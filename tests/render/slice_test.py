import base64,hashlib,importlib.util,io,unittest
from pathlib import Path
from pypdf import PdfWriter,PdfReader
from pypdf.generic import DecodedStreamObject,NameObject
spec=importlib.util.spec_from_file_location('slice',Path(__file__).resolve().parents[2]/'render-service/slice_pdf.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
def fixture():
 w=PdfWriter()
 for i in range(6):
  p=w.add_blank_page(600+i,800+i);s=DecodedStreamObject();s.set_data(f'{i} 0 m 10 10 l S'.encode());p[NameObject('/Contents')]=w._add_object(s)
 out=io.BytesIO();w.write(out);return out.getvalue()
class Tests(unittest.TestCase):
 def test_physical_pages_hashes_content_and_bounds(self):
  data=fixture();r=m.slice_pdf(data,2,5);self.assertEqual(r['source_sha256'],hashlib.sha256(data).hexdigest());self.assertEqual(r['pages'],6)
  for row,number in zip(r['page_results'],range(2,6)):
   self.assertEqual(row['page'],number);pdf=base64.b64decode(row['pdf_base64'],validate=True);self.assertEqual(row['sha256'],hashlib.sha256(pdf).hexdigest());reader=PdfReader(io.BytesIO(pdf));self.assertEqual(len(reader.pages),1);self.assertEqual(reader.pages[0].mediabox.width,599+number);self.assertIn(f'{number-1} 0 m'.encode(),reader.pages[0].get_contents().get_data())
  self.assertEqual(m.slice_pdf(data,5)['page_to'],6)
  for first,last in [(0,1),(1,5),(5,7),(7,None)]:
   with self.assertRaises(ValueError):m.slice_pdf(data,first,last)
 def test_output_and_encryption_fail_closed(self):
  previous=m.MAX_OUTPUT;m.MAX_OUTPUT=100
  try:
   with self.assertRaises(ValueError):m.slice_pdf(fixture(),1,1)
  finally:m.MAX_OUTPUT=previous
  w=PdfWriter();w.add_blank_page(600,800);w.encrypt('secret');out=io.BytesIO();w.write(out)
  with self.assertRaises(ValueError):m.slice_pdf(out.getvalue())
if __name__=='__main__':unittest.main()
