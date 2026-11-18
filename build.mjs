// Сборка: берёт ключи из переменных окружения и создаёт dist/config.js
import {mkdirSync,copyFileSync,writeFileSync,readdirSync,existsSync,readFileSync} from 'fs';
if(existsSync('.env'))for(const l of readFileSync('.env','utf8').split('\n')){const m=l.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);if(m&&!process.env[m[1]])process.env[m[1]]=m[2]}
const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_PUBLISHABLE_KEY;
if(!url||!key){console.error('Не заданы SUPABASE_URL и SUPABASE_PUBLISHABLE_KEY');process.exit(1)}
mkdirSync('dist',{recursive:true});
for(const f of readdirSync('public'))copyFileSync('public/'+f,'dist/'+f);
writeFileSync('dist/config.js','window.CFG='+JSON.stringify({url,key})+';');
console.log('Готово: папка dist');
