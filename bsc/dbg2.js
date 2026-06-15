const puppeteer = require('puppeteer-core');
const { execSync } = require('node:child_process');
const CHROME = execSync('ls /root/.cache/puppeteer/chrome/*/chrome-linux64/chrome').toString().trim().split('\n')[0];
const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  const b = await puppeteer.launch({executablePath:CHROME,headless:'new',args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage']});
  const p = await b.newPage();
  p.on('request', r=>{ if(r.url().includes('/api/')) console.log('REQ', r.method(), r.url()); });
  p.on('response', async r=>{ if(r.url().includes('/api/')) console.log('RES', r.status(), r.url()); });
  await p.goto('http://localhost:3000',{waitUntil:'networkidle0'});
  // direkter fetch-Test
  const r = await p.evaluate(async()=>{
    const res = await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'admin@stoelner.at',password:'admin123'})});
    return {status:res.status, body: await res.text()};
  });
  console.log('DIRECT LOGIN', JSON.stringify(r));
  const me = await p.evaluate(async()=>{ const res=await fetch('/api/auth/me'); return await res.text(); });
  console.log('ME', me);
  await b.close();
})().catch(e=>{console.error(e);process.exit(1);});
