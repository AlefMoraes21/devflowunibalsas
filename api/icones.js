// Ícones da lista de status do Portal do candidato (flows/img, PNG de ~0,6 KB cada), em base64 para o campo
// `start.image` da NavigationList. Sem o arquivo, a linha sai sem ícone (o Flow funciona igual).
import { readFileSync } from 'node:fs';

function ler(nome) {
  try { return readFileSync(new URL('../flows/img/' + nome, import.meta.url)).toString('base64'); } catch { return null; }
}
export const ICONES = {
  ok: ler('icone_ok.png'),
  pendente: ler('icone_pendente.png'),
  analise: ler('icone_analise.png'),
  recusado: ler('icone_recusado.png')
};
