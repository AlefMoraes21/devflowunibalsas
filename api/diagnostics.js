// Retain the validation explanation, removing submitted values and credentials.
export function validationSummary(json,body){
  const details=json?.errors??json?.data?.errors??json?.error??json?.data?.error??json?.message??json?.data?.message;
  if(details==null)return 'Sem detalhes de validação na resposta.';
  let text=typeof details==='string'?details:JSON.stringify(details);
  const values=[];
  function collect(v){if(typeof v==='string'&&v.length>=3)values.push(v);else if(Array.isArray(v))v.forEach(collect);else if(v&&typeof v==='object')Object.values(v).forEach(collect)}
  collect(body);
  for(const value of values.sort((a,b)=>b.length-a.length))text=text.replace(new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'gi'),'[redigido]');
  return text.replace(/https?:\/\/[^\s"<>]+/gi,'[url]').replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi,'[email]').replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g,'[documento]').replace(/[A-Za-z0-9_\/-]{28,}={0,2}/g,'[identificador]').replace(/[\x00-\x1f]/g,' ').slice(0,800);
}
