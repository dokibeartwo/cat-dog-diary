'use strict';
const path=require('node:path');
const {validateCloudConfig}=require('./cloud-config.cjs');
(async()=>{
  const {loadEnv}=await import('vite');
  const env={...loadEnv('production',path.resolve(__dirname,'..'),'VITE_'),...process.env};
  const result=validateCloudConfig(env);
  if(!result.configured){
    console.log('尚未配置 Supabase；示例网站继续独立运行，不登录、不上传任务。');
    if(process.argv.includes('--require'))process.exitCode=1;
  }else{
    console.log('公开客户端配置格式检查通过。此检查不代表已连接数据库、成功发送邮件或完成同步。');
  }
})().catch(error=>{console.error(error.message);process.exitCode=1;});
