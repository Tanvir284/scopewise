'use strict';
const crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
const {promisify}=require('node:util'),{DatabaseSync}=require('node:sqlite');
const scrypt=promisify(crypto.scrypt),ROLES=new Set(['owner','editor','viewer']);
const uid=()=>crypto.randomUUID();
function passwordCheck(password){if(typeof password!=='string'||password.length<12||password.length>128||Buffer.byteLength(password)>512)throw Error('Use a password of 12 to 128 characters.');}
function usernameCheck(value){if(typeof value!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9._@+-]{2,99}$/.test(value))throw Error('Username must be 3–100 letters, numbers or . _ @ + - .');return value.toLowerCase();}
async function hashPassword(password,salt=crypto.randomBytes(16).toString('hex')){passwordCheck(password);return {salt,hash:(await scrypt(password,salt,64,{N:16384,r:8,p:1,maxmem:64*1024*1024})).toString('hex')};}
function createAuthStore(options={}){
 const ApiError=options.ApiError||require('../server.cjs').ApiError;
 const inside=require('../scripts/operator-utils.cjs').inside;
 const filename=inside(path.resolve(options.filename||path.join(__dirname,'../work/data/auth.sqlite')));
 fs.mkdirSync(path.dirname(filename),{recursive:true,mode:0o700});
 const db=new DatabaseSync(filename);db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
 const version=db.prepare('PRAGMA user_version').get().user_version;if(version>1){db.close();throw Error('Unsupported newer authentication database.');}
 db.exec(`CREATE TABLE IF NOT EXISTS agencies(id TEXT PRIMARY KEY,name TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,agency_id TEXT NOT NULL REFERENCES agencies(id),username TEXT NOT NULL UNIQUE,role TEXT NOT NULL CHECK(role IN ('owner','editor','viewer')),salt TEXT NOT NULL,password_hash TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),created_at INTEGER NOT NULL,last_seen INTEGER NOT NULL,expires_at INTEGER NOT NULL);
 CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
 CREATE TABLE IF NOT EXISTS login_limits(key TEXT PRIMARY KEY,attempts INTEGER NOT NULL,window_start INTEGER NOT NULL);
 PRAGMA user_version=1;`);
 db.exec('BEGIN IMMEDIATE');try{if(!db.prepare('PRAGMA table_info(users)').all().some(column=>column.name==='credential_version'))db.exec('ALTER TABLE users ADD COLUMN credential_version INTEGER NOT NULL DEFAULT 1');db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');db.close();throw error;}
 try{fs.chmodSync(filename,0o600);}catch{/* Operator must protect file ACL on Windows. */}
 const secret=options.sessionSecret?Buffer.from(options.sessionSecret):null;
 if(secret&&secret.length<32){db.close();throw Error('Session secret must contain at least 32 bytes.');}
 const now=options.now||Date.now,lifetime=options.sessionLifetimeMs||8*60*60*1000,idle=options.idleMs||30*60*1000;
 const dummySalt='00000000000000000000000000000000';
 let dummyHash=null;
 function publicUser(row){return row?{id:row.id,username:row.username,role:row.role,agency:{id:row.agency_id,name:row.agency_name}}:null;}
 function userRow(id){return db.prepare('SELECT users.*,agencies.name AS agency_name FROM users JOIN agencies ON agencies.id=users.agency_id WHERE users.id=? AND users.active=1 AND agencies.active=1').get(id);}
 function ownerGuard(id){const row=userRow(id);if(row?.role==='owner'&&db.prepare("SELECT COUNT(*) AS n FROM users WHERE agency_id=? AND role='owner' AND active=1").get(row.agency_id).n<=1)throw Error('Provision another active owner before changing the last owner.');}
 function createAgency({name}){if(typeof name!=='string'||!name.trim()||name.length>120)throw Error('Agency name is required (maximum 120 characters).');const agency={id:uid(),name:name.trim()};db.prepare('INSERT INTO agencies(id,name,created_at) VALUES(?,?,?)').run(agency.id,agency.name,new Date(now()).toISOString());return agency;}
 async function createUser({agencyId,username,password,role}){username=usernameCheck(username);if(!ROLES.has(role))throw Error('Role must be owner, editor or viewer.');if(!db.prepare('SELECT id FROM agencies WHERE id=? AND active=1').get(agencyId))throw Error('Agency does not exist.');const encoded=await hashPassword(password),id=uid();db.prepare('INSERT INTO users(id,agency_id,username,role,salt,password_hash,created_at) VALUES(?,?,?,?,?,?,?)').run(id,agencyId,username,role,encoded.salt,encoded.hash,new Date(now()).toISOString());return publicUser(userRow(id));}
 async function authenticate(username,password){
  if(typeof username!=='string'||typeof password!=='string'||username.length>100||password.length>128||Buffer.byteLength(password)>512)return null;
  const row=db.prepare('SELECT users.*,agencies.name AS agency_name,agencies.active AS agency_active FROM users JOIN agencies ON agencies.id=users.agency_id WHERE username=?').get(username.toLowerCase());
  if(!dummyHash)dummyHash=(await scrypt('scopewise-unused-dummy-password',dummySalt,64,{N:16384,r:8,p:1,maxmem:64*1024*1024})).toString('hex');
  const calculated=await scrypt(password,row?.salt||dummySalt,64,{N:16384,r:8,p:1,maxmem:64*1024*1024}),expected=Buffer.from(row?.password_hash||dummyHash,'hex');
  const equal=expected.length===calculated.length&&crypto.timingSafeEqual(expected,calculated);
  return equal&&row?.active&&row?.agency_active?{...publicUser(row),credentialVersion:row.credential_version}:null;
 }
 const digest=token=>crypto.createHash('sha256').update(token).digest('hex');
 function csrf(token){if(!secret)throw Error('Session secret is required for session use.');return crypto.createHmac('sha256',secret).update('scopewise-csrf:'+token).digest('hex');}
 function createSession(userId,credentialVersion){const token=crypto.randomBytes(32).toString('hex'),sessionToken=csrf(token),at=now(),expires=at+lifetime;let user;db.exec('BEGIN IMMEDIATE');try{const row=userRow(userId);if(!row||credentialVersion!==undefined&&row.credential_version!==credentialVersion)throw new ApiError(401,'SESSION_CHANGED','Account access changed. Sign in again.');user=publicUser(row);db.prepare('DELETE FROM sessions WHERE expires_at<=? OR last_seen<=?').run(at,at-idle);const prior=db.prepare('SELECT token_hash FROM sessions WHERE user_id=? ORDER BY created_at DESC').all(userId);for(const row of prior.slice(9))db.prepare('DELETE FROM sessions WHERE token_hash=?').run(row.token_hash);db.prepare('INSERT INTO sessions VALUES(?,?,?,?,?)').run(digest(token),userId,at,at,expires);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}return {token,sessionToken,user,expiresAt:new Date(expires).toISOString(),idleExpiresAt:new Date(at+idle).toISOString()};}
 function getSession(token){if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))return null;const hash=digest(token),row=db.prepare('SELECT * FROM sessions WHERE token_hash=?').get(hash);if(!row)return null;const at=now(),user=publicUser(userRow(row.user_id));if(!user||row.expires_at<=at||row.last_seen+idle<=at){db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hash);return null;}if(at-row.last_seen>=60000)db.prepare('UPDATE sessions SET last_seen=? WHERE token_hash=?').run(at,hash);return {user,sessionToken:csrf(token),expiresAt:new Date(row.expires_at).toISOString(),idleExpiresAt:new Date((at-row.last_seen>=60000?at:row.last_seen)+idle).toISOString()};}
 function revokeSession(token){if(typeof token==='string')db.prepare('DELETE FROM sessions WHERE token_hash=?').run(digest(token));}
 async function resetPassword(id,password){const encoded=await hashPassword(password);db.exec('BEGIN IMMEDIATE');try{if(!userRow(id))throw Error('Active account does not exist.');db.prepare('UPDATE users SET salt=?,password_hash=?,credential_version=credential_version+1 WHERE id=?').run(encoded.salt,encoded.hash,id);db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}}
 function revokeUser(id){db.exec('BEGIN IMMEDIATE');try{if(!userRow(id))throw Error('Active account does not exist.');ownerGuard(id);db.prepare('UPDATE users SET active=0,credential_version=credential_version+1 WHERE id=?').run(id);db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}}
 function updateRole(id,role){if(!ROLES.has(role))throw Error('Invalid role.');db.exec('BEGIN IMMEDIATE');try{if(!userRow(id))throw Error('Active account does not exist.');if(role!=='owner')ownerGuard(id);db.prepare('UPDATE users SET role=?,credential_version=credential_version+1 WHERE id=?').run(role,id);db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}}
 function withSession(authorization,permissions,operation){
  db.exec('BEGIN IMMEDIATE');try{
   const session=getSession(authorization.token),user=session?.user;
   if(!user||user.id!==authorization.userId||user.agency.id!==authorization.agencyId)throw new ApiError(401,'AUTH_REQUIRED','Your account access changed. Sign in again.');
   if(permissions.write&&user.role==='viewer')throw new ApiError(403,'READ_ONLY','Your account has read-only access.');
   if(permissions.owner&&user.role!=='owner')throw new ApiError(403,'OWNER_REQUIRED','Only an agency owner may merge a backup.');
   // Local workspace operations are synchronous. Hold the account lock through the operation,
   // so an operator cannot revoke access between this check and the committed workspace write.
   const result=operation();db.exec('COMMIT');return result;
  }catch(error){db.exec('ROLLBACK');throw error;}
 }
 function checkLoginLimit(username,peer){const at=now(),window=15*60*1000;db.prepare('DELETE FROM login_limits WHERE window_start<?').run(at-window);const keys=['user:'+String(username).toLowerCase(),'peer:'+peer].map(s=>crypto.createHash('sha256').update(s).digest('hex'));for(let i=0;i<keys.length;i++){const row=db.prepare('SELECT attempts FROM login_limits WHERE key=?').get(keys[i]);if(row&&row.attempts>=(i===0?10:1000))return false;}for(const key of keys)db.prepare('INSERT INTO login_limits VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=attempts+1').run(key,at);return true;}
 function clearLoginLimit(username){db.prepare('DELETE FROM login_limits WHERE key=?').run(crypto.createHash('sha256').update('user:'+String(username).toLowerCase()).digest('hex'));}
 function health(){db.prepare('SELECT 1').get();return true;}
 return {filename,createAgency,createUser,authenticate,createSession,getSession,revokeSession,resetPassword,revokeUser,updateRole,withSession,checkLoginLimit,clearLoginLimit,health,
 hasActiveOwner:()=>Boolean(db.prepare("SELECT 1 FROM users u JOIN agencies a ON a.id=u.agency_id WHERE u.active=1 AND a.active=1 AND u.role='owner' LIMIT 1").get()),
 listAgencies:()=>db.prepare('SELECT id,name,active,created_at AS createdAt FROM agencies ORDER BY name').all(),
 listUsers:(filter={})=>db.prepare('SELECT users.id,username,role,users.active,agency_id AS agencyId,agencies.name AS agencyName FROM users JOIN agencies ON agencies.id=users.agency_id'+(filter.agencyId?' WHERE agency_id=?':'')+' ORDER BY username').all(...(filter.agencyId?[filter.agencyId]:[])),
 revokeAllSessions:()=>db.prepare('DELETE FROM sessions').run(),close:()=>db.close()};
}
module.exports={createAuthStore,hashPassword,passwordCheck};
