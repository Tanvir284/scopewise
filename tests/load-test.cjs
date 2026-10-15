'use strict';
// Bounded local acceptance test: never reads deployment settings or calls a remote service.
const assert=require('node:assert/strict'),http=require('node:http'),path=require('node:path'),crypto=require('node:crypto'),fs=require('node:fs');
const {createApp,validateState}=require('../server.cjs'),{createAuthStore}=require('../lib/auth.cjs'),{loadConfig,ROOT}=require('../lib/config.cjs');
const W=require('../public/workspace-data.js'),Ops=require('../public/operations-data.js');
const relative='work/test-artifacts/load-'+crypto.randomUUID(),secret=crypto.randomBytes(32),password='Synthetic-bounded-load-password-2026!';
let app,auth,base,passed=0,requests=0;const timings=[],profiles=[],stamp='2026-10-15T10:00:00.000Z',date='2026-10-15';
async function group(name,fn){await fn();passed++;console.log('PASS '+name);}
function fixture(tasks,times,expenses){
 const s=validateState(W.sample());s.settings.name='Mixed feature load fixture';
 s.operations.team.push({id:'load-person',name:'Test developer',role:'Developer',email:'',capacityHours:40,active:true,costRateMinor:10005,costCurrency:'BDT'});
 s.operations.sprints.push({id:'load-sprint',projectId:'project-1',name:'Synthetic sprint',goal:'Test integrations',start:date,end:'2026-10-30',status:'Active'});
 s.operations.milestones.push({id:'load-milestone',projectId:'project-1',name:'Synthetic milestone',due:'2026-10-25',status:'In progress',sprintId:'load-sprint'});
 for(let i=s.tasks.length;i<tasks;i++)s.tasks.push({id:'load-task-'+i,projectId:'project-1',changeId:null,title:'Synthetic task '+i,description:'Integration pressure fixture',criteria:['Acceptance remains linked'],status:'Backlog',priority:'Medium',due:'',assigneeId:'load-person',sprintId:'load-sprint',estimatedHours:1});
 s.operations.issues.push({id:'load-issue',projectId:'project-1',taskId:'task-1',title:'Synthetic issue',description:'Verify linked issue',severity:'High',status:'Open',assigneeId:'load-person',createdAt:stamp,due:''});
 for(let i=0;i<times;i++)s.operations.timeEntries.push({id:'load-time-'+i,projectId:'project-1',taskId:'task-1',teamId:'load-person',date,durationMinutes:15,note:'Synthetic recorded work',costRateMinor:10005,costCurrency:'BDT'});
 for(let i=0;i<expenses;i++)s.operations.expenses.push({id:'load-expense-'+i,projectId:'project-1',description:'Synthetic tool cost',category:'Software',date,amountMinor:101,currency:'BDT',notes:''});
 s.operations.costPlans.push({id:'load-cost-plan',projectId:'project-1',name:'Synthetic cost plan',currency:'BDT',budgetMinor:10000000,laborLines:[{description:'Implementation',hours:10,rateMinor:10005,taskId:'task-1',teamId:'load-person'}],expenseLines:[{description:'Tools',amountMinor:1000}],notes:'Local acceptance fixture',createdAt:stamp});
 s.operations.estimates.push({id:'load-estimate',projectId:'project-1',name:'Synthetic estimate',hours:10,rateMinor:30000,status:'Accepted',notes:'',createdAt:stamp,currency:'BDT'});
 s.operations.invoices.push({id:'load-invoice',projectId:'project-1',number:'TEST-001',status:'Draft',issuedDate:date,dueDate:'2026-10-30',lines:[{description:'Synthetic services',qty:10,rateMinor:30000}],notes:'',createdAt:stamp,currency:'BDT'});
 s.operations.versions.push({id:'load-version',projectId:'project-1',requirement:s.projects[0].original,reason:'Synthetic baseline',createdAt:stamp,changeId:null});
 s.operations.opportunities.push({id:'load-opportunity',clientId:'client-1',projectId:'project-1',name:'Synthetic opportunity',stage:'Qualified',valueMinor:300000,notes:'',nextStep:'Review',createdAt:stamp,currency:'BDT'});
 s.operations.proposals.push({id:'load-proposal',clientId:'client-1',projectId:'project-1',opportunityId:'load-opportunity',title:'Synthetic proposal',scope:'Test integration',lines:[{description:'Services',qty:10,rateMinor:30000}],status:'Draft',validUntil:'2026-10-30',notes:'',createdAt:stamp,currency:'BDT'});
 return validateState(s);
}
async function call(route,method='GET',body,session,extra={}){
 const started=performance.now();requests++;
 const r=await fetch(base+route,{method,signal:AbortSignal.timeout(20000),headers:{Origin:base,'Content-Type':'application/json',...(session?{Cookie:'scopewise_session='+session.token,'X-Scopewise-Token':session.sessionToken}:{}),...extra},...(body===undefined?{}:{body:typeof body==='string'?body:JSON.stringify(body)})});
 const text=await r.text();timings.push(performance.now()-started);let data;try{data=JSON.parse(text);}catch{data=text;}return {status:r.status,data,headers:r.headers};
}
async function chunkedOversize(session){
 return new Promise((resolve,reject)=>{
  requests++;const request=http.request(base+'/api/workspace',{method:'PUT',headers:{Origin:base,'Content-Type':'application/json',Cookie:'scopewise_session='+session.token,'X-Scopewise-Token':session.sessionToken,'Transfer-Encoding':'chunked'}},response=>{let raw='';response.on('data',chunk=>raw+=chunk);response.on('end',()=>resolve({status:response.statusCode,data:JSON.parse(raw)}));});
  request.setTimeout(20000,()=>request.destroy(Error('Chunked request timeout')));request.on('error',reject);
  request.end(JSON.stringify({padding:'x'.repeat(2*1024*1024+100)}));
 });
}
(async()=>{try{
 const config=loadConfig({SCOPEWISE_WORK_DIR:path.join(ROOT,relative),SCOPEWISE_SESSION_SECRET:secret.toString('hex'),SCOPEWISE_MAX_BODY_BYTES:String(2*1024*1024)});
 auth=createAuthStore({filename:path.join(config.workDir,'data/auth.sqlite'),sessionSecret:secret});const A=auth.createAgency({name:'Load agency A'}),B=auth.createAgency({name:'Load agency B'});
 const owner=await auth.createUser({agencyId:A.id,username:'load-owner',password,role:'owner'}),viewer=await auth.createUser({agencyId:A.id,username:'load-viewer',password,role:'viewer'}),other=await auth.createUser({agencyId:B.id,username:'load-other',password,role:'owner'});
 const o=auth.createSession(owner.id),v=auth.createSession(viewer.id),b=auth.createSession(other.id);
 app=createApp({config,authStore:auth,logger:()=>{}});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));base='http://127.0.0.1:'+app.server.address().port;
 let head=(await call('/api/workspace','GET',undefined,o)).data;const otherHead=(await call('/api/workspace','GET',undefined,b)).data;
 for(const [name,tasks,times,expenses] of [['tasks',4000,20,10],['time-costs',50,3000,1000],['mixed',500,1000,200]]){
  await group(name+' pressure preserves planning, history, reports, costing and another agency',async()=>{
   const state=fixture(tasks,times,expenses),saved=await call('/api/workspace','PUT',{state,revision:head.revision},o);assert.equal(saved.status,200);head=saved.data;
   const expectedCost=Ops.costing(state,'project-1'),expectedOperations=JSON.stringify(state.operations),planBody={projectId:'project-1',original:state.projects[0].original,message:'Add online card payments and email confirmations.'};
   const expectedPlan=(await call('/api/plan','POST',planBody,o)).data,started=performance.now();
   for(let batch=0;batch<8;batch++){
    const current=structuredClone(head.state);current.settings.name='Load batch '+name+' '+batch;
    const work=await Promise.all([
     call('/api/workspace','PUT',{state:current,revision:head.revision},o),
     call('/api/workspace','GET',undefined,o),call('/api/workspace','GET',undefined,v),
     call('/api/plan','POST',planBody,o),call('/api/backup','GET',undefined,v),
     call('/api/history','GET',undefined,o),call('/api/status','GET',undefined,o),
     call('/api/workspace','GET',undefined,b),call('/health/ready'),
     call('/api/workspace','PUT',{state:current,revision:head.revision},v),
     call('/api/plan','POST',{...planBody,original:'Outdated baseline'},o),call('/')
    ]);
    assert.deepEqual(work.map(x=>x.status),[200,200,200,200,200,200,200,200,200,403,409,200]);head=work[0].data;
    for(const snapshot of [work[1].data.state,work[2].data.state,work[4].data]){assert.equal(snapshot.tasks.length,tasks);assert.equal(JSON.stringify(snapshot.operations),expectedOperations);assert.deepEqual(Ops.costing(snapshot,'project-1'),expectedCost);}
    assert.deepEqual(work[3].data,expectedPlan);assert.deepEqual(work[7].data,otherHead);
    // Concurrent reads may linearize immediately before or after the one in-flight save.
    for(const revision of [work[5].data.revisions[0].revision,work[6].data.revision])assert([head.revision-1,head.revision].includes(revision));
   }
   assert.deepEqual((await call('/api/workspace','GET',undefined,o)).data,head);
   profiles.push({name,tasks,timeEntries:times,expenses,bytes:Buffer.byteLength(JSON.stringify(state)),requests:96,concurrency:12,elapsedMs:Math.round(performance.now()-started)});
  });
 }
 await group('Sixteen concurrent saves yield exactly one winner and fifteen recoverable conflicts',async()=>{
  const prior=head.revision,results=await Promise.all(Array.from({length:16},(_,i)=>{const state=structuredClone(head.state);state.settings.name='Concurrent writer '+i;return call('/api/workspace','PUT',{state,revision:prior},o);}));
  assert.equal(results.filter(x=>x.status===200).length,1);assert.equal(results.filter(x=>x.status===409&&x.data.code==='REVISION_CONFLICT').length,15);
  const winner=results.find(x=>x.status===200);head=(await call('/api/workspace','GET',undefined,o)).data;assert.deepEqual(head,winner.data);assert.equal(head.revision,prior+1);assert.equal((await call('/api/history','GET',undefined,o)).data.revisions[0].revision,head.revision);
 });
 await group('Malformed, oversized, unsupported and cross-origin requests leave data unchanged',async()=>{
  const invalid=structuredClone(head.state);invalid.operations.timeEntries[0].taskId='missing-task';
  const requests=[call('/api/workspace','PUT','{invalid',o),call('/api/workspace','PUT','[]',o),call('/api/workspace','PUT','{}',o,{'Content-Type':'text/plain'}),call('/api/workspace','DELETE',undefined,o),call('/api/workspace','PUT',{state:invalid,revision:head.revision},o),call('/api/workspace','PUT',{state:head.state,revision:head.revision},o,{Origin:'https://outside.invalid'}),call('/api/workspace','PUT',{padding:'x'.repeat(2*1024*1024+100)},o)];
  assert.deepEqual((await Promise.all(requests)).map(x=>x.status),[400,400,415,405,400,403,413]);assert.equal((await chunkedOversize(o)).status,413);
  assert.deepEqual((await call('/api/workspace','GET',undefined,o)).data,head);assert.deepEqual((await call('/api/workspace','GET',undefined,b)).data,otherHead);assert.equal((await call('/health/ready')).status,200);
 });
 await group('Login pressure is bounded while existing sessions and other agencies remain usable',async()=>{
  const results=await Promise.all(Array.from({length:12},(_,i)=>call('/api/auth/login','POST',{username:'missing-load-'+i,password})).concat([call('/health/live'),call('/api/workspace','GET',undefined,b)]));
  assert(results.slice(0,12).every(r=>[401,429].includes(r.status)));assert(results.slice(0,12).some(r=>r.status===429));assert.equal(results[12].status,200);assert.deepEqual(results[13].data,otherHead);assert.deepEqual((await call('/api/workspace','GET',undefined,o)).data,head);
 });
 await group('Restart after pressure retains exact state, revision, costing and agency isolation',async()=>{
  const history=(await call('/api/history','GET',undefined,o)).data;await app.close();app=null;
  auth=createAuthStore({filename:path.join(config.workDir,'data/auth.sqlite'),sessionSecret:secret});app=createApp({config,authStore:auth,logger:()=>{}});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));base='http://127.0.0.1:'+app.server.address().port;
  assert.deepEqual((await call('/api/workspace','GET',undefined,o)).data,head);assert.deepEqual((await call('/api/history','GET',undefined,o)).data,history);assert.deepEqual((await call('/api/workspace','GET',undefined,b)).data,otherHead);assert.equal((await call('/health/ready')).status,200);
 });
 timings.sort((a,b)=>a-b);const result={passedGroups:passed,requests,profiles,latencyMs:{p50:Math.round(timings[Math.floor(timings.length*.5)]),p95:Math.round(timings[Math.floor(timings.length*.95)]),max:Math.round(timings.at(-1))},environment:'Loopback HTTP, isolated SQLite, Windows Node '+process.version,limitations:'Bounded regression run, not a production throughput/SLA benchmark or distributed PostgreSQL locking test.'};
 fs.writeFileSync(path.join(ROOT,relative,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
}finally{if(app)await app.close();else auth?.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
