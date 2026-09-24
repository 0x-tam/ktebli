import test from 'node:test';import assert from 'node:assert/strict';import {existsSync} from 'node:fs';
import {slicePdf,createRenderServer} from '../../render-service/server.mjs';
const pdf=Buffer.from('%PDF-fixture');
test('slice process bounds, strict ranges and cleanup',async()=>{
 let path;await slicePdf(pdf,undefined,{first:2,last:5,execute:async(cmd,args,opts)=>{assert.equal(cmd,'python3');path=args[1];assert.deepEqual(args.slice(2),['2','5']);assert.equal(opts.maxBuffer,16*1024*1024);assert.equal(opts.timeout,45000);assert.equal(opts.killSignal,'SIGKILL');return {stdout:JSON.stringify({ok:true,page_results:[{}]})};}});assert.equal(existsSync(path),false);
 await assert.rejects(slicePdf(pdf,undefined,{first:1,last:5}),/invalid_page_range/);
 await assert.rejects(slicePdf(pdf,undefined,{execute:async(c,a)=>{path=a[1];throw {killed:true};}}),/timeout/);assert.equal(existsSync(path),false);
});
test('slice requires shared authentication and passes physical range only',async t=>{
 let calls=0;const server=createRenderServer({secret:'test',slice:async(b,s,o)=>{calls++;assert.deepEqual(b,pdf);assert.deepEqual(o,{first:2,last:5});return {ok:true};}});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));const url=`http://127.0.0.1:${server.address().port}/slice-pdf`;
 assert.equal((await fetch(url,{method:'POST',body:pdf})).status,401);assert.equal(calls,0);
 assert.equal((await fetch(url,{method:'POST',body:pdf,headers:{authorization:'Bearer test','x-page-from':'2','x-page-to':'5'}})).status,200);assert.equal(calls,1);
});
