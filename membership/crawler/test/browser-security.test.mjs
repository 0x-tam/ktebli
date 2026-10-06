import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import {
  createGuardedCdrDriver,
  cdrResourceUrl,
} from "../src/guarded-browser.mjs";
test("browser asset policy rejects private destinations, writes and unknown scripts", () => {
  for (const u of [
    "https://127.0.0.1/",
    "https://169.254.169.254/",
    "http://www.cdr.gov.lb/en-US/Procurment.aspx",
    "https://www.cdr.gov.lb/admin",
    "https://evil.example/script.js",
    "https://www.cdr.gov.lb/CDR/Pages/LoadMore/LoadMoreProcurments.aspx?1=1&stage=Ongoing&Limit=10000&Offset=0",
  ])
    assert.throws(() => cdrResourceUrl(u));
  assert.equal(
    cdrResourceUrl(
      "https://www.cdr.gov.lb/CDR/Pages/LoadMore/LoadMoreProcurments.aspx?1=1&stage=Ongoing&Limit=8&Offset=8",
    ).hostname,
    "www.cdr.gov.lb",
  );
});
test(
  "isolated Chromium cannot reach loopback via page or worker fetch",
  { skip: !process.env.PLAYWRIGHT_BROWSERS_PATH },
  async () => {
    let hits = 0;
    const server = createServer((req, res) => {
      hits++;
      res.end("secret");
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const port = server.address().port;
    const html = `<table><tbody id="ProcurmentsTbody"></tbody></table><script>
 fetch('http://127.0.0.1:${port}/probe').catch(()=>document.body.dataset.fetchBlocked='yes');
 try {new Worker(URL.createObjectURL(new Blob(["fetch('http://127.0.0.1:${port}/worker')"],{type:'text/javascript'})));}catch{}
 </script>`;
    let driver;
    try {
      driver = await createGuardedCdrDriver({
        http: {
          get: async () => ({
            status: 200,
            headers: { "content-type": "text/html" },
            body: html,
          }),
        },
      });
      await driver.openApprovedStage("Ongoing");
      const s = await driver.snapshot();
      assert.match(s.html, /data-fetch-blocked="yes"/);
      assert.equal(hits, 0);
    } finally {
      if (driver) await driver.close();
      await new Promise((r) => server.close(r));
    }
  },
);
