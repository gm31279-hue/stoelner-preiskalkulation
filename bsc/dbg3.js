const puppeteer = require('puppeteer-core');
const { execSync } = require('node:child_process');
const CHROME = execSync('ls /root/.cache/puppeteer/chrome/*/chrome-linux64/chrome').toString().trim().split('\n')[0];
const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  const b = await puppeteer.launch({executablePath:CHROME,headless:'new',args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage']});
  const p = await b.newPage();
  p.on('console', m=>console.log('C:', m.text()));
  p.on('pageerror', e=>console.log('PERR:', e.message));
  await p.goto('http://localhost:3000',{waitUntil:'networkidle0'});
  await p.evaluate(()=>{ document.querySelector('#login-form').addEventListener('submit',()=>console.log('SUBMIT FIRED')); });
  await p.type('#login-email','admin@stoelner.at');
  await p.type('#login-pw','admin123');
  await p.click('#login-form button[type=submit]');
  await sleep(3000);
  console.log('app hidden?', await p.$eval('#app-view',e=>e.hidden), 'err:', await p.$eval('#login-err',e=>e.textContent));
  await b.close();
})().catch(e=>{console.error(e);process.exit(1);});
