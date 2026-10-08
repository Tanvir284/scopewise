const assert=require('node:assert/strict');const W=require('../public/workspace-data.js');const S=require('../public/storage.js');
const key='test';function memory(initial){const map=new Map(Object.entries(initial||{}));return {getItem:k=>map.has(k)?map.get(k):null,setItem:(k,v)=>map.set(k,v),map}}
let store=memory();const fresh=S.load(store,key);assert.equal(fresh.error,'');S.persist(store,key,fresh.state);assert.equal(S.load(store,key).state.projects.length,2);
store=memory({test:'{broken JSON'});const damaged=S.load(store,key);assert(damaged.error.includes('damaged'));assert.equal(store.getItem(key),'{broken JSON');S.persist(store,key,damaged.state);assert.equal(store.getItem(key+'.recovery'),'{broken JSON');W.validate(JSON.parse(store.getItem(key)));
store=memory({test:'broken', 'test.recovery':'older recovery'});assert.throws(()=>S.persist(store,key,W.sample()),/previous recovery/);assert.equal(store.getItem(key),'broken');assert.equal(store.getItem(key+'.recovery'),'older recovery');
store=memory({test:'broken'});store.setItem=()=>{throw Error('Quota exceeded')};assert.throws(()=>S.persist(store,key,W.sample()),/Quota/);assert.equal(store.getItem(key),'broken');
const blocked={getItem:()=>{throw Error('Denied')},setItem:()=>{throw Error('Denied')}};assert(S.load(blocked,key).error.includes('unavailable'));assert.throws(()=>S.persist(blocked,key,W.sample()),/Denied/);
console.log('Passed: fresh/saved workspace, corrupted recovery, recovery collision preservation, quota failure without data loss, denied storage fallback.');
