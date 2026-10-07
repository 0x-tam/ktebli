import {rateLimit} from '../../supabase/functions/upload-intake-file/http.ts';
(async () => {
  const email='private-fixture@example.invalid',ip='198.51.100.11';
  const logs:string[]=[];const prior=console.error;
  console.error=(...args:unknown[])=>logs.push(args.join(' '));
  try {
   for(const bucket of [`upl:em:${email}`,`upl:ip:${ip}`]) {
    globalThis.fetch=async()=>new Response('{}',{status:503});
    if(await rateLimit('http://fixture.invalid','private-test-key',bucket,20,3600))throw Error('HTTP limiter failure opened access');
    globalThis.fetch=async()=>{throw Error('private-test-key '+email+' '+ip);};
    if(await rateLimit('http://fixture.invalid','private-test-key',bucket,20,3600))throw Error('Transport limiter failure opened access');
   }
  } finally {console.error=prior;}
  if(logs.length!==4||logs.join('').includes(email)||logs.join('').includes(ip)||logs.join('').includes('private-test-key'))throw Error('Sensitive limiter log');
  console.log('Upload limiter fails closed without logging customer email, IP or raw errors.');
})().catch((error) => { console.error(error); throw error; });
