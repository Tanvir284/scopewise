'use strict';
const assert=require('node:assert/strict');
const W=require('../public/workspace-data.js'),Ops=require('../public/operations-data.js');
const clone=x=>JSON.parse(JSON.stringify(x)),at='2026-10-08T06:00:00.000Z';
let count=0;
function check(label,fn){fn();count++;console.log('PASS '+label);}
const base=()=>Ops.normalize(W.sample());
const expense=(id='expense-1',currency='BDT',amountMinor=30000)=>({id,projectId:'project-1',description:'Hosting bill',category:'Hosting',date:'2026-10-08',amountMinor,currency,notes:''});
const time=(id,minutes,rate,currency='BDT')=>({id,projectId:'project-1',taskId:'task-1',teamId:'person-1',date:'2026-10-08',durationMinutes:minutes,note:'Recorded work',...(rate===undefined?{}:{costRateMinor:rate,costCurrency:rate===null?null:currency})});
const plan=()=>({id:'cost-plan-1',projectId:'project-1',name:'Internal delivery costs',currency:'BDT',budgetMinor:100000,laborLines:[{description:'Implementation',hours:2,rateMinor:120000,taskId:'task-1',teamId:'person-1'}],expenseLines:[{description:'Planned hosting',amountMinor:50000}],notes:'Internal costs, independent of selling price.',createdAt:at});
function fixture(){
 const s=base();
 s.operations.team.push({id:'person-1',name:'Developer',role:'Engineer',email:'dev@example.com',capacityHours:20,active:true,costRateMinor:999999,costCurrency:'EUR'});
 s.operations.costPlans.push(plan());
 s.operations.timeEntries.push(time('time-bdt',30,120000),time('time-usd',30,10000,'USD'),time('time-unpriced',60,undefined),time('time-zero',15,0));
 s.operations.expenses.push(expense(),expense('expense-usd','USD',1000));
 return s;
}
function bad(mutate,expected){const s=fixture();mutate(s);assert.throws(()=>Ops.validate(s),expected);}
function completeFixture(){
 const s=fixture();s.operations.timeEntries=s.operations.timeEntries.filter(r=>!['time-usd','time-unpriced'].includes(r.id));s.operations.expenses=s.operations.expenses.filter(r=>r.currency==='BDT');return s;
}
check('Legacy migration adds only empty costing arrays and preserves all original records and absent rates',()=>{
 const s=W.sample(),before=clone(s),tasks=s.tasks;
 Ops.validate(s);Ops.normalize(s);
 assert.equal(Ops.COLLECTIONS.length,12);assert.equal(s.version,1);assert.equal(s.tasks,tasks);
 const {operations,...old}=s;assert.deepEqual(old,before);assert.deepEqual(operations.costPlans,[]);assert.deepEqual(operations.expenses,[]);
 assert.equal(Object.hasOwn(s.tasks[0],'costRateMinor'),false);
});
check('Older operations normalization retains array identities, records and explicit zero snapshots',()=>{
 const s=fixture(),ops=s.operations,entry=s.operations.timeEntries[3],times=ops.timeEntries;
 delete ops.costPlans;delete ops.expenses;const before=clone(s);
 Ops.normalize(s);assert.equal(s.operations,ops);assert.equal(ops.timeEntries,times);assert.equal(ops.timeEntries[3],entry);
 assert.equal(entry.costRateMinor,0);assert.deepEqual(ops.costPlans,[]);assert.deepEqual(ops.expenses,[]);
 const {costPlans,expenses,...old}=ops;assert.deepEqual(old,before.operations);
});
check('Connected costing records validate through base model and round trip unchanged',()=>{
 const s=fixture();assert.equal(W.validate(s),s);assert.equal(Ops.validate(s),s);assert.deepEqual(Ops.validate(clone(s)),s);
});
check('Costing records participate in globally unique and safe IDs',()=>{
 bad(s=>s.operations.expenses[0].id='cost-plan-1',/record ID/);
 bad(s=>s.operations.costPlans[0].id='task-1',/record ID/);
 for(const value of ['bad/path','bad#id','',null])bad(s=>s.operations.expenses[0].id=value,/record ID/);
});
check('A project has at most one internal cost plan while other projects may have their own',()=>{
 bad(s=>s.operations.costPlans.push({...plan(),id:'cost-plan-2'}),/one cost plan/);
 const s=fixture(),other={...plan(),id:'cost-plan-2',projectId:'project-2',laborLines:[],expenseLines:[]};
 s.operations.costPlans.push(other);Ops.validate(s);
});
check('Costing project/task/team references reject missing and cross-project records',()=>{
 bad(s=>s.operations.costPlans[0].projectId='missing',/cost plan project/);
 bad(s=>s.operations.expenses[0].projectId='missing',/expense project/);
 bad(s=>s.operations.costPlans[0].laborLines[0].taskId='task-3',/Cross-project/);
 bad(s=>s.operations.costPlans[0].laborLines[0].taskId='missing',/cost plan task/);
 bad(s=>s.operations.costPlans[0].laborLines[0].teamId='missing',/cost plan team/);
 const s=fixture();delete s.operations.costPlans[0].laborLines[0].teamId;s.operations.costPlans[0].laborLines[0].taskId=null;Ops.validate(s);
});
check('Cost snapshot pairs are explicit, finite, bounded, nullable and accept a real zero rate',()=>{
 for(const collection of ['team','timeEntries']){
  bad(s=>delete s.operations[collection][0].costCurrency,/both/);
  bad(s=>delete s.operations[collection][0].costRateMinor,/both/);
  for(const rate of [-1,0.5,NaN,Infinity,'100',1000000000001,undefined,null])bad(s=>s.operations[collection][0].costRateMinor=rate,/cost rate/);
  for(const currency of ['XYZ','',null,undefined])bad(s=>s.operations[collection][0].costCurrency=currency,/currency/);
  const s=fixture();s.operations[collection][0].costRateMinor=null;s.operations[collection][0].costCurrency=null;Ops.validate(s);
  delete s.operations[collection][0].costRateMinor;delete s.operations[collection][0].costCurrency;Ops.validate(s);
 }
 const s=fixture();s.operations.team[0].costRateMinor=0;s.operations.team[0].costCurrency='BDT';Ops.validate(s);
});
check('Plan amounts, hours, text, timestamp, line arrays and rates are validated without coercion',()=>{
 for(const value of [-1,0.5,NaN,Infinity,'5',Number.MAX_SAFE_INTEGER+1])bad(s=>s.operations.costPlans[0].budgetMinor=value,/budget/);
 for(const value of [-1,NaN,Infinity,'2',1000001,0.0001])bad(s=>s.operations.costPlans[0].laborLines[0].hours=value,/labor line/);
 for(const value of [-1,0.5,NaN,Infinity,undefined,'1',1000000000001])bad(s=>s.operations.costPlans[0].laborLines[0].rateMinor=value,/labor line/);
 bad(s=>s.operations.costPlans[0].name='x'.repeat(151),/cost plan record/);
 bad(s=>s.operations.costPlans[0].name='  ',/cost plan record/);
 bad(s=>s.operations.costPlans[0].notes='x'.repeat(24001),/cost plan record/);
 bad(s=>s.operations.costPlans[0].createdAt='2026-02-30T06:00:00.000Z',/cost plan record/);
 bad(s=>s.operations.costPlans[0].laborLines[0].description='x'.repeat(1001),/labor line/);
 bad(s=>s.operations.costPlans[0].expenseLines[0].description='',/expense line/);
 bad(s=>s.operations.costPlans[0].expenseLines=null,/line arrays/);
 const s=fixture();s.operations.costPlans[0].laborLines[0].hours=0;s.operations.costPlans[0].laborLines[0].rateMinor=0;Ops.validate(s);
});
check('Actual expense category, calendar date, explicit currency, amount and text bounds are validated',()=>{
 for(const value of ['2026-02-29','2026-04-31','08/10/2026','',null])bad(s=>s.operations.expenses[0].date=value,/actual expense/);
 for(const value of [-1,0.5,NaN,Infinity,'1',Number.MAX_SAFE_INTEGER+1])bad(s=>s.operations.expenses[0].amountMinor=value,/actual expense/);
 bad(s=>s.operations.expenses[0].category='Payroll',/actual expense/);
 bad(s=>delete s.operations.expenses[0].currency,/expense currency/);
 bad(s=>s.operations.expenses[0].description='x'.repeat(1001),/actual expense/);
 bad(s=>s.operations.expenses[0].notes='x'.repeat(24001),/actual expense/);
 const s=fixture();s.operations.expenses[0].amountMinor=0;s.operations.expenses[0].date='2024-02-29';Ops.validate(s);
});
check('Line and collection bounds hold and empty plans stay legitimate empty records',()=>{
 for(const key of ['laborLines','expenseLines'])bad(s=>s.operations.costPlans[0][key]=Array.from({length:101},()=>({description:'x',hours:0,rateMinor:0,amountMinor:0})),/line arrays/);
 bad(s=>s.operations.expenses=Array.from({length:5001},(_,i)=>expense('expense-'+i,'BDT',0)),/expense/);
 const s=base();s.operations.costPlans.push({...plan(),laborLines:[],expenseLines:[]});Ops.validate(s);
 const report=Ops.costing(s,'project-1');assert.equal(report.plannedKnownMinor,0);assert.equal(report.plannedComplete,true);assert.equal(report.actualKnownMinor,0);assert.equal(report.budgetRemainingMinor,100000);
});
check('Recorded minutes round half-up exactly per entry rather than through rounded decimal hours',()=>{
 assert.equal(Ops.minuteCost(1,30),1);assert.equal(Ops.minuteCost(1,29),0);assert.equal(Ops.minuteCost(3,10),1);
 assert.equal(Ops.minuteCost(1,60000),1000);assert.equal(Ops.multiplyMinor(0.017,60000),1020);
 assert.equal(Ops.minuteCost(0,0),0);assert.equal(Ops.minuteCost(1440,1000000000000),24000000000000);
 for(const value of [-1,0.5,1441,Infinity,'1'])assert.throws(()=>Ops.minuteCost(value,30),/cost minutes/);
 const s=base();s.operations.costPlans.push({...plan(),laborLines:[],expenseLines:[]});s.operations.timeEntries.push({...time('tiny-1',1,30),teamId:null},{...time('tiny-2',1,30),teamId:null});
 assert.equal(Ops.costing(s,'project-1').actualLaborMinor,2);assert.equal(Ops.minuteCost(2,30),1);
});
check('Planned decimal labor rounds per line and treats null rates separately from explicit zero',()=>{
 const p={laborLines:[{description:'a',hours:0.005,rateMinor:100},{description:'b',hours:0.005,rateMinor:100},{description:'unset',hours:2,rateMinor:null},{description:'zero',hours:10,rateMinor:0}],expenseLines:[{description:'c',amountMinor:1}]};
 assert.equal(Ops.costPlanTotal(p),3);assert.equal(Ops.multiplyMinor(0.01,100),1);
 const s=fixture();s.operations.costPlans[0].laborLines=p.laborLines;
 const report=Ops.costing(s,'project-1');assert.equal(report.plannedLaborMinor,2);assert.equal(report.plannedUnpricedHours,2);assert.equal(report.plannedUnpricedLineCount,1);assert.equal(report.plannedComplete,false);
});
check('Known actual totals and row reasons expose unpriced and foreign records accurately',()=>{
 const r=Ops.costing(fixture(),'project-1');
 assert.equal(r.plannedKnownMinor,290000);assert.equal(r.plannedLaborMinor,240000);assert.equal(r.plannedExpensesMinor,50000);
 assert.equal(r.actualLaborMinor,60000);assert.equal(r.actualExpensesMinor,30000);assert.equal(r.actualKnownMinor,90000);
 assert.equal(r.totalMinutes,135);assert.equal(r.pricedMinutes,75);assert.equal(r.includedMinutes,45);assert.equal(r.unpricedMinutes,60);assert.equal(r.unpricedEntryCount,1);assert.equal(r.foreignMinutes,30);assert.equal(r.foreignEntryCount,1);assert.equal(r.foreignExpenseCount,1);
 assert.equal(r.actualComplete,false);assert.equal(r.budgetRemainingMinor,null);assert.equal(r.budgetVarianceMinor,null);assert.equal(r.planVarianceMinor,null);
 assert.equal(r.timeRows.find(x=>x.entryId==='time-zero').included,true);assert.equal(r.timeRows.find(x=>x.entryId==='time-zero').amountMinor,0);
 assert.equal(r.timeRows.find(x=>x.entryId==='time-unpriced').reason,'unpriced');assert.equal(r.timeRows.find(x=>x.entryId==='time-usd').reason,'foreign-currency');
 assert.equal(r.byCurrency.find(x=>x.currency==='USD').knownMinor,6000);assert.equal(r.byCurrency.find(x=>x.currency==='BDT').knownMinor,90000);
});
check('Changing a current team rate never changes recorded time snapshots or historical cost',()=>{
 const s=fixture(),before=Ops.costing(s,'project-1'),entries=clone(s.operations.timeEntries);
 s.operations.team[0].costRateMinor=1;s.operations.team[0].costCurrency='GBP';
 assert.deepEqual(Ops.costing(s,'project-1'),before);assert.deepEqual(s.operations.timeEntries,entries);
});
check('Selling estimates and task estimates never implicitly become internal costs or recorded rates',()=>{
 const s=fixture(),before=Ops.costing(s,'project-1');
 s.operations.estimates.push({id:'sale-estimate',projectId:'project-1',name:'Selling price',hours:90,rateMinor:500000,status:'Accepted',notes:'',currency:'BDT',createdAt:at});
 s.tasks[0].estimatedHours=10000;assert.deepEqual(Ops.costing(s,'project-1'),before);
 assert.equal(Ops.costing(s,'project-1').timeRows.find(r=>r.entryId==='time-unpriced').costRateMinor,null);
});
check('Complete actual costs compare independently against internal budget and planned cost',()=>{
 const s=completeFixture(),r=Ops.costing(s,'project-1');
 assert.equal(r.actualComplete,true);assert.equal(r.plannedComplete,true);assert.equal(r.actualKnownMinor,90000);
 assert.equal(r.budgetRemainingMinor,10000);assert.equal(r.budgetVarianceMinor,-10000);assert.equal(r.planVarianceMinor,-200000);
});
check('Overspend stays signed and zero budgets are not mistaken for unspecified ceilings',()=>{
 const s=completeFixture();s.operations.costPlans[0].budgetMinor=50000;
 let r=Ops.costing(s,'project-1');assert.equal(r.budgetRemainingMinor,-40000);assert.equal(r.budgetVarianceMinor,40000);
 s.operations.costPlans[0].budgetMinor=0;r=Ops.costing(s,'project-1');assert.equal(r.budgetMinor,0);assert.equal(r.budgetRemainingMinor,-90000);
});
check('Optional and null budgets remain unknown rather than inferred from plan or price',()=>{
 const s=completeFixture();delete s.operations.costPlans[0].budgetMinor;
 let r=Ops.costing(s,'project-1');assert.equal(r.budgetMinor,null);assert.equal(r.budgetRemainingMinor,null);assert.equal(r.budgetVarianceMinor,null);assert.equal(r.planVarianceMinor,-200000);
 s.operations.costPlans[0].budgetMinor=null;r=Ops.costing(s,'project-1');assert.equal(r.budgetRemainingMinor,null);
});
check('Incomplete planned rates suppress plan variance but do not suppress a complete actual budget comparison',()=>{
 const s=completeFixture();s.operations.costPlans[0].laborLines[0].rateMinor=null;
 const r=Ops.costing(s,'project-1');assert.equal(r.plannedComplete,false);assert.equal(r.plannedKnownMinor,50000);assert.equal(r.plannedUnpricedHours,2);assert.equal(r.planVarianceMinor,null);assert.equal(r.actualComplete,true);assert.equal(r.budgetRemainingMinor,10000);
});
check('Without a plan, actual costs remain per currency with no invented comparison currency or budget',()=>{
 const s=fixture();s.operations.costPlans=[];const r=Ops.costing(s,'project-1');
 assert.equal(r.planId,null);assert.equal(r.currency,null);assert.equal(r.actualKnownMinor,null);assert.equal(r.budgetRemainingMinor,null);assert.equal(r.actualComplete,false);assert.equal(r.foreignEntryCount,0);
 assert.equal(r.byCurrency.find(x=>x.currency==='BDT').knownMinor,90000);assert.equal(r.byCurrency.find(x=>x.currency==='USD').knownMinor,6000);
 assert.equal(r.timeRows.find(x=>x.entryId==='time-bdt').reason,'no-plan-currency');
 const empty=Ops.costing(base(),'project-1');assert(empty.byCurrency.every(x=>x.knownMinor===0));assert.equal(empty.totalMinutes,0);assert.deepEqual(empty.timeRows,[]);
});
check('Workspace currency does not relabel fixed costing records or mix project totals',()=>{
 const s=fixture(),before=Ops.costing(s,'project-1');s.settings.currency='USD';
 s.operations.expenses.push({...expense('other-project','BDT',1000),projectId:'project-2'});
 assert.deepEqual(Ops.costing(s,'project-1'),before);
});
check('Unsafe planned amounts and aggregate internal ceilings are rejected before persistence',()=>{
 bad(s=>{s.operations.costPlans[0].laborLines[0].hours=1000000;s.operations.costPlans[0].laborLines[0].rateMinor=1000000000000;},/safe range/);
 const s=base();s.operations.costPlans.push({...plan(),laborLines:[],expenseLines:[{description:'a',amountMinor:Number.MAX_SAFE_INTEGER}]},{...plan(),id:'cost-plan-2',projectId:'project-2',laborLines:[],expenseLines:[{description:'b',amountMinor:1}]});
 assert.throws(()=>Ops.validate(s),/safe range/);
 s.operations.costPlans.forEach(p=>p.expenseLines=[]);s.operations.costPlans[0].budgetMinor=Number.MAX_SAFE_INTEGER;s.operations.costPlans[1].budgetMinor=1;
 assert.throws(()=>Ops.validate(s),/safe range/);
});
check('Combined actual time and expense totals are safe across records and separate currencies',()=>{
 const s=base();s.operations.expenses.push(expense('max-bdt','BDT',Number.MAX_SAFE_INTEGER),expense('max-usd','USD',Number.MAX_SAFE_INTEGER));Ops.validate(s);
 s.operations.expenses.push(expense('extra-bdt','BDT',1));assert.throws(()=>Ops.validate(s),/safe range/);s.operations.expenses.pop();
 s.operations.timeEntries.push({...time('one-cent',1,60),teamId:null});assert.throws(()=>Ops.validate(s),/safe range/);
 const many=base();many.operations.timeEntries=Array.from({length:400},(_,i)=>({...time('time-'+i,1440,1000000000000),teamId:null}));
 assert.throws(()=>Ops.validate(many),/safe range/);
});
check('Cost reports are pure and unknown projects fail clearly',()=>{
 const s=fixture(),before=clone(s),times=s.operations.timeEntries,planRecord=s.operations.costPlans[0];Ops.costing(s,'project-1');
 assert.deepEqual(s,before);assert.equal(s.operations.timeEntries,times);assert.equal(s.operations.costPlans[0],planRecord);
 assert.throws(()=>Ops.costing(s,'missing'),/Unknown project/);
});
console.log('Completed '+count+' costing model checks.');
