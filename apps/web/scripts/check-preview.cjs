const { chromium } = require('playwright');
const path = require('node:path');
const fs = require('node:fs');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:1});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.goto('http://127.0.0.1:4173/',{waitUntil:'networkidle'});
 await page.getByRole('navigation',{name:'主导航'}).waitFor({timeout:10000}).catch(async e=>console.log(JSON.stringify({waitError:e.message,body:await page.locator('body').innerText(),errors})));
 const dir=path.resolve(__dirname,'../artifacts');fs.mkdirSync(dir,{recursive:true});
 await page.screenshot({path:path.join(dir,'today-390.png'),fullPage:true});
 console.log(JSON.stringify({title:await page.title(),errors,overflow:await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),screenshot:path.join(dir,'today-390.png')}));
 await browser.close();if(errors.length)process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});
