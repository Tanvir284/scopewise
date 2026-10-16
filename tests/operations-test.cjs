'use strict';
const assert=require('node:assert/strict');
const W=require('../public/workspace-data.js'),Ops=require('../public/operations-data.js');
const clone=x=>JSON.parse(JSON.stringify(x)),at='2026-10-08T06:00:00.000Z',today='2026-10-08';
let count=0;
function check(label,fn){fn();count++;console.log('PASS '+label);}
function fixture(){
 const s=Ops.normalize(W.sample());
 s.operations.team.push({id:'person-1',name:'Developer',role:'Engineer',email:'dev@example.com',capacityHours:20,active:true});
 s.operations.sprints.push({id:'sprint-1',projectId:'project-1',name:'October delivery',goal:'Booking launch',start:'2026-10-01',end:'2026-10-14',status:'Active'});
 s.operations.milestones.push({id:'milestone-1',projectId:'project-1',name:'Client review',due:'2026-10-07',status:'In progress',sprintId:'sprint-1'});
 Object.assign(s.tasks[0],{assigneeId:'person-1',sprintId:'sprint-1',estimatedHours:25});
 s.operations.issues.push({id:'issue-1',projectId:'project-1',taskId:'task-1',title:'Booking double submit',description:'Two requests are recorded.',severity:'Critical',status:'Open',assigneeId:'person-1',createdAt:at,due:''});
 s.operations.timeEntries.push({id:'time-1',projectId:'project-1',taskId:'task-1',teamId:'person-1',date:today,durationMinutes:90,note:'Booking form investigation'});
 s.operations.estimates.push({id:'estimate-1',projectId:'project-1',name:'Booking form',hours:10,rateMinor:150000,status:'Accepted',notes:'Agreed scope',createdAt:at,currency:'BDT'});
 s.operations.invoices.push({id:'invoice-1',projectId:'project-1',number:'SW-001',status:'Draft',issuedDate:today,dueDate:'2026-10-22',lines:[{description:'Booking scope',qty:10,rateMinor:150000},{description:'Review',qty:0.5,rateMinor:200000}],notes:'Review before issuing',createdAt:at,currency:'BDT'});
 s.operations.versions.push({id:'version-1',projectId:'project-1',requirement:s.projects[0].original,reason:'Initial baseline',createdAt:at,changeId:null});
 s.operations.opportunities.push({id:'opportunity-1',clientId:'client-1',projectId:'project-1',name:'Booking phase two',stage:'Qualified',valueMinor:2500000,notes:'Discuss after launch',nextStep:'Confirm priorities',createdAt:at,currency:'BDT'});
 s.operations.proposals.push({id:'proposal-1',clientId:'client-1',projectId:'project-1',opportunityId:'opportunity-1',title:'Booking extension',scope:'Add appointment rescheduling.',lines:[{description:'Extension',qty:12.5,rateMinor:150000}],status:'Draft',validUntil:'2026-10-30',notes:'Client decision required',createdAt:at,currency:'BDT'});
 return s;
}
function bad(mutate,expected){const s=fixture();mutate(s);assert.throws(()=>Ops.validate(s),expected);}
check('Legacy normalization preserves exact records, array identities, and version',()=>{
 const s=W.sample(),base=clone(s),tasks=s.tasks,clients=s.clients;
 assert.equal(Ops.validate(s),s);
 assert.equal(Ops.normalize(s),s);assert.equal(s.tasks,tasks);assert.equal(s.clients,clients);assert.equal(s.version,1);
 const {operations,...preserved}=s;assert.deepEqual(preserved,base);assert.deepEqual(operations,Ops.emptyOperations());
 assert.equal(Ops.normalize(s).operations,operations);
});
check('Existing operations preserved; partial older collections expanded without overwrite',()=>{
 const s=fixture(),existing=s.operations,sprints=existing.sprints,first=sprints[0];delete existing.opportunities;delete existing.proposals;
 Ops.validate(s);Ops.normalize(s);assert.equal(s.operations,existing);assert.equal(s.operations.sprints,sprints);assert.equal(sprints[0],first);assert.deepEqual(s.operations.proposals,[]);
 for(const invalid of [null,[],4,'broken']){const malformed=W.sample();malformed.operations=invalid;assert.throws(()=>Ops.normalize(malformed));assert.equal(malformed.operations,invalid);}
});
check('Full connected fixture validates through base and operations schemas and round trips',()=>{
 const s=fixture();assert.equal(W.validate(s),s);assert.equal(Ops.validate(s),s);assert.deepEqual(Ops.validate(clone(s)),s);
});
check('Record IDs unique globally and safe for route selectors',()=>{
 bad(s=>s.operations.team[0].id=s.tasks[0].id,/record ID/);
 bad(s=>s.operations.issues[0].id=s.operations.sprints[0].id,/record ID/);
 for(const id of ['', 'x/y','bad#id','💥'])bad(s=>s.operations.team[0].id=id,/record ID/);
});
check('Cross-project task, sprint, time, issue, milestone and version references rejected',()=>{
 bad(s=>s.tasks[0].sprintId='missing',/sprint/);
 bad(s=>s.tasks[2].sprintId='sprint-1',/Cross-project/);
 bad(s=>s.operations.milestones[0].projectId='project-2',/Cross-project/);
 bad(s=>s.operations.issues[0].taskId='task-3',/Cross-project/);
 bad(s=>s.operations.timeEntries[0].taskId='task-3',/Cross-project/);
 bad(s=>s.operations.timeEntries[0].projectId='missing',/project reference/);
 bad(s=>s.operations.issues[0].assigneeId='missing',/assignee/);
 bad(s=>s.operations.timeEntries[0].teamId='missing',/team/);
 bad(s=>s.tasks[0].assigneeId='missing',/assignee/);
 bad(s=>s.operations.versions[0].changeId='missing',/version change/);
});
check('Cross-client opportunities and mismatched proposal relationships rejected',()=>{
 bad(s=>s.operations.opportunities[0].clientId='client-2',/Cross-client/);
 bad(s=>s.operations.proposals[0].clientId='missing',/client reference/);
 bad(s=>s.operations.proposals[0].projectId='project-2',/Cross-client/);
 bad(s=>s.operations.proposals[0].opportunityId='missing',/opportunity reference/);
 bad(s=>{s.operations.opportunities[0].clientId='client-2';s.operations.opportunities[0].projectId=null;},/Mismatched/);
 const s=fixture();s.operations.opportunities[0].projectId=null;assert.equal(Ops.validate(s),s);
});
check('Date validation rejects invalid calendar dates, reversed ranges, and locale strings',()=>{
 for(const value of ['2026-02-29','2026-13-01','2026-04-31','10/08/2026','2026-1-01','2026-10-08T00:00:00Z'])bad(s=>s.operations.timeEntries[0].date=value,/date/);
 bad(s=>s.operations.sprints[0].end='2026-09-30',/date range/);
 bad(s=>s.operations.invoices[0].dueDate='2026-10-01',/invoice draft/);
 bad(s=>s.operations.issues[0].createdAt='2026-02-30T06:00:00.000Z',/issue record/);
 const s=fixture();s.operations.timeEntries[0].date='2024-02-29';Ops.validate(s);
});
check('Time duration is a positive bounded integer and task estimates/capacity finite',()=>{
 for(const value of [0,-1,0.5,1441,NaN,Infinity,'60'])bad(s=>s.operations.timeEntries[0].durationMinutes=value,/duration/);
 for(const value of [-1,Infinity,NaN,'5',10001,0.0001])bad(s=>s.tasks[0].estimatedHours=value,/estimated hours/);
 for(const value of [-1,169,Infinity,NaN,0.0001])bad(s=>s.operations.team[0].capacityHours=value,/team/);
 const s=fixture();s.operations.team[0].capacityHours=0;s.tasks[0].estimatedHours=0;Ops.validate(s);
});
check('Invoice drafts only; invalid statuses, currency, text, amounts and line arrays rejected',()=>{
 bad(s=>s.operations.invoices[0].status='Paid',/invoice draft/);
 bad(s=>s.operations.estimates[0].currency='XYZ',/currency/);
 bad(s=>delete s.operations.proposals[0].currency,/currency/);
 bad(s=>s.operations.opportunities[0].valueMinor=-1,/opportunity/);
 bad(s=>s.operations.invoices[0].lines=[],/line items/);
 bad(s=>s.operations.invoices[0].lines=Array.from({length:101},()=>({description:'x',qty:1,rateMinor:1})),/line items/);
 for(const value of [-1,NaN,Infinity,0.0001,'2'])bad(s=>s.operations.invoices[0].lines[0].qty=value,/line item/);
 for(const value of [-1,0.5,NaN,Infinity,'1'])bad(s=>s.operations.invoices[0].lines[0].rateMinor=value,/line item/);
 bad(s=>s.operations.invoices[0].lines[0].description='  ',/line item/);
});
check('Decimal money rounds half-up per line and does not inherit floating point errors',()=>{
 assert.equal(Ops.multiplyMinor(1.005,100),101);assert.equal(Ops.multiplyMinor(0.125,4),1);assert.equal(Ops.multiplyMinor(0.124,4),0);
 assert.equal(Ops.multiplyMinor(2.675,100),268);assert.equal(Ops.multiplyMinor(0.001,1000),1);
 assert.equal(Ops.invoiceTotal({lines:[{description:'a',qty:0.005,rateMinor:100},{description:'b',qty:0.005,rateMinor:100}]}),2);
 assert.equal(Ops.invoiceTotal(fixture().operations.invoices[0]),1600000);assert.equal(Ops.proposalTotal(fixture().operations.proposals[0]),1875000);assert.equal(Ops.estimateTotal(fixture().operations.estimates[0]),1500000);
 assert.throws(()=>Ops.multiplyMinor(1000000,1000000000000),/safe range/);
 assert.throws(()=>Ops.sumMinor([Number.MAX_SAFE_INTEGER,1]),/safe range/);
});
check('Summaries and traceable alerts calculate actual linked records',()=>{
 const s=fixture(),summary=Ops.summarize(s,{today});
 assert.equal(summary.activeSprints,1);assert.equal(summary.openIssues,1);assert.equal(summary.criticalIssues,1);assert.equal(summary.loggedMinutes,90);
 assert.equal(summary.estimatedHours,10);assert.equal(summary.estimatedMinor,1500000);assert.equal(summary.invoiceMinor,1600000);assert.equal(summary.proposalMinor,1875000);assert.equal(summary.pipelineMinor,2500000);
 assert.equal(summary.byProject[0].plannedHours,25);assert.equal(summary.byTeam[0].loadPercent,125);
 for(const fragment of ['Milestone overdue','Critical issues','Planned hours','Invoice drafts','workload'])assert(summary.alerts.some(a=>a.title.includes(fragment)),fragment);
 s.operations.milestones[0].status='Reached';s.operations.issues[0].status='Resolved';s.tasks[0].status='Done';
 const next=Ops.summarize(s,{today});assert.equal(next.overdueMilestones,0);assert.equal(next.openIssues,0);assert.equal(next.byTeam[0].estimatedHours,0);assert.equal(next.completionPercent,33);
});
check('No fabricated metrics; empty workspace totals and completion remain zero',()=>{
 const s=Ops.normalize({version:1,settings:{name:'New agency',currency:'BDT'},clients:[],projects:[],changes:[],tasks:[],activity:[]});
 const summary=Ops.summarize(s,{today});
 for(const key of ['projectCount','taskCount','completionPercent','loggedMinutes','estimatedMinor','invoiceMinor','proposalMinor','pipelineMinor'])assert.equal(summary[key],0,key);
 assert.deepEqual(summary.alerts,[]);assert.deepEqual(summary.byProject,[]);
});
check('Workspace currency changes do not relabel or mix financial records',()=>{
 const s=fixture();s.settings.currency='USD';const summary=Ops.summarize(s,{today});
 assert.equal(summary.currency,'USD');assert.equal(summary.invoiceMinor,0);assert.equal(summary.estimatedMinor,0);assert.equal(summary.estimatedHours,10);
 assert.equal(summary.byCurrency.find(r=>r.currency==='BDT').invoiceMinor,1600000);assert.equal(s.operations.invoices[0].currency,'BDT');
});
check('Export includes current edits, real totals and literal hostile markup without executable HTML',()=>{
 const s=fixture();s.operations.issues[0].title='<script>alert("x")</script>';s.tasks[0].criteria=['Edited booking acceptance'];s.operations.estimates[0].hours=12;
 const md=Ops.exportProject(s,'project-1',{today});
 assert(md.includes('Edited booking acceptance'));assert(md.includes('18000.00 BDT'));assert(md.includes('&lt;script&gt;'));assert(!md.includes('<script>'));assert(md.includes('Invoice drafts'));
 assert.throws(()=>Ops.exportProject(s,'missing',{today}),/Unknown project/);
});
check('Malformed collection and unsupported subtree rejected rather than reset',()=>{
 bad(s=>s.operations.team=null,/team records/);
 bad(s=>s.operations.unrecognized=[],/Unsupported/);
 bad(s=>s.operations.versions[0].reason='  ',/version/);
});


