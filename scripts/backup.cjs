'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const U=require('./operator-utils.cjs');
function inventory(work){
 const files=[];
 function add(relative,kind){const filename=U.inside(path.join(work,relative),work);if(fs.existsSync(filename)){U.fileInfo(filename);files.push({path:relative.split(path.sep).join('/'),kind});}}
 add('data/auth.sqlite','auth-sqlite');add('data/scopewise.sqlite','legacy-sqlite');
 const tenants=path.join(work,'tenants');
 if(fs.existsSync(tenants)){
  U.inside(tenants,work);
  for(const id of fs.readdirSync(tenants).sort()){
   if(!/^[A-Za-z0-9_-]{1,100}$/.test(id))throw Error('Unexpected agency directory name.');
   const directory=U.inside(path.join(tenants,id),work),stat=fs.lstatSync(directory);
   if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('Expected a regular agency directory.');
   add('tenants/'+id+'/scopewise.sqlite','tenant-sqlite');
  }
 }
 function artifacts(directory){
  if(!fs.existsSync(directory))return;
  U.inside(directory,work);
  for(const name of fs.readdirSync(directory).sort()){
   const filename=U.inside(path.join(directory,name),work),stat=fs.lstatSync(filename);
   if(stat.isSymbolicLink())throw Error('Backup artifacts contain a symbolic link.');
   if(stat.isDirectory())artifacts(filename);
   else if(stat.isFile())files.push({path:path.relative(work,filename).split(path.sep).join('/'),kind:'artifact'});
   else throw Error('Unsupported backup artifact file.');
  }
 }
 artifacts(path.join(work,'backups'));
 if(fs.existsSync(tenants))for(const id of fs.readdirSync(tenants).sort()){
  artifacts(path.join(tenants,id,'backups'));add('tenants/'+id+'/legacy-adoption.json','artifact');
 }
 const seen=new Set();
 for(const item of files){U.safeRelative(item.path);const key=item.path.toLowerCase();if(seen.has(key))throw Error('Backup file names collide on a case-insensitive filesystem.');seen.add(key);}
 return files.sort((a,b)=>a.path.localeCompare(b.path));
}
function backupWorkspace(options={}){
 if(process.env.SCOPEWISE_STORAGE==='postgres'&&!options.explicitSqliteExport)throw Error('Use postgres-admin export for a PostgreSQL backup; SQLite tools do not back up the hosted database.');
 const work=U.workDirectory(options.workDir),startedAt=new Date().toISOString();
 const output=options.outputDir?U.inside(path.resolve(U.ROOT,options.outputDir)):path.join(work,'backup-sets',startedAt.replace(/[:.]/g,'-')+'-'+crypto.randomBytes(4).toString('hex'));
 if(output===work||work.startsWith(output+path.sep)||fs.existsSync(output))throw Error('Choose a new backup directory separate from the source workspace.');
 if(options.includeSecret&&!options.secretFile)throw Error('Supply an explicit --secret-file when including the session secret.');
 const entries=inventory(work);
 if(!entries.some(e=>e.kind.endsWith('sqlite')))throw Error('No canonical SQLite databases were found.');
 if(entries.some(e=>e.kind==='tenant-sqlite')&&!entries.some(e=>e.kind==='auth-sqlite'))throw Error('Tenant databases require their central authentication database.');
 U.privateDirectory(output);const payload=path.join(output,'payload'),files=[];
 function record(relative,kind,extra={}){
  const filename=path.join(payload,relative),stat=U.fileInfo(filename);
  files.push({path:relative,kind,bytes:stat.size,sha256:U.hashFile(filename),...extra});
 }
 for(const item of entries){
  const source=path.join(work,item.path),destination=path.join(payload,item.path);
  if(item.kind.endsWith('sqlite')){
   U.vacuumSnapshot(source,destination);
   const checked=U.checkedDatabase(destination,{workspace:item.kind!=='auth-sqlite',auth:item.kind==='auth-sqlite'}),{state,...metadata}=checked;
   record(item.path,item.kind,{database:metadata});
   if(item.kind!=='auth-sqlite'){
    const jsonPath=item.kind==='legacy-sqlite'?'exports/legacy-workspace.json':'exports/'+item.path.replace(/\/scopewise\.sqlite$/,'/workspace.json');
    U.privateWrite(path.join(payload,jsonPath),JSON.stringify({state:state||null,revision:metadata.revision,savedAt:metadata.savedAt||null},null,2)+'\n');
    record(jsonPath,'workspace-export',{database:metadata});
   }
  }else{
   const before=U.fileInfo(source);U.privateDirectory(path.dirname(destination));
   fs.copyFileSync(source,destination,fs.constants.COPYFILE_EXCL);
   const after=U.fileInfo(source);
   if(before.size!==after.size||before.mtimeMs!==after.mtimeMs)throw Error('A backup artifact changed during copying. The partial bundle was preserved; retry after stopping writers.');
   try{fs.chmodSync(destination,0o600);}catch{}
   record(item.path,item.kind);
  }
 }
 if(JSON.stringify(inventory(work))!==JSON.stringify(entries))throw Error('Database or backup-file inventory changed during backup. The partial bundle was preserved; stop writers and retry.');
 if(options.includeSecret){
  const secretFile=path.resolve(U.ROOT,options.secretFile),stat=U.fileInfo(secretFile);
  if(stat.size>1024||stat.size<32)throw Error('Unexpected session-secret file size.');
  U.privateWrite(path.join(payload,'secrets/session-secret'),fs.readFileSync(secretFile));record('secrets/session-secret','session-secret');
 }
 const manifest={format:'scopewise-multiagency-backup',version:1,startedAt,completedAt:new Date().toISOString(),consistency:options.quiescent?'operator-confirmed-quiescent':'individual-database-snapshots',authIncluded:entries.some(e=>e.kind==='auth-sqlite'),legacyIncluded:entries.some(e=>e.kind==='legacy-sqlite'),tenantCount:entries.filter(e=>e.kind==='tenant-sqlite').length,secretIncluded:Boolean(options.includeSecret),files};
 U.privateWrite(path.join(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
 return {directory:output,manifest};
}
function main(argv=process.argv.slice(2)){
 if(argv.includes('--help')){console.log('node scripts/backup.cjs [--work work] [--output work/backup-sets/new-name] [--quiescent] [--include-secret --secret-file FILE]\nDefault: SQLite-consistent per-database snapshots; stop all writers for a coordinated multi-agency recovery point.\nSecrets are excluded by default. Restore always invalidates sessions. All output stays inside Scopewise/work.');return;}
 const a=U.parseArgs(argv,{'--work':'value','--output':'value','--quiescent':'boolean','--include-secret':'boolean','--secret-file':'value'});
 const result=backupWorkspace({workDir:a.work,outputDir:a.output,quiescent:a.quiescent,includeSecret:a['include-secret'],secretFile:a['secret-file']});
 console.log(JSON.stringify({backup:path.relative(U.ROOT,result.directory),consistency:result.manifest.consistency,files:result.manifest.files.length,tenants:result.manifest.tenantCount,secretIncluded:result.manifest.secretIncluded},null,2));
}
if(require.main===module)try{main();}catch(error){console.error('Backup failed: '+error.message);process.exitCode=1;}
module.exports={inventory,backupWorkspace,main};
