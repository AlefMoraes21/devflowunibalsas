const processes={
 "20383":{kind:"exam",academicId:"223",name:"Vestibular Online"},
 "20386":{kind:"enem",academicId:"226",name:"ENEM"},
 "20385":{kind:"registration",academicId:"225",name:"Transferência"},
 "20384":{kind:"registration",academicId:"224",name:"Portador de Diploma"}
};
// IDPS do sistema acadêmico de todos os processos (a sessão de "Já sou inscrito" não informa qual é o processo).
export const academicIds=[...new Set(Object.values(processes).map(p=>p.academicId))];
export function processPolicy(id){const policy=processes[String(id)];if(!policy)throw new Error("Este processo seletivo ainda não possui um caminho validado neste Flow.");return policy}
export const isDirectRegistration=id=>processes[String(id)]?.kind==="registration";
export const requiresEssay=id=>processes[String(id)]?.kind==="exam";

// Documentos de inscrição (etapa "Documentos inscrição", consulta RB.PS.IM.012), como o site mostrou em 17/11/2026
// (ENGENHARIA-FLOW-INSCRICAO-DIRETA.md). Nos três processos o 1º é o único obrigatório. O worker confere a lista
// no próprio passo do portal antes de enviar.
const INSCRICAO_DIRETA={
 "20385":{titulo:"Transferência 2027/1",docs:[{codigo:"28",titulo:"Histórico acadêmico",obrigatorio:true},{codigo:"29",titulo:"Planos de ensino (ementas)",obrigatorio:false},{codigo:"27",titulo:"Declaração de vínculo acadêmico",obrigatorio:false}]},
 "20384":{titulo:"Portador de Diploma 2027/1",docs:[{codigo:"10",titulo:"Diploma de graduação",obrigatorio:true},{codigo:"17",titulo:"Histórico da graduação",obrigatorio:false},{codigo:"26",titulo:"Certidão de conclusão da graduação",obrigatorio:false}]},
 "20386":{titulo:"Nota do ENEM 2027/1",docs:[{codigo:"25",titulo:"Boletim nota ENEM",obrigatorio:true}]}
};
export const docsInscricao=id=>INSCRICAO_DIRETA[String(id)]?.docs??[];
export const temDocsInscricao=id=>docsInscricao(id).length>0;
export const tituloProcesso=id=>INSCRICAO_DIRETA[String(id)]?.titulo??(processes[String(id)]?processes[String(id)].name+" 2027/1":"processo seletivo 2027/1");
