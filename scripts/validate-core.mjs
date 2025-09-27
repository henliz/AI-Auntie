import fs from "node:fs";
const read=p=>fs.readFileSync(p,"utf8");
const ok = m=>console.log("✓",m), bad=(m,e)=>{console.error("✗",m,"—",e.message);process.exit(1);};
try{JSON.parse(read("ai/triage.schema.json"));ok("schema")}catch(e){bad("schema",e)}
try{JSON.parse(read("ai/redflags.json"));ok("redflags")}catch(e){bad("redflags",e)}
try{const a=read("ai/triage.fewshots.jsonl").trim().split("\n").map(l=>JSON.parse(l));if(!a.length)throw new Error("empty");ok("fewshots "+a.length)}catch(e){bad("fewshots",e)}
try{const f=read("ai/facts.jsonl").trim().split("\n").map(l=>JSON.parse(l));if(!f.length)throw new Error("empty");ok("facts "+f.length)}catch(e){bad("facts",e)}
if(!fs.existsSync("ai/demoscripts.md")) bad("demoscripts","missing"); else ok("demoscripts");
