'use strict';
const fs=require('node:fs'),path=require('node:path'),readline=require('node:readline');
const {StringDecoder}=require('node:string_decoder');
const U=require('./operator-utils.cjs');
const HELP=[
'Scopewise offline operator administration (Node 24).',
'  secret-create [--work work] [--file work/secrets/session-secret]',
'  agency-create --name NAME [--work work]',
'  agency-list [--work work]',
'  user-create --agency ID --username NAME --role owner|editor|viewer [password input]',
'  user-list [--agency ID] [--work work]',
'  user-reset --user ID [password input] [--work work]',
'  user-revoke --user ID [--work work]',
'  user-role --user ID --role owner|editor|viewer [--work work]',
'  sessions-revoke-all [--work work]',
'  adopt-legacy --agency ID --confirm-agency ID [--work work]',
'Password input: hidden interactive prompt, --password-stdin, or --password-file FILE.',
'No plaintext password arguments or password environment variables are accepted.',
'Protect auth databases, secret files, and backups with private operator permissions.'
].join('\n');
function hiddenPassword(prompt){
 if(!process.stdin.isTTY||typeof process.stdin.setRawMode!=='function')throw Error('Use a terminal for hidden input, or explicitly choose --password-stdin/--password-file.');
 return new Promise((resolve,reject)=>{
  const input=process.stdin,decoder=new StringDecoder('utf8'),prior=input.isRaw;let value='',finished=false;
  process.stderr.write(prompt);input.setRawMode(true);input.resume();
  function finish(error){if(finished)return;finished=true;input.removeListener('data',onData);input.removeListener('end',onEnd);input.setRawMode(Boolean(prior));input.pause();process.stderr.write('\n');error?reject(error):resolve(value);}
  function onEnd(){finish(Error('Password input ended.'));}
  function onData(chunk){
   for(const character of decoder.write(Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk))){
    if(character==='\u0003'||character==='\u0004')return finish(Error('Password input cancelled.'));
    if(character==='\r'||character==='\n')return finish();
    if(character==='\u007f'||character==='\b'){value=Array.from(value).slice(0,-1).join('');continue;}
    if(character<' ')continue;
    value+=character;if(value.length>128)return finish(Error('Use a password of at most 128 characters.'));
   }
  }
  input.on('data',onData);input.on('end',onEnd);
 });
}
function readPasswordText(text){
 if(Buffer.byteLength(text)>1024)throw Error('Password input is too long.');
 const value=text.replace(/\r?\n$/,'');
 if(/[\r\n\0]/.test(value))throw Error('Password input must contain exactly one line.');
 return value;
}
async function password(options){
 if(options['password-file']&&options['password-stdin'])throw Error('Choose one password input method.');
 if(options['password-file']){
  const filename=path.resolve(U.ROOT,options['password-file']),stat=U.fileInfo(filename);
  if(stat.size>1024)throw Error('Password input is too long.');
  if(process.platform!=='win32'&&(stat.mode&0o077)!==0)throw Error('Password file must be private to its operator (mode 600).');
  return readPasswordText(fs.readFileSync(filename,'utf8'));
 }
 if(options['password-stdin']){
  if(process.stdin.isTTY)throw Error('For a terminal, omit --password-stdin and use the hidden prompt.');
  const chunks=[],buffer=Buffer.alloc(1025);let total=0,length;
  while((length=fs.readSync(0,buffer,0,buffer.length,null))){total+=length;if(total>1024)throw Error('Password input is too long.');chunks.push(Buffer.from(buffer.subarray(0,length)));}
  return readPasswordText(Buffer.concat(chunks).toString('utf8'));
 }
 const first=await hiddenPassword('Password (hidden): '),second=await hiddenPassword('Confirm password (hidden): ');
 if(first!==second)throw Error('Passwords did not match.');
 return first;
}
function required(options,key){if(!options[key])throw Error('A required option is missing: --'+key+'.');return options[key];}
function output(value){process.stdout.write(JSON.stringify(value,null,2)+'\n');}
async function main(argv=process.argv.slice(2)){
 const command=argv.shift();
 if(process.env.SCOPEWISE_STORAGE==='postgres'&&command!=='secret-create'&&command!=='--help'&&command)throw Error('Use scripts/postgres-admin.cjs for external database account administration.');
 if(!command||command==='--help'||command==='help'){console.log(HELP);return;}
 const specifications={
  'secret-create':{'--work':'value','--file':'value'},
  'agency-create':{'--work':'value','--name':'value'},
  'agency-list':{'--work':'value'},
  'user-create':{'--work':'value','--agency':'value','--username':'value','--role':'value','--password-file':'value','--password-stdin':'boolean'},
  'user-list':{'--work':'value','--agency':'value'},
  'user-reset':{'--work':'value','--user':'value','--password-file':'value','--password-stdin':'boolean'},
  'user-revoke':{'--work':'value','--user':'value'},
  'user-role':{'--work':'value','--user':'value','--role':'value'},
  'sessions-revoke-all':{'--work':'value'},
  'adopt-legacy':{'--work':'value','--agency':'value','--confirm-agency':'value'}
 };
 if(!Object.hasOwn(specifications,command))throw Error('Unknown operator command. Use --help.');
 const options=U.parseArgs(argv,specifications[command]),work=U.workDirectory(options.work);
 if(command==='secret-create'){
  const filename=options.file?U.inside(path.resolve(U.ROOT,options.file)):path.join(work,'secrets','session-secret');
  U.privateWrite(filename,U.secretText());output({created:true,file:path.relative(U.ROOT,filename),secretPrinted:false});return;
 }
 const filename=path.join(work,'data','auth.sqlite');
 U.inside(filename);U.privateDirectory(path.dirname(filename));
 const {createAuthStore}=require('../lib/auth.cjs'),auth=createAuthStore({filename});
 try{
  if(command==='agency-create')return output(auth.createAgency({name:required(options,'name')}));
  if(command==='agency-list')return output(auth.listAgencies());
  if(command==='user-list')return output(auth.listUsers(options.agency?{agencyId:options.agency}:{}));
  if(command==='user-create'){
   const agencyId=required(options,'agency'),username=required(options,'username'),role=required(options,'role');
   const value=await password(options);return output(await auth.createUser({agencyId,username,role,password:value}));
  }
  if(command==='user-reset'){const id=required(options,'user'),value=await password(options);await auth.resetPassword(id,value);return output({reset:true,userId:id,sessionsRevoked:true});}
  if(command==='user-revoke'){const id=required(options,'user');auth.revokeUser(id);return output({revoked:true,userId:id,sessionsRevoked:true});}
  if(command==='user-role'){const id=required(options,'user');auth.updateRole(id,required(options,'role'));return output({updated:true,userId:id,sessionsRevoked:true});}
  if(command==='sessions-revoke-all'){
   if(typeof auth.revokeAllSessions!=='function')throw Error('This server version does not expose session revocation. Stop it and update before continuing.');
   auth.revokeAllSessions();return output({sessionsRevoked:true});
  }
  if(command==='adopt-legacy'){
   const agencyId=required(options,'agency');
   if(!/^[A-Za-z0-9_-]{1,100}$/.test(agencyId)||options['confirm-agency']!==agencyId)throw Error('Explicitly repeat the agency ID with --confirm-agency before assigning retained legacy data.');
   const agency=auth.listAgencies().find(a=>a.id===agencyId&&a.active);
   if(!agency)throw Error('An active agency with that ID does not exist.');
   const source=path.join(work,'data','scopewise.sqlite'),directory=path.join(work,'tenants',agencyId),destination=path.join(directory,'scopewise.sqlite');
   U.inside(source);U.inside(destination);
   if(fs.existsSync(destination))throw Error('The agency already has a workspace database. Create a new agency and adopt before its first login.');
   const original=U.checkedDatabase(source,{workspace:true});
   const staged=path.join(work,'operator-staging','legacy-'+require('node:crypto').randomUUID()+'.sqlite');
   U.vacuumSnapshot(source,staged);
   const adopted=U.checkedDatabase(staged,{workspace:true});
   if(original.revision!==adopted.revision||original.savedAt!==adopted.savedAt||original.stateHash!==adopted.stateHash)throw Error('The legacy database changed during adoption. The copied database was preserved; stop writers and review before login.');
   const backupSource=path.join(work,'backups');
   if(fs.existsSync(backupSource)){
    const copy=(from,to)=>{U.inside(from);U.inside(to);const info=fs.lstatSync(from);if(info.isSymbolicLink())throw Error('Legacy backups contain a symbolic link.');if(info.isDirectory()){U.privateDirectory(to);for(const name of fs.readdirSync(from))copy(path.join(from,name),path.join(to,name));}else if(info.isFile()){U.privateWrite(to,fs.readFileSync(from));}};
    copy(backupSource,path.join(directory,'backups','legacy-preserved'));
   }
   U.privateDirectory(directory);
   fs.linkSync(staged,destination);fs.unlinkSync(staged);
   U.privateWrite(path.join(directory,'legacy-adoption.json'),JSON.stringify({agencyId,agencyName:agency.name,adoptedAt:new Date().toISOString(),source:'data/scopewise.sqlite',legacyPreserved:true,revision:adopted.revision,savedAt:adopted.savedAt||null,stateHash:adopted.stateHash||null},null,2)+'\n');
   return output({adopted:true,agencyId,revision:adopted.revision,legacyPreserved:true,destination:path.relative(U.ROOT,destination)});
  }
 }finally{auth.close();}
}
if(require.main===module)main().catch(error=>{console.error('Operator action failed: '+error.message);process.exitCode=1;});
module.exports={main,hiddenPassword,readPasswordText,password};
