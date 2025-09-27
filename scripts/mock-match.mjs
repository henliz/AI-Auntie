import fs from "node:fs";

const csv = fs.readFileSync("resources/demo_resources.csv","utf8").trim().split("\n");
const [header, ...rows] = csv;
const cols = header.split(",");
const data = rows.map(r => {
  const vals = r.split(",");
  const o = {};
  cols.forEach((c,i)=>o[c]=vals[i]);
  o.trust_score = Number(o.trust_score || 0);
  return o;
});

export function matchResources(topic, region="ON", country="CA", n=3){
  const pool = data.filter(d => d.country===country && d.region===region &&
    (d.topic===topic || (topic==="mood" && d.topic==="escalate"))); // simple fallback
  return pool.sort((a,b)=>b.trust_score-a.trust_score).slice(0,n);
}

// quick demo:
if (process.argv[1].endsWith("mock-match.mjs")) {
  console.log(matchResources("latch","ON","CA"));
}
