'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const ROOT=path.resolve(__dirname,'..'),WORK_ROOT=path.join(ROOT,'work');
function inside(target,base=WORK_ROOT){
 const resolved=path.resolve(target),relative=path.relative(path.resolve(base),resolved);
 if(relative.startsWith('..'+path.sep)||relative==='..'||path.isAbsolute(relative))throw Error('Operator files must stay inside Scopewise/work.');
 let current=path.parse(resolved).root;
 for(const part of resolved.slice(current.length).split(path.sep).filter(Boolean)){
  current=path.join(current,part);
  try{if(fs.lstatSync(current).isSymbolicLink())throw Error('Symbolic links are not supported for operator data paths.');}catch(error){if(error.code!=='ENOENT')throw error;}
 }
 return resolved;
}
function workDirectory(value){return inside(path.resolve(ROOT,value||process.env.SCOPEWISE_WORK_DIR||'work'));}
function parseArgs(argv,allowed){
 const values={};
 for(let i=0;i<argv.length;i++){
  const flag=argv[i];
  if(!flag.startsWith('--')||!Object.hasOwn(allowed,flag))throw Error('Unsupported option. Use --help; passwords are never command-line arguments.');
  const key=flag.slice(2);
  if(Object.hasOwn(values,key))throw Error('Duplicate option.');
  if(allowed[flag]==='boolean')values[key]=true;
  else{const value=argv[++i];if(value===undefined||value.startsWith('--'))throw Error('An option value is missing.');values[key]=value;}
 }
 return values;
}
function privateDirectory(directory){inside(directory);fs.mkdirSync(directory,{recursive:true,mode:0o700});}
function privateWrite(filename,data){inside(filename);privateDirectory(path.dirname(filename));fs.writeFileSync(filename,data,{flag:'wx',mode:0o600});}
function hashFile(filename){
 const fd=fs.openSync(filename,'r'),hash=crypto.createHash('sha256'),buffer=Buffer.alloc(1024*1024);
 try{let length;while((length=fs.readSync(fd,buffer,0,buffer.length,null)))hash.update(buffer.subarray(0,length));return hash.digest('hex');}finally{fs.closeSync(fd);}
}
function fileInfo(filename){const stat=fs.lstatSync(filename);if(!stat.isFile()||stat.isSymbolicLink())throw Error('Expected a regular operator file.');return stat;}
function safeRelative(value){
 if(typeof value!=='string'||!value||value.includes('\\')||value.includes('\0')||value.startsWith('/')||/^[A-Za-z]:/.test(value))throw Error('Invalid backup file path.');
 const parts=value.split('/');
 if(parts.some(p=>!p||p==='.'||p==='..'||p.includes(':')))throw Error('Invalid backup file path.');
 return value;
}
function checkedDatabase(filename,{workspace=false,auth=false}={}){
 fileInfo(filename);const db=new DatabaseSync(filename,{readOnly:true});
 try{
  const results=db.prepare('PRAGMA integrity_check').all();
  if(results.length!==1||Object.values(results[0])[0]!=='ok')throw Error('SQLite integrity check failed; original data has been preserved.');
  if(auth){
   for(const name of ['agencies','users','sessions'])if(!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name))throw Error('Authentication database schema is missing.');
   if(db.prepare('PRAGMA user_version').get().user_version!==1)throw Error('Unsupported authentication backup schema version.');
   if(db.prepare('PRAGMA foreign_key_check').all().length)throw Error('Authentication records contain broken agency or account references.');
   return {integrity:'ok',agencies:Number(db.prepare('SELECT COUNT(*) AS n FROM agencies').get().n),users:Number(db.prepare('SELECT COUNT(*) AS n FROM users').get().n)};
  }
  if(!workspace)return {integrity:'ok'};
  if(!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='workspace'").get())throw Error('The workspace database schema is missing.');
  const row=db.prepare('SELECT revision,json,saved_at FROM workspace WHERE id=1').get();
  if(!row)return {integrity:'ok',initialized:false,revision:0};
  if(!Number.isSafeInteger(row.revision)||row.revision<0||typeof row.saved_at!=='string'||!Number.isFinite(Date.parse(row.saved_at)))throw Error('Invalid saved workspace revision or timestamp.');
  let raw;try{raw=JSON.parse(row.json);}catch{throw Error('The saved workspace JSON is invalid.');}
  require('../server.cjs').validateState(raw);
  return {integrity:'ok',initialized:true,revision:row.revision,savedAt:row.saved_at,stateHash:crypto.createHash('sha256').update(row.json).digest('hex'),state:raw};
 }finally{db.close();}
}
function vacuumSnapshot(source,destination){
 inside(source);inside(destination);fileInfo(source);
 if(fs.existsSync(destination))throw Error('Snapshot destination already exists.');
 privateDirectory(path.dirname(destination));const db=new DatabaseSync(source,{readOnly:true});
 try{db.exec('PRAGMA busy_timeout=10000');db.prepare('VACUUM INTO ?').run(destination);}finally{db.close();}
 try{fs.chmodSync(destination,0o600);}catch{}
}
function secretText(){return crypto.randomBytes(48).toString('base64url')+'\n';}
module.exports={ROOT,WORK_ROOT,inside,workDirectory,parseArgs,privateDirectory,privateWrite,hashFile,fileInfo,safeRelative,checkedDatabase,vacuumSnapshot,secretText};
