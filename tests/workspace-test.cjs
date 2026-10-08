const assert=require('node:assert/strict');const W=require('../public/workspace-data.js');const {createPlan}=require('../public/planner.js');
const s=W.sample();assert.equal(W.validate(s),s);assert.equal(s.projects.length,2);
const original=s.projects[0].original;const c=W.addChange(s,'project-1','Payment request','Add bKash payment. Send email confirmation. Add report export.',createPlan);assert.equal(c.status,'Draft');assert.equal(c.items.length,3);assert.equal(s.tasks.filter(t=>t.changeId===c.id).length,3);assert.equal(s.projects[0].original,original);W.validate(s);
const t=s.tasks.find(t=>t.changeId===c.id);t.title='Edited task';t.criteria=['Edited criterion'];c.questions=['Edited question'];c.status='Approved';const md=W.exportChange(s,c);assert(md.includes('Edited task'));assert(md.includes('Edited criterion'));assert(md.includes('Edited question'));assert(md.includes('Status: Approved'));assert.equal(s.projects[0].original,original);assert.deepEqual(W.validate(JSON.parse(JSON.stringify(s))),s);
const corrupt=JSON.parse(JSON.stringify(s));corrupt.tasks[0].projectId='missing';assert.throws(()=>W.validate(corrupt));const badStatus=JSON.parse(JSON.stringify(s));badStatus.changes[0].status='Imaginary';assert.throws(()=>W.validate(badStatus));const badId=JSON.parse(JSON.stringify(s));badId.clients[0].id=badId.clients[1].id;assert.throws(()=>W.validate(badId));
assert.throws(()=>W.addChange(s,'missing','Title','Message',createPlan));assert.throws(()=>W.addChange(s,'project-1','   ','Message',createPlan));
for(let i=0;i<305;i++)W.activity(s,'Event '+i);assert.equal(s.activity.length,300);
console.log('Passed: sample schema, linked change/tasks, baseline snapshots, export edits/status, JSON roundtrip, invalid references/status/IDs, intake validation, bounded history.');

const wrongProject=W.sample();const linked=W.addChange(wrongProject,'project-1','Payment','Add payment.',createPlan);wrongProject.tasks.find(t=>t.changeId===linked.id).projectId='project-2';assert.throws(()=>W.validate(wrongProject),/Invalid task/);
for(const id of ['', 'bad/id','bad#id','bad?id']){const unsafe=W.sample();unsafe.projects[0].id=id;assert.throws(()=>W.validate(unsafe),/record ID/);}
console.log('Passed: cross-project change/task references and route-unsafe IDs rejected.');

const Rules=require('../public/rules-engine.js');
function ruleFixture(){
 const workspace=W.sample();
 W.addChange(workspace,'project-1','Payment revision','Now add bKash payment for booking. Make it fast and simple. Add CSV report export ASAP.',(original,message)=>Rules.analyse(original,message));
 return workspace;
}
{
 const workspace=ruleFixture(),analysis=workspace.changes[0].analysis;
 assert(analysis.appliedRules.length>0);assert(analysis.warnings.length>0);
 const snapshot=JSON.parse(JSON.stringify(workspace));
 assert.equal(W.validate(workspace),workspace);assert.deepEqual(workspace,snapshot);
 const legacy=JSON.parse(JSON.stringify(workspace));delete legacy.changes[0].analysis;
 assert.equal(W.validate(legacy),legacy);
 console.log('Passed: generated evidence metadata, warning references, lossless roundtrip and legacy analysis absence.');
}
function badAnalysis(mutate,pattern){const workspace=ruleFixture();mutate(workspace.changes[0]);assert.throws(()=>W.validate(workspace),pattern);}
for(const value of [null,false,[],{},'metadata']){
 badAnalysis(change=>change.analysis=value,/analysis metadata/);
}
badAnalysis(change=>change.analysis.source='AI',/analysis metadata/);
badAnalysis(change=>change.analysis.version={},/analysis metadata/);
badAnalysis(change=>change.analysis.appliedRules=null,/analysis metadata/);
badAnalysis(change=>change.analysis.warnings={},/analysis metadata/);
badAnalysis(change=>change.analysis.assumptions='text',/analysis metadata/);
badAnalysis(change=>change.analysis.appliedRules=[null],/rule evidence/);
badAnalysis(change=>change.analysis.appliedRules.push({...change.analysis.appliedRules[0]}),/rule evidence/);
badAnalysis(change=>change.analysis.appliedRules[0].title={},/rule evidence/);
badAnalysis(change=>change.analysis.appliedRules[0].evidence='x'.repeat(2001),/rule evidence/);
badAnalysis(change=>change.analysis.appliedRules[0].id='bad/id',/rule evidence/);
badAnalysis(change=>change.analysis.warnings=[null],/planning warning/);
badAnalysis(change=>change.analysis.warnings=[{ruleId:'review.nonexistent',text:'Cannot be linked to evidence.'}],/planning warning/);
badAnalysis(change=>change.analysis.warnings[0].text={},/planning warning/);
badAnalysis(change=>change.analysis.warnings[0].severity='unknown',/planning warning/);
badAnalysis(change=>change.analysis.assumptions=[{}],/assumptions/);
badAnalysis(change=>change.analysis.appliedRules=Array(201).fill({id:'review.person',title:'Review',evidence:''}),/analysis metadata/);
badAnalysis(change=>change.analysis.warnings=Array(5001).fill({}),/analysis metadata/);
badAnalysis(change=>change.analysis.assumptions=Array(101).fill('Assumption'),/analysis metadata/);
console.log('Passed: malformed/bounded analysis arrays and rows rejected before renderEvidence can access them.');
for(const invalid of [null,false,0,[],{strictReview:'yes'},{questionLimit:NaN},{taskLimit:81},{disabledRuleIds:['not-a-rule']},{disabledRuleIds:['domain.payments','domain.payments']},{unexpected:true}]){
 const workspace=W.sample();workspace.settings.rulePreferences=invalid;
 assert.throws(()=>W.validate(workspace),/rule configuration/);
}
{
 const workspace=ruleFixture(),preferences={disabledRuleIds:['domain.payments'],strictReview:false,questionLimit:5,taskLimit:8};
 workspace.settings.rulePreferences=preferences;
 const snapshot=JSON.parse(JSON.stringify(workspace));
 assert.equal(W.validate(workspace),workspace);assert.equal(workspace.settings.rulePreferences,preferences);assert.deepEqual(workspace,snapshot);
 console.log('Passed: valid rule policy remains unchanged and false/null/unknown/malformed preferences cannot bypass import validation.');
}
for(const invalid of [{before:{}},{after:[]},{ruleIds:null},{ruleIds:['bad/id']},{ruleIds:['domain.payments','domain.payments']}]){
 const workspace=ruleFixture();Object.assign(workspace.changes[0].items[0],invalid);assert.throws(()=>W.validate(workspace),/Invalid (change item|rule identifiers)/);
}
{
 const workspace=ruleFixture();workspace.changes[0].items[0]=null;assert.throws(()=>W.validate(workspace),/Invalid change item/);
 workspace.changes[0].items=[];workspace.tasks[0].criteria=Array(2001).fill('criterion');assert.throws(()=>W.validate(workspace),/Invalid task/);
}
console.log('Passed: optional before/after/rule references and criteria collections bounded and typed.');
