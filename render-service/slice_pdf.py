"""Slice supplied issuer PDF into bounded physical pages; no fetching or OCR."""
import base64,hashlib,io,json,sys
from pypdf import PdfReader,PdfWriter
MAX_BYTES=50*1024*1024
MAX_OUTPUT=16*1024*1024

def slice_pdf(data,first=1,last=None):
    if len(data)>MAX_BYTES:raise ValueError('too_large')
    if not data.startswith(b'%PDF-'):raise ValueError('invalid_pdf')
    reader=PdfReader(io.BytesIO(data),strict=True)
    if reader.is_encrypted:raise ValueError('encrypted_pdf')
    total=len(reader.pages)
    if not 1<=total<=2000:raise ValueError('too_many_pages')
    last=min(first+3,total) if last is None else last
    if not 1<=first<=last<=total or last-first+1>4:raise ValueError('invalid_page_range')
    pages=[];encoded_bytes=0
    for number in range(first,last+1):
        writer=PdfWriter();writer.add_page(reader.pages[number-1]);out=io.BytesIO();writer.write(out)
        pdf=out.getvalue();encoded_bytes+=4*((len(pdf)+2)//3)
        if encoded_bytes>MAX_OUTPUT:raise ValueError('slice_output_too_large')
        pages.append({'page':number,'pdf_base64':base64.b64encode(pdf).decode('ascii'),'sha256':hashlib.sha256(pdf).hexdigest()})
    result={'ok':True,'source_sha256':hashlib.sha256(data).hexdigest(),'pages':total,'page_from':first,'page_to':last,'page_results':pages}
    if len(json.dumps(result).encode())>MAX_OUTPUT:raise ValueError('slice_output_too_large')
    return result

if __name__=='__main__':
    try:
        import resource
        if sys.platform.startswith('linux'):resource.setrlimit(resource.RLIMIT_AS,(512*1024*1024,512*1024*1024))
        with open(sys.argv[1],'rb') as f:data=f.read(MAX_BYTES+1)
        print(json.dumps(slice_pdf(data,int(sys.argv[2]),None if sys.argv[3]=='auto' else int(sys.argv[3]))))
    except Exception:sys.exit(2)
