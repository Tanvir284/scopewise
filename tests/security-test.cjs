'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite'),{createApp,validateState}=require('../server.cjs'),{createAuthStore}=require('../lib/auth.cjs'),{loadConfig,ROOT}=require('../lib/config.cjs'),W=require('../public/workspace-data.js');
const rel='work/test-artifacts/security-'+crypto.randomUUID(),dir=path.join(ROOT,rel),secret=crypto.randomBytes(32).toString('hex'),proxySecret=crypto.randomBytes(32).toString('hex'),password='Synthetic-Test-Password-2026!';
const env={SCOPEWISE_MODE:'production',PORT:'10000',SCOPEWISE_WORK_DIR:dir,SCOPEWISE_PUBLIC_ORIGIN:'https://scopewise.example',SCOPEWISE_BACKEND_ORIGIN:'https://scopewise-api.onrender.com',SCOPEWISE_SESSION_SECRET:secret,SCOPEWISE_PROXY_SECRET:proxySecret};
let config=loadConfig(env),clock=Date.now(),auth=createAuthStore({filename:path.join(dir,'data/auth.sqlite'),sessionSecret:config.sessionSecret,now:()=>clock}),app,edge,passed=0,logs=[];
const clone=o=>JSON.parse(JSON.stringify(o));
function call(port,route,method='GET',body,headers={}){return new Promise((resolve,reject)=>{const data=body===undefined?undefined:typeof body==='string'?body:JSON.stringify(body),request=http.request({host:'127.0.0.1',port,path:route,method,headers:{Host:'scopewise-api.onrender.com','Content-Type':'application/json','X-Scopewise-Proxy':proxySecret,...(method==='GET'?{}:{Origin:config.publicOrigin}),...headers,...(data===undefined?{}:{'Content-Length':Buffer.byteLength(data)})}},res=>{let text='';res.setEncoding('utf8');res.on('data',x=>text+=x);res.on('end',()=>{let data;try{data=JSON.parse(text)}catch{data=text}resolve({status:res.statusCode,data,headers:res.headers,text})})});request.on('error',reject);if(data!==undefined)request.write(data);request.end()})}
const request=(...a)=>call(app.server.address().port,...a);
async function start(){app=createApp({config,authStore:auth,logger:x=>logs.push(x)});await new Promise(r=>app.server.listen(0,'127.0.0.1',r))}
async function group(name,fn){await fn();passed++;console.log('PASS '+name)}
async function login(username){const r=await request('/api/auth/login','POST',{username,password});assert.equal(r.status,200);return {cookie:r.headers['set-cookie'][0].split(';')[0],token:r.data.sessionToken,user:r.data.user,response:r}}
const headers=s=>({Cookie:s.cookie,'X-Scopewise-Token':s.token});
function seeded(prefix,name){const s=validateState(W.sample()),map=new Map();for(const key of ['clients','projects','tasks','activity'])for(const row of s[key]){map.set(row.id,prefix+'-'+row.id);row.id=map.get(row.id)}
for(const p of s.projects)p.clientId=map.get(p.clientId);for(const t of s.tasks)t.projectId=map.get(t.projectId);s.settings.name=name;return validateState(s)}
(async()=>{
try{
 const A=auth.createAgency({name:'Security agency A'}),B=auth.createAgency({name:'Security agency B'});
 const owner=await auth.createUser({agencyId:A.id,username:'owner-a',password,role:'owner'}),editor=await auth.createUser({agencyId:A.id,username:'editor-a',password,role:'editor'}),viewer=await auth.createUser({agencyId:A.id,username:'viewer-a',password,role:'viewer'}),ownerB=await auth.createUser({agencyId:B.id,username:'owner-b',password,role:'owner'});
 await start();let o,e,v,b,stateA,stateB;
 await group('Anonymous APIs, origin/host boundaries and private files',async()=>{
 for(const route of ['/api/status','/api/workspace','/api/history','/api/backup','/api/session'])assert.equal((await request(route)).status,401);
 assert.equal((await request('/api/workspace','PUT',{})).status,401);assert.deepEqual((await request('/api/auth/session')).data,{authenticated:false});
 assert.equal((await request('/api/auth/login','POST',{username:'owner-a',password},{Origin:''})).status,403);
 assert.equal((await request('/api/auth/login','POST',{username:'owner-a',password},{Origin:env.SCOPEWISE_BACKEND_ORIGIN})).status,403);
 assert.equal((await request('/api/auth/session','GET',undefined,{'X-Scopewise-Proxy':''})).status,403);
 assert.equal((await request('/api/auth/session','GET',undefined,{'X-Scopewise-Proxy':'forged'})).status,403);
 assert.equal((await request('/api/auth/session','GET',undefined,{Host:'evil.example','X-Forwarded-Host':'scopewise-api.onrender.com','X-Forwarded-Proto':'https'})).status,403);
 const live=await request('/health/live','GET',undefined,{'X-Scopewise-Proxy':''});assert.equal(live.status,200);assert.deepEqual(live.data,{status:'ok'});assert.equal((await request('/health/ready')).status,200);
 for(const route of ['/','/server.cjs','/lib/auth.cjs','/work/data/auth.sqlite','/.env'])assert.equal((await request(route)).status,404);
 });
 await group('Generic login errors and securely stored credentials/session cookies',async()=>{
 const wrong=await request('/api/auth/login','POST',{username:'owner-a',password:'Incorrect-password-2026!'}),unknown=await request('/api/auth/login','POST',{username:'unknown-user',password});assert.equal(wrong.status,401);assert.equal(unknown.status,401);assert.equal(wrong.data.error,unknown.data.error);assert.equal(wrong.data.code,unknown.data.code);assert.notEqual(wrong.data.requestId,unknown.data.requestId);
 o=await login('owner-a');e=await login('editor-a');v=await login('viewer-a');b=await login('owner-b');
 const cookie=o.response.headers['set-cookie'][0];assert.match(cookie,/^__Host-scopewise=[a-f0-9]{64}; Path=\//);for(const flag of ['HttpOnly','SameSite=Strict','Secure','Max-Age=28800'])assert(cookie.includes(flag));assert(!/Domain=/i.test(cookie));
 const db=new DatabaseSync(auth.filename);const rows=db.prepare('SELECT salt,password_hash FROM users').all();assert.equal(new Set(rows.map(x=>x.salt)).size,4);assert(rows.every(x=>x.password_hash.length===128&&!x.password_hash.includes(password)));assert(!db.prepare('SELECT token_hash FROM sessions').all().some(x=>x.token_hash===o.cookie.split('=')[1]));db.close();
 assert.equal(o.response.headers['strict-transport-security'],'max-age=31536000');
 });
 await group('Agency initialization and server-only tenant selection',async()=>{
 let a=await request('/api/workspace','GET',undefined,headers(o)),bb=await request('/api/workspace','GET',undefined,headers(b));assert.equal(a.data.revision,1);assert.equal(bb.data.revision,1);assert.equal(a.data.state.projects.length,0);assert.equal(bb.data.state.projects.length,0);
 stateA=seeded('A',A.name);stateB=seeded('B',B.name);
 assert.equal((await request('/api/workspace','PUT',{state:stateA,revision:1,agencyId:B.id},headers(o))).status,200);
 assert.equal((await request('/api/workspace','PUT',{state:stateB,revision:1},headers(b))).status,200);
 for(const route of ['/api/status','/api/workspace','/api/history','/api/backup','/api/session']){const mixed=await request(route,'GET',undefined,{Cookie:b.cookie,'X-Scopewise-Token':o.token});assert.equal(mixed.status,401);assert(!mixed.text.includes('B-project-1'));} assert.equal((await request('/api/workspace','PUT',{state:stateA,revision:2},{Cookie:b.cookie,'X-Scopewise-Token':o.token})).status,403);
 const fake=await request('/api/workspace?agencyId='+B.id,'GET',undefined,{...headers(o),'X-Agency-ID':B.id});assert.equal(fake.data.state.projects[0].id,stateA.projects[0].id);
 const info=await request('/api/status','GET',undefined,headers(o));assert.equal(info.data.automaticMigration,false);assert.equal(info.data.user.agency.id,A.id);
 });
 await group('Owner/editor/viewer permissions enforced before writes',async()=>{
 const before=(await request('/api/workspace','GET',undefined,headers(o))).data;
 for(const route of ['/api/workspace','/api/plan','/api/migrate'])assert.equal((await request(route,route==='/api/workspace'?'PUT':'POST',{state:stateA,revision:2},headers(v))).status,403);
 assert.equal((await request('/api/migrate','POST',{state:stateA},headers(e))).status,403);
 stateA.projects[0].description='Editor save';assert.equal((await request('/api/workspace','PUT',{state:stateA,revision:2},headers(e))).status,200);
 const payload={projectId:stateA.projects[0].id,original:stateA.projects[0].original,message:'Add online card payments and email confirmations.'};
 assert.equal((await request('/api/plan','POST',payload,headers(e))).status,200);assert.equal((await request('/api/plan','POST',payload,headers(v))).status,403);
 let current=(await request('/api/workspace','GET',undefined,headers(o))).data;const merge=clone(current.state);merge.clients.push({id:'owner-import',name:'Explicit owner import',email:'',contact:'',notes:''});
 assert.equal((await request('/api/migrate','POST',{state:merge},headers(o))).status,200);stateA=(await request('/api/workspace','GET',undefined,headers(o))).data.state;
 assert.equal((await request('/api/status','GET',undefined,headers(v))).data.readOnly,true);assert.equal(before.revision,2);
 });
 await group('Cross-agency IDs, history, export and references stay isolated',async()=>{
 const a=await request('/api/backup','GET',undefined,headers(o)),bb=await request('/api/backup','GET',undefined,headers(b));assert(!a.text.includes('B-project-1'));assert(!bb.text.includes('A-project-1'));assert(!bb.text.includes('owner-import'));
 assert.equal((await request('/api/plan','POST',{projectId:stateB.projects[0].id,original:stateB.projects[0].original,message:'Add payments.'},headers(o))).status,400);
 const invalid=clone(stateA);invalid.tasks[0].projectId=stateB.projects[0].id;assert.equal((await request('/api/workspace','PUT',{state:invalid,revision:4},headers(o))).status,400);
 assert.equal((await request('/api/workspace','GET',undefined,headers(b))).data.revision,2);assert.equal((await request('/api/history','GET',undefined,headers(b))).data.revisions.length,2);
 });
 await group('CSRF, duplicate cookies, stale revision, JSON and prototype protection',async()=>{
 const current=(await request('/api/workspace','GET',undefined,headers(o))).data;
 for(const token of ['', 'bad','é'.repeat(64)])assert.equal((await request('/api/workspace','PUT',{state:current.state,revision:current.revision},{...headers(o),'X-Scopewise-Token':token})).status,403);
 assert.equal((await request('/api/workspace','PUT',{state:current.state,revision:current.revision},{...headers(o),Origin:'https://evil.example'})).status,403);
 assert.equal((await request('/api/workspace','GET',undefined,{...headers(o),Cookie:o.cookie+'; '+o.cookie})).status,401);
 assert.equal((await request('/api/workspace','PUT',{state:current.state,revision:0},headers(o))).status,409);
 assert.equal((await request('/api/workspace','PUT','{"__proto__":{"polluted":true}}',headers(o))).status,400);assert.equal({}.polluted,undefined);
 assert.equal((await request('/api/workspace','PUT','not-json',headers(o))).status,400);
 assert.equal((await request('/api/workspace','PUT','{}',{...headers(o),'Content-Type':'text/plain'})).status,415);
 assert.deepEqual((await request('/api/workspace','GET',undefined,headers(o))).data,current);
 });
 await group('Local same-origin reverse proxy preserves cookies and overwrites forged header',async()=>{
 edge=http.createServer((req,res)=>{const up=http.request({host:'127.0.0.1',port:app.server.address().port,path:req.url,method:req.method,headers:{...req.headers,host:'scopewise-api.onrender.com','x-scopewise-proxy':proxySecret}},response=>{res.writeHead(response.statusCode,response.headers);response.pipe(res)});up.on('error',()=>{res.writeHead(502);res.end()});req.pipe(up)});await new Promise(r=>edge.listen(0,'127.0.0.1',r));
 const p=edge.address().port,l=await call(p,'/api/auth/login','POST',{username:'owner-a',password},{Host:'scopewise.example','X-Scopewise-Proxy':'visitor-forged'});assert.equal(l.status,200);
 const fresh={cookie:l.headers['set-cookie'][0].split(';')[0],token:l.data.sessionToken};
 assert.equal((await call(p,'/api/workspace','GET',undefined,{Host:'scopewise.example',...headers(fresh)})).status,200);
 for(const h of ['cache-control','cdn-cache-control','vercel-cdn-cache-control'])assert.equal(l.headers[h],'no-store');assert(!l.headers['access-control-allow-origin']);assert(!l.text.includes(proxySecret));assert(!l.text.includes(secret));
 const current=(await call(p,'/api/workspace','GET',undefined,headers(fresh))).data;
 assert.equal((await call(p,'/api/workspace','PUT',{state:current.state,revision:current.revision},headers(fresh))).status,200);
 assert.equal((await call(p,'/api/auth/logout','POST',{},headers(fresh))).status,200);assert.equal((await call(p,'/api/workspace','GET',undefined,headers(fresh))).status,401);
 o=await login('owner-a');
 });
 await group('Restart preserves exact workspace and authenticated session',async()=>{
 const before=(await request('/api/workspace','GET',undefined,headers(o))).data;await app.close();app=null;
 auth=createAuthStore({filename:path.join(dir,'data/auth.sqlite'),sessionSecret:config.sessionSecret,now:()=>clock});await start();assert.deepEqual((await request('/api/workspace','GET',undefined,headers(o))).data,before);assert.equal((await request('/api/auth/session','GET',undefined,headers(o))).data.sessionToken,o.token);
 });
 await group('Damaged tenant is preserved without exposing or overwriting another',async()=>{
 const file=path.join(dir,'tenants',A.id,'scopewise.sqlite'),db=new DatabaseSync(file),prior=db.prepare('SELECT * FROM workspace').get();db.prepare('UPDATE workspace SET json=? WHERE id=1').run('{damaged');
 assert.equal((await request('/api/workspace','GET',undefined,headers(o))).status,500);assert.equal((await request('/health/ready')).status,503);assert.equal((await request('/api/workspace','GET',undefined,headers(b))).status,200);assert.equal(db.prepare('SELECT json FROM workspace').get().json,'{damaged');
 db.prepare('UPDATE workspace SET json=? WHERE id=1').run(prior.json);db.close();assert.equal((await request('/health/ready')).status,200);
 });
 await group('Role/password/revocation invalidate sessions and guard last owner',async()=>{
 auth.updateRole(editor.id,'viewer');assert.equal((await request('/api/workspace','GET',undefined,headers(e))).status,401);e=await login('editor-a');assert.equal((await request('/api/workspace','PUT',{},headers(e))).status,403);
 await auth.resetPassword(viewer.id,'Synthetic-Replacement-2026!');assert.equal((await request('/api/workspace','GET',undefined,headers(v))).status,401);assert.equal(await auth.authenticate('viewer-a',password),null);
 assert.throws(()=>auth.revokeUser(owner.id),/another active owner/);assert.throws(()=>auth.updateRole(ownerB.id,'viewer'),/another active owner/);
 const transient=await auth.createUser({agencyId:A.id,username:'temporary',password,role:'editor'}),s=auth.createSession(transient.id);auth.revokeUser(transient.id);assert.equal(auth.getSession(s.token),null);assert.equal(await auth.authenticate('temporary',password),null);
 });
 await group('Logout CSRF, absolute/idle timeout and persistent login throttling',async()=>{
 assert.equal((await request('/api/auth/logout','POST',{}, {...headers(o),'X-Scopewise-Token':''})).status,403);assert.equal((await request('/api/auth/logout','POST',{},headers(o))).status,200);assert.equal((await request('/api/workspace','GET',undefined,headers(o))).status,401);
 for(let i=0;i<10;i++)assert.equal((await request('/api/auth/login','POST',{username:'throttle-user',password})).status,401);assert.equal((await request('/api/auth/login','POST',{username:'throttle-user',password})).status,429);
 const abs=auth.createSession(owner.id),absHeaders={Cookie:'__Host-scopewise='+abs.token,'X-Scopewise-Token':abs.sessionToken};for(let i=0;i<31;i++){clock+=15*60*1000;assert.equal((await request('/api/workspace','GET',undefined,absHeaders)).status,200)}clock+=15*60*1000;assert.equal((await request('/api/workspace','GET',undefined,absHeaders)).status,401);const idle=auth.createSession(owner.id);clock+=30*60*1000;assert.equal((await request('/api/workspace','GET',undefined,{Cookie:'__Host-scopewise='+idle.token,'X-Scopewise-Token':idle.sessionToken})).status,401);
 });
 await group('Production configuration fails closed and logs exclude secrets',async()=>{
 assert.equal(config.port,10000);assert.equal(config.serveFrontend,false);
 for(const patch of [{SCOPEWISE_PUBLIC_ORIGIN:''},{SCOPEWISE_PUBLIC_ORIGIN:'http://scopewise.example'},{SCOPEWISE_SESSION_SECRET:''},{SCOPEWISE_PROXY_SECRET:''},{SCOPEWISE_WORK_DIR:path.join(ROOT,'outside')},{SCOPEWISE_HOST:'localhost'},{PORT:'bad'}])assert.throws(()=>loadConfig({...env,...patch}));
 assert.throws(()=>loadConfig({...env,NODE_ENV:'production',SCOPEWISE_MODE:'development'}));assert.throws(()=>createApp({authentication:false,config}),/cannot run in production/);assert.throws(()=>createAuthStore({filename:path.join(ROOT,'outside.sqlite')}),/work/);
 const raw=JSON.stringify(logs);for(const privateValue of [password,secret,proxySecret,o.cookie.split('=')[1],o.token])assert(!raw.includes(privateValue));
 });
 await group('Agency signup provisions an isolated owner workspace and blocks duplicate usernames',async()=>{
  const reg=await request('/api/auth/signup','POST',{agencyName:'Signup Studio',username:'signup-owner',password});
  assert.equal(reg.status,200);assert.equal(reg.data.authenticated,true);assert.equal(reg.data.user.role,'owner');assert.equal(reg.data.user.agency.name,'Signup Studio');
  const dup=await request('/api/auth/signup','POST',{agencyName:'Another Studio',username:'signup-owner',password});
  assert.equal(dup.status,409);assert.equal(dup.data.code,'USERNAME_TAKEN');
 });
 console.log('Security checks: '+passed+' groups passed. Isolated artifacts: '+rel);
}catch(error){console.error(error.stack);process.exitCode=1}finally{if(edge)await new Promise(r=>edge.close(r));if(app)await app.close();else try{auth.close()}catch{}}
})();
