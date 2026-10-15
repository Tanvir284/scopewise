'use strict';
const fs=require('node:fs'),path=require('node:path');
const U=require('./operator-utils.cjs');
const {password}=require('./admin.cjs');
const {createPostgresBackend}=require('../lib/postgres.cjs');
const Transfer=require('../lib/postgres-transfer.cjs');
const HELP=[
'Scopewise external PostgreSQL administration. DATABASE_URL comes from a private environment file.',
'  init',
'  agency-create --name NAME | agency-list',
'  user-create --agency ID --username NAME --role owner|editor|viewer [hidden password input]',
'  user-list [--agency ID] | user-reset --user ID [hidden password input]',
'  user-role --user ID --role ROLE | user-revoke --user ID | sessions-revoke-all',
'  export --output work/backups/NEW.json',
'  import --input work/backups/FILE.json --confirm-empty-target',
'  sqlite-export --work work --output work/backups/NEW.json [--quiescent]',
'  legacy-list | adopt-legacy --legacy ID --agency ID --confirm-agency ID',
'Keep private backups and credentials out of Git. No passwords or database URLs in arguments.'
].join('\n');
function required(options,key){if(!options[key])throw Error('Required option: --'+key);return options[key];}
function output(value){console.log(JSON.stringify(value,null,2));}
async function main(argv=process.argv.slice(2)){
 const command=argv.shift();if(!command||command==='--help'){console.log(HELP);return;}
 const schemas={
  init:{},'agency-create':{'--name':'value'},'agency-list':{},
  'user-create':{'--agency':'value','--username':'value','--role':'value','--password-file':'value','--password-stdin':'boolean'},
  'user-list':{'--agency':'value'},'user-reset':{'--user':'value','--password-file':'value','--password-stdin':'boolean'},
  'user-role':{'--user':'value','--role':'value'},'user-revoke':{'--user':'value'},'sessions-revoke-all':{},
  export:{'--output':'value'},import:{'--input':'value','--confirm-empty-target':'boolean'},
  'sqlite-export':{'--work':'value','--output':'value','--quiescent':'boolean'},
  'legacy-list':{},'adopt-legacy':{'--legacy':'value','--agency':'value','--confirm-agency':'value'}
 };
 if(!Object.hasOwn(schemas,command))throw Error('Unknown command. Use --help.');
 const a=U.parseArgs(argv,schemas[command]);
 if(command==='sqlite-export'){
  const target=U.inside(path.resolve(U.ROOT,required(a,'output')));if(fs.existsSync(target))throw Error('Choose a new output file.');
  const exported=Transfer.exportSqlite({workDir:a.work,quiescent:a.quiescent});U.privateWrite(target,JSON.stringify(exported.bundle)+'\n');
  output({exported:true,file:path.relative(U.ROOT,target),sqliteBackup:path.relative(U.ROOT,exported.sqliteBackup),legacySources:exported.bundle.data.legacy_sources.length,sessionsExcluded:true});return;
 }
 const backend=createPostgresBackend({databaseUrl:process.env.DATABASE_URL});
 try{
  if(command==='init'){await backend.init();return output({initialized:true,schemaVersion:1});}
  await backend.ready();const auth=backend.auth;
  if(command==='agency-create')return output(await auth.createAgency({name:required(a,'name')}));
  if(command==='agency-list')return output(await auth.listAgencies());
  if(command==='user-list')return output(await auth.listUsers(a.agency?{agencyId:a.agency}:{}));
  if(command==='user-create')return output(await auth.createUser({agencyId:required(a,'agency'),username:required(a,'username'),role:required(a,'role'),password:await password(a)}));
  if(command==='user-reset'){await auth.resetPassword(required(a,'user'),await password(a));return output({reset:true,sessionsRevoked:true});}
  if(command==='user-role'){await auth.updateRole(required(a,'user'),required(a,'role'));return output({updated:true,sessionsRevoked:true});}
  if(command==='user-revoke'){await auth.revokeUser(required(a,'user'));return output({revoked:true,sessionsRevoked:true});}
  if(command==='sessions-revoke-all'){await auth.revokeAllSessions();return output({sessionsRevoked:true});}
  if(command==='export'){const target=U.inside(path.resolve(U.ROOT,required(a,'output')));if(fs.existsSync(target))throw Error('Choose a new output file.');U.privateWrite(target,JSON.stringify(await Transfer.exportPostgres(backend))+'\n');return output({exported:true,file:path.relative(U.ROOT,target),sessionsExcluded:true});}
  if(command==='import'){if(!a['confirm-empty-target'])throw Error('Explicit --confirm-empty-target is required.');const input=U.inside(path.resolve(U.ROOT,required(a,'input')));U.fileInfo(input);return output(await Transfer.importPostgres(backend,JSON.parse(fs.readFileSync(input,'utf8'))));}
  if(command==='legacy-list')return output((await backend.pool.query('SELECT id FROM scopewise.legacy_sources ORDER BY id')).rows);
  if(command==='adopt-legacy'){const agencyId=required(a,'agency');if(a['confirm-agency']!==agencyId)throw Error('Repeat the intended agency ID with --confirm-agency.');return output(await Transfer.adoptLegacy(backend,{agencyId,legacyId:required(a,'legacy')}));}
 }finally{await backend.close();}
}
if(require.main===module)main().catch(error=>{console.error('Database operator action failed. No credentials were printed. '+(error.code&&/^[A-Z0-9_]{1,40}$/.test(error.code)?'Code: '+error.code:'Check command options, private settings and database availability.'));process.exitCode=1;});
module.exports={main};
