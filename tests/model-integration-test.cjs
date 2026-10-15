'use strict';
const assert=require('node:assert/strict');
const W=require('../public/workspace-data.js'),Ops=require('../public/operations-data.js'),R=require('../public/rules-engine.js');
const clone=x=>JSON.parse(JSON.stringify(x)),at='2026-10-15T12:00:00.000Z',today='2026-10-15';
let count=0;
function check(label,fn){fn();count++;console.log('PASS '+label);}
function fixture(projectCount=4,taskCount=40){
 const s=Ops.normalize({version:1,settings:{name:'Isolated integration fixture',currency:'BDT'},clients:[],projects:[],changes:[],tasks:[],activity:[]});
 for(let i=0;i<Math.min(projectCount,100);i++)s.operations.team.push({id:'person-'+i,name:'Person '+i,role:'Engineer',email:'person'+i+'@example.invalid',capacityHours:40,active:true,costRateMinor:6000,costCurrency:'BDT'});
 for(let i=0;i<projectCount;i++){
  const projectId='project-'+i,clientId='client-'+i,currency=Ops.CURRENCIES[i%4];
  s.clients.push({id:clientId,name:'Client '+i,contact:'Contact',email:'client'+i+'@example.invalid',notes:''});
  s.projects.push({id:projectId,clientId,name:'Project '+i,description:'Connected fixture',original:'Keep the current report.',status:'Active',due:'2026-10-30',createdAt:at});
  s.operations.sprints.push({id:'sprint-'+i,projectId,name:'Sprint '+i,goal:'Deliver',start:today,end:'2026-10-30',status:'Active'});
  s.operations.milestones.push({id:'milestone-'+i,projectId,sprintId:'sprint-'+i,name:'Review '+i,due:'2026-10-14',status:'Planned'});
  s.operations.issues.push({id:'issue-'+i,projectId,taskId:'task-'+i,assigneeId:'person-'+(i%s.operations.team.length),title:'Issue '+i,description:'Reproducible issue',severity:'High',status:'Open',createdAt:at,due:''});
  s.operations.estimates.push({id:'estimate-'+i,projectId,name:'Estimate '+i,hours:2.5,rateMinor:6000,currency,status:'Accepted',notes:'',createdAt:at});
  s.operations.invoices.push({id:'invoice-'+i,projectId,number:'INV-'+i,currency,status:'Draft',issuedDate:today,dueDate:'2026-10-30',notes:'',createdAt:at,lines:[{description:'Agreed work',qty:1.25,rateMinor:6000}]});
  s.operations.versions.push({id:'version-'+i,projectId,requirement:'Keep the original report.',reason:'Original baseline',createdAt:at,changeId:null});
  s.operations.opportunities.push({id:'opportunity-'+i,projectId,clientId,name:'Phase 2 '+i,currency,valueMinor:10000,stage:'Qualified',notes:'',nextStep:'Review',createdAt:at});
  s.operations.proposals.push({id:'proposal-'+i,projectId,clientId,opportunityId:'opportunity-'+i,title:'Proposal '+i,scope:'Phase 2',currency,status:'Draft',validUntil:'2026-10-30',notes:'',createdAt:at,lines:[{description:'Phase 2',qty:1,rateMinor:10000}]});
  s.operations.costPlans.push({id:'cost-plan-'+i,projectId,name:'Internal cost '+i,currency,budgetMinor:100000,laborLines:[{description:'Implementation',hours:2,rateMinor:6000,taskId:'task-'+i,teamId:'person-'+(i%s.operations.team.length)}],expenseLines:[{description:'Planned hosting',amountMinor:1000}],notes:'',createdAt:at});
  s.operations.expenses.push({id:'expense-'+i,projectId,currency,description:'Recorded hosting',category:'Hosting',date:today,amountMinor:500,notes:''});
 }
 for(let i=0;i<taskCount;i++){
  const p=i%projectCount,person=i%s.operations.team.length;
  s.tasks.push({id:'task-'+i,projectId:'project-'+p,changeId:null,title:'Task '+i,description:'Implement requirement '+i,criteria:['Preserve approved behavior'],status:i%2?'Backlog':'Done',priority:'Medium',due:'',estimatedHours:0.125,assigneeId:'person-'+person,sprintId:'sprint-'+p});
  s.operations.timeEntries.push({id:'time-'+i,projectId:'project-'+p,taskId:'task-'+i,teamId:'person-'+person,date:today,durationMinutes:15,note:'Recorded effort',costRateMinor:6000,costCurrency:Ops.CURRENCIES[p%4]});
 }
 return s;
}
check('Base project and task dates reject invalid calendars while blanks and leap dates remain valid',()=>{
 for(const key of ['projects','tasks']){
  for(const due of ['2026-02-29','2026-04-31','2026-13-01','nonsense','2026-1-01','10/15/2026',null,42]){const s=W.sample();s[key][0].due=due;assert.throws(()=>W.validate(s),/Invalid (project|task)/);}
  for(const due of ['','2024-02-29','2026-10-15']){const s=W.sample();s[key][0].due=due;W.validate(s);}
 }
});
check('Optional base relationships reject false and numeric IDs consistently with operations references',()=>{
 for(const value of [false,0,true,1,{},[]]){const s=W.sample();s.projects[0].clientId=value;assert.throws(()=>W.validate(s),/Invalid project/);const t=W.sample();t.tasks[0].changeId=value;assert.throws(()=>W.validate(t),/Invalid task/);}
 for(const value of [undefined,null,'']){const s=W.sample();s.projects[0].clientId=value;s.tasks[0].changeId=value;W.validate(s);}
});
check('Direct negative requests preserve punctuation and cannot draft prohibited additions or removals',()=>{
 for(const message of ['Don’t add payment.','Do not remove payment.','Don’t disable login.','Must not delete client data.','Should not replace the report.','Never cancel the booking.']){
  const p=R.analyse('Keep payment, login, client data, reports and bookings.',message);
  assert.equal(p.changes[0].type,'Constraint',message);assert.equal(p.message,message);assert(p.tasks[0].title.startsWith('Review excluded scope:'));
  assert(!p.tasks[0].criteria.some(c=>c.includes('server-side provider')||c.startsWith('The explicitly approved behavior is removed')));
  assert(!p.appliedRules.some(r=>r.id==='review.removal'));
  if(/remove|disable|delete|replace|cancel/.test(message))assert(p.tasks[0].criteria.includes('The explicitly prohibited removal or modification is not performed.'));
 }
});
check('Request deduplication preserves repeated word order that changes a workflow',()=>{
 const p=R.analyse('A workflow exists.','Add approval then payment then approval. Add approval then payment. Add approval then payment.');
 assert.equal(p.changes.length,2);assert.equal(p.tasks.length,2);assert(p.warnings.some(w=>w.ruleId==='review.duplicate'));
});
check('A valid 12000-character request with many acknowledgements remains persistable with disclosed warning limits',()=>{
 const message='Add report.\n'+'a\n'.repeat(5994);assert.equal(message.length,12000);
 for(const disabledRuleIds of [[],['review.limit']]){
  const s=W.sample();const p=R.analyse(s.projects[0].original,message,{}, {disabledRuleIds});
  assert.equal(p.changes.length,1);assert(p.warnings.length<=5000);assert(p.warnings.some(w=>w.ruleId==='system.output-limit'&&w.text.includes('warnings were omitted')));
  W.addChange(s,s.projects[0].id,'Bounded request',message,()=>p);W.validate(clone(s));
 }
});
check('Requirement Markdown exports escape hostile text across headings, links, tasks and questions',()=>{
 const s=W.sample(),c=W.addChange(s,'project-1','Safe title','Add report.',R.analyse),task=s.tasks.find(t=>t.changeId===c.id);
 s.projects[0].name='<img src=x onerror=alert(1)>';c.title='[click](javascript:alert(1))';c.items[0].text='<script>alert(1)</script>';task.description='<svg onload=alert(1)>';task.criteria=['[click](javascript:alert(1))'];c.questions=['<iframe src=x>'];
 const md=W.exportChange(s,c);assert(!md.includes('<img'));assert(!md.includes('<script'));assert(!md.includes('<svg'));assert(!md.includes('<iframe'));assert(!md.includes('[click](javascript:'));assert(md.includes('&lt;script&gt;'));assert(md.includes('\\[click\\]'));
});
check('Every operations collection joins valid project/client/task/team references and survives JSON roundtrip',()=>{
 const s=fixture();W.validate(s);Ops.validate(s);assert.deepEqual(Ops.validate(W.validate(clone(s))),s);
 assert(Ops.COLLECTIONS.every(k=>s.operations[k].length));
 const before=JSON.stringify(s),summary=Ops.summarize(s,{today});
 assert.equal(summary.taskCount,40);assert.equal(summary.doneTasks,20);assert.equal(summary.loggedMinutes,600);assert.equal(summary.overdueMilestones,4);
 for(const row of summary.byCurrency){assert.equal(row.estimatedMinor,15000);assert.equal(row.invoiceMinor,7500);assert.equal(row.proposalMinor,10000);assert.equal(row.pipelineMinor,10000);}
 for(const row of summary.byProject){assert.equal(row.taskCount,10);assert.equal(row.plannedHours,1.25);assert.equal(row.loggedMinutes,150);const c=Ops.costing(s,row.projectId);assert.equal(c.actualKnownMinor,15500);assert.equal(c.plannedKnownMinor,13000);assert.equal(c.budgetRemainingMinor,84500);assert.equal(c.actualComplete,true);}
 assert.equal(JSON.stringify(s),before,'Read-only reports must not mutate source records');
});
check('Deleting referenced records cannot persist dangling projects, clients, people, tasks, sprints or opportunities',()=>{
 for(const [where,key] of [['base','clients'],['base','projects'],['base','tasks'],['ops','team'],['ops','sprints'],['ops','opportunities']]){
  const s=fixture();(where==='base'?s:s.operations)[key].shift();assert.throws(()=>Ops.validate(W.validate(s)),undefined,key);
 }
});
check('Updates propagate to reports and costing independently, retaining original rate snapshots',()=>{
 const s=fixture(),baseCost=Ops.costing(s,'project-0');
 s.operations.team[0].costRateMinor=123;s.operations.team[0].costCurrency='EUR';s.operations.estimates[0].hours=99;
 s.tasks[0].estimatedHours=7;s.tasks[0].status='Backlog';s.operations.proposals[0].status='Declined';s.operations.opportunities[0].stage='Won';s.operations.milestones[0].status='Reached';s.operations.issues[0].status='Resolved';
 assert.deepEqual(Ops.costing(s,'project-0'),baseCost);
 const r=Ops.summarize(s,{today});assert.equal(r.doneTasks,19);assert.equal(r.byProject[0].plannedHours,8.125);assert.equal(r.byProject[0].openIssues,0);assert.equal(r.overdueMilestones,3);assert.equal(r.proposalMinor,0);assert.equal(r.pipelineMinor,0);assert.equal(r.estimatedMinor,594000);
 s.operations.timeEntries[0].durationMinutes=30;assert.equal(Ops.costing(s,'project-0').actualKnownMinor,17000);assert.equal(Ops.summarize(s,{today}).loggedMinutes,615);
 s.operations.timeEntries.shift();s.operations.expenses.shift();assert.equal(Ops.costing(s,'project-0').actualKnownMinor,13500);
});
check('Maximum task/time collections remain cross-module consistent under bounded local data pressure',()=>{
 const s=fixture(500,5000),start=performance.now();W.validate(s);Ops.validate(s);const validMs=performance.now()-start,reportStart=performance.now(),r=Ops.summarize(s,{today}),reportMs=performance.now()-reportStart;
 assert.equal(r.projectCount,500);assert.equal(r.taskCount,5000);assert.equal(r.doneTasks,2500);assert.equal(r.loggedMinutes,75000);assert.equal(r.byProject.length,500);assert.equal(r.overdueMilestones,500);
 assert.equal(r.byProject.reduce((n,p)=>n+p.taskCount,0),r.taskCount);assert.equal(r.byTeam.reduce((n,p)=>n+p.loggedMinutes,0),r.loggedMinutes);
 for(const projectId of ['project-0','project-1','project-499'])assert.equal(Ops.costing(s,projectId).actualKnownMinor,15500);
 s.tasks.push({...s.tasks[0],id:'overflow-task'});assert.throws(()=>W.validate(s),/workspace records/);s.tasks.pop();
 s.operations.timeEntries.push({...s.operations.timeEntries[0],id:'overflow-time'});assert.throws(()=>Ops.validate(s),/timeEntries records/);s.operations.timeEntries.pop();
 console.log('MEASURE '+JSON.stringify({projects:500,tasks:5000,timeEntries:5000,operationsRecords:Object.values(s.operations).reduce((n,a)=>n+a.length,0),jsonBytes:Buffer.byteLength(JSON.stringify(s)),validationMs:+validMs.toFixed(1),summaryMs:+reportMs.toFixed(1)}));
});
check('Large planning inputs remain deterministic, traced and persistable with existing-task pressure',()=>{
 const original=Array.from({length:300},(_,i)=>'Baseline feature number '+i+'.').join(' '),message=Array.from({length:100},(_,i)=>'Add feature number '+i+'.').join(' '),existingTasks=Array.from({length:500},(_,i)=>({title:'Feature item '+i,description:'Existing work',status:'Backlog'}));
 const start=performance.now(),p=R.analyse(original,message,{existingTasks}),elapsed=performance.now()-start;
 assert.equal(p.changes.length,100);assert.equal(p.tasks.length,40);assert.deepEqual(p,R.analyse(original,message,{existingTasks}));assert(p.warnings.some(w=>w.ruleId==='system.output-limit'));
 const s=W.sample();W.addChange(s,'project-1','Large plan',message,()=>p);W.validate(s);
 console.log('MEASURE '+JSON.stringify({baselineSentences:300,requestClauses:100,existingTasks:500,planningMs:+elapsed.toFixed(1)}));
});
console.log('Completed '+count+' cross-module model integration checks.');
