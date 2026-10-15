'use strict';
if(process.env.SCOPEWISE_STORAGE==='postgres')throw Error('Use postgres-admin import into an empty database for PostgreSQL recovery.');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{DatabaseSync}=require('node:sqlite');
const U=require('./operator-utils.cjs');
function allowedEntry(entry){
 const id='[A-Za-z0-9_-]{1,100}',patterns={
  'auth-sqlite':/^data\/auth\.sqlite$/,
  'legacy-sqlite':/^data\/scopewise\.sqlite$/,
  'tenant-sqlite':new RegExp('^tenants/'+id+'/scopewise\\.sqlite$'),
  'workspace-export':new RegExp('^exports/(?:legacy-workspace|tenants/'+id+'/workspace)\\.json$'),
  'artifact':new RegExp('^(?:backups/.+|tenants/'+id+'/(?:backups/.+|legacy-adoption\\.json))$'),
  'session-secret':/^secrets\/session-secret$/
 };
 return Object.hasOwn(patterns,entry.kind)&&patterns[entry.kind].test(entry.path);
}
function validateBundle(bundle){
 U.inside(bundle);const filename=path.join(bundle,'manifest.json'),stat=U.fileInfo(filename);
 if(stat.size>16*1024*1024)throw Error('Backup manifest is unexpectedly large.');
 let manifest;try{manifest=JSON.parse(fs.readFileSync(filename,'utf8'));}catch{throw Error('Backup manifest is invalid JSON.');}
 if(!manifest||manifest.format!=='scopewise-multiagency-backup'||manifest.version!==1||!Array.isArray(manifest.files)||!manifest.files.length)throw Error('Unsupported or incomplete backup manifest.');
 const seen=new Set();
 for(const entry of manifest.files){
  if(!entry||typeof entry!=='object')throw Error('Invalid backup entry.');
  U.safeRelative(entry.path);
  if(!allowedEntry(entry)||!Number.isSafeInteger(entry.bytes)||entry.bytes<0||typeof entry.sha256!=='string'||!/^[a-f0-9]{64}$/.test(entry.sha256))throw Error('Invalid backup entry metadata.');
  const key=entry.path.toLowerCase();if(seen.has(key))throw Error('Backup entries contain duplicate paths.');seen.add(key);
  const source=U.inside(path.join(bundle,'payload',entry.path),path.join(bundle,'payload')),file=U.fileInfo(source);
  if(file.size!==entry.bytes||U.hashFile(source)!==entry.sha256)throw Error('Backup checksum or size does not match. No restore files were written.');
  if(entry.kind.endsWith('sqlite')){
   const checked=U.checkedDatabase(source,{workspace:entry.kind!=='auth-sqlite',auth:entry.kind==='auth-sqlite'});
   if(entry.kind!=='auth-sqlite'){
    const expected=entry.database;
    if(!expected||checked.revision!==expected.revision||checked.initialized!==expected.initialized||checked.savedAt!==expected.savedAt||checked.stateHash!==expected.stateHash)throw Error('Workspace metadata does not match its backup manifest.');
   }
  }
 }
 const auth=manifest.files.filter(e=>e.kind==='auth-sqlite').length,legacy=manifest.files.filter(e=>e.kind==='legacy-sqlite').length,tenants=manifest.files.filter(e=>e.kind==='tenant-sqlite').length,secrets=manifest.files.filter(e=>e.kind==='session-secret').length;
 if(auth>1||legacy>1||secrets>1||(tenants&&!auth)||manifest.authIncluded!==Boolean(auth)||manifest.legacyIncluded!==Boolean(legacy)||manifest.tenantCount!==tenants||manifest.secretIncluded!==Boolean(secrets))throw Error('Backup inventory does not match its manifest.');
 return manifest;
}
function restoreWorkspace(options={}){
 if(options.confirm!=='OFFLINE-RESTORE')throw Error('Stop the application and explicitly acknowledge --confirm OFFLINE-RESTORE.');
 if(!options.bundle||!options.target)throw Error('Supply a backup --bundle and a new --target directory.');
 const bundle=U.inside(path.resolve(U.ROOT,options.bundle)),target=U.inside(path.resolve(U.ROOT,options.target));
 if(target===bundle||target.startsWith(bundle+path.sep)||fs.existsSync(target))throw Error('Restore requires a new target directory outside the backup bundle. Existing data is never replaced.');
 const manifest=validateBundle(bundle);
 U.privateDirectory(target);
 for(const entry of manifest.files){
  if(entry.kind==='session-secret')continue;
  const destination=U.inside(path.join(target,entry.path),target),source=path.join(bundle,'payload',entry.path);
  U.privateDirectory(path.dirname(destination));fs.copyFileSync(source,destination,fs.constants.COPYFILE_EXCL);
  try{fs.chmodSync(destination,0o600);}catch{}
  if(U.hashFile(destination)!==entry.sha256)throw Error('A restored file failed verification. The new partial target was preserved; do not start it.');
 }
 let revokedSessions=0;
 if(manifest.authIncluded){
  const db=new DatabaseSync(path.join(target,'data','auth.sqlite'));
  try{db.exec('PRAGMA busy_timeout=10000; BEGIN IMMEDIATE');try{revokedSessions=Number(db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n);db.exec('DELETE FROM sessions; COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}}finally{db.close();}
  U.checkedDatabase(path.join(target,'data','auth.sqlite'),{auth:true});
 }
 for(const entry of manifest.files.filter(e=>e.kind==='tenant-sqlite'||e.kind==='legacy-sqlite')){
  const checked=U.checkedDatabase(path.join(target,entry.path),{workspace:true});
  if(checked.revision!==entry.database.revision||checked.stateHash!==entry.database.stateHash||checked.savedAt!==entry.database.savedAt)throw Error('Restored workspace state changed unexpectedly. The new target was preserved.');
 }
 U.privateWrite(path.join(target,'secrets','session-secret'),U.secretText());
 const recovery={format:'scopewise-restore-record',version:1,restoredAt:new Date().toISOString(),backupManifestSha256:U.hashFile(path.join(bundle,'manifest.json')),sourceStartedAt:manifest.startedAt,sourceCompletedAt:manifest.completedAt,sourceConsistency:manifest.consistency,workspaceStateAndRevisionPreserved:true,authSessionsRemoved:revokedSessions,newSessionSecretCreated:true,originalsPreserved:true};
 U.privateWrite(path.join(target,'restore-record.json'),JSON.stringify(recovery,null,2)+'\n');
 return {directory:target,recovery,tenants:manifest.tenantCount};
}
function main(argv=process.argv.slice(2)){
 if(argv.includes('--help')){console.log('node scripts/restore.cjs --bundle work/backup-sets/BUNDLE --target work/restores/NEW-DIRECTORY --confirm OFFLINE-RESTORE\nStop the server first. Target must not exist. Checksums and SQLite/workspace validation precede copying.\nRestored sessions are deleted and a new secret is generated. Existing databases and backup bundles are preserved.');return;}
 const a=U.parseArgs(argv,{'--bundle':'value','--target':'value','--confirm':'value'});
 const result=restoreWorkspace({bundle:a.bundle,target:a.target,confirm:a.confirm});
 console.log(JSON.stringify({restored:path.relative(U.ROOT,result.directory),tenants:result.tenants,sessionsRemoved:result.recovery.authSessionsRemoved,originalsPreserved:true,secretFile:path.relative(U.ROOT,path.join(result.directory,'secrets','session-secret'))},null,2));
}
if(require.main===module)try{main();}catch(error){console.error('Restore failed: '+error.message);process.exitCode=1;}
module.exports={allowedEntry,validateBundle,restoreWorkspace,main};
