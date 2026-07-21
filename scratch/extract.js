const fs=require('fs');
const p='/Users/sachingupta/.claude/projects/-Users-sachingupta-Developer-game/6f6ac087-11af-4975-84cf-3d8f7b6ef35b/subagents/workflows/wf_eefb8289-1bf/journal.jsonl';
const lines=fs.readFileSync(p,'utf8').trim().split('\n').map(l=>JSON.parse(l));
const results=lines.filter(l=>l.type==='result'&&l.result&&l.result.findings);
const out=results.map(r=>r.result);
fs.writeFileSync('/private/tmp/claude-501/-Users-sachingupta-Developer-game/6f6ac087-11af-4975-84cf-3d8f7b6ef35b/scratchpad/analyst-findings.json',JSON.stringify(out,null,2));
console.log('subsystems:',out.map(o=>o.subsystem).join(' | '));
console.log('total findings:',out.reduce((a,o)=>a+o.findings.length,0));
