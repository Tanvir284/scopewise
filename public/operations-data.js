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
 if(typeof v!=='number'||!Number.isFinite(v)||v<0||v>max)return false;
 return Number.isInteger(v)||/^(?:0|[1-9]\d*)\.\d{1,3}$/.test(String(v));
}
function date(v,optional=false){
 if(optional&&v==='')return true;
 if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v))return false;
 const y=+v.slice(0,4),m=+v.slice(5,7),d=+v.slice(8,10);
 if(m<1||m>12||d<1)return false;
 const max=m===2?((y%4===0&&(y%100!==0||y%400===0))?29:28):(m===4||m===6||m===9||m===11?30:31);
 return d<=max;
}
function timestamp(v){
 if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v))return false;
 if(!date(v.slice(0,10)))return false;
 const hh=+v.slice(11,13),mm=+v.slice(14,16),ss=+v.slice(17,19);
 return hh<=23&&mm<=59&&ss<=59;
}
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
const MAX_SAFE_BIG=BigInt(Number.MAX_SAFE_INTEGER);
function addSafeBig(acc,currency,amount){
 const next=acc[currency]+BigInt(amount);
 if(next>MAX_SAFE_BIG)fail('Monetary total exceeds safe range.');
 acc[currency]=next;
}
const zeroCurrencyBig=()=>({BDT:0n,USD:0n,EUR:0n,GBP:0n});
function validate(state){
 if(!object(state))fail('Invalid workspace.');
 for(const k of BASE)if(!Array.isArray(state[k]))fail('Invalid base workspace records.');
 if(own(state,'operations')&&!object(state.operations))fail('Invalid operations data.');
 const ops=state.operations||{};
 for(const k of Object.keys(ops))if(!COLLECTIONS.includes(k))fail('Unsupported operations collection: '+k+'.');
 for(const k of COLLECTIONS)if(own(ops,k)&&(!Array.isArray(ops[k])||ops[k].length>5000))fail('Invalid '+k+' records.');
 const ids=new Set();
 for(const k of BASE){
  const list=state[k];
  for(let i=0;i<list.length;i++){const r=list[i];if(!object(r)||!id(r.id)||ids.has(r.id))fail('Invalid or duplicate record ID.');ids.add(r.id);}
 }
 for(const k of COLLECTIONS){
  const list=ops[k]||[];
  for(let i=0;i<list.length;i++){const r=list[i];if(!object(r)||!id(r.id)||ids.has(r.id))fail('Invalid or duplicate record ID.');ids.add(r.id);}
 }
 const map=k=>{const m=new Map(),list=BASE.includes(k)?state[k]:(ops[k]||[]);for(let i=0;i<list.length;i++)m.set(list[i].id,list[i]);return m;};
 const projects=map('projects'),clients=map('clients'),tasks=map('tasks'),changes=map('changes'),teams=map('team'),sprints=map('sprints'),opportunities=map('opportunities');
 const project=(r,label)=>{if(!projects.has(r.projectId))fail('Invalid '+label+' project reference.');};
 const ref=(v,m,label)=>{if(!absent(v)&&!m.has(v))fail('Invalid '+label+' reference.');};
 const projectRef=(r,v,m,label)=>{ref(v,m,label);if(!absent(v)&&m.get(v).projectId!==r.projectId)fail('Cross-project '+label+' reference.');};
 const monetary=(r,label)=>{if(!CURRENCIES.includes(r.currency))fail('Invalid '+label+' currency.');};
 const estSums=zeroCurrencyBig(),invSums=zeroCurrencyBig(),propSums=zeroCurrencyBig(),oppSums=zeroCurrencyBig(),planSums=zeroCurrencyBig(),budgetSums=zeroCurrencyBig(),actLaborSums=zeroCurrencyBig(),actExpSums=zeroCurrencyBig();
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
  if(r.costRateMinor!==undefined&&r.costRateMinor!==null)addSafeBig(actLaborSums,r.costCurrency,minuteCost(r.durationMinutes,r.costRateMinor));
 }
 for(const r of ops.estimates||[]){
  project(r,'estimate');monetary(r,'estimate');
  if(!required(r.name)||!decimal(r.hours)||!integer(r.rateMinor,1000000000000)||!['Draft','Proposed','Accepted'].includes(r.status)||!string(r.notes)||!timestamp(r.createdAt))fail('Invalid estimate record.');
  addSafeBig(estSums,r.currency,estimateTotal(r));
 }
 for(const r of ops.invoices||[]){
  project(r,'invoice');monetary(r,'invoice');
  if(!required(r.number,100)||r.status!=='Draft'||!date(r.issuedDate)||!date(r.dueDate,true)||(r.dueDate&&r.dueDate<r.issuedDate)||!string(r.notes)||!timestamp(r.createdAt))fail('Invalid invoice draft.');
  addSafeBig(invSums,r.currency,invoiceTotal(r));
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
  addSafeBig(oppSums,r.currency,r.valueMinor);
 }
 for(const r of ops.proposals||[]){
  clientProject(r,'proposal');monetary(r,'proposal');ref(r.opportunityId,opportunities,'proposal opportunity');
  if(!absent(r.opportunityId)){
   const opportunity=opportunities.get(r.opportunityId);
   if(opportunity.clientId!==r.clientId||(!absent(r.projectId)&&!absent(opportunity.projectId)&&opportunity.projectId!==r.projectId))fail('Mismatched proposal opportunity reference.');
  }
  if(!required(r.title)||!string(r.scope)||!['Draft','Sent','Accepted','Declined'].includes(r.status)||!date(r.validUntil,true)||!string(r.notes)||!timestamp(r.createdAt))fail('Invalid proposal record.');
  addSafeBig(propSums,r.currency,proposalTotal(r));
 }
 const plannedProjects=new Set();
 for(const r of ops.costPlans||[]){
  project(r,'cost plan');monetary(r,'cost plan');
  if(plannedProjects.has(r.projectId))fail('Only one cost plan is allowed per project.');
  plannedProjects.add(r.projectId);
  if(!required(r.name)||!string(r.notes)||!timestamp(r.createdAt)||(own(r,'budgetMinor')&&r.budgetMinor!==null&&!integer(r.budgetMinor)))fail('Invalid cost plan record or internal budget.');
  const parts=costPlanParts(r);
  addSafeBig(planSums,r.currency,parts.knownMinor);
  if(r.budgetMinor!==undefined&&r.budgetMinor!==null)addSafeBig(budgetSums,r.currency,r.budgetMinor);
  for(const line of r.laborLines){projectRef(r,line.taskId,tasks,'cost plan task');ref(line.teamId,teams,'cost plan team');}
 }
 for(const r of ops.expenses||[]){
  project(r,'expense');monetary(r,'expense');
  if(!required(r.description,1000)||!['Hosting','Software','Contractor','Travel','Other'].includes(r.category)||!date(r.date)||!integer(r.amountMinor)||!string(r.notes))fail('Invalid actual expense record.');
  addSafeBig(actExpSums,r.currency,r.amountMinor);
 }
 for(const c of CURRENCIES){
  if(actLaborSums[c]+actExpSums[c]>MAX_SAFE_BIG)fail('Monetary total exceeds safe range.');
 }
 return state;
}
function multiplyMinor(qty,rateMinor){
 if(!decimal(qty)||!integer(rateMinor,1000000000000))fail('Invalid quantity or monetary rate.');
 const milli=Math.round(qty*1000);
 if(milli*rateMinor<=9000000000000000)return Math.floor((milli*rateMinor+500)/1000);
 const rounded=(BigInt(milli)*BigInt(rateMinor)+500n)/1000n;
 if(rounded>MAX_SAFE_BIG)fail('Monetary amount exceeds safe range.');
 return Number(rounded);
}
function sumMinor(values){
 let total=0n;
 for(const value of values){if(!integer(value))fail('Invalid monetary amount.');total+=BigInt(value);}
 if(total>MAX_SAFE_BIG)fail('Monetary total exceeds safe range.');
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
function groupBy(list,keyFn){
 const m=new Map();
 for(let i=0;i<list.length;i++){
  const item=list[i],k=keyFn(item);
  if(absent(k))continue;
  let arr=m.get(k);if(!arr){arr=[];m.set(k,arr);}
  arr.push(item);
 }
 return m;
}
function summarize(state,options={}){
 validate(state);
 const reportDate=options.today||today(options.timeZone||'Asia/Dhaka');if(!date(reportDate))fail('Invalid report date.');
 const currency=CURRENCIES.includes(state.settings?.currency)?state.settings.currency:'BDT',get=k=>records(state,k);
 const tasks=state.tasks,sprints=get('sprints'),milestones=get('milestones'),issues=get('issues'),team=get('team'),timeEntries=get('timeEntries'),estimates=get('estimates'),invoices=get('invoices'),proposals=get('proposals'),opportunities=get('opportunities');
 const curMap=new Map(CURRENCIES.map(c=>[c,{currency:c,estimatedMinor:0n,acceptedEstimateMinor:0n,invoiceMinor:0n,proposalMinor:0n,pipelineMinor:0n}]));
 let totalEstimatedHours=0;
 for(let i=0;i<estimates.length;i++){
  const r=estimates[i],tot=BigInt(estimateTotal(r)),b=curMap.get(r.currency);
  totalEstimatedHours+=r.hours;
  b.estimatedMinor+=tot;
  if(r.status==='Accepted')b.acceptedEstimateMinor+=tot;
 }
 for(let i=0;i<invoices.length;i++){const r=invoices[i];curMap.get(r.currency).invoiceMinor+=BigInt(invoiceTotal(r));}
 for(let i=0;i<proposals.length;i++){const r=proposals[i];if(r.status!=='Declined')curMap.get(r.currency).proposalMinor+=BigInt(proposalTotal(r));}
 for(let i=0;i<opportunities.length;i++){const r=opportunities[i];if(r.stage!=='Won'&&r.stage!=='Lost')curMap.get(r.currency).pipelineMinor+=BigInt(r.valueMinor);}
 const byCurrency=CURRENCIES.map(c=>{
  const b=curMap.get(c);
  for(const k of ['estimatedMinor','acceptedEstimateMinor','invoiceMinor','proposalMinor','pipelineMinor'])if(b[k]>MAX_SAFE_BIG)fail('Monetary total exceeds safe range.');
  return {currency:c,estimatedMinor:Number(b.estimatedMinor),acceptedEstimateMinor:Number(b.acceptedEstimateMinor),invoiceMinor:Number(b.invoiceMinor),proposalMinor:Number(b.proposalMinor),pipelineMinor:Number(b.pipelineMinor)};
 });
 const selectedCurrencyTotals=byCurrency.find(c=>c.currency===currency);
 let doneTasksTotal=0,activeSprintsTotal=0,overdueMilestonesTotal=0,openIssuesTotal=0,criticalIssuesTotal=0,activeTeamTotal=0,loggedMinutesTotal=0;
 for(let i=0;i<tasks.length;i++)if(tasks[i].status==='Done')doneTasksTotal++;
 for(let i=0;i<sprints.length;i++)if(sprints[i].status==='Active')activeSprintsTotal++;
 for(let i=0;i<milestones.length;i++)if(milestones[i].status!=='Reached'&&milestones[i].due&&milestones[i].due<reportDate)overdueMilestonesTotal++;
 for(let i=0;i<issues.length;i++)if(issues[i].status!=='Resolved'){openIssuesTotal++;if(issues[i].severity==='Critical')criticalIssuesTotal++;}
 for(let i=0;i<team.length;i++)if(team[i].active)activeTeamTotal++;
 for(let i=0;i<timeEntries.length;i++)loggedMinutesTotal+=timeEntries[i].durationMinutes;
 const summary={
  projectCount:state.projects.length,clientCount:state.clients.length,taskCount:tasks.length,
  doneTasks:doneTasksTotal,openTasks:tasks.length-doneTasksTotal,
  activeSprints:activeSprintsTotal,overdueMilestones:overdueMilestonesTotal,
  openIssues:openIssuesTotal,criticalIssues:criticalIssuesTotal,
  teamCount:activeTeamTotal,loggedMinutes:loggedMinutesTotal,
  estimatedHours:hours(totalEstimatedHours),
  ...selectedCurrencyTotals,byCurrency,
  completionPercent:tasks.length?Math.round(100*doneTasksTotal/tasks.length):0,
  byProject:[],byTeam:[],alerts:[]
 };
 const tasksByProject=groupBy(tasks,t=>t.projectId),esByProject=groupBy(estimates,r=>r.projectId),msByProject=groupBy(milestones,r=>r.projectId),issuesByProject=groupBy(issues,r=>r.projectId),timeByProject=groupBy(timeEntries,r=>r.projectId),invByProject=groupBy(invoices,r=>r.projectId),sprintsByProject=groupBy(sprints,r=>r.projectId);
 const tasksByAssignee=groupBy(tasks,t=>t.assigneeId),timeByTeam=groupBy(timeEntries,t=>t.teamId);
 const alert=(type,projectId,title,detail)=>summary.alerts.push({id:'alert-'+summary.alerts.length,type,projectId,title,detail});
 const hasTeam=team.length>0;
 for(let i=0;i<state.projects.length;i++){
  const p=state.projects[i],pid=p.id;
  const ts=tasksByProject.get(pid)||[],es=esByProject.get(pid)||[],ms=msByProject.get(pid)||[],pIssues=issuesByProject.get(pid)||[],pTime=timeByProject.get(pid)||[],pInv=invByProject.get(pid)||[],pSprints=sprintsByProject.get(pid)||[];
  let pDone=0,pPlannedHrs=0,pRemHrs=0,pUnassigned=0;
  for(let j=0;j<ts.length;j++){
   const t=ts[j],eh=t.estimatedHours||0;pPlannedHrs+=eh;
   if(t.status==='Done')pDone++;
   else{pRemHrs+=eh;if(absent(t.assigneeId))pUnassigned++;}
  }
  let pAcceptedHrs=0,pEstMinor=0n,pAccEstMinor=0n;
  for(let j=0;j<es.length;j++){
   const e=es[j], matchesCur=e.currency===currency, tot=matchesCur?BigInt(estimateTotal(e)):0n;
   if(matchesCur)pEstMinor+=tot;
   if(e.status==='Accepted'){pAcceptedHrs+=e.hours;if(matchesCur)pAccEstMinor+=tot;}
  }
  let pLoggedMin=0;for(let j=0;j<pTime.length;j++)pLoggedMin+=pTime[j].durationMinutes;
  let pInvMinor=0n;for(let j=0;j<pInv.length;j++)if(pInv[j].currency===currency)pInvMinor+=BigInt(invoiceTotal(pInv[j]));
  let pOpenIssues=0,pCritIssues=0;for(let j=0;j<pIssues.length;j++)if(pIssues[j].status!=='Resolved'){pOpenIssues++;if(pIssues[j].severity==='Critical')pCritIssues++;}
  let pOverdueMs=0;for(let j=0;j<ms.length;j++)if(ms[j].status!=='Reached'&&ms[j].due&&ms[j].due<reportDate)pOverdueMs++;
  let pActiveSprints=0;for(let j=0;j<pSprints.length;j++)if(pSprints[j].status==='Active')pActiveSprints++;
  const row={
   projectId:pid,currency,taskCount:ts.length,doneTasks:pDone,openTasks:ts.length-pDone,
   plannedHours:hours(pPlannedHrs),remainingHours:hours(pRemHrs),
   acceptedHours:hours(pAcceptedHrs),loggedMinutes:pLoggedMin,
   estimatedMinor:Number(pEstMinor),acceptedEstimateMinor:Number(pAccEstMinor),invoiceMinor:Number(pInvMinor),
   openIssues:pOpenIssues,criticalIssues:pCritIssues,overdueMilestones:pOverdueMs,
   unassignedTasks:pUnassigned,activeSprints:pActiveSprints,
   completionPercent:ts.length?Math.round(100*pDone/ts.length):0
  };
  summary.byProject.push(row);
  if(row.overdueMilestones)alert('warning',pid,'Milestone overdue',row.overdueMilestones+' unfinished milestone(s) passed their due date.');
  if(row.criticalIssues)alert('warning',pid,'Critical issues need triage',row.criticalIssues+' unresolved critical issue(s).');
  if(row.acceptedHours>0&&row.plannedHours>row.acceptedHours)alert('warning',pid,'Planned hours exceed accepted estimate',row.plannedHours+' planned hours against '+row.acceptedHours+' accepted hours.');
  if(row.acceptedHours>0&&row.loggedMinutes/60>row.acceptedHours)alert('warning',pid,'Logged time exceeds accepted estimate',hours(row.loggedMinutes/60)+' logged hours against '+row.acceptedHours+' accepted hours.');
  if(row.unassignedTasks&&hasTeam)alert('info',pid,'Assign remaining work',row.unassignedTasks+' open task(s) have no assigned person.');
  if(row.acceptedEstimateMinor>0&&row.invoiceMinor>row.acceptedEstimateMinor)alert('warning',pid,'Invoice drafts exceed accepted estimate','Draft invoice totals in '+currency+' exceed accepted estimates; review scope and billing.');
 }
 for(let i=0;i<team.length;i++){
  const person=team[i],ts=tasksByAssignee.get(person.id)||[],pTime=timeByTeam.get(person.id)||[];
  let openCount=0,estHrs=0,loggedMin=0;
  for(let j=0;j<ts.length;j++)if(ts[j].status!=='Done'){openCount++;estHrs+=ts[j].estimatedHours||0;}
  for(let j=0;j<pTime.length;j++)loggedMin+=pTime[j].durationMinutes;
  const row={teamId:person.id,assignedTasks:ts.length,openTasks:openCount,estimatedHours:hours(estHrs),capacityHours:person.capacityHours,loggedMinutes:loggedMin};
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
 return Math.floor((durationMinutes*rateMinor+30)/60);
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
 const acc=new Map(CURRENCIES.map(c=>[c,{labor:0n,expense:0n,pricedMinutes:0,entryCount:0,expenseCount:0}]));
 const times=records(state,'timeEntries'),expenses=records(state,'expenses');
 for(let i=0;i<times.length;i++){
  const r=times[i];
  if(r.costRateMinor!==undefined&&r.costRateMinor!==null&&acc.has(r.costCurrency)){
   const b=acc.get(r.costCurrency);
   b.labor+=BigInt(minuteCost(r.durationMinutes,r.costRateMinor));
   if(b.labor>MAX_SAFE_BIG)fail('Monetary total exceeds safe range.');
   b.pricedMinutes+=r.durationMinutes;b.entryCount++;
  }
 }
 for(let i=0;i<expenses.length;i++){
  const r=expenses[i];
  if(acc.has(r.currency)){
   const b=acc.get(r.currency);
   b.expense+=BigInt(r.amountMinor);
   if(b.expense>MAX_SAFE_BIG)fail('Monetary total exceeds safe range.');
   b.expenseCount++;
  }
 }
 return CURRENCIES.map(currency=>{
  const b=acc.get(currency),known=b.labor+b.expense;
  if(known>MAX_SAFE_BIG)fail('Monetary total exceeds safe range.');
  return {currency,laborMinor:Number(b.labor),expenseMinor:Number(b.expense),knownMinor:Number(known),pricedMinutes:b.pricedMinutes,entryCount:b.entryCount,expenseCount:b.expenseCount};
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
function projectInsights(state,options={}){
 const summary=summarize(state,options);
 const plansByProject=new Map(records(state,'costPlans').map(p=>[p.projectId,p]));
 const timesByProject=groupBy(records(state,'timeEntries'),r=>r.projectId);
 const expensesByProject=groupBy(records(state,'expenses'),r=>r.projectId);
 const estimatesByProject=groupBy(records(state,'estimates'),r=>r.projectId);
 const invoicesByProject=groupBy(records(state,'invoices'),r=>r.projectId);
 return summary.byProject.map(row=>{
  const pid=row.projectId,plan=plansByProject.get(pid)||null,planCur=plan?.currency||row.currency;
  const times=timesByProject.get(pid)||[],expenses=expensesByProject.get(pid)||[],es=estimatesByProject.get(pid)||[],invs=invoicesByProject.get(pid)||[];
  let actualLabor=0n,actualExp=0n,unpricedEntries=0,foreignEntries=0;
  for(let i=0;i<times.length;i++){
   const t=times[i];
   if(t.costRateMinor===undefined||t.costRateMinor===null)unpricedEntries++;
   else if(t.costCurrency===planCur)actualLabor+=BigInt(minuteCost(t.durationMinutes,t.costRateMinor));
   else foreignEntries++;
  }
  for(let i=0;i<expenses.length;i++){
   const e=expenses[i];
   if(e.currency===planCur)actualExp+=BigInt(e.amountMinor);
   else foreignEntries++;
  }
  let acceptedEst=0n,invoiced=0n;
  for(let i=0;i<es.length;i++)if(es[i].status==='Accepted'&&es[i].currency===planCur)acceptedEst+=BigInt(estimateTotal(es[i]));
  for(let i=0;i<invs.length;i++)if(invs[i].currency===planCur)invoiced+=BigInt(invoiceTotal(invs[i]));
  const actualCostMinor=Number(actualLabor+actualExp),acceptedEstimateMinor=Number(acceptedEst),invoiceMinor=Number(invoiced);
  const actualComplete=Boolean(plan&&unpricedEntries===0&&foreignEntries===0);
  const plannedParts=plan?costPlanParts(plan):null;
  const plannedCostMinor=plannedParts?plannedParts.knownMinor:null;
  const budgetMinor=plan?.budgetMinor??null;
  const marginMinor=acceptedEstimateMinor>0&&actualComplete?acceptedEstimateMinor-actualCostMinor:null;
  const marginPercent=marginMinor!==null&&acceptedEstimateMinor>0?Math.round(100*marginMinor/acceptedEstimateMinor):null;
  const loggedHours=hours(row.loggedMinutes/60);
  const hourBurnPercent=row.acceptedHours>0?Math.round(100*loggedHours/row.acceptedHours):(row.plannedHours>0?Math.round(100*loggedHours/row.plannedHours):null);
  const reasons=[];
  if(row.criticalIssues>0)reasons.push(row.criticalIssues+' critical issue(s)');
  if(row.overdueMilestones>0)reasons.push(row.overdueMilestones+' overdue milestone(s)');
  if(budgetMinor!==null&&actualComplete&&actualCostMinor>budgetMinor)reasons.push('Internal budget exceeded');
  if(marginMinor!==null&&marginMinor<0)reasons.push('Negative delivery margin');
  if(hourBurnPercent!==null&&hourBurnPercent>100)reasons.push('Hours exceed baseline ('+hourBurnPercent+'%)');
  const healthStatus=(row.criticalIssues>0||(budgetMinor!==null&&actualComplete&&actualCostMinor>budgetMinor)||(marginMinor!==null&&marginMinor<0))?'Critical':(reasons.length>0||(marginPercent!==null&&marginPercent<20))?'At risk':'Healthy';
  return {
   projectId:pid,currency:planCur,hasCostPlan:Boolean(plan),actualComplete,
   acceptedEstimateMinor,invoiceMinor,plannedCostMinor,actualCostMinor,budgetMinor,
   marginMinor,marginPercent,plannedHours:row.plannedHours,acceptedHours:row.acceptedHours,loggedHours,hourBurnPercent,burnPercent:hourBurnPercent,healthStatus,health:healthStatus,reasons
  };
 });
}
const markdown=s=>String(s).replace(/[\\*_{}\[\]()#+.!|]/g,'\\$&').replace(/\x60/g,'\\\x60').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\r?\n/g,' ');
function exportProject(state,projectId,options={}){
 const summary=summarize(state,options),p=state.projects.find(p=>p.id===projectId);if(!p)fail('Unknown project.');
 const row=summary.byProject.find(r=>r.projectId===projectId),lines=['# '+markdown(p.name),'','Workspace: '+markdown(state.settings.name),'Source: current saved agency workspace records. Approvals and proposal statuses reflect recorded decisions.','','## Delivery snapshot','Tasks: '+row.doneTasks+'/'+row.taskCount+' completed','Planned hours: '+row.plannedHours+' | Logged hours: '+hours(row.loggedMinutes/60),'Open issues: '+row.openIssues+' | Overdue milestones: '+row.overdueMilestones,''];
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
const api={COLLECTIONS,CURRENCIES,uid,stamp,emptyOperations,normalize,validate,summarize,projectInsights,today,formatMinor,multiplyMinor,sumMinor,lineTotal,invoiceTotal,proposalTotal,estimateTotal,minuteCost,costPlanTotal,costing,exportProject};
if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.Ops=api;
})(globalThis);
