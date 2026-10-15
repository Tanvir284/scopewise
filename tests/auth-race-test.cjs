'use strict';
const assert=require('node:assert/strict'),path=require('node:path'),crypto=require('node:crypto');
const {Readable}=require('node:stream');
const {DatabaseSync}=require('node:sqlite'),{exportSqlite}=require('../lib/postgres-transfer.cjs');
const {createApp}=require('../server.cjs'),{createAuthStore}=require('../lib/auth.cjs'),{loadConfig,ROOT}=require('../lib/config.cjs');
const relative='work/test-artifacts/auth-races-'+crypto.randomUUID(),secret=crypto.randomBytes(32),password='Synthetic-auth-race-password-2026!';
let app,auth,passed=0;
async function group(name,fn){await fn();passed++;console.log('PASS '+name);}
function capture(){let status=200,body;return {res:{headersSent:false,setHeader(){},writeHead(code){status=code;this.headersSent=true;},end(value){body=value;this.headersSent=true;}},result:()=>({status,data:JSON.parse(Buffer.from(body).toString())})};}
(async()=>{try{
 const config=loadConfig({SCOPEWISE_WORK_DIR:path.join(ROOT,relative),SCOPEWISE_SESSION_SECRET:secret.toString('hex')});
 auth=createAuthStore({filename:path.join(config.workDir,'data/auth.sqlite'),sessionSecret:secret});
 const agency=auth.createAgency({name:'Auth race fixture'}),owner=await auth.createUser({agencyId:agency.id,username:'race-owner',password,role:'owner'}),editor=await auth.createUser({agencyId:agency.id,username:'race-editor',password,role:'editor'});
 await group('Old SQLite accounts upgrade without losing passwords or sessions; exports retain credential versions',async()=>{
  const oldRelative=relative+'/old-format',filename=path.join(ROOT,oldRelative,'data/auth.sqlite');let old=createAuthStore({filename,sessionSecret:secret});
  const agency=old.createAgency({name:'Old format fixture'}),user=await old.createUser({agencyId:agency.id,username:'old-owner',password,role:'owner'}),session=old.createSession(user.id);old.close();
  const db=new DatabaseSync(filename);db.exec('ALTER TABLE users DROP COLUMN credential_version');db.close();
  assert.equal(exportSqlite({workDir:oldRelative,quiescent:true}).bundle.data.users[0].credential_version,1);
  old=createAuthStore({filename,sessionSecret:secret});assert.equal((await old.authenticate('old-owner',password)).id,user.id);assert.equal(old.getSession(session.token).user.id,user.id);
  await old.resetPassword(user.id,password);assert.equal(old.getSession(session.token),null);assert.equal((await old.authenticate('old-owner',password)).credentialVersion,2);old.close();
  assert.equal(exportSqlite({workDir:oldRelative,quiescent:true}).bundle.data.users[0].credential_version,2);
 });
 await group('Password and role changes reject an already verified older login',async()=>{
  const passwordProof=await auth.authenticate('race-editor',password);await auth.resetPassword(editor.id,password);
  assert.throws(()=>auth.createSession(editor.id,passwordProof.credentialVersion),error=>error.status===401&&error.code==='SESSION_CHANGED');
  const roleProof=await auth.authenticate('race-editor',password);auth.updateRole(editor.id,'viewer');
  assert.throws(()=>auth.createSession(editor.id,roleProof.credentialVersion),error=>error.status===401&&error.code==='SESSION_CHANGED');
  auth.updateRole(editor.id,'editor');
  const current=await auth.authenticate('race-editor',password),session=auth.createSession(editor.id,current.credentialVersion);assert.equal(auth.getSession(session.token).user.id,editor.id);
 });
 app=createApp({config,authStore:auth,logger:()=>{}});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 const origin='http://127.0.0.1:'+app.server.address().port,ownerSession=auth.createSession(owner.id);
 async function call(route,method='GET',body,session=ownerSession){const r=await fetch(origin+route,{method,headers:{Origin:origin,'Content-Type':'application/json',Cookie:'scopewise_session='+session.token,'X-Scopewise-Token':session.sessionToken},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:r.status,data:await r.json()};}
 await group('Role revocation during upload rejects pending save, import and planning',async()=>{
  const before=(await call('/api/workspace')).data;
  for(const route of ['/api/workspace','/api/migrate','/api/plan']){
   const session=auth.createSession(editor.id),body=JSON.stringify({state:before.state,revision:before.revision});let resume,started;
   const gate=new Promise(resolve=>resume=resolve),begun=new Promise(resolve=>started=resolve);
   const req=Readable.from((async function*(){yield Buffer.from(body.slice(0,20));started();await gate;yield Buffer.from(body.slice(20));})());
   // Owner-only import needs an owner at upload start. A second owner preserves the last-owner guard.
   if(route==='/api/migrate'){auth.updateRole(editor.id,'owner');Object.assign(session,auth.createSession(editor.id));}
   req.method=route==='/api/workspace'?'PUT':'POST';req.url=route;req.headers={host:new URL(origin).host,origin,'content-type':'application/json',cookie:'scopewise_session='+session.token,'x-scopewise-token':session.sessionToken};req.socket={remoteAddress:'127.0.0.1'};
   const response=capture(),pending=app.handler(req,response.res);await begun;auth.updateRole(editor.id,'viewer');resume();await pending;
   assert.equal(response.result().status,401,route);assert.deepEqual((await call('/api/workspace')).data,before);
   auth.updateRole(editor.id,'editor');
  }
 });
 console.log('SQLite authorization race checks: '+passed+' groups passed.');
}finally{if(app)await app.close();else auth?.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
