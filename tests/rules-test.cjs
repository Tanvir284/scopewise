'use strict';
const assert=require('node:assert/strict');const R=require('../public/rules-engine.js');const C=require('../public/rule-catalogue.js');
let count=0;function check(name,fn){fn();count++;console.log('PASS '+name)}const baseline='Customers can book appointments. Bookings require manual confirmation. No online payment is supported. Admins can see appointments.';
const plan=(message,context={},preferences={})=>R.analyse(baseline,message,context,preferences);
check('all domain rules produce evidence and observable criteria',()=>{for(const rule of C.domains){const p=plan('Add '+rule.keywords[0]+' capability.');assert(p.appliedRules.some(r=>r.id===rule.id),rule.id);assert(p.tasks[0].criteria.includes(rule.criteria[0]),rule.id);}});
check('deterministic snapshots and multiple domain criteria',()=>{const message='Add payment and email confirmation with CSV export.';const p=plan(message);assert.deepEqual(p,plan(message));for(const id of ['domain.payments','domain.notifications','domain.reporting'])assert(p.appliedRules.some(r=>r.id===id));assert(p.tasks[0].criteria.some(c=>c.includes('server-side provider')));assert(p.tasks[0].criteria.some(c=>c.includes('duplicate delivery')));assert.equal(p.original,baseline);assert.equal(p.message,message);assert.equal(p.source,'rules')});
check('baseline constraints and removal require explicit impact review',()=>{const p=plan('Customers should now pay a deposit. Remove manual booking confirmation.');assert.equal(p.changes[1].type,'Removal');assert(p.changes[1].before.includes('manual confirmation'));for(const id of ['review.scope-conflict','review.removal','review.data-loss','review.unavailable-provider'])assert(p.appliedRules.some(r=>r.id===id),id)});
check('modification preserves before/after and review questions',()=>{const p=plan('Replace manual booking confirmation with an email.');assert.equal(p.changes[0].type,'Modification');assert(p.changes[0].before.includes('confirmation'));assert(p.questions.some(q=>q.includes('superseded')));assert(p.appliedRules.some(r=>r.id==='review.replacement'))});
check('questions, greetings and unchanged scope create no development work',()=>{for(const text of ['Hello!','Thanks.','No changes needed.','Can we discuss the scope?']){const p=plan(text);assert.equal(p.tasks.length,0,text);assert.equal(p.changes.length,0,text);assert(p.appliedRules.some(r=>r.id==='review.no-action'));}assert(plan('Can we discuss the scope?').appliedRules.some(r=>r.id==='review.question'))});
check('duplicate requests consolidate and unknown domain stays explicit',()=>{const p=plan('Add payment. Add payment. Add a purple penguin.');assert.equal(p.changes.length,2);assert(p.appliedRules.some(r=>r.id==='review.duplicate'));assert(p.appliedRules.some(r=>r.id==='review.unmatched'));assert(p.questions.some(q=>q.includes('purple penguin')))});
check('deadline, commercial and subjective statements get review flags',()=>{const p=plan('Add a modern report ASAP by tomorrow within a budget of 5000 BDT.');for(const id of ['review.ambiguity','review.deadline','review.budget','review.person','review.regression'])assert(p.appliedRules.some(r=>r.id===id),id)});
check('existing work and paused project are reconciled without automatic scheduling',()=>{const p=plan('Add monthly CSV reports.',{project:{status:'On hold'},existingTasks:[{title:'Add monthly CSV reports.',description:'',status:'In progress'}]});for(const id of ['review.existing-work','review.project-state'])assert(p.appliedRules.some(r=>r.id===id));assert(p.assumptions.some(a=>a.includes('No effort')))});
check('configuration disables selected evidence and domain criteria',()=>{const p=plan('Add payment.',{}, {disabledRuleIds:['domain.payments','review.regression','review.person'],strictReview:false});assert(!p.appliedRules.some(r=>['domain.payments','review.regression','review.person'].includes(r.id)));assert(!p.tasks[0].criteria.some(c=>c.includes('server-side provider')));assert(!p.questions.some(q=>q.includes('approved for this release')))});
check('question and task limits are disclosed',()=>{const p=plan(Array.from({length:12},(_,i)=>'Add payment and report item '+i+'.').join('\n'),{},{taskLimit:5,questionLimit:3});assert.equal(p.changes.length,12);assert.equal(p.tasks.length,5);assert.equal(p.questions.length,3);assert(p.warnings.some(w=>w.ruleId==='system.output-limit'&&w.text.includes('5 draft')))});
check('plurals, Bangla and decimal amounts remain intact',()=>{const p=plan('Add emails with a 12.50 BDT budget.\nবাংলা ভাষা যোগ করতে চাই।');assert.equal(p.changes.length,2);assert(p.changes[0].text.includes('12.50'));assert(p.appliedRules.some(r=>r.id==='domain.localization'));assert(p.appliedRules.some(r=>r.id==='domain.notifications'))});
check('literal markup remains plain output data',()=>{const p=plan('Add <script>alert(1)</script> report.');assert(p.changes[0].text.includes('<script>'));assert.equal(p.source,'rules')});
check('invalid policies, empty text and excessive inputs are rejected',()=>{for(const p of [null,[],{bad:1},{disabledRuleIds:['imaginary']},{disabledRuleIds:['domain.payments','domain.payments']},{strictReview:'yes'},{questionLimit:2},{taskLimit:81}])assert.throws(()=>R.validatePreferences(p));assert.throws(()=>R.analyse('','Add payment'));assert.throws(()=>R.analyse(baseline,' '.repeat(2)));assert.throws(()=>R.analyse(baseline,'x'.repeat(12001)))});
check('catalogue IDs are unique and all review rules have exercised triggers',()=>{assert.equal(new Set(C.rules.map(r=>r.id)).size,C.rules.length);const exercised=new Set();for(const p of [plan('Add payment. Add payment. Remove booking. Replace booking. Do not add payment. Add modern report ASAP with a budget.'),plan('Can we discuss the scope?'),plan('Add a purple penguin.'),plan('Add reports.',{project:{status:'Completed'},existingTasks:[{title:'Add reports.',status:'Done'}]}),plan(Array.from({length:8},(_,i)=>'Add reports '+i+'.').join('\n'),{},{taskLimit:5,questionLimit:3})])p.appliedRules.forEach(r=>exercised.add(r.id));for(const r of C.rules.filter(r=>r.category==='Review'))assert(exercised.has(r.id),r.id)});
check('disabled review rules suppress their questions while enabled domain questions remain',()=>{
 const message='Add a modern report ASAP with a budget of 5000 BDT.',ids=['review.ambiguity','review.deadline','review.budget','review.person'];
 const enabled=plan(message),disabled=plan(message,{},{disabledRuleIds:ids,strictReview:true});
 for(const fragment of ['measurable example defines subjective','requested date fixed','approves the budget','approved for this release','delivery, commercial and existing-work']){
  assert(enabled.questions.some(q=>q.includes(fragment)),fragment+' enabled');
  assert(!disabled.questions.some(q=>q.includes(fragment)),fragment+' disabled');
 }
 for(const id of ids){assert(!disabled.appliedRules.some(r=>r.id===id));assert(!disabled.warnings.some(w=>w.ruleId===id));}
 assert(disabled.questions.some(q=>q.includes('columns, formats, filters')),'reporting domain questions still apply');
});

