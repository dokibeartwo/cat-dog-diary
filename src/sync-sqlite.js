'use strict';
const fs=require('node:fs');
const path=require('node:path');
// Electron main process uses Node's built-in SQLite: no native addon ABI to
// ship. The legacy JSON is an import source, never removed or overwritten.
class SyncSqlite {
  constructor(file) {
    const {DatabaseSync}=require('node:sqlite');
    fs.mkdirSync(path.dirname(file),{recursive:true});
    this.db=new DatabaseSync(file);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS sync_meta(id INTEGER PRIMARY KEY CHECK(id=1),value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sync_entities(account_id TEXT,entity_type TEXT,entity_id TEXT,payload TEXT,revision INTEGER,deleted_at TEXT,PRIMARY KEY(account_id,entity_type,entity_id));
      CREATE TABLE IF NOT EXISTS sync_outbox(account_id TEXT,mutation_id TEXT,entity_type TEXT,entity_id TEXT,value TEXT,PRIMARY KEY(account_id,mutation_id));`);
  }
  load(){return this.db.prepare('SELECT value FROM sync_meta WHERE id=1').get()?.value || null;}
  save(meta) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('INSERT OR REPLACE INTO sync_meta(id,value) VALUES (1,?)').run(JSON.stringify(meta));
      this.db.exec('DELETE FROM sync_entities; DELETE FROM sync_outbox;');
      const entity=this.db.prepare('INSERT INTO sync_entities VALUES (?,?,?,?,?,?)'),mutation=this.db.prepare('INSERT INTO sync_outbox VALUES (?,?,?,?,?)');
      for(const [id,account]of Object.entries(meta.accounts||{})) {
        for(const e of Object.values(account.entities||{}))entity.run(id,e.entityType,e.entityId,JSON.stringify(e.payload),e.revision||0,e.deletedAt||null);
        for(const m of account.outbox||[])mutation.run(id,m.mutationId,m.entityType,m.entityId,JSON.stringify(m));
      }
      this.db.exec('COMMIT');
    }catch(e){this.db.exec('ROLLBACK');throw e;}
  }
  close(){this.db.close();}
}
module.exports={SyncSqlite};
