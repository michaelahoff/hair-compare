import type { PreparedCase } from "./cases";
import { digest, type RecordRow } from "./run";

/** Offline review: no keys, external assets, provider names, costs or gold labels. */
export function renderReview(cases: PreparedCase[], rows: RecordRow[], seed: string): string {
  const records = [...rows].sort((a, b) => digest(seed + a.reportId).localeCompare(digest(seed + b.reportId))).map((r) => {
    const prepared = cases.find((c) => c.case.id === r.caseId)!;
    const current = { ...prepared.case.current, path: undefined };
    const previous = prepared.case.previous ? { ...prepared.case.previous, path: undefined } : null;
    return {
      reportId: r.reportId,
      caseId: r.caseId,
      current,
      previous: prepared.case.previous ? previous : null,
      treatments: prepared.case.treatments,
      images: r.imageHashes.map((hash) => `assets/${hash}.jpg`),
      status: r.status,
      analysis: r.analysis ?? null,
    };
  });
  const data = JSON.stringify({ runId: seed, records }).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' data: file:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'; base-uri 'none'; form-action 'none'">
<title>Scalp report review</title>
<style>
body{font:16px system-ui,sans-serif;margin:0;background:#f6f5f0;color:#222}main{max-width:1000px;margin:auto;padding:24px}h1{font-size:26px}select,input,textarea,button{font:inherit;padding:10px;border:1px solid #aaa;border-radius:6px}button{cursor:pointer;background:#173c35;color:white}nav{display:flex;gap:12px;flex-wrap:wrap;align-items:center}.photos{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px;margin:20px 0}.photos figure{margin:0}.photos img{display:block;width:100%;height:auto;background:#ddd}.photo{position:relative}.box{position:absolute;border:2px solid #d44;box-sizing:border-box;pointer-events:none}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:white;padding:16px;border-radius:8px}.ratings{display:grid;gap:12px;background:white;padding:16px}label{display:flex;gap:12px;align-items:center;flex-wrap:wrap}textarea{width:90%;min-height:80px}.muted{color:#555;font-size:14px}
</style>
<main><h1>Scalp report review</h1><p>Score visible evidence and uncertainty before looking at model identities. Synthetic cases test mechanics only.</p>
<nav><label>Reviewer ID <input id="reviewer" placeholder="Pseudonym"></label><select id="reports" aria-label="Report"></select><button id="export">Export scores</button><span id="progress"></span></nav>
<p class="muted">Scores stay in this page until exported. Export before closing or refreshing.</p>
<h2 id="heading"></h2><div class="photos" id="photos"></div><details><summary>Capture conditions and treatment dates</summary><pre id="context"></pre></details><pre id="analysis"></pre>
<form class="ratings" id="ratings">
<p>0 = poor, 1 = mixed, 2 = good. Leave unscored when you cannot judge.</p>
<label>Visible evidence <select name="evidence"></select></label>
<label>Appropriate uncertainty <select name="uncertainty"></select></label>
<label>Lighting / length / angle handling <select name="confounds"></select></label>
<label>Useful, clear summary <select name="clarity"></select></label>
<label>Region observations / locations <select name="regions"></select></label>
<label><input type="checkbox" name="critical"> Unsupported diagnosis, treatment advice or causal claim</label>
<label>Notes <textarea name="notes" maxlength="2000"></textarea></label>
</form></main>
<script id="data" type="application/json">${data}</script>
<script>
const data=JSON.parse(document.getElementById('data').textContent);
const picker=document.getElementById('reports'),form=document.getElementById('ratings'),scores={};
for(const r of data.records){const o=document.createElement('option');o.value=r.reportId;o.textContent=r.reportId+' / '+r.caseId;picker.append(o)}
for(const s of form.querySelectorAll('select')){for(const [v,t] of [['','Unscored'],['0','0 — Poor'],['1','1 — Mixed'],['2','2 — Good']]){const o=document.createElement('option');o.value=v;o.textContent=t;s.append(o)}}
function show(){const r=data.records.find(x=>x.reportId===picker.value);if(!r)return;document.getElementById('heading').textContent=r.reportId+' / '+r.caseId;const photos=document.getElementById('photos');photos.replaceChildren();r.images.forEach((src,i)=>{const figure=document.createElement('figure'),caption=document.createElement('figcaption'),img=document.createElement('img'),wrap=document.createElement('div');wrap.className='photo';caption.textContent=r.images.length===2&&i===0?'Previous':'Current';img.src=src;img.alt=caption.textContent+' scalp photo';wrap.append(img);if(i===r.images.length-1&&r.analysis){for(const region of r.analysis.regions){const b=region.box;if(!b||b.x+b.width>1||b.y+b.height>1)continue;const box=document.createElement('span');box.className='box';box.title=region.area+': '+region.observation;box.style.left=b.x*100+'%';box.style.top=b.y*100+'%';box.style.width=b.width*100+'%';box.style.height=b.height*100+'%';wrap.append(box)}}figure.append(caption,wrap);photos.append(figure)});document.getElementById('context').textContent=JSON.stringify({previous:r.previous,current:r.current,treatments:r.treatments},null,2);document.getElementById('analysis').textContent=r.analysis?JSON.stringify(r.analysis,null,2):'No valid report returned.';const score=scores[r.reportId]||{};for(const el of form.elements){if(!el.name)continue;if(el.type==='checkbox')el.checked=!!score[el.name];else el.value=score[el.name]??''}form.inert=!r.analysis;document.getElementById('progress').textContent=Object.keys(scores).length+' reports touched / '+data.records.length}
form.addEventListener('input',()=>{const score={};for(const el of form.elements){if(!el.name)continue;score[el.name]=el.type==='checkbox'?el.checked:el.tagName==='SELECT'?(el.value===''?null:Number(el.value)):el.value}scores[picker.value]=score;document.getElementById('progress').textContent=Object.keys(scores).length+' reports touched / '+data.records.length});
picker.addEventListener('change',show);
document.getElementById('export').addEventListener('click',()=>{const records=Object.entries(scores).map(([reportId,score])=>({reportId,...score}));const blob=new Blob([JSON.stringify({version:1,runId:data.runId,reviewer:document.getElementById('reviewer').value,records},null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='review-scores.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)});
show();
</script></html>`;
}