check('explicit exclusion retains constraint without affirmative payment implementation',()=>{
 const p=plan('Do not add online payment. Add CSV reports.');
 assert.equal(p.changes[0].type,'Constraint');assert(p.appliedRules.some(r=>r.id==='review.negation'));
 assert(p.tasks[0].title.startsWith('Review excluded scope:'));
 assert(p.tasks[0].criteria.some(c=>c.includes('excluded capability is not introduced')));
 assert(!p.tasks[0].criteria.some(c=>c.includes('server-side provider')));
 assert(!p.warnings.some(w=>w.ruleId==='review.unavailable-provider'));
 assert(!p.questions.some(q=>q.includes('Which provider')));
 assert.equal(p.changes[1].type,'Addition');assert(p.tasks[1].criteria.some(c=>c.includes('fields, periods and totals')));
});
check('combined domains retain highest matched risk priority',()=>{
 const p=plan('Add payment and email confirmation.');
 assert(p.tasks[0].ruleIds.includes('domain.payments'));assert(p.tasks[0].ruleIds.includes('domain.notifications'));
 assert.equal(p.tasks[0].priority,'High');assert(p.tasks[0].criteria.some(c=>c.includes('server-side provider')));assert(p.tasks[0].criteria.some(c=>c.includes('duplicate delivery')));
});





check('disabled limit review still discloses truncation and persists',()=>{const message=Array.from({length:12},(_,i)=>'Add payment and report item '+i+'.').join('\n');const p=plan(message,{},{disabledRuleIds:['review.limit'],taskLimit:5,questionLimit:3});assert.equal(p.tasks.length,5);assert.equal(p.questions.length,3);assert(!p.appliedRules.some(r=>r.id==='review.limit'));assert(!p.warnings.some(w=>w.ruleId==='review.limit'));assert(p.warnings.some(w=>w.ruleId==='system.output-limit'&&w.text.includes('5 draft')));assert(p.warnings.some(w=>w.ruleId==='system.output-limit'&&w.text.includes('Questions')));const W=require('../public/workspace-data.js'),state=W.sample();W.addChange(state,state.projects[0].id,'Bounded plan',message,()=>p);W.validate(JSON.parse(JSON.stringify(state)));});

check('criteria limits are disclosed when review guidance is disabled',()=>{const p=plan('Add '+C.rules.filter(r=>r.category==='Domain').map(r=>r.keywords[0]).join(' and ')+' capabilities.',{},{disabledRuleIds:['review.limit'],questionLimit:3});assert.equal(p.tasks[0].criteria.length,18);assert(p.warnings.some(w=>w.ruleId==='system.output-limit'&&w.text.includes('Acceptance criteria')));assert(p.warnings.some(w=>w.ruleId==='system.output-limit'&&w.text.includes('Questions')));});
console.log('Passed '+count+' rule-engine scenarios covering '+C.rules.length+' traceable rules.');
