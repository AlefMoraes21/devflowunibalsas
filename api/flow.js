import crypto from 'crypto';

export default async function handler(req, res) {
  if (req.method === 'GET') return res.status(200).send('ok');
  if (req.method !== 'POST') return res.status(405).send('Method not allowed');

  try {
    const { encrypted_flow_data, encrypted_aes_key, initial_vector } = req.body;
    const privateKey = process.env.FLOW_PRIVATE_KEY?.replace(/\\n/g, '\n');

    const aesKey = crypto.privateDecrypt(
      { key: privateKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
      Buffer.from(encrypted_aes_key, 'base64')
    );

    const iv = Buffer.from(initial_vector, 'base64');
    const encryptedData = Buffer.from(encrypted_flow_data, 'base64');
    const authTag = encryptedData.subarray(-16);
    const data = encryptedData.subarray(0, -16);

    const decipher = crypto.createDecipheriv('aes-128-gcm', aesKey, iv);
    decipher.setAuthTag(authTag);
    const decrypted = decipher.update(data, undefined, 'utf8') + decipher.final('utf8');
    const requestData = JSON.parse(decrypted);

    let responsePayload;

    // 1. Health Check que a Meta faz na hora de publicar
    if (requestData.action === 'ping') {
      responsePayload = { data: { status: 'active' } };
    } 
    // 2. Quando usuário abre o Flow
    else if (requestData.action === 'INIT') {
      try {
        const rbsRes = await fetch(`https://admin.portal.apprbs.com.br/api/v1/selective-processes?portal=257`, {
          headers: { 'Authorization': `Bearer ${process.env.RBS_TOKEN}` }
        });
        const json = await rbsRes.json();
let lista = json.data?.map(p => ({ id: String(p.id), title: p.name })) || [];

if (lista.length === 0) throw new Error('RBS vazia'); // força cair no fallback

responsePayload = { screen: 'ESCOLHA_PROCESSO', data: { processo_seletivo_id: lista } };
      } catch (e) {
        // Fallback se a RBS falhar, pra não quebrar a publicação
        responsePayload = {
          screen: 'ESCOLHA_PROCESSO',
          data: {
            processo_seletivo_id: [
              { id: '18713', title: 'Vestibular Online - 2026/2' },
              { id: '18716', title: 'Transferência - 2026/2' },
              { id: '18715', title: 'Portador de Diploma - 2026/2' },
              { id: '18714', title: 'Nota do ENEM - 2026/2' }
            ]
          }
        };
      }
    } 
    // 3. Qualquer outro caso
    else {
      responsePayload = { data: { status: 'active' } };
    }

    // Criptografa resposta com IV invertido
    const flippedIv = Buffer.from(iv.map(b => b ^ 0xFF));
    const cipher = crypto.createCipheriv('aes-128-gcm', aesKey, flippedIv);
    const enc = Buffer.concat([cipher.update(JSON.stringify(responsePayload), 'utf8'), cipher.final()]);
    const finalBuf = Buffer.concat([enc, cipher.getAuthTag()]).toString('base64');

    res.setHeader('Content-Type', 'text/plain');
    return res.status(200).send(finalBuf);

  } catch (err) {
    console.error('FLOW ERROR:', err);
    return res.status(500).send(err.message);
  }
}
