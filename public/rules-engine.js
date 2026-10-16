(function(root){
const catalog=typeof module!=='undefined'?require('./rule-catalogue.js'):root.RuleCatalogue;
const defaults={disabledRuleIds:[],strictReview:true,questionLimit:12,taskLimit:40};
const defaultKeys=new Set(Object.keys(defaults));
const ruleById=new Map(catalog.rules.map(r=>[r.id,r]));
const normalize=t=>t.toLowerCase().normalize('NFKC').replace(/[\u2018\u2019]/g,"'");
const preparedDomains=catalog.domains.map(r=>({rule:r,keywords:r.keywords.map(k=>{const w=normalize(k);return {word:w,phrase:w.includes(' ')};})}));
function validatePreferences(raw={}){const p={...defaults,...raw};if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).some(k=>!defaultKeys.has(k))||!Array.isArray(p.disabledRuleIds)||p.disabledRuleIds.length>catalog.rules.length||p.disabledRuleIds.some(id=>!ruleById.has(id))||new Set(p.disabledRuleIds).size!==p.disabledRuleIds.length||typeof p.strictReview!=='boolean'||!Number.isInteger(p.questionLimit)||p.questionLimit<3||p.questionLimit>30||!Number.isInteger(p.taskLimit)||p.taskLimit<5||p.taskLimit>80)throw Error('Invalid planning-rule configuration.');return p}
const tokens=t=>new Set(normalize(t).match(/[\p{L}\p{M}\p{N}]+/gu)||[]);
function split(text){return text.split(/\n+|;\s*|(?<=[.!?।])\s+(?=[\p{Lu}\p{L}])/u).map(t=>t.trim()).filter(Boolean)}
const common=new Set('a an the and or to for with from in on at is are be will should must need want add now please it this that of we our you your'.split(' '));
function analyse(original,message,context={},preferences={}){
 if(typeof original!=='string'||typeof message!=='string'||!original.trim()||!message.trim())throw Error('Original requirements and client message are required.');if(original.length>24000||message.length>12000)throw Error('Requirement text exceeds the supported limit.');
 const config=validatePreferences(preferences),disabledSet=new Set(config.disabledRuleIds),enabled=id=>!disabledSet.has(id),applied=new Map(),warnings=[],questions=[],questionSet=new Set(),tasks=[],changes=[],seen=new Set();
 // Reuse token indexes within this analysis; large baselines and task lists must not
 // be reparsed for every keyword and every incoming request.
 const indexed=new Map(),index=text=>{let entry=indexed.get(text);if(!entry){const value=normalize(text),words=new Set(value.match(/[\p{L}\p{M}\p{N}]+/gu)||[]),relevant=new Set();for(const w of words)if(w.length>2&&!common.has(w))relevant.add(w);entry={value,words,relevant};indexed.set(text,entry);}return entry;};
 const matchData=(data,kw)=>kw.phrase?data.value.includes(kw.word):data.words.has(kw.word)||data.words.has(kw.word+'s')||data.words.has(kw.word+'ing');
 const baseline=split(original),existing=(Array.isArray(context.existingTasks)?context.existingTasks:[]).filter(t=>t&&typeof t.title==='string').map(t=>({task:t,text:t.title+' '+(t.description||'')}));
 const negBaselineData=baseline.filter(s=>/\b(no|without|not|never|only|must not)\b/i.test(s)).map(index);
 const constrainedDomains=new Set();
 if(negBaselineData.length){
  for(let i=0;i<preparedDomains.length;i++){
   const pd=preparedDomains[i];
   if(negBaselineData.some(bd=>pd.keywords.some(kw=>matchData(bd,kw))))constrainedDomains.add(pd.rule.id);
  }
 }
 function overlapIndex(texts){
  const postings=new Map(),sizes=texts.map((text,i)=>{const words=index(text).relevant;for(const word of words){let list=postings.get(word);if(!list){list=[];postings.set(word,list);}list.push(i)}return words.size});
  return request=>{const words=index(request).relevant,counts=new Uint32Array(texts.length),positions=[];for(const word of words){const list=postings.get(word);if(!list)continue;for(let i=0;i<list.length;i++){const position=list[i];if(counts[position]===0)positions.push(position);counts[position]++;}}return positions.map(position=>({position,score:counts[position]/Math.max(1,Math.min(words.size,sizes[position]))}));};
 }
 const baselineMatches=overlapIndex(baseline),taskMatches=overlapIndex(existing.map(item=>item.text));
 const closest=request=>{let best=-1,score=0;for(const match of baselineMatches(request)){if(match.score>score||(match.score===score&&match.position<best)){score=match.score;best=match.position}}return score>=.25?baseline[best]:'No direct baseline match identified; review the full original scope.'};
 let warningLimitReached=false,hasLimitWarning=false;
 function addWarning(warning){if(warnings.length<4998){if(warning.ruleId==='review.limit')hasLimitWarning=true;warnings.push(warning);}else warningLimitReached=true;}
 function apply(id,evidence){if(!enabled(id))return;const rule=ruleById.get(id);if(rule&&!applied.has(id))applied.set(id,{id,title:rule.title,evidence:evidence.slice(0,500)})}
 function warn(id,text,severity='review'){if(enabled(id)){apply(id,text);addWarning({code:id,text,ruleId:id,severity})}}
 function discloseLimit(text){addWarning({code:'system.output-limit',text,ruleId:'system.output-limit',severity:'info'});if(enabled('review.limit')){apply('review.limit',text);if(!hasLimitWarning)addWarning({code:'review.limit',text:'Review omitted work before approval. Split this request or increase the configured drafting limits.',ruleId:'review.limit',severity:'review'})}}
 function ask(text){if(!questionSet.has(text)){questionSet.add(text);questions.push(text)}}
 if(context.project&&['Completed','Archived','On hold'].includes(context.project.status))warn('review.project-state','This project is '+context.project.status+'. Confirm whether it should resume before scheduling new work.');
 const activeDomains=preparedDomains.filter(pd=>enabled(pd.rule.id));
 const parts=split(message);for(const text of parts){const data=index(text),normalized=data.value,key=(normalized.match(/[\p{L}\p{M}\p{N}]+/gu)||[]).join(' ');if(seen.has(key)){warn('review.duplicate','A repeated request was consolidated: '+text.slice(0,160),'info');continue}seen.add(key);
 const action=/\b(add|remove|drop|replace|change|switch|need|want|should|must|build|implement|enable|disable|support|send|allow|include|instead|now|only)\b/i.test(text)||/চাই|করতে|যোগ|বাদ|পরিবর্তন/.test(text),question=/\?$/.test(text)&&!action;
 if(/^(no (new )?changes?( (are )?needed|required)?|keep (everything|the scope) (as is|unchanged))[.! ]*$/i.test(text)){warn('review.no-action','An explicit request to keep the existing scope was excluded.','info');continue}
 if(question){warn('review.question','Clarification question retained before implementation.','info');ask(text);continue}if(!action&&(/^(hi|hello|thanks|thank you|ok|okay|great)[.! ]*$/i.test(text)||text.length<6)){warn('review.no-action','Non-actionable greeting/acknowledgement was excluded.','info');continue}
 const exclusion=/\b(do not|don't|must not|mustn't|should not|shouldn't|never)\s+(add|enable|implement|include|build|send|allow|support|remove|drop|delete|disable|replace|change|cancel)|\bwithout\b|\bno new\b/i.test(normalized);let type=exclusion?'Constraint':/\b(remove|drop|delete|no longer|don't need|do not need|disable|cancel)\b/i.test(normalized)?'Removal':/\b(replace|instead|switch|change|rather|now|only)\b/i.test(normalized)?'Modification':/\b(add|include|enable|new)\b/i.test(normalized)?'Addition':'Requested scope';
 const domain=[];for(let i=0;i<activeDomains.length;i++){const pd=activeDomains[i];if(pd.keywords.some(kw=>matchData(data,kw))){domain.push(pd.rule);apply(pd.rule.id,text);}}
 const before=closest(text),ruleIds=domain.map(r=>r.id);changes.push({text,type,before,after:type==='Removal'?'Requested removal: '+text:text,ruleIds});
 if(exclusion){warn('review.negation','Negative scope wording requires clarification; it is not affirmative implementation work.');if(enabled('review.negation'))ask('For this exclusion, should existing behavior remain, be removed, or simply not be added: '+text.slice(0,160)+'?')}
 if(type==='Removal'){apply('review.removal',text);if(enabled('review.removal'))ask('Which existing flows, records and dependent features are affected by this removal?');warn('review.data-loss','For removal requests, confirm data-retention and recovery behavior before implementation.');}
 if(type==='Modification'){apply('review.replacement',text);if(enabled('review.replacement'))ask('Which original behavior is explicitly superseded, and which must remain?');}
 if(!domain.length){apply('review.unmatched',text);if(enabled('review.unmatched'))ask('What concrete before/after example confirms this request: '+text.slice(0,160)+'?')}
 let primary=domain.find(r=>r.id==='domain.notifications')||domain.find(r=>r.id==='domain.reporting')||domain[0];const title=exclusion?'Review excluded scope: '+text.slice(0,95):type==='Removal'?'Remove superseded behavior: '+text.slice(0,95):primary?primary.taskTitle:'Implement: '+text.slice(0,100);
 const criteria=exclusion?['Confirm the prohibited action and whether it concerns existing behavior or a proposed addition.',/\b(remove|drop|delete|disable|replace|change|cancel)\b/i.test(normalized)?'The explicitly prohibited removal or modification is not performed.':'The explicitly excluded capability is not introduced by this change.']:type==='Removal'?['The explicitly approved behavior is removed from its agreed user flow.','Affected data, dependencies and recovery handling are confirmed.']:primary?[...new Set(domain.flatMap(r=>r.criteria))]:['The client-approved before/after example is demonstrated.','Empty, invalid and unauthorized cases follow agreed behavior.'];
 if(enabled('review.regression')){criteria.push('Existing agreed behavior continues to work unless explicitly superseded.');apply('review.regression',text)}
 if(criteria.length>18){criteria.length=18;discloseLimit('Acceptance criteria were limited to 18 for a request matching many domains; review all rule evidence.')}
 tasks.push({title:title.slice(0,150),description:text,criteria,priority:!domain.length?'Medium':domain.some(r=>r.priority==='High')?'High':domain.some(r=>r.priority==='Medium')?'Medium':'Low',ruleIds});if(!exclusion)domain.forEach(r=>r.questions.forEach(ask));
 if(enabled('review.ambiguity')&&/\b(easy|simple|quick|better|beautiful|modern|fast|user friendly|asap)\b/i.test(text)){warn('review.ambiguity','Replace subjective wording with measurable acceptance criteria: '+text.slice(0,160));ask('What measurable example defines subjective terms such as fast, easy or modern?')}
 if(enabled('review.deadline')&&/\b(by (monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow)|deadline|urgent|asap|this week|\d+ days?)\b/i.test(text)){warn('review.deadline','A deadline was mentioned. Review capacity and dependencies before making a commitment.');ask('Is the requested date fixed, and what scope can be deferred if capacity is insufficient?')}
 if(enabled('review.budget')&&/\b(budget|price|cost|free|discount|\d+ (taka|bdt|usd))\b/i.test(text)){warn('review.budget','A commercial constraint was mentioned. Confirm the estimate and approval before committing.');ask('Who approves the budget or change-order cost, and what scope does it cover?')}
 if(domain.some(r=>constrainedDomains.has(r.id))&&/\b(add|now|should|must|need)\b/i.test(text)){warn('review.scope-conflict','The baseline contains constraints in this request domain. Reconcile them explicitly with the new request.');}
 if(!exclusion&&domain.some(r=>r.id==='domain.integration'||r.id==='domain.payments'))warn('review.unavailable-provider','External capability is requested. Confirm provider availability, credentials ownership and approval before implementation.');
 const related=taskMatches(text).filter(match=>match.score>=.65).sort((a,b)=>a.position-b.position).slice(0,3).map(match=>existing[match.position].task);if(related.length)warn('review.existing-work','Potentially overlapping recorded work: '+related.map(t=>t.title+' ('+t.status+')').join('; ')+'. Compare scope before duplicating tasks.');
 }
 if(!changes.length)warn('review.no-action','No actionable requirement change was extracted. Clarify the client request before generating development work.');
 if(config.strictReview&&enabled('review.person')){ask('Which changes are approved for this release, and who records the decision?');ask('What delivery, commercial and existing-work impacts must be agreed?');apply('review.person','Approval owner and scope are not independently verified by this engine.')}
 if(tasks.length>config.taskLimit)discloseLimit('Only the first '+config.taskLimit+' draft tasks are shown. Split the request into smaller change plans.');if(questions.length>config.questionLimit)discloseLimit('Questions are limited to '+config.questionLimit+'. Review all matched rules for additional domain questions.');
 if(warningLimitReached){const text='Further planning warnings were omitted at the supported limit. Split this request before approving the resulting work.';warnings.push({code:'system.output-limit',text,ruleId:'system.output-limit',severity:'info'});if(enabled('review.limit')&&!hasLimitWarning){apply('review.limit',text);warnings.push({code:'review.limit',text,ruleId:'review.limit',severity:'review'});}}
 return {source:'rules',version:catalog.version,original:original.trim(),message:message.trim(),changes,tasks:tasks.slice(0,config.taskLimit),questions:questions.slice(0,config.questionLimit),warnings,appliedRules:[...applied.values()],assumptions:['Classifications are deterministic text rules, not a complete semantic interpretation.','No effort, price or delivery date is inferred without explicit records.','Client approval must be recorded by the developer.']};
}
function catalogue(){return catalog.rules.map(r=>({...r}))}
const api={analyse,catalogue,validatePreferences,defaults,version:catalog.version};if(typeof module!=='undefined')module.exports=api;else root.RulesEngine=api;
})(globalThis);
