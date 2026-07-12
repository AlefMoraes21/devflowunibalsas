export default async function handler(req, res) {
  if (req.body.action === 'INIT') {
    const resp = await fetch('https://admin.portal.apprbs.com.br/api/v1/selective-processes?portal=257', {
      headers: { 'Authorization': 'Bearer 1e527dbd3b9bc702b65cccfed83d31ba0ab4bb401fb6b85b8e4256fef8fca49a' }
    });
    const json = await resp.json();
    const dataSource = json.data.map(p => ({ id: String(p.id), title: p.name }));
    
    return res.json({
      screen: 'ESCOLHA_PROCESSO',
      data: { processo_seletivo_id: dataSource }
    });
  }
  
  if (req.body.screen === 'ESCOLHA_PROCESSO') {
    return res.json({ screen: 'DADOS_BASICOS', data: {} });
  }
}