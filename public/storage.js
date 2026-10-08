(function(root){
const model=typeof module!=='undefined'?require('./workspace-data.js'):root.Workspace;
function valid(raw){try{model.validate(JSON.parse(raw));return true}catch{return false}}
function load(storage,key){let raw=null;try{raw=storage.getItem(key);if(raw===null)return {state:model.sample(),error:''};return{state:model.validate(JSON.parse(raw)),error:''}}catch(e){return{state:model.sample(),error:raw===null?'Browser storage is unavailable. Changes will stay in memory until storage is accessible.':'Saved data is damaged or incompatible. A temporary sample is shown. Any save preserves the damaged original as a recovery copy first.'}}}
function persist(storage,key,state){model.validate(state);const current=storage.getItem(key);if(current!==null&&!valid(current)){const recoveryKey=key+'.recovery',previous=storage.getItem(recoveryKey);if(previous!==null&&previous!==current)throw Error('A previous recovery copy exists. Export the recovery and workspace before replacing damaged data.');storage.setItem(recoveryKey,current)}storage.setItem(key,JSON.stringify(state));}
const api={load,persist};if(typeof module!=='undefined')module.exports=api;else root.WorkspaceStorage=api;
})(globalThis);
