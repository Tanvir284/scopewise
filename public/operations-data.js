(function(root){
'use strict';
const COLLECTIONS=Object.freeze(['sprints','milestones','issues','team','timeEntries','estimates','invoices','versions','opportunities','proposals','costPlans','expenses']);
const BASE=['clients','projects','changes','tasks','activity'],CURRENCIES=['BDT','USD','EUR','GBP'];
const uid=()=>globalThis.crypto?.randomUUID?.()||('id-'+Date.now()+'-'+Math.random().toString(36).slice(2));
const stamp=()=>new Date().toISOString(),own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v),fail=m=>{throw Error(m);};
const string=(v,max=24000)=>typeof v==='string'&&v.length<=max;
const required=(v,max=150)=>string(v,max)&&Boolean(v.trim());
const id=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(v);
const absent=v=>v===undefined||v===null||v==='';
const integer=(v,max=Number.MAX_SAFE_INTEGER)=>Number.isSafeInteger(v)&&v>=0&&v<=max;
function decimal(v,max=1000000){
 return typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=max&&/^(?:0|[1-9]\d*)(?:\.\d{1,3})?$/.test(String(v));
}
function date(v,optional=false){
 if(optional&&v==='')return true;
 if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v))return false;
 const d=new Date(v+'T00:00:00.000Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===v;
}
function timestamp(v){return typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;}
function emptyOperations(){return Object.fromEntries(COLLECTIONS.map(k=>[k,[]]));}
function normalize(state){
 if(!object(state))fail('Invalid workspace.');
 if(!own(state,'operations'))state.operations=emptyOperations();
 if(!object(state.operations))fail('Invalid operations data.');
 for(const k of COLLECTIONS)if(!own(state.operations,k))state.operations[k]=[];
 return state;
}
function today(timeZone='Asia/Dhaka',now=new Date()){
 const parts=new Intl.DateTimeFormat('en-US',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
 const get=type=>parts.find(p=>p.type===type).value;
 return get('year')+'-'+get('month')+'-'+get('day');
}
function formatMinor(amount,currency){
 if(!integer(amount)||!CURRENCIES.includes(currency))fail('Invalid monetary amount or currency.');
 const value=BigInt(amount);return String(value/100n)+'.'+String(value%100n).padStart(2,'0')+' '+currency;
}
const records=(s,k)=>s.operations?.[k]||[];
function validate(state){
 if(!object(state))fail('Invalid workspace.');
 for(const k of BASE)if(!Array.isArray(state[k]))fail('Invalid base workspace records.');
 if(own(state,'operations')&&!object(state.operations))fail('Invalid operations data.');
 const ops=state.operations||{};
 for(const k of Object.keys(ops))if(!COLLECTIONS.includes(k))fail('Unsupported operations collection: '+k+'.');
 for(const k of COLLECTIONS)if(own(ops,k)&&(!Array.isArray(ops[k])||ops[k].length>5000))fail('Invalid '+k+' records.');
 const ids=new Set();
 for(const k of [...BASE,...COLLECTIONS])for(const r of BASE.includes(k)?state[k]:(ops[k]||[])){
  if(!object(r)||!id(r.id)||ids.has(r.id))fail('Invalid or duplicate record ID.');
  ids.add(r.id);
 }
 const map=k=>new Map((BASE.includes(k)?state[k]:(ops[k]||[])).map(r=>[r.id,r]));
 const projects=map('projects'),clients=map('clients'),tasks=map('tasks'),changes=map('changes'),teams=map('team'),sprints=map('sprints'),opportunities=map('opportunities');
 const project=(r,label)=>{if(!projects.has(r.projectId))fail('Invalid '+label+' project reference.');};
 const ref=(v,m,label)=>{if(!absent(v)&&!m.has(v))fail('Invalid '+label+' reference.');};
 const projectRef=(r,v,m,label)=>{ref(v,m,label);if(!absent(v)&&m.get(v).projectId!==r.projectId)fail('Cross-project '+label+' reference.');};
 const monetary=(r,label)=>{if(!CURRENCIES.includes(r.currency))fail('Invalid '+label+' currency.');};
 for(const r of ops.team||[]){costSnapshot(r,'team');if(!required(r.name,120)||!string(r.role,120)||!string(r.email,200)||!decimal(r.capacityHours,168)||typeof r.active!=='boolean')fail('Invalid team record.');}
 for(const r of ops.sprints||[]){
  project(r,'sprint');
  if(!required(r.name)||!string(r.goal)||!date(r.start,true)||!date(r.end,true)||!['Planned','Active','Completed'].includes(r.status)||(r.start&&r.end&&r.start>r.end))fail('Invalid sprint record or date range.');
 }
 for(const r of ops.milestones||[]){
  project(r,'milestone');projectRef(r,r.sprintId,sprints,'milestone sprint');
  if(!required(r.name)||!date(r.due,true)||!['Planned','In progress','Reached'].includes(r.status))fail('Invalid milestone record.');
 }
 for(const r of state.tasks){
  projectRef(r,r.sprintId,sprints,'task sprint');ref(r.assigneeId,teams,'task assignee');
  if(own(r,'estimatedHours')&&!decimal(r.estimatedHours,10000))fail('Invalid task estimated hours.');
 }
 for(const r of ops.issues||[]){
  project(r,'issue');projectRef(r,r.taskId,tasks,'issue task');ref(r.assigneeId,teams,'issue assignee');
  if(!required(r.title)||!string(r.description)||!['Low','Medium','High','Critical'].includes(r.severity)||!['Open','In progress','Resolved'].includes(r.status)||!timestamp(r.createdAt)||(own(r,'due')&&!date(r.due,true)))fail('Invalid issue record.');
 }
 for(const r of ops.timeEntries||[]){
  costSnapshot(r,'time entry');
  project(r,'time entry');projectRef(r,r.taskId,tasks,'time entry task');ref(r.teamId,teams,'time entry team');
  if(!date(r.date)||!integer(r.durationMinutes,1440)||r.durationMinutes===0||!string(r.note,4000))fail('Invalid time entry duration, date, or note.');
 }
 for(const r of ops.estimates||[]){
  project(r,'estimate');monetary(r,'estimate');
  if(!required(r.name)||!decimal(r.hours)||!integer(r.rateMinor,1000000000000)||!['Draft','Proposed','Accepted'].includes(r.status)||!string(r.notes)||!timestamp(r.createdAt))fail('Invalid estimate record.');
  estimateTotal(r);
 }
 for(const r of ops.invoices||[]){
  project(r,'invoice');monetary(r,'invoice');
  if(!required(r.number,100)||r.status!=='Draft'||!date(r.issuedDate)||!date(r.dueDate,true)||(r.dueDate&&r.dueDate<r.issuedDate)||!string(r.notes)||!timestamp(r.createdAt))fail('Invalid invoice draft.');
  invoiceTotal(r);
 }
 for(const r of ops.versions||[]){
  project(r,'version');projectRef(r,r.changeId,changes,'version change');
  if(!string(r.requirement)||!required(r.reason,2000)||!timestamp(r.createdAt))fail('Invalid requirement version.');
 }
 const clientProject=(r,label)=>{
  if(!clients.has(r.clientId))fail('Invalid '+label+' client reference.');
  ref(r.projectId,projects,label+' project');
  if(!absent(r.projectId)&&projects.get(r.projectId).clientId!==r.clientId)fail('Cross-client '+label+' project reference.');
 };
 for(const r of ops.opportunities||[]){
  clientProject(r,'opportunity');monetary(r,'opportunity');
  if(!required(r.name)||!['Lead','Qualified','Proposal','Won','Lost'].includes(r.stage)||!integer(r.valueMinor,1000000000000)||!string(r.notes)||!string(r.nextStep,4000)||!timestamp(r.createdAt))fail('Invalid opportunity record.');
 }
 for(const r of ops.proposals||[]){
  clientProject(r,'proposal');monetary(r,'proposal');ref(r.opportunityId,opportunities,'proposal opportunity');
  if(!absent(r.opportunityId)){
   const opportunity=opportunities.get(r.opportunityId);
   if(opportunity.clientId!==r.clientId||(!absent(r.projectId)&&!absent(opportunity.projectId)&&opportunity.projectId!==r.projectId))fail('Mismatched proposal opportunity reference.');
  }
  if(!required(r.title)||!string(r.scope)||!['Draft','Sent','Accepted','Declined'].includes(r.status)||!date(r.validUntil,true)||!string(r.notes)||!timestamp(r.createdAt))fail('Invalid proposal record.');
  proposalTotal(r);
 }
 const plannedProjects=new Set();
 for(const r of ops.costPlans||[]){
  project(r,'cost plan');monetary(r,'cost plan');
  if(plannedProjects.has(r.projectId))fail('Only one cost plan is allowed per project.');
  plannedProjects.add(r.projectId);
  if(!required(r.name)||!string(r.notes)||!timestamp(r.createdAt)||(own(r,'budgetMinor')&&r.budgetMinor!==null&&!integer(r.budgetMinor)))fail('Invalid cost plan record or internal budget.');
  costPlanParts(r);
  for(const line of r.laborLines){projectRef(r,line.taskId,tasks,'cost plan task');ref(line.teamId,teams,'cost plan team');}
 }
 for(const r of ops.expenses||[]){
  project(r,'expense');monetary(r,'expense');
  if(!required(r.description,1000)||!['Hosting','Software','Contractor','Travel','Other'].includes(r.category)||!date(r.date)||!integer(r.amountMinor)||!string(r.notes))fail('Invalid actual expense record.');
 }
 // Reject workspaces whose aggregated currency totals cannot be represented safely.
 for(const currency of CURRENCIES){
  sumMinor((ops.estimates||[]).filter(r=>r.currency===currency).map(estimateTotal));
  sumMinor((ops.invoices||[]).filter(r=>r.currency===currency).map(invoiceTotal));
  sumMinor((ops.proposals||[]).filter(r=>r.currency===currency).map(proposalTotal));
  sumMinor((ops.opportunities||[]).filter(r=>r.currency===currency).map(r=>r.valueMinor));
  sumMinor((ops.costPlans||[]).filter(r=>r.currency===currency).map(costPlanTotal));
  sumMinor((ops.costPlans||[]).filter(r=>r.currency===currency&&r.budgetMinor!==undefined&&r.budgetMinor!==null).map(r=>r.budgetMinor));

 }
 actualCurrencyTotals(state);
 return state;
}
function multiplyMinor(qty,rateMinor){
 if(!decimal(qty)||!integer(rateMinor,1000000000000))fail('Invalid quantity or monetary rate.');
 const parts=String(qty).split('.'),scale=10n**BigInt((parts[1]||'').length);
 const numerator=BigInt(parts[0]+(parts[1]||''))*BigInt(rateMinor),rounded=(numerator+scale/2n)/scale;
 if(rounded>BigInt(Number.MAX_SAFE_INTEGER))fail('Monetary amount exceeds safe range.');
 return Number(rounded);
}
function sumMinor(values){
 let total=0n;
 for(const value of values){if(!integer(value))fail('Invalid monetary amount.');total+=BigInt(value);}
 if(total>BigInt(Number.MAX_SAFE_INTEGER))fail('Monetary total exceeds safe range.');
 return Number(total);
}
function lineTotal(line){
 if(!object(line)||!required(line.description,1000)||!decimal(line.qty)||!integer(line.rateMinor,1000000000000))fail('Invalid financial line item.');
 return multiplyMinor(line.qty,line.rateMinor);
}
function invoiceTotal(invoice){
 if(!object(invoice)||!Array.isArray(invoice.lines)||invoice.lines.length===0||invoice.lines.length>100)fail('Add between 1 and 100 invoice line items.');
 return sumMinor(invoice.lines.map(lineTotal));
}
const proposalTotal=proposal=>invoiceTotal(proposal),estimateTotal=e=>multiplyMinor(e.hours,e.rateMinor),hours=v=>Math.round(v*1000)/1000;
function summarize(state,options={}){
 validate(state);
 const reportDate=options.today||today(options.timeZone||'Asia/Dhaka');if(!date(reportDate))fail('Invalid report date.');
 const currency=CURRENCIES.includes(state.settings?.currency)?state.settings.currency:'BDT',get=k=>records(state,k);
 const currencyTotals=c=>({
  currency:c,
  estimatedMinor:sumMinor(get('estimates').filter(r=>r.currency===c).map(estimateTotal)),
  acceptedEstimateMinor:sumMinor(get('estimates').filter(r=>r.currency===c&&r.status==='Accepted').map(estimateTotal)),
  invoiceMinor:sumMinor(get('invoices').filter(r=>r.currency===c).map(invoiceTotal)),
  proposalMinor:sumMinor(get('proposals').filter(r=>r.currency===c&&r.status!=='Declined').map(proposalTotal)),
  pipelineMinor:sumMinor(get('opportunities').filter(r=>r.currency===c&&!['Won','Lost'].includes(r.stage)).map(r=>r.valueMinor))
 });
 const summary={
  projectCount:state.projects.length,clientCount:state.clients.length,taskCount:state.tasks.length,
  doneTasks:state.tasks.filter(t=>t.status==='Done').length,openTasks:state.tasks.filter(t=>t.status!=='Done').length,
  activeSprints:get('sprints').filter(r=>r.status==='Active').length,
  overdueMilestones:get('milestones').filter(r=>r.status!=='Reached'&&r.due&&r.due<reportDate).length,
  openIssues:get('issues').filter(r=>r.status!=='Resolved').length,
  criticalIssues:get('issues').filter(r=>r.status!=='Resolved'&&r.severity==='Critical').length,
  teamCount:get('team').filter(r=>r.active).length,
  loggedMinutes:get('timeEntries').reduce((n,r)=>n+r.durationMinutes,0),
  estimatedHours:hours(get('estimates').reduce((n,r)=>n+r.hours,0)),
  ...currencyTotals(currency),byCurrency:CURRENCIES.map(currencyTotals),
  completionPercent:state.tasks.length?Math.round(100*state.tasks.filter(t=>t.status==='Done').length/state.tasks.length):0,
  byProject:[],byTeam:[],alerts:[]
 };
 const alert=(type,projectId,title,detail)=>summary.alerts.push({id:'alert-'+summary.alerts.length,type,projectId,title,detail});
 for(const p of state.projects){
  const ts=state.tasks.filter(t=>t.projectId===p.id),es=get('estimates').filter(r=>r.projectId===p.id),ms=get('milestones').filter(r=>r.projectId===p.id),issues=get('issues').filter(r=>r.projectId===p.id&&r.status!=='Resolved');
  const row={
   projectId:p.id,currency,taskCount:ts.length,doneTasks:ts.filter(t=>t.status==='Done').length,openTasks:ts.filter(t=>t.status!=='Done').length,
   plannedHours:hours(ts.reduce((n,r)=>n+(r.estimatedHours||0),0)),remainingHours:hours(ts.filter(t=>t.status!=='Done').reduce((n,r)=>n+(r.estimatedHours||0),0)),
   acceptedHours:hours(es.filter(r=>r.status==='Accepted').reduce((n,r)=>n+r.hours,0)),
   loggedMinutes:get('timeEntries').filter(r=>r.projectId===p.id).reduce((n,r)=>n+r.durationMinutes,0),
   estimatedMinor:sumMinor(es.filter(r=>r.currency===currency).map(estimateTotal)),
   acceptedEstimateMinor:sumMinor(es.filter(r=>r.currency===currency&&r.status==='Accepted').map(estimateTotal)),
   invoiceMinor:sumMinor(get('invoices').filter(r=>r.projectId===p.id&&r.currency===currency).map(invoiceTotal)),
   openIssues:issues.length,criticalIssues:issues.filter(r=>r.severity==='Critical').length,
   overdueMilestones:ms.filter(r=>r.status!=='Reached'&&r.due&&r.due<reportDate).length,
   unassignedTasks:ts.filter(t=>t.status!=='Done'&&absent(t.assigneeId)).length,
   activeSprints:get('sprints').filter(r=>r.projectId===p.id&&r.status==='Active').length,
   completionPercent:ts.length?Math.round(100*ts.filter(t=>t.status==='Done').length/ts.length):0
  };
  summary.byProject.push(row);
  if(row.overdueMilestones)alert('warning',p.id,'Milestone overdue',row.overdueMilestones+' unfinished milestone(s) passed their due date.');
  if(row.criticalIssues)alert('warning',p.id,'Critical issues need triage',row.criticalIssues+' unresolved critical issue(s).');
  if(row.acceptedHours>0&&row.plannedHours>row.acceptedHours)alert('warning',p.id,'Planned hours exceed accepted estimate',row.plannedHours+' planned hours against '+row.acceptedHours+' accepted hours.');
  if(row.acceptedHours>0&&row.loggedMinutes/60>row.acceptedHours)alert('warning',p.id,'Logged time exceeds accepted estimate',hours(row.loggedMinutes/60)+' logged hours against '+row.acceptedHours+' accepted hours.');
  if(row.unassignedTasks&&get('team').length)alert('info',p.id,'Assign remaining work',row.unassignedTasks+' open task(s) have no assigned person.');
  if(row.acceptedEstimateMinor>0&&row.invoiceMinor>row.acceptedEstimateMinor)alert('warning',p.id,'Invoice drafts exceed accepted estimate','Draft invoice totals in '+currency+' exceed accepted estimates; review scope and billing.');
 }
 for(const person of get('team')){
  const ts=state.tasks.filter(t=>t.assigneeId===person.id),open=ts.filter(t=>t.status!=='Done');
  const row={teamId:person.id,assignedTasks:ts.length,openTasks:open.length,estimatedHours:hours(open.reduce((n,t)=>n+(t.estimatedHours||0),0)),capacityHours:person.capacityHours,loggedMinutes:get('timeEntries').filter(t=>t.teamId===person.id).reduce((n,t)=>n+t.durationMinutes,0)};
  row.loadPercent=person.capacityHours?Math.round(100*row.estimatedHours/person.capacityHours):null;summary.byTeam.push(row);
  if(person.active&&row.estimatedHours>person.capacityHours)alert('info',null,'Review '+person.name+"'s workload",row.estimatedHours+' open estimated hours compared with '+person.capacityHours+' weekly capacity. This is a planning comparison, not a scheduled-week forecast.');
 }
 return summary;
}
function costSnapshot(r,label){
 const rate=own(r,'costRateMinor'),currency=own(r,'costCurrency');
 if(!rate&&!currency)return;
 if(!rate||!currency)fail('Provide both '+label+' cost rate and currency.');
 if(r.costRateMinor===null&&r.costCurrency===null)return;
 if(!integer(r.costRateMinor,1000000000000)||!CURRENCIES.includes(r.costCurrency))fail('Invalid '+label+' cost rate or currency.');
}
function minuteCost(durationMinutes,rateMinor){
 if(!integer(durationMinutes,1440)||!integer(rateMinor,1000000000000))fail('Invalid cost minutes or rate.');
 const total=(BigInt(durationMinutes)*BigInt(rateMinor)+30n)/60n;
 if(total>BigInt(Number.MAX_SAFE_INTEGER))fail('Monetary amount exceeds safe range.');
 return Number(total);
}
function costPlanParts(plan){
 if(!object(plan)||!Array.isArray(plan.laborLines)||plan.laborLines.length>100||!Array.isArray(plan.expenseLines)||plan.expenseLines.length>100)fail('Invalid cost plan line arrays.');
 const labor=plan.laborLines.map(line=>{
  if(!object(line)||!required(line.description,1000)||!decimal(line.hours)||(line.rateMinor!==null&&!integer(line.rateMinor,1000000000000)))fail('Invalid cost plan labor line.');
  return line.rateMinor===null?0:multiplyMinor(line.hours,line.rateMinor);
 });
 const expenses=plan.expenseLines.map(line=>{
  if(!object(line)||!required(line.description,1000)||!integer(line.amountMinor))fail('Invalid cost plan expense line.');
  return line.amountMinor;
 });
 return {laborMinor:sumMinor(labor),expensesMinor:sumMinor(expenses),knownMinor:sumMinor([...labor,...expenses])};
}
const costPlanTotal=plan=>costPlanParts(plan).knownMinor;
function actualCurrencyTotals(state){
 return CURRENCIES.map(currency=>{
  const time=records(state,'timeEntries').filter(r=>r.costRateMinor!==undefined&&r.costRateMinor!==null&&r.costCurrency===currency);
  const expenses=records(state,'expenses').filter(r=>r.currency===currency);
  const laborMinor=sumMinor(time.map(r=>minuteCost(r.durationMinutes,r.costRateMinor)));
  const expenseMinor=sumMinor(expenses.map(r=>r.amountMinor));
  return {currency,laborMinor,expenseMinor,knownMinor:sumMinor([laborMinor,expenseMinor]),pricedMinutes:time.reduce((n,r)=>n+r.durationMinutes,0),entryCount:time.length,expenseCount:expenses.length};
 });
}
function decimalHoursTotal(values){
 let total=0n;
 for(const value of values){
  if(!decimal(value))fail('Invalid cost hours.');
  const parts=String(value).split('.');
  total+=BigInt(parts[0])*1000n+BigInt((parts[1]||'').padEnd(3,'0'));
 }
 return Number(total)/1000;
}
function costing(state,projectId){
 validate(state);
 if(!state.projects.some(r=>r.id===projectId))fail('Unknown project.');
 const plan=records(state,'costPlans').find(r=>r.projectId===projectId)||null,currency=plan?.currency||null;
 const times=records(state,'timeEntries').filter(r=>r.projectId===projectId),expenses=records(state,'expenses').filter(r=>r.projectId===projectId);
 const scoped={operations:{timeEntries:times,expenses}},byCurrency=actualCurrencyTotals(scoped),selected=byCurrency.find(r=>r.currency===currency);
 const laborRows=(plan?.laborLines||[]).map((r,index)=>({index,description:r.description,hours:r.hours,rateMinor:r.rateMinor,taskId:r.taskId||null,teamId:r.teamId||null,amountMinor:r.rateMinor===null?null:multiplyMinor(r.hours,r.rateMinor)}));
 const plannedExpenseRows=(plan?.expenseLines||[]).map((r,index)=>({index,description:r.description,amountMinor:r.amountMinor}));
 const timeRows=times.map(r=>{
  const rate=r.costRateMinor??null,costCurrency=r.costCurrency??null,priced=rate!==null,included=Boolean(priced&&currency&&costCurrency===currency);
  return {entryId:r.id,date:r.date,taskId:r.taskId||null,teamId:r.teamId||null,durationMinutes:r.durationMinutes,costRateMinor:rate,costCurrency,amountMinor:priced?minuteCost(r.durationMinutes,rate):null,included,reason:!priced?'unpriced':!currency?'no-plan-currency':included?'':'foreign-currency'};
 });
 const expenseRows=expenses.map(r=>({expenseId:r.id,date:r.date,description:r.description,category:r.category,amountMinor:r.amountMinor,currency:r.currency,included:Boolean(currency&&r.currency===currency),reason:!currency?'no-plan-currency':r.currency===currency?'':'foreign-currency'}));
 const missing=laborRows.filter(r=>r.rateMinor===null),unpriced=timeRows.filter(r=>r.amountMinor===null),foreign=timeRows.filter(r=>r.reason==='foreign-currency'),foreignExpenses=expenseRows.filter(r=>r.reason==='foreign-currency');
 const parts=plan?costPlanParts(plan):{laborMinor:0,expensesMinor:0,knownMinor:0};
 const plannedComplete=Boolean(plan&&missing.length===0),actualComplete=Boolean(currency&&unpriced.length===0&&foreign.length===0&&foreignExpenses.length===0);
 const budgetMinor=plan?.budgetMinor??null,actualKnownMinor=selected?.knownMinor??null;
 return {projectId,planId:plan?.id||null,currency,budgetMinor,
  plannedLaborMinor:parts.laborMinor,plannedExpensesMinor:parts.expensesMinor,plannedKnownMinor:parts.knownMinor,
  plannedUnpricedHours:decimalHoursTotal(missing.map(r=>r.hours)),plannedUnpricedLineCount:missing.length,plannedComplete,
  actualLaborMinor:selected?.laborMinor??null,actualExpensesMinor:selected?.expenseMinor??null,actualKnownMinor,actualComplete,
  totalMinutes:timeRows.reduce((n,r)=>n+r.durationMinutes,0),pricedMinutes:timeRows.filter(r=>r.amountMinor!==null).reduce((n,r)=>n+r.durationMinutes,0),
  includedMinutes:timeRows.filter(r=>r.included).reduce((n,r)=>n+r.durationMinutes,0),
  unpricedMinutes:unpriced.reduce((n,r)=>n+r.durationMinutes,0),unpricedEntryCount:unpriced.length,
  foreignMinutes:foreign.reduce((n,r)=>n+r.durationMinutes,0),foreignEntryCount:foreign.length,foreignExpenseCount:foreignExpenses.length,
  budgetRemainingMinor:budgetMinor!==null&&actualComplete?budgetMinor-actualKnownMinor:null,
  budgetVarianceMinor:budgetMinor!==null&&actualComplete?actualKnownMinor-budgetMinor:null,
  planVarianceMinor:plannedComplete&&actualComplete?actualKnownMinor-parts.knownMinor:null,
  laborRows,plannedExpenseRows,timeRows,expenseRows,byCurrency};
}

const markdown=s=>String(s).replace(/[\\*_{}\[\]()#+.!|]/g,'\\$&').replace(/\x60/g,'\\\x60').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\r?\n/g,' ');
function exportProject(state,projectId,options={}){
 const summary=summarize(state,options),p=state.projects.find(p=>p.id===projectId);if(!p)fail('Unknown project.');
 const row=summary.byProject.find(r=>r.projectId===projectId),lines=['# '+markdown(p.name),'','Workspace: '+markdown(state.settings.name),'Storage: local agency workspace. Approvals and proposal statuses are local tracking.','','## Delivery snapshot','Tasks: '+row.doneTasks+'/'+row.taskCount+' completed','Planned hours: '+row.plannedHours+' | Logged hours: '+hours(row.loggedMinutes/60),'Open issues: '+row.openIssues+' | Overdue milestones: '+row.overdueMilestones,''];
 const section=(title,items)=>lines.push('## '+title,...(items.length?items:['No records.']),'');
 section('Sprints',records(state,'sprints').filter(r=>r.projectId===projectId).map(r=>'- '+markdown(r.name)+' — '+r.status+' ('+(r.start||'unscheduled')+' → '+(r.end||'unscheduled')+')'));
 section('Milestones',records(state,'milestones').filter(r=>r.projectId===projectId).map(r=>'- '+markdown(r.name)+' — '+r.status+' | Due: '+(r.due||'unscheduled')));
 section('Tasks',state.tasks.filter(t=>t.projectId===projectId).map(t=>'- '+markdown(t.title)+' — '+t.status+' | Estimate: '+(t.estimatedHours||0)+' hours\n'+t.criteria.map(c=>'  - [ ] '+markdown(c)).join('\n')));
 section('Issues',records(state,'issues').filter(r=>r.projectId===projectId).map(r=>'- '+markdown(r.title)+' — '+r.severity+' / '+r.status));
 section('Time entries',records(state,'timeEntries').filter(r=>r.projectId===projectId).map(r=>'- '+r.date+' | '+r.durationMinutes+' minutes | '+markdown(r.note)));
 const money=formatMinor;
 section('Estimates',records(state,'estimates').filter(r=>r.projectId===projectId).map(r=>'- '+markdown(r.name)+' — '+r.status+' | '+r.hours+' hours | '+money(estimateTotal(r),r.currency)));
 section('Invoice drafts',records(state,'invoices').filter(r=>r.projectId===projectId).map(r=>'- '+markdown(r.number)+' — Draft | '+money(invoiceTotal(r),r.currency)));
 section('Proposals',records(state,'proposals').filter(r=>r.projectId===projectId).map(r=>'- '+markdown(r.title)+' — '+r.status+' | '+money(proposalTotal(r),r.currency)));
 section('Requirement versions',records(state,'versions').filter(r=>r.projectId===projectId).map(r=>'- '+r.createdAt+' | '+markdown(r.reason)+'\n  '+markdown(r.requirement)));
 section('Planning alerts',summary.alerts.filter(r=>r.projectId===projectId).map(r=>'- '+markdown(r.title)+': '+markdown(r.detail)));
 return lines.join('\n');
}
const api={COLLECTIONS,CURRENCIES,uid,stamp,emptyOperations,normalize,validate,summarize,today,formatMinor,multiplyMinor,sumMinor,lineTotal,invoiceTotal,proposalTotal,estimateTotal,minuteCost,costPlanTotal,costing,exportProject};
if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.Ops=api;
})(globalThis);
