export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Quando o usuário abre o Flow
  if (req.body.action === 'INIT') {
    return res.status(200).json({
      screen: 'ESCOLHA_PROCESSO',
      data: {
        processo_seletivo_id: [
          { id: '18713', title: 'Vestibular Online - 2026/2' },
          { id: '18716', title: 'Transferência - 2026/2' }
        ]
      }
    });
  }

  // Quando clica Continuar na Tela 1
  if (req.body.screen === 'ESCOLHA_PROCESSO') {
    return res.status(200).json({
      screen: 'DADOS_BASICOS',
      data: {}
    });
  }

  res.status(200).json({ screen: 'ESCOLHA_PROCESSO', data: {} });
}
