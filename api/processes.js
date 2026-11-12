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
