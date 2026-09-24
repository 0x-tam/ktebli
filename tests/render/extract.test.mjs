import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {extractPdf,createRenderServer} from '../../render-service/server.mjs';
const pdf=Buffer.from('%PDF-fixture');
test('native subprocess has hard resource bounds and always removes document',async()=>{
 let path;
 const result=await extractPdf(pdf,undefined,{first:10,last:20,execute:async(cmd,args,opts)=>{
  assert.equal(cmd,'python3');path=args[1];assert.deepEqual(args.slice(2),['10','20']);assert.equal(opts.timeout,45000);assert.equal(opts.maxBuffer,8*1024*1024);assert.equal(opts.killSignal,'SIGKILL');
  return {stdout:JSON.stringify({ok:true,page_results:[],text_truncated:false})};
 }});
 assert.equal(result.ok,true);assert.equal(existsSync(path),false);
 await assert.rejects(extractPdf(pdf,undefined,{first:1,last:65}),/invalid_page_range/);
 await assert.rejects(extractPdf(pdf,undefined,{execute:async(c,args)=>{path=args[1];throw {killed:true};}}),/timeout/);assert.equal(existsSync(path),false);
});
test('native HTTP keeps authentication and validates ranges before subprocess',async t=>{
 let calls=0;const server=createRenderServer({secret:'test',extract:async(bytes,signal,opts)=>{calls++;assert.deepEqual(opts,{first:2,last:4});return {ok:true};}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const url=`http://127.0.0.1:${server.address().port}/extract-pdf`;
 assert.equal((await fetch(url,{method:'POST',body:pdf})).status,401);
 assert.equal((await fetch(url,{method:'POST',body:pdf,headers:{authorization:'Bearer test','x-page-from':'2','x-page-to':'4'}})).status,200);
 assert.equal((await fetch(url,{method:'POST',body:pdf,headers:{authorization:'Bearer test','x-page-from':'1e3'}})).status,422);assert.equal(calls,1);
});
