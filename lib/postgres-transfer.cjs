'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const U=require('../scripts/operator-utils.cjs');
const {pack,unpack,safeNumber}=require('./postgres.cjs');
const {validateState}=require('../server.cjs');
const TABLES={
 agencies:['id','name','active','created_at'],
 users:['id','agency_id','username','role','salt','password_hash','active','created_at','credential_version'],
 workspaces:['agency_id','revision','json','saved_at'],
 revisions:['agency_id','revision','saved_at','reason','json_gzip'],
 imports:['agency_id','hash','incoming_gzip','server_gzip','server_revision','completed'],
 legacy_sources:['id','payload'],
 artifacts:['path','content']
};
const BINARY=new Set(['json_gzip','incoming_gzip','server_gzip','content']);
const NUMERIC=new Set(['revision','server_revision','credential_version']);
const sha=text=>crypto.createHash('sha256').update(text).digest('hex');
function encode(row){return Object.fromEntries(Object.entries(row).map(([key,value])=>[key,value===null?null:BINARY.has(key)?Buffer.from(value).toString('base64'):NUMERIC.has(key)?safeNumber(value):value]));}
function envelope(data){return {format:'scopewise-postgres-portable',version:1,createdAt:new Date().toISOString(),sessionsExcluded:true,sha256:sha(JSON.stringify(data)),data};}
function jsonState(text){if(typeof text!=='string')throw Error('Invalid workspace snapshot.');validateState(JSON.parse(text));}
function timestamp(value){if(typeof value!=='string'||!Number.isFinite(Date.parse(value)))throw Error('Invalid stored timestamp.');}
function validateBundle(bundle){
 if(bundle?.format!=='scopewise-postgres-portable'||bundle.version!==1||bundle.sessionsExcluded!==true||bundle.sha256!==sha(JSON.stringify(bundle.data)))throw Error('Invalid or damaged portable backup.');
 const data=bundle.data;if(!data||Object.keys(data).some(key=>!Object.hasOwn(TABLES,key)))throw Error('Unexpected backup tables.');
 for(const [table,columns] of Object.entries(TABLES)){
  if(!Array.isArray(data[table]))throw Error('Missing backup table.');
  for(const row of data[table]){
   if(!row||Object.keys(row).length!==columns.length||columns.some(key=>!Object.hasOwn(row,key))||Object.keys(row).some(key=>!columns.includes(key)))throw Error('Invalid backup row.');
   for(const key of columns){if(NUMERIC.has(key))safeNumber(row[key]);if(BINARY.has(key)&&row[key]!==null&&(typeof row[key]!=='string'||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(row[key])))throw Error('Invalid binary snapshot.');}
   if(table==='agencies'){if(!/^[a-f0-9-]{36}$/.test(row.id)||typeof row.name!=='string'||!row.name.trim()||row.name.length>120||![0,1].includes(row.active))throw Error('Invalid agency.');timestamp(row.created_at);}
   if(table==='users'){if(!/^[a-f0-9-]{36}$/.test(row.id)||!/^[a-f0-9-]{36}$/.test(row.agency_id)||typeof row.username!=='string'||!/^[a-z0-9][a-z0-9._@+-]{2,99}$/.test(row.username)||!['owner','editor','viewer'].includes(row.role)||!/^[a-f0-9]{32}$/.test(row.salt)||!/^[a-f0-9]{128}$/.test(row.password_hash)||![0,1].includes(row.active)||row.credential_version<1)throw Error('Invalid account.');timestamp(row.created_at);}
   if(table==='workspaces'){jsonState(row.json);timestamp(row.saved_at);if(!/^[a-f0-9-]{36}$/.test(row.agency_id))throw Error('Invalid workspace binding.');}
   if(table==='revisions'){jsonState(unpack(Buffer.from(row.json_gzip,'base64')));timestamp(row.saved_at);if(row.revision<1||typeof row.reason!=='string')throw Error('Invalid revision.');}
   if(table==='imports'){jsonState(unpack(Buffer.from(row.incoming_gzip,'base64')));if(row.server_gzip!==null)jsonState(unpack(Buffer.from(row.server_gzip,'base64')));if(!/^[a-f0-9]{64}$/.test(row.hash)||![0,1].includes(row.completed))throw Error('Invalid import ledger.');}
   if(table==='legacy_sources'){const legacy=JSON.parse(row.payload);validateLegacy(legacy);}
   if(table==='artifacts')U.safeRelative(row.path);
  }
 }
 for(const [table,rows] of Object.entries(data)){const seen=new Set();for(const row of rows){const key=table==='revisions'?row.agency_id+':'+row.revision:table==='imports'?row.agency_id+':'+row.hash:table==='workspaces'?row.agency_id:table==='artifacts'?row.path:row.id;if(seen.has(key))throw Error('Duplicate backup record.');seen.add(key);}}
 const usernames=new Set();for(const row of data.users){if(usernames.has(row.username))throw Error('Duplicate username.');usernames.add(row.username);}
 const agencies=new Set(data.agencies.map(row=>row.id));
 for(const name of ['users','workspaces','revisions','imports'])for(const row of data[name])if(!agencies.has(row.agency_id))throw Error('Broken agency reference.');
 const heads=new Map(data.workspaces.map(row=>[row.agency_id,row]));
 for(const row of data.revisions)if(!heads.has(row.agency_id)||row.revision>heads.get(row.agency_id).revision)throw Error('Revision history exceeds its workspace head.');
 for(const head of heads.values()){const history=data.revisions.find(row=>row.agency_id===head.agency_id&&row.revision===head.revision);if(head.revision>0&&(!history||unpack(Buffer.from(history.json_gzip,'base64'))!==head.json||history.saved_at!==head.saved_at))throw Error('Workspace head differs from its latest revision.');}
 for(const row of data.imports)if(row.server_revision>(heads.get(row.agency_id)?.revision||0))throw Error('Import revision exceeds its head.');
 return bundle;
}
function validateLegacy(legacy){
 if(!legacy||!Array.isArray(legacy.revisions)||!Array.isArray(legacy.imports))throw Error('Invalid legacy source.');
 if(legacy.head){jsonState(legacy.head.json);safeNumber(legacy.head.revision);timestamp(legacy.head.saved_at);}
 const seen=new Set();
 for(const row of legacy.revisions){jsonState(unpack(Buffer.from(row.json_gzip,'base64')));safeNumber(row.revision);timestamp(row.saved_at);if(row.revision<1||row.revision>(legacy.head?.revision||0)||seen.has(row.revision)||typeof row.reason!=='string')throw Error('Invalid legacy history.');seen.add(row.revision);}
 const latest=legacy.revisions.find(row=>row.revision===legacy.head?.revision);
 if(legacy.head?.revision>0&&(!latest||unpack(Buffer.from(latest.json_gzip,'base64'))!==legacy.head.json||latest.saved_at!==legacy.head.saved_at))throw Error('Legacy head differs from history.');
 const imports=new Set();
 for(const row of legacy.imports){jsonState(unpack(Buffer.from(row.incoming_gzip,'base64')));if(row.server_gzip)jsonState(unpack(Buffer.from(row.server_gzip,'base64')));if(!/^[a-f0-9]{64}$/.test(row.hash)||![0,1].includes(row.completed)||safeNumber(row.server_revision)>(legacy.head?.revision||0)||imports.has(row.hash))throw Error('Invalid legacy import.');imports.add(row.hash);}
}
async function exportPostgres(backend){
 const data=await backend.transaction(async c=>{await c.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');const output={};
  for(const [name,columns] of Object.entries(TABLES)){const order=name==='artifacts'?'path':columns[0]+(columns.includes('revision')?',revision':'');output[name]=(await c.query('SELECT '+columns.join(',')+' FROM scopewise.'+name+' ORDER BY '+order)).rows.map(encode);}return output;});
 return envelope(data);
}
async function importPostgres(backend,bundle){
 validateBundle(bundle);
 return backend.transaction(async c=>{
  await c.query('LOCK TABLE scopewise.agencies IN EXCLUSIVE MODE');
  for(const name of Object.keys(TABLES))if(Number((await c.query('SELECT count(*) AS n FROM scopewise.'+name)).rows[0].n)!==0)throw Error('Restore only into an empty PostgreSQL destination.');
  if(Number((await c.query('SELECT count(*) AS n FROM scopewise.sessions')).rows[0].n)!==0)throw Error('Restore only into an empty PostgreSQL destination.');
  for(const [name,columns] of Object.entries(TABLES))for(const row of bundle.data[name]){
   const values=columns.map(key=>BINARY.has(key)&&row[key]!==null?Buffer.from(row[key],'base64'):row[key]);
   await c.query('INSERT INTO scopewise.'+name+'('+columns.join(',')+') VALUES('+columns.map((_,i)=>'$'+(i+1)).join(',')+')',values);
  }
  return {restored:true,agencies:bundle.data.agencies.length,users:bundle.data.users.length,workspaces:bundle.data.workspaces.length,legacySources:bundle.data.legacy_sources.length,sessionsRestored:false};
 });
}
function sqliteState(source,snapshotRoot,originalWork,relativePrefix){
 const filename=path.join(snapshotRoot,source);U.checkedDatabase(filename,{workspace:true});const db=new DatabaseSync(filename,{readOnly:true});
 try{const head=db.prepare('SELECT revision,json,saved_at FROM workspace WHERE id=1').get()||null;
  const revisions=db.prepare('SELECT revision,saved_at,reason,json FROM revisions ORDER BY revision').all().map(row=>({revision:row.revision,saved_at:row.saved_at,reason:row.reason,json_gzip:pack(row.json).toString('base64')}));
  const imports=db.prepare('SELECT * FROM migrations').all().map(row=>{
   function snapshot(relative){if(!relative)return null;const absolute=U.inside(path.resolve(U.ROOT,relative),originalWork);const rebased=path.join(snapshotRoot,path.relative(originalWork,absolute));const text=fs.readFileSync(U.inside(rebased,snapshotRoot),'utf8');jsonState(text);return pack(text).toString('base64');}
   return {hash:row.hash,incoming_gzip:snapshot(row.imported_backup),server_gzip:snapshot(row.server_backup),server_revision:0,completed:row.completed||0};
  });
  return {head,revisions,imports,source:relativePrefix};
 }finally{db.close();}
}
function exportSqlite(options={}){
 const originalWork=U.workDirectory(options.workDir);
 const backup=require('../scripts/backup.cjs').backupWorkspace({workDir:originalWork,outputDir:options.backupDir,quiescent:options.quiescent,explicitSqliteExport:true});
 const root=path.join(backup.directory,'payload'),data=Object.fromEntries(Object.keys(TABLES).map(name=>[name,[]])),authFile=path.join(root,'data/auth.sqlite');
 if(fs.existsSync(authFile)){U.checkedDatabase(authFile,{auth:true});const db=new DatabaseSync(authFile,{readOnly:true});try{
  data.agencies=db.prepare('SELECT id,name,active,created_at FROM agencies ORDER BY id').all();
  data.users=db.prepare('SELECT id,agency_id,username,role,salt,password_hash,active,created_at FROM users ORDER BY id').all().map(row=>({...row,credential_version:1}));
 }finally{db.close();}}
 for(const item of backup.manifest.files){
  if(item.kind==='tenant-sqlite'){
   const agencyId=item.path.split('/')[1];if(!data.agencies.some(row=>row.id===agencyId))throw Error('A tenant has no authentication agency.');
   const stored=sqliteState(item.path,root,originalWork,item.path);
   if(stored.head)data.workspaces.push({agency_id:agencyId,...stored.head});
   data.revisions.push(...stored.revisions.map(row=>({agency_id:agencyId,...row})));data.imports.push(...stored.imports.map(row=>({agency_id:agencyId,...row})));
  }
  if(item.kind==='legacy-sqlite'){const legacy=sqliteState(item.path,root,originalWork,item.path);data.legacy_sources.push({id:'legacy-'+sha(JSON.stringify(legacy)).slice(0,24),payload:JSON.stringify(legacy)});}
  if(item.kind==='artifact')data.artifacts.push({path:item.path,content:fs.readFileSync(path.join(root,item.path)).toString('base64')});
 }
 const bundle=envelope(data);bundle.source={storage:'sqlite',consistency:backup.manifest.consistency};return {bundle:validateBundle(bundle),sqliteBackup:backup.directory};
}
async function adoptLegacy(backend,{legacyId,agencyId}){
 return backend.transaction(async c=>{
  const agency=(await c.query('SELECT id FROM scopewise.agencies WHERE id=$1 AND active=1 FOR UPDATE',[agencyId])).rows[0];if(!agency)throw Error('Active agency does not exist.');
  if((await c.query('SELECT agency_id FROM scopewise.workspaces WHERE agency_id=$1',[agencyId])).rows.length)throw Error('Adopt only before the agency first opens its workspace.');
  const row=(await c.query('SELECT payload FROM scopewise.legacy_sources WHERE id=$1',[legacyId])).rows[0];if(!row)throw Error('Legacy source does not exist.');
  const legacy=JSON.parse(row.payload);validateLegacy(legacy);if(!legacy.head)throw Error('Legacy source has no saved workspace.');
  await c.query('INSERT INTO scopewise.workspaces VALUES($1,$2,$3,$4)',[agencyId,legacy.head.revision,legacy.head.json,legacy.head.saved_at]);
  for(const record of legacy.revisions)await c.query('INSERT INTO scopewise.revisions VALUES($1,$2,$3,$4,$5)',[agencyId,record.revision,record.saved_at,record.reason,Buffer.from(record.json_gzip,'base64')]);
  for(const record of legacy.imports)await c.query('INSERT INTO scopewise.imports VALUES($1,$2,$3,$4,$5,$6)',[agencyId,record.hash,Buffer.from(record.incoming_gzip,'base64'),record.server_gzip?Buffer.from(record.server_gzip,'base64'):null,record.server_revision,record.completed]);
  return {adopted:true,agencyId,revision:legacy.head.revision,legacyPreserved:true};
 });
}
module.exports={TABLES,envelope,validateBundle,exportPostgres,importPostgres,exportSqlite,adoptLegacy};
