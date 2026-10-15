'use strict';
// Exercise the actual UI functions with an in-memory DOM surface. Browser layout
// and native form behaviour are covered separately by manual acceptance tests.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const W=require('../public/workspace-data.js'),Ops=require('../public/operations-data.js');
const source=name=>fs.readFileSync(path.join(__dirname,'../public',name),'utf8');
class Element{
 constructor(tag,text){this.tagName=tag.toUpperCase();this.children=[];this.attributes={};this.value='';this._text=text==null?'':String(text);this.classList={add(){},toggle(){}};}
 append(...items){for(const item of items){if(item instanceof Element)item.parentElement=this;this.children.push(item);}}
 replaceChildren(...items){this.children=[];this.append(...items);}
 closest(){return this.parentElement;}
 click(){this.onclick?.();}
 set textContent(value){this._text=String(value);this.children=[];}
 get textContent(){return this._text+this.children.map(x=>x.textContent??String(x)).join('');}
 setAttribute(key,value){this.attributes[key]=String(value);}
 querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
 querySelectorAll(selector){const tags=selector.split(',').map(x=>x.toUpperCase());return this.children.flatMap(x=>x instanceof Element?[...(tags.includes(x.tagName)?[x]:[]),...x.querySelectorAll(selector)]:[]);}
}
function uiFixture(state=Ops.normalize(W.sample())){
 const selections=new Map(),fields=new Map(),buttons=[],notices=[],exports=[];let form;
 const E=(tag,text)=>new Element(tag,text),A=(p,...children)=>{children.flat().filter(Boolean).forEach(x=>p.append(x));return p;};
 const B=(text,fn)=>{const b=E('button',text);b.onclick=fn;buttons.push(b);return b;};
 const context={state,W,Ops,E,A,B,toast:text=>notices.push(text),render(){},nav(){},project:id=>state.projects.find(p=>p.id===id),titleProject:id=>state.projects.find(p=>p.id===id)?.name||'Workspace',
  field(label,id,value='',type='text'){const input=E(type==='textarea'?'textarea':Array.isArray(type)?'select':'input');input.value=String(value);fields.set(id,input);return A(E('div'),E('label',label),input);},
  val:id=>String(fields.get(id).value).trim(),required:id=>fields.get(id).required=true,modal(title,content,save){form={title,content,save};},select(options,value,change,label){const el=E('select');el.value=value;el.change=change;el.options=options;selections.set(label,el);return el;},
  head:(title,subtitle,actions=[])=>A(E('header'),E('h1',title),E('p',subtitle),actions),panel:(title,action)=>A(E('section'),E('h2',title),action),empty:(title,text,action)=>A(E('section'),E('h2',title),E('p',text),action),badge:text=>E('span',text)};
 const sandbox={Node:Element,document:{getElementById:id=>fields.get(id)},Blob:class{constructor(parts){this.text=parts.join('')}},URL:{createObjectURL(blob){exports.push(blob.text);return'blob:test';},revokeObjectURL(){}},setTimeout(){},Event:class{},console};
 vm.createContext(sandbox);vm.runInContext(source('operations-ui.js'),sandbox);
 return {state,context,sandbox,selections,fields,buttons,notices,exports,get form(){return form;},render(page){buttons.length=0;selections.clear();fields.clear();const main=E('main');sandbox.OpsUI.render(main,page,context);return main;}};
}
let count=0;async function check(name,fn){await fn();count++;console.log('PASS '+name);}
(async()=>{
 await check('a new authenticated workspace resets base filters and module views before loading',async()=>{
  const text=source('workspace.js'),start=text.indexOf('async function openAgency()'),end=text.indexOf("\nwindow.addEventListener('scopewise-auth-ready'",start);assert(start>=0&&end>start);
  const search={value:'old confidential query'},dialog={open:false},log=[];
  const sandbox={ScopewiseAuth:{user:()=>({id:'new-user',role:'owner',agency:{id:'new-agency',name:'Next agency'}}),token:()=> 'new-token'},openedSession:'old-token:old-agency:old-user:owner',identityVersion:7,modalSequence:9,filterProject:'old-project',filterStatus:'Done',taskView:'list',detailTab:'tasks',searchTerm:search.value,document:{getElementById:id=>id==='modal'?dialog:search},OpsUI:{reset:()=>log.push('reset')},blankWorkspace:name=>({name}),ServerWorkspace:{create:()=>({})},fetch(){},window:{},browserStorage:{},boot:async()=>log.push('boot')};
  vm.createContext(sandbox);vm.runInContext(text.slice(start,end),sandbox);await sandbox.openAgency();
  assert.equal(sandbox.filterProject,'all');assert.equal(sandbox.filterStatus,'all');assert.equal(sandbox.taskView,'board');assert.equal(sandbox.detailTab,'summary');assert.equal(sandbox.searchTerm,'');assert.equal(search.value,'');assert.deepEqual(log,['reset','boot']);assert.equal(sandbox.KEY,'scopewise.auth.new-agency.new-user.v1');assert.equal(sandbox.identityVersion,8);
  await sandbox.openAgency();assert.deepEqual(log,['reset','boot'],'unchanged authentication does not reload or reset the workspace');
 });
 await check('module reset removes prior person, date and project filters and selected subviews',()=>{
  const f=uiFixture();f.render('time');f.selections.get('Filter time by person').change('old-person');f.selections.get('Filter time by project').change('project-1');f.fields.get('ops-filter-from').value='2020-01-01';f.fields.get('ops-filter-to').value='2020-01-31';f.buttons.find(b=>b.textContent==='Apply dates').onclick();
  f.render('finance');f.buttons.find(b=>b.textContent==='Invoice drafts').onclick();f.render('finance');assert(f.selections.get('Filter finance by project'));
  f.sandbox.OpsUI.reset();f.render('time');assert.equal(f.selections.get('Filter time by person').value,'all');assert.equal(f.selections.get('Filter time by project').value,'all');assert.equal(f.fields.get('ops-filter-from').value,'');assert.equal(f.fields.get('ops-filter-to').value,'');
  f.render('finance');assert(f.selections.has('Filter finance by status'),'finance returns to estimates, whose status selector is available');
 });
 await check('project reports agree with summary totals by excluding declined proposals in each currency',()=>{
  const f=uiFixture(),at='2026-10-15T00:00:00.000Z';f.state.operations.proposals=[['accepted','Accepted',12300],['declined','Declined',99900]].map(([id,status,rateMinor])=>({id,clientId:'client-1',projectId:'project-1',opportunityId:null,title:id,scope:'Explicit scope',lines:[{description:'Work',qty:1,rateMinor}],status,validUntil:'',currency:'BDT',notes:'',createdAt:at}));Ops.validate(f.state);
  const page=f.render('reports'),tables=page.querySelectorAll('table'),moneyTable=tables.find(t=>t.textContent.includes('Amounts grouped by recorded currency'));assert(moneyTable);assert(moneyTable.textContent.includes('123.00 BDT'));assert(!moneyTable.textContent.includes('1122.00 BDT'));assert(page.textContent.includes('Proposal totals exclude declined proposals.'));assert.equal(Ops.summarize(f.state).proposalMinor,12300);
 });
 await check('read-only copy dialogs close for viewers without a workspace save or validation',async()=>{
  const text=source('workspace.js'),modalStart=text.indexOf('function modal('),modalEnd=text.indexOf('\nfunction download(',modalStart),submitStart=text.indexOf("document.getElementById('modal-form').onsubmit="),submitEnd=text.indexOf(";['modal-close'",submitStart);assert(modalStart>=0&&modalEnd>modalStart&&submitStart>=0&&submitEnd>submitStart);
  for(const role of ['viewer','owner']){
   let saves=0,closes=0,renders=0;const elements=new Map();for(const id of ['modal-form','modal','modal-title','modal-kicker','modal-content','modal-submit','modal-error'])elements.set(id,{textContent:'',replaceChildren(){},querySelectorAll:()=>[],showModal(){},close:()=>closes++});
   const sandbox={modalSequence:0,modalWrites:true,ScopewiseAuth:{user:()=>({role})},document:{getElementById:id=>elements.get(id)},state:{marker:'unchanged'},W:{validate(){throw Error('Read-only dialog must not validate or write state')}},Ops:{validate(){throw Error('Read-only dialog must not validate or write state')}},save:async()=>{saves++;return true},render:()=>renders++,toast(){},restoreState(){throw Error('Read-only close must not roll back state')}};
   vm.createContext(sandbox);vm.runInContext(text.slice(modalStart,modalEnd),sandbox);vm.runInContext(text.slice(submitStart,submitEnd),sandbox);sandbox.modal('Copy report',[],()=>{},'Close','COPY TEXT',{persist:false});
   assert.equal(elements.get('modal-submit').disabled,false);assert.equal(elements.get('modal-error').textContent,'');await elements.get('modal-form').onsubmit({preventDefault(){}});assert.equal(saves,0);assert.equal(closes,1);assert.equal(renders,1);assert.equal(sandbox.state.marker,'unchanged');
  }
 });
 await check('team and time forms preserve recorded rates and block cross-currency repricing',()=>{
  const f=uiFixture();f.render('team');f.buttons.find(b=>b.textContent==='+ Add person').click();f.fields.get('ops-name').value='Test developer';f.fields.get('ops-cost-rate').value='100.05';f.form.save();Ops.validate(f.state);const person=f.state.operations.team[0];
  f.render('time');f.buttons.find(b=>b.textContent==='+ Log time').click();f.fields.get('ops-person').value=person.id;f.fields.get('ops-person').onchange();f.fields.get('ops-task').value='task-1';f.fields.get('ops-minutes').value='90';f.form.save();Ops.validate(f.state);const entry=f.state.operations.timeEntries[0];assert.equal(entry.costRateMinor,10005);assert.equal(entry.costCurrency,'BDT');assert.equal(Ops.costing(f.state,'project-1').byCurrency.find(x=>x.currency==='BDT').laborMinor,15008);
  f.sandbox.OpsUI.open('team',person.id,f.context);f.fields.get('ops-cost-rate').value='200.00';f.fields.get('ops-cost-currency').value='USD';f.form.save();Ops.validate(f.state);assert.equal(entry.costRateMinor,10005);assert.equal(entry.costCurrency,'BDT');
  f.buttons.length=0;f.sandbox.OpsUI.open('timeEntries',entry.id,f.context);assert.equal(f.fields.get('ops-cost-currency').disabled,true);f.buttons.find(b=>b.textContent==='Use selected person’s cost rate').click();assert.equal(f.fields.get('ops-cost-rate').value,'100.05');assert(f.notices.at(-1).includes('keeps its recorded cost currency'));f.fields.get('ops-minutes').value='1441';assert.throws(()=>f.form.save(),/between 1 and 1440/);assert.equal(entry.durationMinutes,90);assert.equal(entry.costRateMinor,10005);
  f.fields.get('ops-project').value='project-2';f.fields.get('ops-project').onchange();assert.equal(f.fields.get('ops-task').value,'','project changes remove a prior task reference');
 });
 await check('CSV export honors person and date filters and neutralizes spreadsheet formulas',()=>{
  const f=uiFixture();f.state.operations.team.push({id:'qa-person',name:'=FORMULA()',role:'Developer',email:'',capacityHours:40,active:true});f.state.operations.timeEntries.push({id:'time-a',projectId:'project-1',taskId:'task-1',teamId:'qa-person',date:'2026-10-15',durationMinutes:60,note:'  =HYPERLINK("bad")',costRateMinor:10005,costCurrency:'BDT'},{id:'time-b',projectId:'project-2',taskId:null,teamId:null,date:'2026-10-14',durationMinutes:15,note:'Excluded record'});Ops.validate(f.state);
  f.render('time');f.selections.get('Filter time by person').change('qa-person');f.fields.get('ops-filter-from').value='2026-10-15';f.fields.get('ops-filter-to').value='2026-10-15';f.buttons.find(b=>b.textContent==='Apply dates').click();f.render('time');f.buttons.find(b=>b.textContent==='Export filtered CSV').click();const csv=f.exports[0];assert(csv.startsWith('\uFEFF'));assert(csv.includes("\"'=FORMULA()\""));assert(csv.includes("\"'  =HYPERLINK(\"\"bad\"\")\""));assert(csv.includes('100.05'));assert(!csv.includes('Excluded record'));assert.equal(csv.split('\r\n').length,2);
 });
 await check('commercial Markdown exports preserve user text without active markup',()=>{
  const f=uiFixture(),hostile='<img src=x onerror=alert(1)> [click](javascript:alert(1))',at='2026-10-16T00:00:00.000Z';
  f.state.projects.find(p=>p.id==='project-1').name=hostile;f.state.clients.find(p=>p.id==='client-1').name=hostile;
  f.state.operations.invoices=[{id:'qa-invoice',projectId:'project-1',number:hostile,currency:'BDT',status:'Draft',issuedDate:'2026-10-16',dueDate:'',notes:'First line\n# '+hostile,createdAt:at,lines:[{description:hostile,qty:1,rateMinor:100}]}];
  f.state.operations.proposals=[{id:'qa-proposal',projectId:'project-1',clientId:'client-1',opportunityId:null,title:hostile,scope:'First line\n# '+hostile,currency:'BDT',status:'Draft',validUntil:'',notes:hostile,createdAt:at,lines:[{description:hostile,qty:1,rateMinor:100}]}];
  Ops.validate(f.state);f.render('finance');f.buttons.find(b=>b.textContent==='Invoice drafts').click();f.render('finance');f.buttons.find(b=>b.textContent==='Export .md').click();
  f.render('crm');f.buttons.find(b=>b.textContent==='Proposals').click();f.render('crm');f.buttons.find(b=>b.textContent==='Export .md').click();
  assert.equal(f.exports.length,2);for(const output of f.exports){assert(!output.includes('<img'));assert(!output.includes('[click]('));assert(output.includes('&lt;img'));assert(output.includes('\\[click\\]\\('));assert(output.includes('First line\n\\# '));}
 });
 console.log('Passed '+count+' workspace UI regression scenarios.');
})().catch(error=>{console.error(error);process.exitCode=1;});
