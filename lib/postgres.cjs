'use strict';
const crypto=require('node:crypto');
const {gzipSync,gunzipSync}=require('node:zlib');
const {isDeepStrictEqual}=require('node:util');
const {promisify}=require('node:util');
const {hashPassword}=require('./auth.cjs');
const scrypt=promisify(crypto.scrypt);
const ROLES=new Set(['owner','editor','viewer']);
const SCHEMA=[
'CREATE SCHEMA IF NOT EXISTS scopewise',
'CREATE TABLE IF NOT EXISTS scopewise.schema_meta(id INTEGER PRIMARY KEY CHECK(id=1),version INTEGER NOT NULL)',
'INSERT INTO scopewise.schema_meta VALUES(1,1) ON CONFLICT(id) DO NOTHING',
'CREATE TABLE IF NOT EXISTS scopewise.agencies(id TEXT PRIMARY KEY,name TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)),created_at TEXT NOT NULL)',
"CREATE TABLE IF NOT EXISTS scopewise.users(id TEXT PRIMARY KEY,agency_id TEXT NOT NULL REFERENCES scopewise.agencies(id),username TEXT UNIQUE NOT NULL,role TEXT NOT NULL CHECK(role IN('owner','editor','viewer')),salt TEXT NOT NULL,password_hash TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)),created_at TEXT NOT NULL,credential_version BIGINT NOT NULL DEFAULT 1)",
'CREATE TABLE IF NOT EXISTS scopewise.sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES scopewise.users(id),created_at BIGINT NOT NULL,last_seen BIGINT NOT NULL,expires_at BIGINT NOT NULL)',
'CREATE INDEX IF NOT EXISTS scopewise_sessions_user ON scopewise.sessions(user_id)',
'CREATE TABLE IF NOT EXISTS scopewise.login_limits(key TEXT PRIMARY KEY,attempts INTEGER NOT NULL,window_start BIGINT NOT NULL)',
'CREATE TABLE IF NOT EXISTS scopewise.workspaces(agency_id TEXT PRIMARY KEY REFERENCES scopewise.agencies(id),revision BIGINT NOT NULL CHECK(revision>=0 AND revision<=9007199254740991),json TEXT NOT NULL,saved_at TEXT NOT NULL)',
'CREATE TABLE IF NOT EXISTS scopewise.revisions(agency_id TEXT NOT NULL REFERENCES scopewise.agencies(id),revision BIGINT NOT NULL CHECK(revision>0 AND revision<=9007199254740991),saved_at TEXT NOT NULL,reason TEXT NOT NULL,json_gzip BYTEA NOT NULL,PRIMARY KEY(agency_id,revision))',
'CREATE TABLE IF NOT EXISTS scopewise.imports(agency_id TEXT NOT NULL REFERENCES scopewise.agencies(id),hash TEXT NOT NULL,incoming_gzip BYTEA NOT NULL,server_gzip BYTEA,server_revision BIGINT NOT NULL,completed INTEGER NOT NULL DEFAULT 0 CHECK(completed IN(0,1)),PRIMARY KEY(agency_id,hash))',
'CREATE TABLE IF NOT EXISTS scopewise.legacy_sources(id TEXT PRIMARY KEY,payload TEXT NOT NULL)',
'CREATE TABLE IF NOT EXISTS scopewise.artifacts(path TEXT PRIMARY KEY,content BYTEA NOT NULL)'
];
function poolSettings(databaseUrl){
 let url;try{url=new URL(databaseUrl);}catch{throw Error('A private PostgreSQL connection URL is required.');}
 if(!['postgres:','postgresql:'].includes(url.protocol)||!url.hostname||!url.username||!url.password||url.pathname==='/'||url.hash)throw Error('Invalid private PostgreSQL connection settings.');
 for(const key of url.searchParams.keys())if(!['sslmode','channel_binding'].includes(key))throw Error('Unsupported PostgreSQL URL setting. Use the provider connection URL with sslmode=require.');
 if(url.searchParams.has('sslmode')&&!['require','verify-full','verify-ca'].includes(url.searchParams.get('sslmode')))throw Error('PostgreSQL TLS verification is required.');
 if(url.searchParams.has('channel_binding')&&url.searchParams.get('channel_binding')!=='require')throw Error('PostgreSQL channel binding must be required.');
 let user,password,database;try{user=decodeURIComponent(url.username);password=decodeURIComponent(url.password);database=decodeURIComponent(url.pathname.slice(1));}catch{throw Error('Invalid encoded PostgreSQL connection settings.');}
 if(!database)throw Error('A PostgreSQL database name is required.');
 return {host:url.hostname,port:Number(url.port||5432),user,password,database,ssl:{rejectUnauthorized:true},enableChannelBinding:true,max:2,connectionTimeoutMillis:10000,idleTimeoutMillis:10000,statement_timeout:15000,query_timeout:20000,allowExitOnIdle:true};
}
function createPool(databaseUrl,PoolClass){
 const settings=poolSettings(databaseUrl),Pool=PoolClass||require('pg').Pool,pool=new Pool(settings);
 pool.on('error',()=>process.stderr.write('Scopewise PostgreSQL idle connection failed; requests will reconnect.\n'));
 return pool;
}
const pack=text=>gzipSync(Buffer.from(text,'utf8'));
const unpack=data=>gunzipSync(Buffer.from(data),{maxOutputLength:64*1024*1024}).toString('utf8');
const digest=token=>crypto.createHash('sha256').update(token).digest('hex');
function safeNumber(value){const n=Number(value);if(!Number.isSafeInteger(n)||n<0)throw Error('Invalid stored numeric value.');return n;}
function createPostgresBackend(options={}){
 const {validateState,emptyWorkspace,ApiError}=options.services||require('../server.cjs');
 const now=options.now||Date.now,lifetime=options.sessionLifetimeMs||8*60*60*1000,idle=options.idleMs||30*60*1000;
 const secret=options.sessionSecret?Buffer.from(options.sessionSecret):null;
 if(secret&&secret.length<32)throw Error('Session secret requires at least 32 bytes.');
 if(typeof validateState!=='function'||typeof emptyWorkspace!=='function'||typeof ApiError!=='function')throw Error('Workspace services are required.');
 const maxWorkspaceBytes=options.maxWorkspaceBytes||8*1024*1024;
 const pool=options.pool||createPool(options.databaseUrl,options.Pool);
 let readyPromise=null;
 async function ready(){if(!readyPromise)readyPromise=pool.query('SELECT version FROM scopewise.schema_meta WHERE id=1').then(result=>{if(result.rows[0]?.version!==1)throw Error('Run the explicit PostgreSQL schema initialization before starting.');}).catch(error=>{readyPromise=null;throw error;});return readyPromise;}
 async function q(sql,values=[]){await ready();return pool.query(sql,values);}
 async function transaction(fn,skipReady=false){
  if(!skipReady)await ready();const c=await pool.connect();
  let broken=null;try{await c.query('BEGIN');const result=await fn(c);await c.query('COMMIT');return result;}
  catch(error){try{await c.query('ROLLBACK');}catch(rollbackError){broken=rollbackError;}throw error;}
  finally{c.release(broken||undefined);}
 }
 async function init(){await transaction(async c=>{for(const sql of SCHEMA)await c.query(sql);const result=await c.query('SELECT version FROM scopewise.schema_meta WHERE id=1');if(result.rows[0]?.version!==1)throw Error('Unsupported PostgreSQL schema version.');},true);readyPromise=null;await ready();}
 function publicUser(row){return row?{id:row.id,username:row.username,role:row.role,agency:{id:row.agency_id,name:row.agency_name}}:null;}
 async function userRow(c,id,lock=false){return (await c.query('SELECT u.*,a.name AS agency_name FROM scopewise.users u JOIN scopewise.agencies a ON a.id=u.agency_id WHERE u.id=$1 AND u.active=1 AND a.active=1'+(lock?' FOR UPDATE OF u':''),[id])).rows[0];}
 async function agencyLock(c,id){const row=(await c.query('SELECT id,name,active FROM scopewise.agencies WHERE id=$1 FOR UPDATE',[id])).rows[0];if(!row||!row.active)throw new ApiError(500,'ACCOUNT_UNAVAILABLE','Agency configuration is unavailable.');return row;}
 async function accountLock(c,id){const found=(await c.query('SELECT agency_id FROM scopewise.users WHERE id=$1',[id])).rows[0];if(!found)throw Error('Active account does not exist.');await agencyLock(c,found.agency_id);const row=await userRow(c,id,true);if(!row)throw Error('Active account does not exist.');return row;}
 async function ownerGuard(c,row){if(row.role==='owner'&&Number((await c.query("SELECT count(*) AS n FROM scopewise.users WHERE agency_id=$1 AND role='owner' AND active=1",[row.agency_id])).rows[0].n)<=1)throw Error('Provision another active owner before changing the last owner.');}
 function csrf(token){if(!secret)throw Error('A managed session secret is required.');return crypto.createHmac('sha256',secret).update('scopewise-csrf:'+token).digest('hex');}
 let dummyHash=null;
 const auth={
  async createAgency({name}){if(typeof name!=='string'||!name.trim()||name.length>120)throw Error('Agency name is required (maximum 120 characters).');const agency={id:crypto.randomUUID(),name:name.trim()};await q('INSERT INTO scopewise.agencies(id,name,created_at) VALUES($1,$2,$3)',[agency.id,agency.name,new Date(now()).toISOString()]);return agency;},
  async createUser({agencyId,username,password,role}){
   if(typeof username!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9._@+-]{2,99}$/.test(username))throw Error('Use a valid 3–100 character username.');
   if(!ROLES.has(role))throw Error('Role must be owner, editor or viewer.');
   const encoded=await hashPassword(password),id=crypto.randomUUID();
   return transaction(async c=>{await agencyLock(c,agencyId);await c.query('INSERT INTO scopewise.users(id,agency_id,username,role,salt,password_hash,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)',[id,agencyId,username.toLowerCase(),role,encoded.salt,encoded.hash,new Date(now()).toISOString()]);return publicUser(await userRow(c,id));});
  },
  async authenticate(username,password){
   if(typeof username!=='string'||typeof password!=='string'||username.length>100||password.length>128||Buffer.byteLength(password)>512)return null;
   const row=(await q('SELECT u.*,a.name AS agency_name,a.active AS agency_active FROM scopewise.users u JOIN scopewise.agencies a ON a.id=u.agency_id WHERE username=$1',[username.toLowerCase()])).rows[0];
   const salt='00000000000000000000000000000000';
   if(!dummyHash)dummyHash=scrypt('scopewise-unused-dummy-password',salt,64,{N:16384,r:8,p:1,maxmem:64*1024*1024});
   const fallback=await dummyHash,calculated=await scrypt(password,row?.salt||salt,64,{N:16384,r:8,p:1,maxmem:64*1024*1024}),expected=row?Buffer.from(row.password_hash,'hex'):fallback;
   return expected.length===calculated.length&&crypto.timingSafeEqual(expected,calculated)&&row?.active&&row?.agency_active?{...publicUser(row),credentialVersion:safeNumber(row.credential_version)}:null;
  },
  async createSession(userId,credentialVersion){
   return transaction(async c=>{
    const row=await accountLock(c,userId);if(credentialVersion!==undefined&&safeNumber(row.credential_version)!==credentialVersion)throw new ApiError(401,'SESSION_CHANGED','Account access changed. Sign in again.');
    const token=crypto.randomBytes(32).toString('hex'),at=now(),expires=at+lifetime;
    await c.query('DELETE FROM scopewise.sessions WHERE user_id=$1 AND (expires_at<=$2 OR last_seen<=$3)',[userId,at,at-idle]);
    await c.query('DELETE FROM scopewise.sessions WHERE token_hash IN(SELECT token_hash FROM scopewise.sessions WHERE user_id=$1 ORDER BY created_at DESC,token_hash DESC OFFSET 9)',[userId]);
    await c.query('INSERT INTO scopewise.sessions VALUES($1,$2,$3,$3,$4)',[digest(token),userId,at,expires]);
    return {token,sessionToken:csrf(token),user:publicUser(row),expiresAt:new Date(expires).toISOString(),idleExpiresAt:new Date(at+idle).toISOString()};
   });
  },
  async getSession(token){
   if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))return null;
   return transaction(async c=>{const hash=digest(token),row=(await c.query('SELECT * FROM scopewise.sessions WHERE token_hash=$1 FOR UPDATE',[hash])).rows[0];if(!row)return null;
    const at=now(),last=safeNumber(row.last_seen),expires=safeNumber(row.expires_at),user=publicUser(await userRow(c,row.user_id));
    if(!user||expires<=at||last+idle<=at){await c.query('DELETE FROM scopewise.sessions WHERE token_hash=$1',[hash]);return null;}
    const seen=at-last>=60000?at:last;if(seen!==last)await c.query('UPDATE scopewise.sessions SET last_seen=$1 WHERE token_hash=$2',[seen,hash]);
    return {user,sessionToken:csrf(token),expiresAt:new Date(expires).toISOString(),idleExpiresAt:new Date(seen+idle).toISOString()};
   });
  },
  async revokeSession(token){if(typeof token==='string')await q('DELETE FROM scopewise.sessions WHERE token_hash=$1',[digest(token)]);},
  async resetPassword(id,password){const encoded=await hashPassword(password);await transaction(async c=>{await accountLock(c,id);await c.query('UPDATE scopewise.users SET salt=$1,password_hash=$2,credential_version=credential_version+1 WHERE id=$3',[encoded.salt,encoded.hash,id]);await c.query('DELETE FROM scopewise.sessions WHERE user_id=$1',[id]);});},
  async revokeUser(id){await transaction(async c=>{const row=await accountLock(c,id);await ownerGuard(c,row);await c.query('UPDATE scopewise.users SET active=0,credential_version=credential_version+1 WHERE id=$1',[id]);await c.query('DELETE FROM scopewise.sessions WHERE user_id=$1',[id]);});},
  async updateRole(id,role){if(!ROLES.has(role))throw Error('Invalid role.');await transaction(async c=>{const row=await accountLock(c,id);if(role!=='owner')await ownerGuard(c,row);await c.query('UPDATE scopewise.users SET role=$1,credential_version=credential_version+1 WHERE id=$2',[role,id]);await c.query('DELETE FROM scopewise.sessions WHERE user_id=$1',[id]);});},
  async checkLoginLimit(username,peer){return transaction(async c=>{const at=now(),cutoff=at-15*60*1000;const keys=['user:'+String(username).toLowerCase(),'peer:'+String(peer)].map(digest);let allowed=true;
   for(let i=0;i<keys.length;i++){const result=await c.query('INSERT INTO scopewise.login_limits(key,attempts,window_start) VALUES($1,1,$2) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN scopewise.login_limits.window_start<$3 THEN 1 ELSE LEAST(scopewise.login_limits.attempts+1,1000000) END,window_start=CASE WHEN scopewise.login_limits.window_start<$3 THEN $2 ELSE scopewise.login_limits.window_start END RETURNING attempts',[keys[i],at,cutoff]);if(result.rows[0].attempts>(i===0?10:1000))allowed=false;}
   await c.query('DELETE FROM scopewise.login_limits WHERE key IN(SELECT key FROM scopewise.login_limits WHERE window_start<$1 ORDER BY key LIMIT 100 FOR UPDATE SKIP LOCKED)',[cutoff]);return allowed;});},
  async clearLoginLimit(username){await q('DELETE FROM scopewise.login_limits WHERE key=$1',[digest('user:'+String(username).toLowerCase())]);},
  async hasActiveOwner(){return (await q("SELECT 1 FROM scopewise.users u JOIN scopewise.agencies a ON a.id=u.agency_id WHERE u.active=1 AND a.active=1 AND u.role='owner' LIMIT 1")).rows.length>0;},
  async health(){await q('SELECT 1');return true;},
  async listAgencies(){return (await q('SELECT id,name,active,created_at AS "createdAt" FROM scopewise.agencies ORDER BY name')).rows;},
  async listUsers(filter={}){return (await q('SELECT u.id,username,role,u.active,agency_id AS "agencyId",a.name AS "agencyName" FROM scopewise.users u JOIN scopewise.agencies a ON a.id=u.agency_id'+(filter.agencyId?' WHERE agency_id=$1':'')+' ORDER BY username',filter.agencyId?[filter.agencyId]:[])).rows;},
  async revokeAllSessions(){await q('DELETE FROM scopewise.sessions');},
  close:async()=>{}
 };
 function workspace(agencyId,authorization=null){
  if(typeof agencyId!=='string'||!/^[a-f0-9-]{36}$/.test(agencyId))throw Error('Invalid agency binding.');
  function decoded(row){if(!row)return {state:null,revision:0};try{return {state:validateState(JSON.parse(row.json)),revision:safeNumber(row.revision),savedAt:row.saved_at};}catch{throw new ApiError(500,'STORAGE_DAMAGED','The saved workspace could not be validated. Restore a verified backup before saving.');}}
  function checkSize(state){if(Buffer.byteLength(JSON.stringify(state),'utf8')>maxWorkspaceBytes)throw new ApiError(413,'WORKSPACE_TOO_LARGE','The workspace exceeds this deployment size limit. Use an operator export and split or reduce records before retrying.');}
  async function authorize(c,write=false,owner=false){
   if(!authorization)return;
   if(typeof authorization.token!=='string'||!/^[a-f0-9]{64}$/.test(authorization.token))throw new ApiError(401,'AUTH_REQUIRED','Sign in again.');
   const row=(await c.query('SELECT s.user_id,s.last_seen,s.expires_at,u.agency_id,u.role,u.active,a.active AS agency_active FROM scopewise.sessions s JOIN scopewise.users u ON u.id=s.user_id JOIN scopewise.agencies a ON a.id=u.agency_id WHERE s.token_hash=$1 FOR UPDATE OF s',[digest(authorization.token)])).rows[0];
   if(!row||row.user_id!==authorization.userId||row.agency_id!==agencyId||!row.active||!row.agency_active||safeNumber(row.expires_at)<=now()||safeNumber(row.last_seen)+idle<=now())throw new ApiError(401,'AUTH_REQUIRED','Your account access changed. Sign in again.');
   if(write&&row.role==='viewer')throw new ApiError(403,'READ_ONLY','Your account has read-only access.');
   if(owner&&row.role!=='owner')throw new ApiError(403,'OWNER_REQUIRED','Only an agency owner may merge a backup.');
  }
  async function current(c){return decoded((await c.query('SELECT revision,json,saved_at FROM scopewise.workspaces WHERE agency_id=$1',[agencyId])).rows[0]);}
  async function write(c,state,revision,reason,at=new Date(now()).toISOString()){
   if(!Number.isSafeInteger(revision)||revision<0||revision>=Number.MAX_SAFE_INTEGER)throw new ApiError(400,'INVALID_REVISION','A supported non-negative revision is required.');
   checkSize(state);const json=JSON.stringify(state),next=revision+1;
   await c.query('INSERT INTO scopewise.workspaces(agency_id,revision,json,saved_at) VALUES($1,$2,$3,$4) ON CONFLICT(agency_id) DO UPDATE SET revision=excluded.revision,json=excluded.json,saved_at=excluded.saved_at',[agencyId,next,json,at]);
   await c.query('INSERT INTO scopewise.revisions VALUES($1,$2,$3,$4,$5)',[agencyId,next,at,reason,pack(json)]);
   return {state,revision:next,savedAt:at};
  }
  return {
   async ensureInitialized(name){return transaction(async c=>{await agencyLock(c,agencyId);await authorize(c);const head=(await c.query('SELECT revision FROM scopewise.workspaces WHERE agency_id=$1',[agencyId])).rows[0];return head?{revision:safeNumber(head.revision)}:write(c,emptyWorkspace(name),0,'Agency workspace initialized');});},
   async read({write=false}={}){return transaction(async c=>{await agencyLock(c,agencyId);await authorize(c,write);return current(c);});},
   async revision(){return transaction(async c=>{await agencyLock(c,agencyId);await authorize(c);return safeNumber((await c.query('SELECT revision FROM scopewise.workspaces WHERE agency_id=$1',[agencyId])).rows[0]?.revision||0);});},
   async save(raw,revision,reason='Workspace saved'){
    const state=validateState(raw);checkSize(state);if(!Number.isSafeInteger(revision)||revision<0||revision>=Number.MAX_SAFE_INTEGER)throw new ApiError(400,'INVALID_REVISION','A supported non-negative revision is required.');
    return transaction(async c=>{await agencyLock(c,agencyId);await authorize(c,true);const head=await current(c);if(head.revision!==revision)throw new ApiError(409,'REVISION_CONFLICT','Another tab saved newer work. Load the latest workspace before retrying.',{revision:head.revision});return write(c,state,revision,reason);});
   },
   async migrate(raw){
    const incoming=validateState(raw);checkSize(incoming);const incomingJson=JSON.stringify(incoming),hash=digest(incomingJson);
    const result=await transaction(async c=>{
     await agencyLock(c,agencyId);await authorize(c,true,true);const head=await current(c);let prior=(await c.query('SELECT hash,completed,incoming_gzip FROM scopewise.imports WHERE agency_id=$1 AND hash=$2',[agencyId,hash])).rows[0];
     if(!prior){for(const row of (await c.query('SELECT hash,completed,incoming_gzip FROM scopewise.imports WHERE agency_id=$1 AND completed=1',[agencyId])).rows){try{if(isDeepStrictEqual(validateState(JSON.parse(unpack(row.incoming_gzip))),incoming)){prior=row;break;}}catch{}}}
     const ledgerHash=prior?.hash||hash,backups={storage:'postgres',importId:ledgerHash,completed:prior?.completed||0};
     if(prior?.completed&&head.state)return {...head,backups};
     if(!prior)await c.query('INSERT INTO scopewise.imports(agency_id,hash,incoming_gzip,server_gzip,server_revision) VALUES($1,$2,$3,$4,$5)',[agencyId,hash,pack(incomingJson),head.state?pack(JSON.stringify(head.state)):null,head.revision]);
     let merged=incoming,conflicts=[];
     if(head.state){merged=structuredClone(head.state);const ids=new Map(),collections=['clients','projects','changes','tasks','activity'],ops=require('../public/operations-data.js').COLLECTIONS;
      for(const key of collections)for(const record of merged[key])ids.set(record.id,{key,record});
      for(const key of ops)for(const record of merged.operations[key])ids.set(record.id,{key:'operations.'+key,record});
      const merge=(key,target,source)=>{for(const record of source){const old=ids.get(record.id);if(old){if(old.key!==key||!isDeepStrictEqual(old.record,record))conflicts.push(record.id);}else{target.push(structuredClone(record));ids.set(record.id,{key,record});}}};
      for(const key of collections)merge(key,merged[key],incoming[key]);for(const key of ops)merge('operations.'+key,merged.operations[key],incoming.operations[key]);
      for(const key of Object.keys(incoming).filter(key=>!collections.includes(key)&&key!=='operations'&&key!=='version')){if(merged[key]===undefined)merged[key]=structuredClone(incoming[key]);else if(!isDeepStrictEqual(merged[key],incoming[key]))conflicts.push(key);}
     }
     if(conflicts.length)return {conflict:true,conflicts:[...new Set(conflicts)].slice(0,30),backups};
     let validated;try{validated=validateState(merged);checkSize(validated);}catch(error){return {conflict:true,size:error.code==='WORKSPACE_TOO_LARGE',conflicts:['Combined records violate workspace limits or relationships.'],backups};}
     const saved=head.state&&isDeepStrictEqual(validated,head.state)?head:await write(c,validated,head.revision,'Browser records merged');
     await c.query('UPDATE scopewise.imports SET completed=1 WHERE agency_id=$1 AND hash=$2',[agencyId,ledgerHash]);
     return {...saved,backups:{...backups,completed:1}};
    });
    if(result.conflict)throw new ApiError(result.size?413:409,result.size?'WORKSPACE_TOO_LARGE':'MIGRATION_CONFLICT','Existing records differ. Both import snapshots are preserved in the external database; export and review before retrying.',{conflicts:result.conflicts,backups:result.backups});
    return result;
   },
   async history(){return transaction(async c=>{await agencyLock(c,agencyId);await authorize(c);return (await c.query('SELECT revision,saved_at AS "savedAt",reason FROM scopewise.revisions WHERE agency_id=$1 ORDER BY revision DESC LIMIT 200',[agencyId])).rows.map(row=>({...row,revision:safeNumber(row.revision)}));});},
   close:async()=>{}
  };
 }
 return {pool,auth,workspace,ready,init,transaction,close:()=>pool.end()};
}
module.exports={createPostgresBackend,createPool,poolSettings,SCHEMA,pack,unpack,safeNumber};
