const scores=[['nota_natureza_enem','Ciências da Natureza'],['nota_humanas_enem','Ciências Humanas'],['nota_matematica_enem','Matemática'],['nota_linguagens_enem','Linguagens'],['nota_redacao_enem','Redação']];
function score(value,label){
 const raw=String(value??'').trim().replace(',','.');
 if(!/^\d+(?:\.\d+)?$/.test(raw))throw new Error(`Informe uma nota numérica para ${label}.`);
 const n=Number(raw);if(!Number.isFinite(n)||n<0||n>1000)throw new Error(`${label} deve estar entre 0 e 1000.`);
 return n;
}
export function enemAverage(data,{checkTyped=true}={}){
 const average=(scores.reduce((sum,[key,label])=>sum+score(data[key],label),0)/5).toFixed(2);
 if(checkTyped&&String(data.media_enem??'').trim()!==''&&Math.abs(score(data.media_enem,'Média')-Number(average))>0.005)throw new Error(`A média das cinco notas é ${average.replace('.',',')}. Confira a média informada ou toque em Calcular média.`);
 return average;
}
export function enemYears(field,fallback){
 const options=field?.options??field?.manual_options??field?.data;
 if(!Array.isArray(options)||!options.length)return fallback;
 const years=options.map(o=>({id:String(o.value??o.id??''),title:String(o.label??o.display??o.value??o.id??'')})).filter(o=>/^\d{4}$/.test(o.id));
 if(!years.length)throw new Error('O formulário não retornou anos válidos para o ENEM.');
 return years;
}
