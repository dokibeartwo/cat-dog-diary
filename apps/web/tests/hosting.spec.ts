import {test,expect} from '@playwright/test';

test('public path loads images, shared rules and themed focus without errors',async({page,baseURL})=>{
 const errors:string[]=[],badResponses:string[]=[],external:string[]=[];let antivirusRequests=0;
 page.on('pageerror',e=>errors.push(e.message));
 page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 page.on('response',r=>{if(r.status()>=400)badResponses.push(r.url());});
 page.on('request',r=>{
  const url=new URL(r.url());
  // This Windows machine's installed antivirus injects its own inspection
  // script. Record it separately, do not disable protection or allow arbitrary
  // external traffic. The clean Linux release gate has no such exception.
  if(process.platform==='win32'&&url.hostname==='me.kis.v2.scr.kaspersky-labs.com'){antivirusRequests++;return;}
  if(url.origin!==new URL(baseURL!).origin)external.push(url.origin+url.pathname);
 });
 await page.goto('./');
 await expect(page.getByRole('navigation',{name:'主导航'})).toBeVisible();
 await expect.poll(()=>page.locator('.brand img').evaluate((img:HTMLImageElement)=>img.complete&&img.naturalWidth>0)).toBeTruthy();
 await page.getByRole('navigation').getByRole('button',{name:'专注',exact:true}).click();
 await page.getByRole('button',{name:'开始专注',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'专注时刻'})).toBeVisible();
 await expect(page.locator('.focus-screen')).toContainText(/25:00|24:[0-5][0-9]/);
 await page.getByRole('button',{name:'返回清单',exact:true}).click();
 await expect(page.locator('.mini-timer')).toBeVisible();
 await page.reload();
 await expect(page.locator('.mini-timer')).toBeVisible();
 await page.screenshot({path:'artifacts/public-mobile-preview.png'});
 if(antivirusRequests)test.info().annotations.push({type:'environment',description:antivirusRequests+' antivirus-injected requests recorded separately'});
 expect(errors).toEqual([]);expect(badResponses).toEqual([]);expect(external).toEqual([]);
});

test('home screen metadata keeps launch URL inside the public project path',async({page,request,baseURL})=>{
 await page.goto('./');
 const href=await page.locator('link[rel="manifest"]').getAttribute('href');
 const manifestURL=new URL(href!,baseURL!).href;
 const response=await request.get(manifestURL);expect(response.ok()).toBeTruthy();
 const manifest=await response.json();
 expect(new URL(manifest.start_url,manifestURL).href).toBe(new URL('./',baseURL!).href);
 expect(new URL(manifest.scope,manifestURL).href).toBe(new URL('./',baseURL!).href);
 expect(manifest.display).toBe('standalone');
 expect((await request.get(new URL(manifest.icons[0].src,manifestURL).href)).ok()).toBeTruthy();
 await page.getByRole('button',{name:'了解范围'}).click();
 await expect(page.getByText(/不需要电脑开机/)).toBeVisible();
 await expect(page.getByText(/不代表支持后台提醒或离线启动/)).toBeVisible();
});

test('site never serves local source, databases or executable runtime',async({request})=>{
 for(const file of ['src/model.ts','done-data.json','.env','.preview-runtime/node.exe','package-lock.json']){
  const response=await request.get('./'+file);
  expect([403,404]).toContain(response.status());
 }
});
