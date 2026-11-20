// Cursos da inscrição, fixos no Flow (2027/1). O candidato escolhe nesta lista sem chamar o Run (no WhatsApp Web,
// a escolha que chamava o Run para carregar o turno fazia o Flow voltar à 1ª tela). O worker acha o curso e o turno
// no Rubeus pelo nome, na hora de enviar: `busca` é o começo do nome do curso no Rubeus (sem acento, maiúsculas)
// e `turno` é o nome do turno esperado. Conferido no catálogo do Vestibular 20383 em 19/11/2026: todos noturnos,
// exceto Medicina Veterinária e Odontologia (integral). Atualizar a cada semestre, junto com a lista de processos.
export const CURSOS_FIXOS = [
  { id: 'agronomia', title: 'AGRONOMIA', busca: 'AGRONOMIA', turno: 'NOTURNO' },
  { id: 'ads', title: 'ANÁLISE E DESENV. DE SISTEMAS', busca: 'ANALISE E DESENVOLVIMENTO', turno: 'NOTURNO' },
  { id: 'biomedicina', title: 'BIOMEDICINA', busca: 'BIOMEDICINA', turno: 'NOTURNO' },
  { id: 'contabeis', title: 'CIÊNCIAS CONTÁBEIS', busca: 'CIENCIAS CONTABEIS', turno: 'NOTURNO' },
  { id: 'direito', title: 'DIREITO', busca: 'DIREITO', turno: 'NOTURNO' },
  { id: 'enfermagem', title: 'ENFERMAGEM', busca: 'ENFERMAGEM', turno: 'NOTURNO' },
  { id: 'estetica', title: 'ESTÉTICA E COSMÉTICA', busca: 'ESTETICA', turno: 'NOTURNO' },
  { id: 'veterinaria', title: 'MEDICINA VETERINÁRIA', busca: 'MEDICINA VETERINARIA', turno: 'INTEGRAL' },
  { id: 'odontologia', title: 'ODONTOLOGIA', busca: 'ODONTOLOGIA', turno: 'INTEGRAL' },
  { id: 'publicidade', title: 'PRODUÇÃO PUBLICITÁRIA', busca: 'PRODUCAO PUBLICITARIA', turno: 'NOTURNO' },
  { id: 'psicologia', title: 'PSICOLOGIA', busca: 'PSICOLOGIA', turno: 'NOTURNO' }
];

// Opções da lista no Flow (só id, título e descrição: o formato da Meta).
// Nome do curso no título e o turno no subtítulo (description): "Turno: Noturno".
const turnoTexto = t => 'Turno: ' + t.charAt(0) + t.slice(1).toLowerCase();
export const opcoesCursos = () => CURSOS_FIXOS.map(({ id, title, turno }) => ({ id, title, description: turnoTexto(turno) }));

const chave = v => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
export const cursoFixo = id => CURSOS_FIXOS.find(c => c.id === String(id ?? '')) ?? null;

// Curso do Rubeus (lista do processo) que corresponde ao curso fixo, pelo começo do nome.
export function cursoNoRubeus(fixo, cursosRubeus) {
  const alvo = chave(fixo?.busca);
  const achados = (cursosRubeus ?? []).filter(c => chave(c.title).startsWith(alvo));
  return achados.length === 1 ? achados[0] : null;
}

// Turno do Rubeus que corresponde ao turno esperado; com um turno só, usa ele.
export function turnoNoRubeus(fixo, turnosRubeus) {
  const lista = turnosRubeus ?? [];
  const pelo = lista.filter(t => chave(t.title).includes(chave(fixo?.turno)));
  if (pelo.length === 1) return pelo[0];
  return lista.length === 1 ? lista[0] : null;
}
