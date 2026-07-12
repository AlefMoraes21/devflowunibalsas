export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const RBS_TOKEN = '1e527dbd3b9bc702b65cccfed83d31ba0ab4bb401fb6b85b8e4256fef8fca49a';
  const RBS_PORTAL = '257';

  // Só trata o INIT por enquanto
  if (req.body.action === 'INIT') {
    try {
      // 1. Chama a API da RBS
      const rbs = await fetch(`https://admin.portal.apprbs.com.br/api/v1/selective-processes?portal=${RBS_PORTAL}`, {
        headers: { 
          'Authorization': `Bearer ${RBS_TOKEN}`,
          'Accept': 'application/json'
        }
      });

      if (!rbs.ok) {
        throw new Error(`RBS API erro: ${rbs.status}`);
      }

      const json = await rbs.json();
      
      // 2. Converte o formato da RBS pro formato do Flow
      const processos = json.data.map(p => ({
        id: String(p.id), // WhatsApp quer string
        title: p.name     // RBS manda 'name', Flow quer 'title'
      }));

      // 3. Retorna pro WhatsApp
      return res.status(200).json({
        screen: 'ESCOLHA_PROCESSO',
        data: {
          processo_seletivo_id: processos
        }
      });

    } catch (error) {
      console.error('Erro RBS:', error);
      // Se der erro na RBS, retorna fallback hardcoded pra não quebrar
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
  }

  // Qualquer outra ação, só devolve a tela 1 mesmo
  res.status(200).json({
    screen: 'ESCOLHA_PROCESSO',
    data: { processo_seletivo_id: [] }
  });
}
