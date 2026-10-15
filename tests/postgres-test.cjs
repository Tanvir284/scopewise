'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {Readable}=require('node:stream'),{PGlite}=require('@electric-sql/pglite');
const {createPostgresBackend,poolSettings,pack,unpack}=require('../lib/postgres.cjs');
const T=require('../lib/postgres-transfer.cjs'),{createAuthStore}=require('../lib/auth.cjs');
const {createApp,createStore,validateState,emptyWorkspace}=require('../server.cjs');
const {loadConfig}=require('../lib/config.cjs'),W=require('../public/workspace-data.js'),Ops=require('../public/operations-data.js');
const root=path.resolve(__dirname,'..'),relative='work/test-artifacts/postgres-'+crypto.randomUUID(),directory=path.join(root,relative);
const secret=Buffer.alloc(32,53),password='Test-only-private-passphrase-2026!',clone=x=>structuredClone(x);
let count=0,clock=Date.parse('2026-10-09T06:00:00Z');
const databases=[];
async function group(name,fn){await fn();count++;console.log('PASS '+name);}
async function memoryBackend(extra={}){
 const db=new PGlite();await db.waitReady;databases.push(db);let tail=Promise.resolve(),failure=null;
 async function acquire(){const before=tail;let release;tail=new Promise(r=>release=r);await before;return release;}
 async function query(sql,params){if(failure&&failure.test(sql)){failure=null;throw Error('Injected write failure');}return db.query(sql,params);}
 const pool={query:async(sql,params)=>{const release=await acquire();try{return await query(sql,params);}finally{release();}},connect:async()=>{const release=await acquire();return {query,release};},end:async()=>{},failOnce:pattern=>failure=pattern};
 const backend=createPostgresBackend({pool,sessionSecret:secret,now:()=>clock,...extra});await backend.init();return backend;
}
function fixture(){const s=validateState(W.sample()),at='2026-10-08T06:00:00.000Z';
 s.settings.preservedOperatorField={unchanged:true};
 s.operations.team.push({id:'person-1',name:'Developer',role:'Engineer',email:'developer@example.invalid',capacityHours:20,active:true,costRateMinor:99999,costCurrency:'EUR'});
 s.operations.costPlans.push({id:'cost-plan-1',projectId:'project-1',name:'Internal costs',currency:'BDT',budgetMinor:100000,laborLines:[{description:'Implementation',hours:2,rateMinor:12000,taskId:'task-1',teamId:'person-1'}],expenseLines:[{description:'Hosting',amountMinor:5000}],notes:'Internal',createdAt:at});
 s.operations.timeEntries.push({id:'time-zero',projectId:'project-1',taskId:'task-1',teamId:'person-1',date:'2026-10-08',durationMinutes:15,note:'Explicit free time',costRateMinor:0,costCurrency:'BDT'},{id:'time-unknown',projectId:'project-1',taskId:'task-1',teamId:'person-1',date:'2026-10-08',durationMinutes:60,note:'Unpriced time'});
 s.operations.expenses.push({id:'expense-usd',projectId:'project-1',description:'Tools',category:'Software',date:'2026-10-08',amountMinor:1000,currency:'USD',notes:''});
 return validateState(s);
}
function responseCapture(){let status=200,body;const headers={};return {res:{headersSent:false,setHeader(n,v){headers[n.toLowerCase()]=v;},writeHead(s,h={}){status=s;Object.entries(h).forEach(([n,v])=>headers[n.toLowerCase()]=v);this.headersSent=true;},end(v){body=v===undefined?'':Buffer.from(v).toString();this.headersSent=true;}},result(){return {status,headers,data:body?JSON.parse(body):null};}};}
(async()=>{
 try{
 const pg=await memoryBackend(),auth=pg.auth,A=await auth.createAgency({name:'Postgres Agency A'}),B=await auth.createAgency({name:'Postgres Agency B'});
 const owner=await auth.createUser({agencyId:A.id,username:'pg-owner',role:'owner',password}),editor=await auth.createUser({agencyId:A.id,username:'pg-editor',role:'editor',password}),viewer=await auth.createUser({agencyId:A.id,username:'pg-viewer',role:'viewer',password}),other=await auth.createUser({agencyId:B.id,username:'pg-other',role:'owner',password});
 const store=pg.workspace(A.id);let state;
 await group('TLS URL controls cannot disable certificate verification',async()=>{
  const settings=poolSettings('postgresql://u:p%40ss@db.example.invalid:5432/db?sslmode=require&channel_binding=require');assert.equal(settings.password,'p@ss');assert.equal(settings.ssl.rejectUnauthorized,true);assert.equal(settings.enableChannelBinding,true);assert(!Object.hasOwn(settings,'connectionString'));
  for(const query of ['ssl=0','ssl=no-verify','sslmode=disable','uselibpqcompat=true','host=evil.invalid','options=bad'])assert.throws(()=>poolSettings('postgresql://u:p@db.example.invalid/db?'+query));
 });
 await group('Revision compare-and-save and atomic head/history rollback',async()=>{
  await store.ensureInitialized(A.name);state=fixture();const saved=await store.save(state,1);assert.equal(saved.revision,2);assert.deepEqual(saved.state,state);
  const left=clone(state),right=clone(state);left.projects[0].description='Concurrent left';right.projects[0].description='Concurrent right';
  const results=await Promise.allSettled([store.save(left,2),store.save(right,2)]);assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(results.find(x=>x.status==='rejected').reason.code,'REVISION_CONFLICT');assert.equal((await store.history()).length,3);
  const before=await store.read();pg.pool.failOnce(/INSERT INTO scopewise.revisions/);await assert.rejects(store.save(state,before.revision),/Injected/);assert.deepEqual(await store.read(),before);assert.equal((await store.history()).length,3);
 });
 await group('Import ID/relationship conflicts commit diagnostics without changing head',async()=>{
  const head=await store.read(),different=clone(head.state);different.projects[0].description='Conflicting source';
  await assert.rejects(store.migrate(different),e=>e.code==='MIGRATION_CONFLICT'&&e.details.backups.completed===0);
  assert.deepEqual(await store.read(),head);assert.equal((await pg.pool.query('SELECT count(*) AS n FROM scopewise.imports')).rows[0].n,1);
  const semantic=clone(head.state);semantic.operations.costPlans[0].id='different-cost-plan';await assert.rejects(store.migrate(semantic),e=>e.code==='MIGRATION_CONFLICT');assert.deepEqual(await store.read(),head);assert.equal((await pg.pool.query('SELECT count(*) AS n FROM scopewise.imports')).rows[0].n,2);
 });
 await group('Completed imports never resurrect deleted records; corrupt historical replay is skipped',async()=>{
  let head=await store.read();const incoming=clone(head.state);incoming.clients.push({id:'import-client',name:'Incoming client',email:'',contact:'',notes:''});await store.migrate(incoming);
  head=await store.read();head.state.clients=head.state.clients.filter(c=>c.id!=='import-client');await store.save(head.state,head.revision);const before=await store.read();assert.deepEqual((await store.migrate(incoming)).state,before.state);assert.equal((await store.read()).revision,before.revision);
  const bad='a'.repeat(64);await pg.pool.query('INSERT INTO scopewise.imports VALUES($1,$2,$3,NULL,0,1)',[A.id,bad,Buffer.from('invalid gzip')]);
  const next=clone(before.state);next.clients.push({id:'new-client',name:'New client',email:'',contact:'',notes:''});assert.equal((await store.migrate(next)).backups.completed,1);await pg.pool.query('DELETE FROM scopewise.imports WHERE hash=$1',[bad]);
 });
 await group('Workspace size checks prevent committed states beyond hosted limits',async()=>{
  const small=await memoryBackend({maxWorkspaceBytes:12000}),agency=await small.auth.createAgency({name:'Size fixture'}),s=small.workspace(agency.id);await s.ensureInitialized(agency.name);
  const left=emptyWorkspace(agency.name);left.clients.push({id:'size-left',name:'Left',email:'',contact:'',notes:'a'.repeat(6500)});await s.save(left,1);
  const incoming=emptyWorkspace(agency.name);incoming.clients.push({id:'size-right',name:'Right',email:'',contact:'',notes:'b'.repeat(6500)});const before=await s.read();
  await assert.rejects(s.migrate(incoming),e=>e.status===413&&e.details.backups.completed===0);assert.deepEqual(await s.read(),before);assert.equal((await small.pool.query('SELECT count(*) AS n FROM scopewise.imports')).rows[0].n,1);
  const huge=clone(left);huge.clients[0].notes='x'.repeat(20000);await assert.rejects(s.save(huge,before.revision),e=>e.status===413);
  const oldLarge='x'.repeat(19*1024*1024);assert.equal(unpack(pack(oldLarge)),oldLarge);
 });
 await group('Passwords, credential race, idle expiry, rate limits and last-owner guard',async()=>{
  assert.equal(await auth.hasActiveOwner(),true);await pg.pool.query('UPDATE scopewise.agencies SET active=0');assert.equal(await auth.hasActiveOwner(),false);await pg.pool.query('UPDATE scopewise.agencies SET active=1');
  assert.equal((await auth.authenticate('PG-OWNER',password)).id,owner.id);assert.equal(await auth.authenticate('pg-owner','wrong-password'),null);
  const proof=await auth.authenticate('pg-editor',password);await auth.resetPassword(editor.id,password);await assert.rejects(auth.createSession(editor.id,proof.credentialVersion),e=>e.code==='SESSION_CHANGED');
  const session=await auth.createSession(editor.id);assert.equal((await auth.getSession(session.token)).user.agency.id,A.id);clock+=31*60*1000;assert.equal(await auth.getSession(session.token),null);
  await assert.rejects(auth.revokeUser(owner.id),/last owner/);await assert.rejects(auth.updateRole(owner.id,'editor'),/last owner/);
  for(let i=0;i<10;i++)assert.equal(await auth.checkLoginLimit('throttle-user','fixture-ip'),true);assert.equal(await auth.checkLoginLimit('throttle-user','fixture-ip'),false);await auth.clearLoginLimit('throttle-user');assert.equal(await auth.checkLoginLimit('throttle-user','fixture-ip'),true);
 });
 const env={SCOPEWISE_STORAGE:'postgres',DATABASE_URL:'postgresql://fixture:private@db.example.invalid/db?sslmode=require',SCOPEWISE_SESSION_SECRET:secret.toString('hex'),SCOPEWISE_PUBLIC_ORIGIN:'https://scopewise-fixture.netlify.app'};
 const config=loadConfig({...env,SCOPEWISE_MODE:'production',SCOPEWISE_SERVE_FRONTEND:'false',SCOPEWISE_MAX_BODY_BYTES:String(4*1024*1024)}),app=createApp({config,backend:pg,logger:()=>{}}),{createFunction}=await import('../netlify/functions/api.mjs'),fn=createFunction({env,app}),context={ip:'192.0.2.21',deploy:{context:'production'}};
 async function call(route,method='GET',body,session,extra={}){
  const headers={'Content-Type':'application/json',...(method==='GET'?{}:{Origin:env.SCOPEWISE_PUBLIC_ORIGIN}),...(session?{Cookie:session.cookie,'X-Scopewise-Token':session.token}:{}),...extra};
  const response=await fn(new Request(env.SCOPEWISE_PUBLIC_ORIGIN+route,{method,headers,...(body===undefined?{}:{body:typeof body==='string'?body:JSON.stringify(body)})}),context);
  return {status:response.status,data:await response.json(),headers:response.headers};
 }
 async function login(username){const r=await call('/api/auth/login','POST',{username,password});assert.equal(r.status,200);return {cookie:r.headers.get('set-cookie').split(';')[0],token:r.data.sessionToken,user:r.data.user};}
 await group('Modern Function boundary rejects previews before DB; liveness does not query DB',async()=>{
  let readyCalls=0;const fake={ready:async()=>{readyCalls++;},close:async()=>{},handler:async()=>{throw Error('Unexpected API');}},isolated=createFunction({env,app:fake});
  assert.equal((await isolated(new Request(env.SCOPEWISE_PUBLIC_ORIGIN+'/health/live'),context)).status,200);assert.equal(readyCalls,0);
  assert.equal((await isolated(new Request('https://preview.example.invalid/api/status'),context)).status,403);
  assert.equal((await isolated(new Request(env.SCOPEWISE_PUBLIC_ORIGIN+'/api/status'),{deploy:{context:'deploy-preview'}})).status,403);assert.equal(readyCalls,0);
  assert.equal((await createFunction({env:{}})(new Request(env.SCOPEWISE_PUBLIC_ORIGIN+'/api/status'),context)).status,503);
  let closed=0;const failing=createFunction({env,app:{ready:async()=>{throw Error('private unavailable');},close:async()=>{closed++;}}});
  assert.equal((await failing(new Request(env.SCOPEWISE_PUBLIC_ORIGIN+'/api/status'),context)).status,503);assert.equal(closed,1);
 });
 let o,e,v,b;
 await group('HTTP API roles, CSRF, secure cookies, costing and agency isolation',async()=>{
  assert.equal((await call('/api/workspace')).status,401);o=await login('pg-owner');e=await login('pg-editor');v=await login('pg-viewer');b=await login('pg-other');
  assert(o.cookie.startsWith('__Host-scopewise='));const loginCookie=(await call('/api/auth/login','POST',{username:'pg-owner',password})).headers.get('set-cookie');for(const flag of ['HttpOnly','Secure','SameSite=Strict'])assert(loginCookie.includes(flag));
  const read=await call('/api/workspace','GET',undefined,o);assert.equal(read.status,200);assert.deepEqual(read.data.state,(await store.read()).state);assert.equal(read.headers.get('cache-control'),'private, no-store');assert.equal(read.headers.get('netlify-cdn-cache-control'),'no-store');
  const otherHead=await call('/api/workspace','GET',undefined,b);assert.equal(otherHead.data.state.projects.length,0);assert(!JSON.stringify(otherHead.data).includes('project-1'));
  assert.equal((await call('/api/workspace?agencyId='+B.id,'GET',undefined,o)).data.state.projects[0].id,'project-1');
  assert.equal((await call('/api/workspace','GET',undefined,b,{'X-Scopewise-Token':o.token})).status,401);
  assert.equal((await call('/api/workspace','PUT',{state:read.data.state,revision:read.data.revision},v)).status,403);
  assert.equal((await call('/api/migrate','POST',{state:read.data.state},e)).status,403);
  assert.equal((await call('/api/workspace','PUT',{state:read.data.state,revision:read.data.revision},e,{Origin:'https://evil.invalid'})).status,403);
  const plan={projectId:'project-1',original:read.data.state.projects[0].original,message:'Add online card payments and email confirmations.'};
  assert.equal((await call('/api/plan','POST',plan,e)).status,200);assert.equal((await call('/api/plan','POST',plan,v)).status,403);
  assert.deepEqual((await call('/api/backup','GET',undefined,v)).data.operations.timeEntries,read.data.state.operations.timeEntries);
 });
 await group('Role revocation during body upload prevents the pending save',async()=>{
  const head=await store.read(),body=JSON.stringify({state:head.state,revision:head.revision});let resume,started;
  const begun=new Promise(r=>started=r),gate=new Promise(r=>resume=r);
  const req=Readable.from((async function*(){yield Buffer.from(body.slice(0,20));started();await gate;yield Buffer.from(body.slice(20));})());
  req.method='PUT';req.url='/api/workspace';req.headers={host:new URL(env.SCOPEWISE_PUBLIC_ORIGIN).host,origin:env.SCOPEWISE_PUBLIC_ORIGIN,'content-type':'application/json',cookie:e.cookie,'x-scopewise-token':e.token};req.socket={remoteAddress:'192.0.2.21'};
  const capture=responseCapture(),pending=app.handler(req,capture.res);await begun;await auth.updateRole(editor.id,'viewer');resume();await pending;assert.equal(capture.result().status,401);assert.deepEqual(await store.read(),head);
 });
 await group('Function request cap and response cap return safe explicit errors',async()=>{
  const tooLarge=JSON.stringify({state:'x'.repeat(4*1024*1024)});assert.equal((await call('/api/workspace','PUT',tooLarge,o)).status,413);
  const largeApp={ready:async()=>{},close:async()=>{},handler:async(_req,res)=>{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({data:'x'.repeat(5*1024*1024)}));}};
  const r=await createFunction({env,app:largeApp})(new Request(env.SCOPEWISE_PUBLIC_ORIGIN+'/api/workspace'),context);assert.equal(r.status,413);assert.equal((await r.json()).code,'RESPONSE_TOO_LARGE');
 });
 await group('Postgres portable restore preserves all data and passwords; sessions stay revoked',async()=>{
  const exported=await T.exportPostgres(pg),target=await memoryBackend();assert(!Object.hasOwn(exported.data,'sessions'));const restored=await T.importPostgres(target,exported);assert.equal(restored.sessionsRestored,false);
  assert.deepEqual(await target.workspace(A.id).read(),await store.read());assert.deepEqual(await target.workspace(A.id).history(),await store.history());assert.equal((await target.auth.authenticate('pg-owner',password)).id,owner.id);assert.equal(await target.auth.getSession(o.cookie.split('=')[1]),null);
  assert.deepEqual((await T.exportPostgres(target)).data,exported.data);await assert.rejects(T.importPostgres(target,exported),/empty/);
  const damaged=clone(exported);damaged.data.workspaces[0].saved_at='2026-10-01T00:00:00Z';const inconsistent=T.envelope(damaged.data),empty=await memoryBackend();await assert.rejects(T.importPostgres(empty,inconsistent),/differs/);assert.equal((await empty.auth.listAgencies()).length,0);
 });
 await group('SQLite cutover preserves raw JSON, all revisions, ledger files, costs and unassigned legacy',async()=>{
  const localDir=relative+'/sqlite-source',localAuth=createAuthStore({filename:path.join(root,localDir,'data/auth.sqlite'),sessionSecret:secret}),agency=localAuth.createAgency({name:'SQLite source agency'}),user=await localAuth.createUser({agencyId:agency.id,username:'sqlite-owner',role:'owner',password});
  const sqlite=createStore(localDir+'/tenants/'+agency.id+'/scopewise.sqlite',localDir+'/tenants/'+agency.id+'/backups');const original=fixture();sqlite.save(original,0);
  const incoming=clone(original);incoming.clients.push({id:'sqlite-merged',name:'SQLite merged client',email:'',contact:'',notes:''});sqlite.migrate(incoming);const expected=sqlite.read(),history=sqlite.history();sqlite.close();localAuth.close();
  const legacy=createStore(localDir+'/data/scopewise.sqlite',localDir+'/backups');legacy.save(original,0);const legacyHead=legacy.read();legacy.close();
  const previous=process.env.SCOPEWISE_STORAGE;process.env.SCOPEWISE_STORAGE='postgres';let exported;try{exported=T.exportSqlite({workDir:localDir,quiescent:true});}finally{if(previous===undefined)delete process.env.SCOPEWISE_STORAGE;else process.env.SCOPEWISE_STORAGE=previous;}
  assert.equal(exported.bundle.source.consistency,'operator-confirmed-quiescent');const target=await memoryBackend();await T.importPostgres(target,exported.bundle);
  assert.deepEqual(await target.workspace(agency.id).read(),expected);assert.deepEqual(await target.workspace(agency.id).history(),clone(history));assert.equal((await target.auth.authenticate('sqlite-owner',password)).id,user.id);
  assert.deepEqual(Ops.costing((await target.workspace(agency.id).read()).state,'project-1'),Ops.costing(expected.state,'project-1'));
  const assigned=await target.auth.createAgency({name:'Explicit legacy destination'});assert.equal((await target.workspace(assigned.id).read()).state,null);
  await T.adoptLegacy(target,{legacyId:exported.bundle.data.legacy_sources[0].id,agencyId:assigned.id});assert.deepEqual(await target.workspace(assigned.id).read(),legacyHead);
  await assert.rejects(T.adoptLegacy(target,{legacyId:exported.bundle.data.legacy_sources[0].id,agencyId:assigned.id}),/before/);
  const again=await T.exportPostgres(target),fresh=await memoryBackend();await T.importPostgres(fresh,again);assert.deepEqual((await T.exportPostgres(fresh)).data,again.data);
 });
 await group('Fresh application instance reads canonical Postgres data and existing session',async()=>{
  const replacement=createApp({config,backend:createPostgresBackend({pool:pg.pool,sessionSecret:secret,now:()=>clock}),logger:()=>{}}),fn2=createFunction({env,app:replacement});
  const r=await fn2(new Request(env.SCOPEWISE_PUBLIC_ORIGIN+'/api/workspace',{headers:{Cookie:o.cookie,'X-Scopewise-Token':o.token}}),context);assert.equal(r.status,200);assert.deepEqual((await r.json()).state,(await store.read()).state);await replacement.close();await app.close();
 });
 console.log('PostgreSQL/serverless suites passed: '+count+'. PGlite validates PostgreSQL SQL and transaction rollback; its serial test pool does not verify real multi-client locking, hosted TLS or provider deployment.');
 }finally{for(const db of databases)await db.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
