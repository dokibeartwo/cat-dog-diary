'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const diary = require('./shared/diary-v1');

// Never replace an unreadable primary with an empty state. Recovery is explicit.
class StateStore {
  constructor(file, legacy, adapter=fs, now=()=>new Date()) { this.fs=adapter;this.now=now;this.file=file;this.legacy=legacy;this.folder=path.join(path.dirname(file),'backups');this.issue=null;this.readOnly=false; }
  read(file) {
    const fs=this.fs;
    if (fs.statSync(file).size > 50*1024*1024) throw Error('数据超过 50 MB，请联系维护者协助恢复');
    return JSON.parse(fs.readFileSync(file,'utf8'));
  }
  parse(file) { return diary.migrate(this.read(file)); }
  stamp() {
    const instant=this.now(),pad=value=>String(value).padStart(2,'0');
    return `${instant.getFullYear()}-${pad(instant.getMonth()+1)}-${pad(instant.getDate())}T${pad(instant.getHours())}-${pad(instant.getMinutes())}-${pad(instant.getSeconds())}-${String(instant.getMilliseconds()).padStart(3,'0')}`;
  }
  load() {
    const fs=this.fs;
    const candidate=fs.existsSync(this.file)?this.file:fs.existsSync(this.legacy)?this.legacy:null;
    if (!candidate) return null;
    try {
      const raw=this.read(candidate),state=diary.migrate(raw);
      if(candidate===this.file && Number(raw.schemaVersion || 0)<diary.SCHEMA) {
        // Keep one exact pre-migration copy, including when a read-only launch is repeated.
        const fingerprint=crypto.createHash('sha256').update(JSON.stringify(raw)).digest('hex').slice(0,24);
        const suffix=`-before-upgrade-${fingerprint}.json`;
        if(!this.list().some(item=>item.name.endsWith(suffix))) {
          fs.mkdirSync(this.folder,{recursive:true});
          fs.copyFileSync(this.file,path.join(this.folder,`diary-${this.stamp()}${suffix}`));
        }
      }
      return state;
    }
    catch(error) {
      this.readOnly=true; this.issue='数据未能安全读取：'+error.message+'。原文件未覆盖，请在“设置与备份”恢复备份或导入数据。';
      return null;
    }
  }
  backup(reason='manual') {
    const fs=this.fs;
    if (!fs.existsSync(this.file)) return null;
    this.parse(this.file); // Don't turn corruption into a "good" backup.
    fs.mkdirSync(this.folder,{recursive:true});
    const stamp=this.stamp();
    const name=`diary-${stamp}-${reason}-${crypto.randomBytes(3).toString('hex')}.json`;
    fs.copyFileSync(this.file,path.join(this.folder,name)); return name;
  }
  list() {
    const fs=this.fs;
    if(!fs.existsSync(this.folder))return [];
    return fs.readdirSync(this.folder).filter(name=>/^diary-[\w.-]+\.json$/.test(name)).sort().reverse().map(name=>({name,bytes:fs.statSync(path.join(this.folder,name)).size}));
  }
  save(state) {
    const fs=this.fs;
    if(this.readOnly)throw Error(this.issue);
    fs.mkdirSync(path.dirname(this.file),{recursive:true});
    // Validate before touching the primary or producing a backup of a rejected write.
    diary.migrate(state);
    const serialized=JSON.stringify(state,null,2);
    const today=this.stamp().slice(0,10);
    if(fs.existsSync(this.file)&&!this.list().some(item=>item.name.startsWith('diary-'+today)&&item.name.includes('-daily-')))this.backup('daily');
    this.writeAtomic(serialized,this.file+'.tmp');
  }
  writeAtomic(serialized,temporary) {
    const fs=this.fs;
    try {
      const fd=fs.openSync(temporary,'w');
      try{fs.writeFileSync(fd,serialized,'utf8');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
      fs.renameSync(temporary,this.file);
    } catch(error) {
      // A failed flush/rename must leave the original intact, not promote the draft on restart.
      try { if(fs.existsSync(temporary))fs.unlinkSync(temporary); } catch {}
      throw error;
    }
  }
  replace(candidate) {
    const fs=this.fs;
    const normalized=diary.migrate(candidate);
    if(fs.existsSync(this.file)) {
      if(this.readOnly) {
        fs.mkdirSync(this.folder,{recursive:true});
        fs.copyFileSync(this.file,path.join(this.folder,'unreadable-'+this.stamp()+'-'+crypto.randomBytes(3).toString('hex')+'.json'));
      } else this.backup('before-restore');
    }
    const previousIssue=this.issue, previousReadOnly=this.readOnly;
    this.readOnly=false;
    try { // Save without backing up an unreadable primary again.
      fs.mkdirSync(path.dirname(this.file),{recursive:true});
      this.writeAtomic(JSON.stringify(normalized,null,2),this.file+'.restore.tmp');
      this.issue=null;return normalized;
    }catch(error){this.issue=previousIssue;this.readOnly=previousReadOnly;throw error;}
  }
  fromBackup(name) {
    if(!this.list().some(item=>item.name===name))throw Error('找不到指定备份');
    return this.parse(path.join(this.folder,name));
  }
}
module.exports={StateStore};
