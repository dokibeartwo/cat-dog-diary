import {defineConfig} from '@playwright/test';
const external=process.env.PREVIEW_BASE_URL;
const baseURL=external||'http://127.0.0.1:4175/cat-dog-diary/';
export default defineConfig({
 testDir:'./tests',testMatch:'**/*.spec.ts',timeout:45000,workers:1,reporter:'list',
 use:{browserName:'chromium',channel:process.platform==='win32'?'msedge':undefined,baseURL,viewport:{width:390,height:844},screenshot:'only-on-failure',trace:'retain-on-failure'},
 webServer:external?undefined:{
  command:'"'+process.execPath+'" scripts/serve.cjs',url:baseURL,
  env:{HOST:'127.0.0.1',PORT:'4175',MOUNT_PATH:'/cat-dog-diary/'},reuseExistingServer:false,timeout:15000
 }
});
