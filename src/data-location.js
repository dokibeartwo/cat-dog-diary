'use strict';
const fs=require('node:fs'),path=require('node:path');

// A packaged beta may use a sibling data folder. The stable app's userData is
// left alone; no legacy task file is silently imported into an isolated beta.
function customDataDirectory({argv=[],executable,packaged=false,isolated=false},adapter=fs){
  if(isolated)return null;
  const index=argv.indexOf('--data-dir');
  let requested=index>=0?argv[index+1]:null;
  if(index>=0&&(!requested||requested.startsWith('--')))throw Error('--data-dir 需要一个数据目录');
  if(!requested&&packaged){
    const file=path.join(path.dirname(executable),'data-location.json');
    if(adapter.existsSync(file)){
      let config;try{config=JSON.parse(adapter.readFileSync(file,'utf8').replace(/^\uFEFF/,''));}catch{throw Error('数据目录配置无法读取，请修复 data-location.json；原数据未更改');}
      if(config.version!==1||typeof config.directory!=='string'||!config.directory.trim())throw Error('数据目录配置无效；原数据未更改');
      requested=config.directory;
    }
  }
  if(!requested)return null;
  const directory=path.resolve(path.dirname(executable),requested);
  if(directory===path.parse(directory).root)throw Error('数据目录不能直接使用磁盘根目录');
  const resources=path.join(path.dirname(executable),'resources');
  if(directory===path.dirname(executable)||directory===resources||directory.startsWith(resources+path.sep))throw Error('数据目录必须与程序文件分开');
  return directory;
}
module.exports={customDataDirectory};
