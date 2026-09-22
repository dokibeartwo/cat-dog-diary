const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
if(!process.versions.electron){
  const {execFileSync}=require('node:child_process');
  const exe=path.resolve(__dirname,'../release/猫狗日记-windows-x64/猫狗日记.exe');
  console.log(execFileSync(exe,[__filename],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},encoding:'utf8',timeout:20000}));
}else{
  const reports=path.resolve(__dirname,'../qa-reports');fs.mkdirSync(reports,{recursive:true});
  const folder=fs.mkdtempSync(path.join(reports,'electron-sqlite-'));
  const {SyncSqlite}=require('../release/猫狗日记-windows-x64/resources/app/src/sync-sqlite');
  const {customDataDirectory}=require('../release/猫狗日记-windows-x64/resources/app/src/data-location');
  const file=path.join(folder,'sync-state.sqlite');let store=new SyncSqlite(file);
  store.save({version:1,accounts:{}});store.close();store=new SyncSqlite(file);
  assert.equal(JSON.parse(store.load()).version,1);store.close();
  const directory=customDataDirectory({executable:process.execPath,packaged:true});
  assert.equal(directory,path.resolve(__dirname,'../release/本地数据'));
  const report={passed:true,electron:process.versions.electron,node:process.version,portableDirectory:directory,file};
  fs.writeFileSync(path.join(folder,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}