check('Aggregated money overflow rejected on validation before import persistence',()=>{
 const s=fixture();const e=s.operations.estimates[0];e.hours=9000;e.rateMinor=1000000000000;
 assert.equal(Ops.estimateTotal(e),9000000000000000);
 s.operations.estimates.push({...e,id:'estimate-2'});
 assert.throws(()=>Ops.validate(s),/safe range/);
});
check('Minor unit display is exact at safe integer boundary and date defaults honor Dhaka',()=>{
 assert.equal(Ops.formatMinor(Number.MAX_SAFE_INTEGER,'BDT'),'90071992547409.91 BDT');
 assert.equal(Ops.formatMinor(1,'USD'),'0.01 USD');
 assert.equal(Ops.today('Asia/Dhaka',new Date('2026-10-07T20:00:00.000Z')),'2026-10-08');
 assert.equal(Ops.today('UTC',new Date('2026-10-07T20:00:00.000Z')),'2026-10-07');
 assert.throws(()=>Ops.formatMinor(-1,'BDT'),/Invalid monetary/);
});
check('Project insights compute deterministic margin, burn percentage, and delivery health',()=>{
 const s=fixture();
 const insights=Ops.projectInsights(s,{today});
 assert.equal(insights.length,2);
 assert.equal(insights[0].projectId,'project-1');
 assert.equal(insights[0].acceptedEstimateMinor,1500000);
 assert.equal(insights[0].plannedHours,25);
 assert.equal(insights[0].acceptedHours,10);
 assert.equal(insights[0].loggedHours,1.5);
 assert.equal(insights[0].burnPercent,15);
 assert.equal(insights[0].health,'Critical');
 assert(insights[0].reasons.some(r=>r.includes('critical issue'))&&insights[0].reasons.some(r=>r.includes('overdue milestone')));
 s.operations.milestones[0].status='Reached';
 s.operations.issues[0].status='Resolved';
 const healthy=Ops.projectInsights(s,{today});
 assert.equal(healthy[0].health,'Healthy');
});
console.log('Completed '+count+' operations model checks.');
