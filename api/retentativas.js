// Ritmo de envio ao Rubeus pelos workers (inscrição, redação, documentos de inscrição e matrícula).
// Dados chegam no Run → 1ª tentativa em 10 s. Se falhar: 30 s, 2 min, 30 min, 30 min, depois 1 h (6ª à 10ª) e
// 6 h 35 min 44 s (11ª à 20ª). Total de 72 h exatas da chegada à 20ª tentativa. Depois da 20ª, a fila fica
// "falhou", guardada no Firestore (criptografada), para a equipe conferir.
// Entre as tentativas o Run fica desligado: cada espera é uma tarefa agendada no Cloud Tasks.
export const PRIMEIRA_TENTATIVA_S = 10;
// Espera antes da próxima tentativa, depois da falha n (n = 1 é a 1ª falha).
const ESPERAS_S = [30, 120, 1800, 1800, ...Array(5).fill(3600), ...Array(10).fill(23744)];
export const MAX_TENTATIVAS = ESPERAS_S.length + 1; // 20
export const esperaDepoisDaFalha = n => ESPERAS_S[Math.min(Math.max(1, n), ESPERAS_S.length) - 1];
