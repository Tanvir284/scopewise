'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const { DatabaseSync } = require('node:sqlite');
const W = require('./public/workspace-data.js');
const Ops = require('./public/operations-data.js');
const Rules = require('./public/rules-engine.js');
const ROOT = __dirname;
const {createAuthStore}=require('./lib/auth.cjs');
const {loadConfig}=require('./lib/config.cjs');
const COLLECTIONS = ['clients','projects','changes','tasks','activity'];
const STATIC_FILES = new Set(['index.html','auth.js','auth.css','costing-ui.js','costing.css','theme.css','planner.js','workspace.js','workspace-data.js','storage.js','workspace.css','cyberpunk.css','operations-data.js','operations-ui.js','operations.css','rule-catalogue.js','rules-engine.js','server-client.js','intelligence.js','platform.css']);
const TYPES = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8'};
class ApiError extends Error {
 constructor(status, code, message, details) {super(message); Object.assign(this,{status,code,details});}
}
function rejectPrototypeKeys(value, depth=0) {
 if(depth>40) throw new ApiError(400,'INVALID_WORKSPACE','Workspace nesting is too deep.');
 if(value && typeof value==='object') for(const key of Object.keys(value)){
  if(['__proto__','prototype','constructor'].includes(key)) throw new ApiError(400,'INVALID_WORKSPACE','Unsafe workspace property.');
  rejectPrototypeKeys(value[key],depth+1);
 }
}
function validateState(raw) {
 try{
  rejectPrototypeKeys(raw);
  const state=structuredClone(raw);
  W.validate(state); Ops.normalize(state); Ops.validate(state);
  if(state.settings.rulePreferences!==undefined) Rules.validatePreferences(state.settings.rulePreferences);
  return state;
 }catch(error){if(error instanceof ApiError) throw error; throw new ApiError(400,'INVALID_WORKSPACE',error.message || 'Invalid workspace.');}
}
function safeWorkPath(relative) {
 const base=path.resolve(ROOT,'work'),target=path.resolve(ROOT,relative);
 if(!target.startsWith(base+path.sep)) throw new Error('Persistence must stay inside Scopewise/work.');
 fs.mkdirSync(path.dirname(target),{recursive:true});
 const actualParent=fs.realpathSync(path.dirname(target));
 if(actualParent!==base && !actualParent.startsWith(base+path.sep)) throw new Error('Persistence directory resolves outside Scopewise/work.');
 if(fs.existsSync(target)&&!fs.realpathSync(target).startsWith(base+path.sep))throw new Error('Persistence file resolves outside Scopewise/work.');
 return target;
}
function createStore(databaseRelative='work/data/scopewise.sqlite',backupRelative='work/backups') {
 const filename=safeWorkPath(databaseRelative);
 const db=new DatabaseSync(filename);
 db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS workspace (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, json TEXT NOT NULL, saved_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS revisions (revision INTEGER PRIMARY KEY, saved_at TEXT NOT NULL, reason TEXT NOT NULL, json TEXT NOT NULL); CREATE TABLE IF NOT EXISTS migrations (hash TEXT PRIMARY KEY, imported_backup TEXT NOT NULL, server_backup TEXT, completed INTEGER NOT NULL DEFAULT 0);');
 if(!db.prepare('PRAGMA table_info(migrations)').all().some(x=>x.name==='completed'))db.exec('ALTER TABLE migrations ADD COLUMN completed INTEGER NOT NULL DEFAULT 0');
 function read(){const row=db.prepare('SELECT revision,json,saved_at FROM workspace WHERE id=1').get(); if(!row)return {state:null,revision:0};try{return {state:validateState(JSON.parse(row.json)),revision:row.revision,savedAt:row.saved_at};}catch{throw new ApiError(500,'STORAGE_DAMAGED','The saved server workspace could not be validated. Its database has been preserved; restore a known-good backup before saving.');}}
 function save(raw,revision,reason='Workspace saved'){
  const state=validateState(raw);
  if(!Number.isSafeInteger(revision)||revision<0||revision>=Number.MAX_SAFE_INTEGER)throw new ApiError(400,'INVALID_REVISION','A non-negative workspace revision is required.');
  db.exec('BEGIN IMMEDIATE');
  try{
   const current=read();
   if(current.revision!==revision)throw new ApiError(409,'REVISION_CONFLICT','Another tab saved newer work. Your draft is retained; load the latest server workspace before retrying.',{revision:current.revision});
   const next=revision+1,at=new Date().toISOString(),json=JSON.stringify(state);
   db.prepare('INSERT INTO workspace (id,revision,json,saved_at) VALUES (1,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,json=excluded.json,saved_at=excluded.saved_at').run(next,json,at);
   db.prepare('INSERT INTO revisions (revision,saved_at,reason,json) VALUES (?,?,?,?)').run(next,at,reason,json);
   db.exec('COMMIT'); return {state,revision:next,savedAt:at};
  }catch(error){db.exec('ROLLBACK');throw error;}
 }
 function safeBackupPath(relative){const target=path.resolve(ROOT,relative),base=path.resolve(ROOT,backupRelative);if(!target.startsWith(base+path.sep))throw Error('Backup reference is outside this workspace.');return safeWorkPath(relative);}
 function migrationBackups(state,current){
  const hash=crypto.createHash('sha256').update(JSON.stringify(state)).digest('hex');
  let row=db.prepare('SELECT imported_backup,server_backup,completed FROM migrations WHERE hash=?').get(hash);
  if(row)return {hash,...row};
  for(const previous of db.prepare('SELECT hash,imported_backup,server_backup,completed FROM migrations WHERE completed=1').all()){try{const priorState=validateState(JSON.parse(fs.readFileSync(safeBackupPath(previous.imported_backup),'utf8')));if(isDeepStrictEqual(priorState,state))return previous;}catch{/* Preserve missing/damaged snapshots without adopting them. */}}

  const name='migration-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+hash.slice(0,12);
  const imported=backupRelative+'/'+name+'-browser.json',server=current.state?backupRelative+'/'+name+'-server.json':null;
  fs.writeFileSync(safeWorkPath(imported),JSON.stringify(state,null,2),{flag:'wx'});
  if(server)fs.writeFileSync(safeWorkPath(server),JSON.stringify(current.state,null,2),{flag:'wx'});
  db.prepare('INSERT INTO migrations (hash,imported_backup,server_backup) VALUES (?,?,?)').run(hash,imported,server);
  return {hash,imported_backup:imported,server_backup:server,completed:0};
 }
 function migrate(raw){
  const incoming=validateState(raw),current=read(),backups=migrationBackups(incoming,current);
  function completed(result){db.prepare('UPDATE migrations SET completed=1 WHERE hash=?').run(backups.hash);return {...result,backups:{...backups,completed:1}}}
  if(backups.completed&&current.state)return {...current,backups};
  if(!current.state)return completed(save(incoming,0,'Browser workspace migrated'));
  const merged=structuredClone(current.state),conflicts=[];
  const ids=new Map();
  for(const key of COLLECTIONS)for(const record of merged[key])ids.set(record.id,{key,record});
  for(const key of Ops.COLLECTIONS)for(const record of merged.operations[key])ids.set(record.id,{key:'operations.'+key,record});
  function mergeRecords(key,target,source){
   for(const record of source){const existing=ids.get(record.id);if(existing){if(existing.key!==key||!isDeepStrictEqual(existing.record,record))conflicts.push(record.id);}
    else{target.push(structuredClone(record));ids.set(record.id,{key,record});}}
  }
  for(const key of COLLECTIONS)mergeRecords(key,merged[key],incoming[key]);
  for(const key of Ops.COLLECTIONS)mergeRecords('operations.'+key,merged.operations[key],incoming.operations[key]);
  for(const key of Object.keys(incoming).filter(k=>!COLLECTIONS.includes(k)&&k!=='operations'&&k!=='version')){
   if(merged[key]===undefined)merged[key]=structuredClone(incoming[key]);
   else if(!isDeepStrictEqual(merged[key],incoming[key]))conflicts.push(key);
  }
  if(conflicts.length)throw new ApiError(409,'MIGRATION_CONFLICT','The browser and server contain different versions of existing records. Both snapshots are preserved in work/backups. Export/review the browser draft before adopting server data.',{conflicts:[...new Set(conflicts)].slice(0,30),backups});
  if(isDeepStrictEqual(merged,current.state))return completed(current);
  return completed(save(merged,current.revision,'Browser records merged'));
 }
 return {read,save,migrate,history:()=>db.prepare('SELECT revision,saved_at AS savedAt,reason FROM revisions ORDER BY revision DESC LIMIT 200').all(),close:()=>db.close(),filename};
}
function json(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));}
async function readJson(req,maxBytes=8*1024*1024){
 if(!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']||''))throw new ApiError(415,'JSON_REQUIRED','Send a JSON request body.');
 const declared=Number(req.headers['content-length']);
 if(Number.isFinite(declared)&&declared>maxBytes)throw new ApiError(413,'BODY_TOO_LARGE','The request exceeds this deployment’s allowed size.');
 const chunks=[];let bytes=0;
 for await(const chunk of req){bytes+=chunk.length;if(bytes>maxBytes)throw new ApiError(413,'BODY_TOO_LARGE','The request exceeds this deployment’s allowed size.');chunks.push(chunk);}
 let body;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new ApiError(400,'INVALID_JSON','The request body is not valid JSON.');}
 if(!body||typeof body!=='object'||Array.isArray(body))throw new ApiError(400,'INVALID_BODY','A JSON object is required.');
 return body;
}
function validatePlan(plan){
 if(!plan||!Array.isArray(plan.changes)||!Array.isArray(plan.tasks)||!Array.isArray(plan.questions)||plan.changes.length>2000||plan.tasks.length>80||plan.questions.length>30)throw new ApiError(500,'INVALID_PLAN','The local planner produced invalid output.');
 if(!plan.changes.length)throw new ApiError(400,'NO_ACTIONABLE_CHANGE','No actionable requirement change was found. Add a concrete request or clarify the scope.');
 const valid=(v,max)=>typeof v==='string'&&v.trim().length>0&&v.length<=max;
 for(const change of plan.changes)if(!valid(change.text,12000)||!valid(change.type,50)||!valid(change.before,24000)||!valid(change.after,24000))throw new ApiError(500,'INVALID_PLAN','The local planner produced invalid change output.');
 for(const task of plan.tasks)if(!valid(task.title,150)||!valid(task.description,24000)||!Array.isArray(task.criteria)||task.criteria.length>30||task.criteria.some(c=>!valid(c,4000)))throw new ApiError(500,'INVALID_PLAN','The local planner produced invalid task output.');
 if(plan.questions.some(q=>!valid(q,12000)))throw new ApiError(500,'INVALID_PLAN','The local planner produced invalid question output.');
 return {...plan,source:'rules'};
}
function createLegacyApp(options={}){
 const store=options.store||createStore(options.databaseRelative,options.backupRelative);
 const sessionToken=crypto.randomBytes(32).toString('hex');
 const server=http.createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Cache-Control','no-store');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'");
  try{
   const port=server.address()?.port,host=req.headers.host;
   if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(server.address()?.address)||!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress))throw new ApiError(403,'LOOPBACK_REQUIRED','Compatibility mode requires a loopback listener and client.');
   if(!host||!['127.0.0.1:'+port,'localhost:'+port].includes(host))throw new ApiError(403,'INVALID_HOST','Use the loopback Scopewise preview address.');
   const origin=req.headers.origin;
   if(origin&&!['http://127.0.0.1:'+port,'http://localhost:'+port].includes(origin))throw new ApiError(403,'CROSS_ORIGIN','Cross-origin workspace access is not permitted.');
   if(req.headers['sec-fetch-site']==='cross-site')throw new ApiError(403,'CROSS_ORIGIN','Cross-site workspace access is not permitted.');
   const url=new URL(req.url,'http://'+host),pathname=url.pathname;
   if(pathname.startsWith('/api/')){
    if(!['GET','PUT','POST'].includes(req.method)){res.setHeader('Allow','GET, PUT, POST');throw new ApiError(405,'METHOD_NOT_ALLOWED','Unsupported API method.');}

    if(req.method!=='GET'){
     if(req.headers['x-scopewise-token']!==sessionToken)throw new ApiError(403,'TOKEN_REQUIRED','Refresh Scopewise before saving; the local session token is missing or expired.');
     const body=await readJson(req);
     if(pathname==='/api/workspace'&&req.method==='PUT')return json(res,200,store.save(body.state,body.revision));
     if(pathname==='/api/migrate'&&req.method==='POST')return json(res,200,store.migrate(body.state));
     if(pathname==='/api/plan'&&req.method==='POST'){
      const state=store.read().state,project=state?.projects.find(p=>p.id===body.projectId);
      if(!project)throw new ApiError(400,'PROJECT_REQUIRED','Save and select an existing project before planning.');
      if(typeof body.original!=='string'||typeof body.message!=='string'||!body.original.trim()||!body.message.trim()||body.original.length>24000||body.message.length>12000)throw new ApiError(400,'INVALID_REQUIREMENTS','Original requirements and client message are required (24,000 and 12,000 character limits).');
      if(body.original!==project.original)throw new ApiError(409,'BASELINE_CHANGED','The project baseline changed on the server. Reconnect and review the current scope before planning.');
      try{
       const plan=Rules.analyse(body.original,body.message,{project,existingTasks:state.tasks.filter(t=>t.projectId===project.id),operations:state.operations},state.settings.rulePreferences||{});
       return json(res,200,validatePlan(plan));
      }catch(error){if(error instanceof ApiError)throw error;throw new ApiError(400,'PLANNING_ERROR',error.message||'The local planner could not process this request.');}
     }
     throw new ApiError(404,'API_NOT_FOUND','This write endpoint does not exist.');
    }
    if(pathname==='/api/status')return json(res,200,{storage:'server',database:'sqlite',localOnly:true,sessionToken,planner:{mode:'rules',configured:true,label:'Local deterministic analysis',version:'2.0',ruleCount:Rules.catalogue().length},revision:store.read().revision});
    if(pathname==='/api/session')return json(res,200,{sessionToken});
    if(pathname==='/api/workspace')return json(res,200,store.read());
    if(pathname==='/api/history')return json(res,200,{revisions:store.history()});
    if(pathname==='/api/backup'){res.setHeader('Content-Disposition','attachment; filename="scopewise-server-backup.json"');return json(res,200,store.read().state);}
    throw new ApiError(404,'API_NOT_FOUND','This API endpoint does not exist.');
   }
   if(!['GET','HEAD'].includes(req.method)){res.setHeader('Allow','GET, HEAD');throw new ApiError(405,'METHOD_NOT_ALLOWED','Only GET and HEAD are supported for files.');}
   let name;try{name=decodeURIComponent(pathname==='/'?'index.html':pathname.slice(1));}catch{throw new ApiError(400,'INVALID_PATH','Invalid URL path.');}
   if(!STATIC_FILES.has(name))throw new ApiError(404,'NOT_FOUND','Not found.');
   const data=await fs.promises.readFile(path.join(ROOT,'public',name));
   res.setHeader('Content-Length',data.length);res.writeHead(200,{'Content-Type':TYPES[path.extname(name)]});res.end(req.method==='HEAD'?undefined:data);
  }catch(error){
   if(res.headersSent)return res.end();
   const known=error instanceof ApiError;
   json(res,known?error.status:error.code==='ENOENT'?404:500,{error:known?error.message:'The local server could not complete the request.',code:known?error.code:'SERVER_ERROR',...(known&&error.details?{details:error.details}:{})});
  }
 });
 server.headersTimeout=15000;server.requestTimeout=30000;
 server.on('clientError',(error,socket)=>{if(socket.writable)socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');});
 return {server,store,close:()=>new Promise(resolve=>server.close(()=>{store.close();resolve();}))};
}

function emptyWorkspace(name){return Ops.normalize({version:1,settings:{name,currency:'BDT'},clients:[],projects:[],changes:[],tasks:[],activity:[]});}
function createApp(options={}){
 if(options.authentication===false){if(options.config?.mode==='production'||process.env.NODE_ENV==='production'||process.env.SCOPEWISE_MODE==='production')throw Error('Unauthenticated compatibility mode cannot run in production.');return createLegacyApp(options);}
 const config=options.config||loadConfig(),backend=options.backend||(config.storage==='postgres'?require('./lib/postgres.cjs').createPostgresBackend({databaseUrl:config.databaseUrl,Pool:options.Pool,sessionSecret:config.sessionSecret,maxWorkspaceBytes:(config.maxBodyBytes||8388608)-1024,services:{validateState,emptyWorkspace,ApiError}}):null),auth=options.authStore||backend?.auth||createAuthStore({filename:path.join(config.workDir,'data/auth.sqlite'),sessionSecret:config.sessionSecret});
 const recentLocalAgencies=new Set();let closing=false,inFlightLogins=0;
 const log=options.logger||((event)=>process.stdout.write(JSON.stringify({...event,at:new Date().toISOString()})+'\n'));
 async function tenant(user,authorization){
  const id=user.agency.id;if(!/^[a-f0-9-]{36}$/.test(id))throw new ApiError(500,'ACCOUNT_UNAVAILABLE','Account configuration is unavailable.');
  if(backend){const store=backend.workspace(id,authorization);await store.ensureInitialized(user.agency.name);return store;}
  recentLocalAgencies.delete(id);recentLocalAgencies.add(id);if(recentLocalAgencies.size>32)recentLocalAgencies.delete(recentLocalAgencies.values().next().value);
  const base=config.workRelative+'/tenants/'+id,store=createStore(base+'/scopewise.sqlite',base+'/backups');
  try{if(!store.read().state)store.save(emptyWorkspace(user.agency.name),0,'Agency workspace initialized');return store;}catch(error){store.close();throw error;}
 }
 function cookies(req){const raw=req.headers.cookie||'';if(raw.length>8192)return null;const name=config.secureCookies?'__Host-scopewise':'scopewise_session';const matches=raw.split(';').map(x=>x.trim()).filter(x=>x.startsWith(name+'='));if(matches.length!==1)return null;return matches[0].slice(name.length+1);}
 function setCookie(res,token,remove=false){res.setHeader('Set-Cookie',(config.secureCookies?'__Host-scopewise':'scopewise_session')+'='+(remove?'':token)+'; Path=/; HttpOnly; SameSite=Strict; Max-Age='+(remove?'0':'28800')+(config.secureCookies?'; Secure':''));}
 function verifyCSRF(req,session){const given=req.headers['x-scopewise-token'];if(typeof given!=='string'||!/^[a-f0-9]{64}$/.test(given)||given.length!==session.sessionToken.length||!crypto.timingSafeEqual(Buffer.from(given),Buffer.from(session.sessionToken)))throw new ApiError(403,'CSRF_REQUIRED','Refresh your session before saving.');}
 function access(req,port,pathname){
  const origins=config.mode==='production'?[config.publicOrigin]:['http://127.0.0.1:'+port,'http://localhost:'+port,...(config.publicOrigin?[config.publicOrigin]:[])];
  const hosts=[...origins.map(x=>new URL(x).host),...(config.backendOrigin?[new URL(config.backendOrigin).host]:[])],host=req.headers.host;
  if(!host||!hosts.includes(host)){if(!pathname.startsWith('/health/')||!['127.0.0.1:'+port,'localhost:'+port,'[::1]:'+port].includes(host))throw new ApiError(403,'INVALID_HOST','This host is not configured for Scopewise.');}
  if(req.headers.origin&&!origins.includes(req.headers.origin))throw new ApiError(403,'CROSS_ORIGIN','Cross-origin access is not permitted.');
  if(req.headers['sec-fetch-site']==='cross-site')throw new ApiError(403,'CROSS_ORIGIN','Cross-site access is not permitted.');
  if(!['GET','HEAD'].includes(req.method)&&!origins.includes(req.headers.origin))throw new ApiError(403,'ORIGIN_REQUIRED','A same-origin request is required.');
 }
 const handler=async(req,res)=>{
  let requestStore=null;
  const requestId=crypto.randomUUID();res.setHeader('X-Request-ID',requestId);res.setHeader('CDN-Cache-Control','no-store');res.setHeader('Vercel-CDN-Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
  if(config.secureCookies)res.setHeader('Strict-Transport-Security','max-age=31536000');
  try{
   let url;try{url=new URL(req.url,'http://scopewise.invalid');}catch{throw new ApiError(400,'INVALID_PATH','Invalid request path.');}
   const pathname=url.pathname;access(req,server.address()?.port,pathname);
   if(pathname.startsWith('/api/')&&config.proxySecret){const raw=req.headers['x-scopewise-proxy'],given=typeof raw==='string'?Buffer.from(raw):Buffer.alloc(0);if(given.length!==config.proxySecret.length||!crypto.timingSafeEqual(given,config.proxySecret))throw new ApiError(403,'PROXY_REQUIRED','This API is accessed through the configured frontend.');}
   if(closing)throw new ApiError(503,'SHUTTING_DOWN','The service is shutting down. Retry shortly.');
   if(pathname==='/health/live'&&['GET','HEAD'].includes(req.method))return json(res,200,{status:'ok'});
   if(pathname==='/health/ready'&&['GET','HEAD'].includes(req.method)){
    let ready=false;try{await auth.health();ready=auth.hasActiveOwner?await auth.hasActiveOwner() :(await auth.listUsers()).some(x=>x.active&&x.role==='owner');
    if(!backend)for(const id of recentLocalAgencies){const db=new DatabaseSync(path.join(config.workDir,'tenants',id,'scopewise.sqlite'),{readOnly:true});try{const row=db.prepare('SELECT json FROM workspace WHERE id=1').get();if(row)validateState(JSON.parse(row.json));}finally{db.close();}}
    }catch{ready=false;}
    return json(res,ready?200:503,{status:ready?'ready':'not-ready'});
   }
   const rawToken=cookies(req),session=pathname.startsWith('/api/')?await auth.getSession(rawToken):null;
   if(pathname==='/api/auth/session'&&req.method==='GET')return json(res,200,session?{authenticated:true,...session}:{authenticated:false});
   if(pathname==='/api/auth/login'&&req.method==='POST'){
    const body=await readJson(req,4096);rejectPrototypeKeys(body);
    if(Object.keys(body).some(k=>!['username','password'].includes(k))||typeof body.username!=='string'||typeof body.password!=='string'||body.username.length>100||body.password.length>128)throw new ApiError(400,'INVALID_LOGIN','Enter a valid username and password.');
    if(!(await auth.checkLoginLimit(body.username,req.socket.remoteAddress||'unknown'))||inFlightLogins>=4){res.setHeader('Retry-After','900');throw new ApiError(429,'LOGIN_LIMIT','Too many sign-in attempts. Try again later.');}
    inFlightLogins++;let user;try{user=await auth.authenticate(body.username,body.password);}finally{inFlightLogins--;}
    if(!user){log({event:'login_rejected',requestId});throw new ApiError(401,'INVALID_CREDENTIALS','Invalid username or password.');}
    await auth.clearLoginLimit(body.username);if(rawToken)await auth.revokeSession(rawToken);
    const created=await auth.createSession(user.id,user.credentialVersion);setCookie(res,created.token);log({event:'login',requestId,userId:user.id,agencyId:user.agency.id});
    return json(res,200,{authenticated:true,user:created.user,sessionToken:created.sessionToken,expiresAt:created.expiresAt,idleExpiresAt:created.idleExpiresAt});
   }
   if(pathname==='/api/auth/logout'&&req.method==='POST'){
    if(!session)throw new ApiError(401,'AUTH_REQUIRED','Sign in to continue.');verifyCSRF(req,session);await auth.revokeSession(rawToken);setCookie(res,'',true);return json(res,200,{authenticated:false});
   }
   if(pathname.startsWith('/api/')){
    if(!['GET','PUT','POST'].includes(req.method)){res.setHeader('Allow','GET, PUT, POST');throw new ApiError(405,'METHOD_NOT_ALLOWED','Unsupported API method.');}
    if(!session)throw new ApiError(401,'AUTH_REQUIRED','Sign in to access your agency workspace.');
    if(req.method==='GET'){try{verifyCSRF(req,session)}catch{throw new ApiError(401,'SESSION_CHANGED','Your session changed. Refresh authentication before loading workspace data.');}}
    if(req.method!=='GET'){
     if(session.user.role==='viewer')throw new ApiError(403,'READ_ONLY','Your account has read-only access.');
     if(pathname==='/api/migrate'&&session.user.role!=='owner')throw new ApiError(403,'OWNER_REQUIRED','Only an agency owner may merge a backup.');
     verifyCSRF(req,session);const body=await readJson(req,config.maxBodyBytes||8388608);rejectPrototypeKeys(body);
     const store=requestStore=await tenant(session.user,{token:rawToken,userId:session.user.id});
     if(pathname==='/api/workspace'&&req.method==='PUT'){const saved=await store.save(body.state,body.revision,'Workspace saved by '+session.user.id);log({event:'workspace_saved',requestId,userId:session.user.id,agencyId:session.user.agency.id,revision:saved.revision});return json(res,200,saved);}
     if(pathname==='/api/migrate'&&req.method==='POST'){const migrated=await store.migrate(body.state);log({event:'workspace_import',requestId,userId:session.user.id,agencyId:session.user.agency.id,revision:migrated.revision});return json(res,200,migrated);}
     if(pathname==='/api/plan'&&req.method==='POST'){
      const state=(await store.read({write:true})).state,project=state.projects.find(p=>p.id===body.projectId);
      if(!project)throw new ApiError(400,'PROJECT_REQUIRED','Select an existing project in your agency.');
      if(typeof body.original!=='string'||typeof body.message!=='string'||!body.original.trim()||!body.message.trim()||body.original.length>24000||body.message.length>12000)throw new ApiError(400,'INVALID_REQUIREMENTS','Original requirements and client message are required (24,000 and 12,000 character limits).');
      if(body.original!==project.original)throw new ApiError(409,'BASELINE_CHANGED','Review the current project baseline before planning.');
      try{return json(res,200,validatePlan(Rules.analyse(body.original,body.message,{project,existingTasks:state.tasks.filter(t=>t.projectId===project.id),operations:state.operations},state.settings.rulePreferences||{})));}catch(error){if(error instanceof ApiError)throw error;throw new ApiError(400,'PLANNING_ERROR','The deterministic planner could not process this request.');}
     }
     throw new ApiError(404,'API_NOT_FOUND','This write endpoint does not exist.');
    }
    const store=requestStore=await tenant(session.user,{token:rawToken,userId:session.user.id});
    if(pathname==='/api/status')return json(res,200,{storage:'server',database:config.storage||'sqlite',localOnly:config.mode==='development',sessionToken:session.sessionToken,user:session.user,readOnly:session.user.role==='viewer',automaticMigration:false,planner:{mode:'rules',configured:true,label:'Deterministic analysis',version:'2.0',ruleCount:Rules.catalogue().length},revision:store.revision?await store.revision():(await store.read()).revision});
    if(pathname==='/api/session')return json(res,200,{sessionToken:session.sessionToken});
    if(pathname==='/api/workspace')return json(res,200,await store.read());
    if(pathname==='/api/history')return json(res,200,{revisions:await store.history()});
    if(pathname==='/api/backup'){res.setHeader('Content-Disposition','attachment; filename="scopewise-agency-backup.json"');return json(res,200,(await store.read()).state);}
    throw new ApiError(404,'API_NOT_FOUND','This API endpoint does not exist.');
   }
   if(!['GET','HEAD'].includes(req.method)){res.setHeader('Allow','GET, HEAD');throw new ApiError(405,'METHOD_NOT_ALLOWED','Only GET and HEAD are supported for files.');}
   let name;try{name=decodeURIComponent(pathname==='/'?'index.html':pathname.slice(1));}catch{throw new ApiError(400,'INVALID_PATH','Invalid URL path.');}
   if(!config.serveFrontend)throw new ApiError(404,'NOT_FOUND','Use the configured frontend for the workspace.');
   if(!STATIC_FILES.has(name))throw new ApiError(404,'NOT_FOUND','Not found.');
   const data=await fs.promises.readFile(path.join(ROOT,'public',name));res.setHeader('Content-Length',data.length);res.writeHead(200,{'Content-Type':TYPES[path.extname(name)]});res.end(req.method==='HEAD'?undefined:data);
  }catch(error){
   if(res.headersSent)return res.end();const known=error instanceof ApiError,status=known?error.status:error.code==='ENOENT'?404:500;
   log({event:'request_failed',requestId,status,code:known?error.code:'SERVER_ERROR'});
   json(res,status,{error:known?error.message:'The service could not complete the request. Quote its request ID to the operator.',code:known?error.code:'SERVER_ERROR',requestId,...(known&&error.details?{details:error.details}:{})});
  }finally{if(requestStore)await requestStore.close();}
 };
 const server=http.createServer(handler);
 server.headersTimeout=15000;server.requestTimeout=30000;server.maxRequestsPerSocket=100;server.keepAliveTimeout=5000;
 server.on('clientError',(_error,socket)=>{if(socket.writable)socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');});
 async function resourcesClose(){await auth.close();if(backend)await backend.close();}
 return {server,handler,auth,config,backend,ready:()=>backend?backend.ready():Promise.resolve(),close:()=>{closing=true;return new Promise((resolve,reject)=>server.close(()=>resourcesClose().then(resolve,reject)));}};
}

if(require.main===module){
 let app;try{const config=loadConfig();app=createApp({config});app.ready().then(()=>app.server.listen(config.port,config.host,()=>console.log('Scopewise authenticated workspace: '+(config.publicOrigin||'http://127.0.0.1:'+config.port)))).catch(()=>{console.error('Scopewise database startup failed. Verify private settings and schema initialization.');process.exitCode=1;app.close().catch(()=>{});});
 app.server.on('error',error=>{console.error(JSON.stringify({event:'startup_failed',code:error.code||'ERROR'}));app.close().catch(()=>{});process.exitCode=1;});
 for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{const deadline=setTimeout(()=>process.exit(1),10000);deadline.unref();app.close().then(()=>process.exit(0));});
 }catch(error){console.error('Scopewise startup configuration failed: '+error.message);process.exitCode=1;}
}
module.exports={createApp,createStore,validateState,validatePlan,ApiError,emptyWorkspace};
