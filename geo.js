'use strict';
const $ = selector => document.querySelector(selector);
const state = { mode: 'real', ready: false, job: null, result: null, realResult: null, realDraft: null, busy: false, refreshing: false, poll: null, key: null, payload: null };
const labels = {queued:'排队中',waiting_executor:'等待执行端',running:'正在采集',needs_attention:'等待维护者处理',completed:'已完成',failed:'采集失败'};
const examples = {mode:'example',brand:'知页（虚构品牌）',platform:'示例平台',status:'completed',questions:[
{question:'小团队如何选择知识库工具？',answer:'【界面示例，非模型真实回答】先比较检索能力、权限管理与维护成本。示例中提及知页，用于展示品牌提及的记录方式。',brand_mentioned:true,sources:[]},
{question:'知识库工具应该比较哪些能力？',answer:'【界面示例，非模型真实回答】可以从文档组织、搜索、协作和导入导出四方面建立对照表。本条未出现目标品牌。',brand_mentioned:false,sources:[]},
{question:'怎样把已有文档迁移到团队知识库？',answer:'【界面示例，非模型真实回答】先整理目录与权限，再小批量迁移并验证检索。示例中的知页仅为虚构名称。',brand_mentioned:true,sources:[]}
]};
async function api(path, options={}) {
 const response = await fetch(`api/public${path}`, {...options,credentials:'same-origin',headers:{'Content-Type':'application/json',...(options.headers||{})},signal:AbortSignal.timeout(15000)});
 const data = await response.json().catch(()=>null);
 if(!response.ok || !data) throw new Error(response.status===429?'当前请求较多，请稍后重试。':response.status===401?'访客会话已失效，请刷新页面。':'任务服务暂不可用，请稍后重试。');
 return data;
}
function el(tag,text,className) {const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;}
function setProgress(count) {document.querySelectorAll('.progress span').forEach((node,i)=>node.classList.toggle('active',i<count));}
function resetResult() {
 state.result=null;
 $('#result-title').textContent='任务与结果';$('#result-status').textContent='尚未提交';setProgress(0);$('#result-actions').hidden=true;
 const box=el('div',undefined,'empty');box.append(el('span','↗','empty-symbol'),el('h3','一个好问题，是观察的起点。'),el('p','在左侧填写问题，提交后查看任务状态。也可以切换到“查看示例”，先了解报告如何呈现。'));$('#results').replaceChildren(box);
}
function draw(data,example=false) {
 const items=Array.isArray(data.questions)?data.questions:[];
 state.result={...data,mode:example?'example':'real'};
 if(!example)state.realResult=state.result;
 const completed=items.filter(q=>typeof q.answer==='string'&&q.answer.trim().length>0);
 const analyzed=completed.filter(q=>typeof q.brand_mentioned==='boolean');
 const mentions=analyzed.filter(q=>q.brand_mentioned===true).length;
 $('#result-title').textContent=example?'示例报告 · 虚构数据':'轮询任务';
 $('#result-status').textContent=example?'示例已展示':(labels[data.status]||'等待状态更新');
 setProgress(data.status==='completed'?4:data.status==='running'?3:2);
 const fragment=document.createDocumentFragment();
 if(example)fragment.append(el('div','以下为预设虚构示例，没有调用任何 AI 平台。','notice'));
 if(data.job_id)fragment.append(el('p',`任务编号：${data.job_id}`,'subtle'));
 const metrics=el('div',undefined,'metrics');
 [['问题总数',String(data.total_questions??items.length)],['已取得回答',String(completed.length)],['品牌提及 / 已分析回答',analyzed.length?`${mentions} / ${analyzed.length}`:'—']].forEach(([name,value])=>{const m=el('div',undefined,'metric');m.append(el('strong',value),el('span',name));metrics.append(m)});fragment.append(metrics);
 if(completed.length>analyzed.length)fragment.append(el('p',`${completed.length-analyzed.length} 条回答的品牌提及尚未分析，暂不计入提及统计。`,'subtle'));
 if(!items.length) fragment.append(el('p',data.status==='failed'?'本次任务未完成，请保留任务编号联系维护者。':'任务已登记，等待执行端处理。尚未获得平台回答。','subtle'));
 items.forEach((item,i)=>{const row=el('article',undefined,'result-item');row.append(el('h3',`${i+1}. ${item.question||'问题'}`),el('p',item.answer||'等待采集，暂无回答。'));row.append(el('small',item.answer?(item.brand_mentioned===true?'已提及目标品牌':item.brand_mentioned===false?'未提及目标品牌':'品牌提及尚未分析'):'未完成，未计入提及统计'));
 const sources=Array.isArray(item.sources)?item.sources:[];
 sources.forEach(source=>{try{const url=new URL(source.url);if(!['https:','http:'].includes(url.protocol))return;const link=el('a',source.title||url.hostname,'text-link');link.href=url.href;link.target='_blank';link.rel='noopener noreferrer';link.style.display='block';row.append(link)}catch{}});
 if(!sources.length)row.append(el('p',example?'示例未提供真实信源。':'本条暂无已记录信源。','subtle'));
 fragment.append(row)});
 $('#results').replaceChildren(fragment);$('#result-actions').hidden=false;$('#refresh-job').hidden=example||['completed','failed'].includes(data.status);
}
function updateButton() {const b=$('#submit-job');b.disabled=state.busy||(state.mode==='real'&&(!state.ready||Boolean(state.job)));b.textContent=state.mode==='example'?'查看示例报告 →':state.busy?'正在提交…':state.job?'任务已提交':state.ready?'提交真实轮询 →':'真实服务尚未接通';}
function switchMode(mode) {
 if(mode!==state.mode){
  if(mode==='example'){
   state.realDraft={brand:$('#brand').value,platform:$('#platform').value,questions:$('#questions').value,competitors:$('#competitors').value};
   const option=el('option','示例平台');option.value='example';option.id='example-platform-option';$('#platform').append(option);
   $('#brand').value=examples.brand;$('#platform').value='example';$('#questions').value=examples.questions.map(item=>item.question).join('\n');$('#competitors').value='';
  }else{
   $('#example-platform-option')?.remove();
   if(state.realDraft)for(const [field,value] of Object.entries(state.realDraft))$('#'+field).value=value;
  }
  $('#question-count').textContent=`${questions().length} / 3`;
 }
 state.mode=mode;$('#real-tab').setAttribute('aria-selected',String(mode==='real'));$('#example-tab').setAttribute('aria-selected',String(mode==='example'));$('#input-panel').setAttribute('aria-labelledby',mode==='real'?'real-tab':'example-tab');$('#form-error').textContent='';
 $('#form-heading').textContent=mode==='real'?'新建轮询任务':'示例任务';
 for(const selector of ['#brand','#platform','#questions','#competitors'])$(selector).disabled=mode==='example'||Boolean(state.job);
 $('#submit-help').textContent=mode==='example'?'示例为预先编写的虚构内容，仅用于了解界面与报告结构。':'真实任务进入队列后，由执行端采集。请保留当前页面查看进度。';
 if(mode==='example')draw(examples,true);else if(state.job){
  if(state.realResult)draw(state.realResult);else{resetResult();$('#result-status').textContent='正在读取任务';$('#results').replaceChildren(el('p','正在读取真实任务进度…','subtle'));}
  if(!['completed','failed'].includes(state.realResult?.status))refreshJob();
 }else resetResult();updateButton();
}
function questions(){return $('#questions').value.split('\n').map(x=>x.trim()).filter(Boolean)}
$('#questions').addEventListener('input',()=>{$('#question-count').textContent=`${questions().length} / 3`});
$('#real-tab').addEventListener('click',()=>switchMode('real'));$('#example-tab').addEventListener('click',()=>switchMode('example'));
for(const [id,other] of [['real-tab','example-tab'],['example-tab','real-tab']]) $('#'+id).addEventListener('keydown',event=>{if(['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();$('#'+other).focus();switchMode(other==='real-tab'?'real':'example')}});
$('#job-form').addEventListener('submit',async event=>{
 event.preventDefault();if(state.mode==='example'){draw(examples,true);return;}if(state.busy||!state.ready||state.job)return;
 const qs=questions();const competitors=$('#competitors').value.split(/[,，]/).map(x=>x.trim()).filter(Boolean);$('#form-error').textContent='';
 if(qs.length<1||qs.length>3||qs.some(q=>q.length>300)||!$('#brand').value.trim()||competitors.length>3){$('#form-error').textContent='请填写品牌和 1–3 个问题，每题不超过 300 字，竞品最多 3 个。';return;}
 const payload=JSON.stringify({brand:$('#brand').value.trim(),platform:$('#platform').value,questions:qs,competitors});
 if(payload!==state.payload){state.key=crypto.randomUUID();state.payload=payload;}state.busy=true;updateButton();
 try{const job=await api('/jobs',{method:'POST',headers:{'Idempotency-Key':state.key},body:payload});if(!job.job_id)throw new Error('服务未返回任务编号，请勿重复创建，稍后重试。');state.job=job.job_id;state.realResult={...job,mode:'real'};if(state.mode==='real')draw(job);for(const selector of ['#brand','#platform','#questions','#competitors'])$(selector).disabled=true;if(!['completed','failed'].includes(job.status))state.poll=setTimeout(refreshJob,5000)}catch(error){if(state.mode==='real')$('#form-error').textContent=error.message||'暂时无法确认提交结果；重试会使用相同请求编号。'}finally{state.busy=false;updateButton()}
});
async function refreshJob(){
 if(!state.job||state.refreshing||['completed','failed'].includes(state.realResult?.status))return;
 clearTimeout(state.poll);state.poll=null;state.refreshing=true;$('#refresh-job').disabled=true;
 const jobId=state.job;
 try{
  const job=await api(`/jobs/${encodeURIComponent(jobId)}`);
  if(state.job!==jobId)return;
  state.realResult={...job,mode:'real'};
  if(state.mode==='real'){draw(job);$('#form-error').textContent='';}
  if(!['completed','failed'].includes(job.status))state.poll=setTimeout(refreshJob,8000);
 }catch(error){if(state.mode==='real')$('#form-error').textContent='暂时无法刷新任务，请点击“刷新进度”重试。'}
 finally{state.refreshing=false;$('#refresh-job').disabled=false;}
}
$('#refresh-job').addEventListener('click',refreshJob);
$('#export-results').addEventListener('click',()=>{if(!state.result||state.result.mode!==state.mode)return;const url=URL.createObjectURL(new Blob([JSON.stringify(state.result,null,2)],{type:'application/json'}));const a=el('a');a.href=url;a.download=state.result.mode==='example'?'geo-example-not-real.json':'geo-job-result.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)});
(async()=>{try{const health=await api('/health');state.ready=health.accepting_jobs===true&&Array.isArray(health.platforms)&&health.platforms.includes('doubao');}catch{state.ready=false;}$('#service-notice').textContent=state.ready?'真实轮询服务可接收任务。提交后进入队列，执行时长取决于平台和执行端状态。':'真实轮询服务尚未接通，目前不会发送问题或启动采集。可先填写任务，或切换到“查看示例”了解报告。';updateButton()})();
