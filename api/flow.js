import crypto from 'crypto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const RUBEUS_BASE = process.env.RUBEUS_BASE_URL || 'https://admin.portal.apprbs.com.br/api/v1'
const RUBEUS_KEY = process.env.RUBEUS_API_KEY
const PROCESSO_ENEM_ID = '18714'
const DATASOURCE_CURSO_ENEM = '692a07a6fd009df99f7e77570902f45ab186577cec8fa1dd2570a1fa7dc88513'
const DATASOURCE_CURSO_GERAL = 'bea2a4e9cd1511ba11b6031de620e254dd43834dcdd9387cfed56e049b76f428'

function decryptRequest(body, privatePem, passphrase) {
  const privateKey = crypto.createPrivateKey({ key: privatePem, passphrase: passphrase || '' })
  const encryptedAesKey = Buffer.from(body.encrypted_aes_key, 'base64')
  const aesKey = crypto.privateDecrypt(
    { key: privateKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
    encryptedAesKey
  )
  const encryptedFlowData = Buffer.from(body.encrypted_flow_data, 'base64')
  const iv = Buffer.from(body.initial_vector, 'base64')
  const encryptedData = encryptedFlowData.subarray(0, -16)
  const authTag = encryptedFlowData.subarray(-16)
  const decipher = crypto.createDecipheriv('aes-128-gcm', aesKey, iv)
  decipher.setAuthTag(authTag)
  let decrypted = decipher.update(encryptedData)
  decrypted = Buffer.concat([decrypted, decipher.final()])
  return {
    decryptedBody: JSON.parse(decrypted.toString('utf8')),
    aesKeyBuffer: aesKey,
    initialVectorBuffer: iv
  }
}

function encryptResponse(data, aesKey, iv) {
  const flippedIv = Buffer.alloc(iv.length)
  for (let i = 0; i < iv.length; i++) flippedIv[i] = ~iv[i]
  const cipher = crypto.createCipheriv('aes-128-gcm', aesKey, flippedIv)
  const jsonStr = JSON.stringify(data)
  let encrypted = cipher.update(jsonStr, 'utf8')
  encrypted = Buffer.concat([encrypted, cipher.final(), cipher.getAuthTag()])
  return encrypted.toString('base64')
}

async function rubeus(path, method='GET', body=null) {
  const headers = { 'Authorization': `Bearer ${RUBEUS_KEY}`, 'Content-Type': 'application/json' }
  const opts = { method, headers }
  if (body) opts.body = JSON.stringify(body)
  const res = await fetch(`${RUBEUS_BASE}${path}`, opts)
  const text = await res.text()
  let json
  try { json = JSON.parse(text) } catch { json = { raw: text } }
  console.log('RUBEUS RESPONSE:', { path, status: res.status, duration_ms: 0 })
  if (!res.ok) {
    console.error('RUBEUS ERRO:', JSON.stringify(json).substring(0, 2000))
    throw new Error(`Rubeus ${path} erro ${res.status}: ${JSON.stringify(json).substring(0,500)}`)
  }
  return json
}

function buildBasicScreenData({ token, target, local, buttonId, formInfo, processoId }) {
  // CORREÇÃO AQUI - antes estava usando variavel notaEnem que não existe
  const isNotaEnem = String(processoId) === String(PROCESSO_ENEM_ID)
  const ehNotaEnem = isNotaEnem // alias para compatibilidade com Flow

  // IDs dos campos - vem do /form ou fallback
  const fields = formInfo?.fields || {}

  return {
    token: String(token),
    target: String(target),
    local: String(local),
    button_id: String(buttonId),
    campo_nome_id: String(fields.nome || '38544'),
    campo_possui_nome_social_id: String(fields.possui_nome_social || '38606'),
    campo_nome_social_id: String(fields.nome_social || '38607'),
    campo_email_id: String(fields.email || '38545'),
    campo_data_nascimento_id: String(fields.data_nascimento || '38566'),
    campo_celular_id: String(fields.celular || '38546'),
    campo_genero_id: String(fields.genero || '38564'),
    campo_consentimento_id: String(fields.consentimento || '38679'),
    campo_idps_id: String(fields.idps || '38548'),
    campo_lgpd_assinatura_id: String(fields.lgpd_assinatura || '38707'),
    campo_lgpd_base_legal_id: String(fields.lgpd_base_legal || '38708'),
    campo_genero_rubeus_id: String(fields.genero_rubeus || '38565'),
    idps_valor: isNotaEnem ? '220' : '217',
    lgpd_assinatura_valor: '1',
    lgpd_base_legal_valor: '4',
    data_maxima_nascimento: new Date().toISOString().split('T')[0],
    titulo_etapa: 'Dados básicos',
    erro: '',
    processo_seletivo_id: String(processoId),
    eh_nota_enem: ehNotaEnem
  }
}

async function routeFlowRequest(decryptedBody) {
  const { screen, data: payload } = decryptedBody
  const acao = payload?.acao
  console.log('FLOW REQUEST:', { action: decryptedBody.action, screen, customAction: acao })
  if (acao) console.log(`${acao} raw:`, payload.processo_seletivo_id || payload.curso_id || '', 'full data:', JSON.stringify(payload).substring(0,1000))

  if (acao === 'selecionar_processo') {
    const processoId = payload.processo_seletivo_id
    const isNotaEnem = String(processoId) === String(PROCESSO_ENEM_ID)

    const start = await rubeus('/start','POST',{ process: Number(processoId) })
    const token = start.token
    const next = start.data.next
    const local = start.data.local

    const form = await rubeus('/form','POST',{ target: next, local, token })

    // Extrai button e field ids do form se vier
    const buttonId = form?.data?.button_id || form?.button_id || '3590261'

    const basicData = buildBasicScreenData({
      token,
      target: next,
      local,
      buttonId,
      formInfo: {},
      processoId
    })

    return { screen: 'DADOS_BASICOS', data: basicData }
  }

  if (acao === 'enviar_dados_basicos') {
    const isNotaEnem = payload.eh_nota_enem === true || payload.eh_nota_enem === 'true' || String(payload.processo_seletivo_id) === PROCESSO_ENEM_ID

    await rubeus('/submit','POST',{
      button: Number(payload.button_id),
      validate_on_server: true,
      token: payload.token,
      data: [
        { field_id: Number(payload.campo_nome_id), value: payload.nome },
        { field_id: Number(payload.campo_possui_nome_social_id), value: payload.possui_nome_social === true || payload.possui_nome_social === 'true' },
        { field_id: Number(payload.campo_nome_social_id), value: payload.nome_social || '' },
        { field_id: Number(payload.campo_email_id), value: payload.email },
        { field_id: Number(payload.campo_data_nascimento_id), value: payload.data_nascimento },
        { field_id: Number(payload.campo_celular_id), value: payload.celular },
        { field_id: Number(payload.campo_genero_id), value: payload.genero },
        { field_id: Number(payload.campo_consentimento_id), value: true },
        { field_id: Number(payload.campo_idps_id), value: payload.idps_valor },
        { field_id: Number(payload.campo_lgpd_assinatura_id), value: payload.lgpd_assinatura_valor },
        { field_id: Number(payload.campo_lgpd_base_legal_id), value: payload.lgpd_base_legal_valor },
        { field_id: Number(payload.campo_genero_rubeus_id), value: payload.genero }
      ]
    })

    // Busca cursos - usa datasource correto
    const datasource = isNotaEnem ? DATASOURCE_CURSO_ENEM : DATASOURCE_CURSO_GERAL

    const cursosRes = await rubeus('/data-source','POST',{
      datasource,
      target: 38627,
      filter: [],
      nextFields: [38547, 38553, 38552, 38550, 38611, 38612, 38610],
      token: payload.token
    })

    const cursos = (cursosRes.data || cursosRes.data?.options || []).map(c => ({
      id: c.value || c.id,
      title: c.label || c.title
    }))

    return {
      screen: 'CURSO_INTERESSE',
      data: {
        token: payload.token,
        target: payload.target,
        local: payload.local,
        button_id: payload.button_id,
        datasource,
        campo_curso_id: '38627',
        campo_turno_id: '38547',
        campo_area_interesse_id: '38553',
        campo_oferta_id: '38552',
        campo_coligada_id: '38611',
        campo_filial_id: '38612',
        campo_tipo_curso_id: '38610',
        campo_codpolo_id: '38550',
        campo_enem_numero_id: '38556',
        campo_enem_ano_id: '38557',
        campo_enem_natureza_id: '38563',
        campo_enem_humanas_id: '38562',
        campo_enem_matematica_id: '38561',
        campo_enem_linguagens_id: '38560',
        campo_enem_redacao_id: '38559',
        campo_enem_media_id: '38558',
        anos_enem: [
          {id:"2025",title:"2025"},{id:"2024",title:"2024"},{id:"2023",title:"2023"},
          {id:"2022",title:"2022"},{id:"2021",title:"2021"},{id:"2020",title:"2020"}
        ],
        cursos: cursos.length ? cursos : [
          {id:"1-390",title:"AGRONOMIA"},{id:"1-30",title:"CIÊNCIAS CONTÁBEIS"},
          {id:"1-20",title:"DIREITO"},{id:"1-480",title:"ENFERMAGEM"}
        ],
        turnos: [],
        turno_visivel: false,
        curso_selecionado: '',
        turno_selecionado: '',
        area_interesse_valor: '',
        oferta_valor: '',
        coligada_valor: '1',
        filial_valor: '1',
        tipo_curso_valor: '1',
        codpolo_valor: '01',
        erro: '',
        processo_seletivo_id: payload.processo_seletivo_id,
        eh_nota_enem: isNotaEnem
      }
    }
  }

  if (acao === 'buscar_turnos') {
    const turnoRes = await rubeus('/data-source','POST',{
      datasource: payload.datasource,
      target: Number(payload.campo_turno_id),
      filter: [{ field: Number(payload.campo_curso_id), values: payload.curso_id }],
      nextFields: [38553, 38552, 38550, 38611, 38612, 38610],
      token: payload.token
    })

    const turnos = (turnoRes.data?.options || []).map(o => ({ id: o.value, title: o.label }))
    const nextOptions = turnoRes.data?.nextOptions || {}

    const isNotaEnem = payload.eh_nota_enem === true || payload.eh_nota_enem === 'true'

    return {
      screen: 'CURSO_INTERESSE',
      data: {
        token: payload.token,
        target: payload.target,
        local: payload.local,
        button_id: payload.button_id,
        datasource: payload.datasource,
        campo_curso_id: payload.campo_curso_id,
        campo_turno_id: payload.campo_turno_id,
        campo_area_interesse_id: payload.campo_area_interesse_id,
        campo_oferta_id: payload.campo_oferta_id,
        campo_coligada_id: payload.campo_coligada_id,
        campo_filial_id: payload.campo_filial_id,
        campo_tipo_curso_id: payload.campo_tipo_curso_id,
        campo_codpolo_id: '38550',
        campo_enem_numero_id: '38556',
        campo_enem_ano_id: '38557',
        campo_enem_natureza_id: '38563',
        campo_enem_humanas_id: '38562',
        campo_enem_matematica_id: '38561',
        campo_enem_linguagens_id: '38560',
        campo_enem_redacao_id: '38559',
        campo_enem_media_id: '38558',
        anos_enem: [
          {id:"2025",title:"2025"},{id:"2024",title:"2024"},{id:"2023",title:"2023"},
          {id:"2022",title:"2022"},{id:"2021",title:"2021"},{id:"2020",title:"2020"}
        ],
        cursos: [
          {id:"1-390",title:"AGRONOMIA"},{id:"1-30",title:"CIÊNCIAS CONTÁBEIS"},
          {id:"1-20",title:"DIREITO"},{id:"1-480",title:"ENFERMAGEM"},
          {id:"1-230",title:"ODONTOLOGIA"},{id:"1-140",title:"PRODUÇÃO PUBLICITÁRIA"},
          {id:"1-240",title:"PSICOLOGIA"}
        ],
        turnos: turnos.length ? turnos : [{id:"6",title:"NOTURNO"}],
        turno_visivel: true,
        curso_selecionado: payload.curso_id,
        turno_selecionado: turnos[0]?.value || '6',
        area_interesse_valor: nextOptions[38553]?.value || nextOptions[payload.campo_area_interesse_id]?.value || '420',
        oferta_valor: nextOptions[38552]?.value || nextOptions[payload.campo_oferta_id]?.value || '1-220-420',
        coligada_valor: nextOptions[38611]?.value || '1',
        filial_valor: nextOptions[38612]?.value || '1',
        tipo_curso_valor: nextOptions[38610]?.value || '1',
        codpolo_valor: nextOptions[38550]?.value || '01',
        processo_seletivo_id: payload.processo_seletivo_id || PROCESSO_ENEM_ID,
        eh_nota_enem: isNotaEnem,
        erro: ''
      }
    }
  }

  if (acao === 'enviar_curso') {
    const isNotaEnem = payload.eh_nota_enem === true || payload.eh_nota_enem === 'true'

    let dataToSubmit = [
      { field_id: Number(payload.campo_curso_id), value: payload.curso_id },
      { field_id: Number(payload.campo_turno_id), value: payload.turno_id },
      { field_id: Number(payload.campo_area_interesse_id), value: payload.area_interesse_valor },
      { field_id: Number(payload.campo_oferta_id), value: payload.oferta_valor },
      { field_id: 38550, value: payload.codpolo_valor || '01' },
      { field_id: Number(payload.campo_coligada_id), value: payload.coligada_valor },
      { field_id: Number(payload.campo_filial_id), value: payload.filial_valor },
      { field_id: Number(payload.campo_tipo_curso_id), value: payload.tipo_curso_valor }
    ]

    if (isNotaEnem) {
      let media = payload.media_enem
      if (!media) {
        const toNum = (v) => parseFloat(String(v).replace(',','.')) || 0
        const soma = toNum(payload.nota_natureza_enem) + toNum(payload.nota_humanas_enem) + toNum(payload.nota_matematica_enem) + toNum(payload.nota_linguagens_enem) + toNum(payload.nota_redacao_enem)
        media = (soma / 5).toFixed(1)
      }
      dataToSubmit.push(
        { field_id: Number(payload.campo_enem_numero_id), value: payload.numero_inscricao_enem },
        { field_id: Number(payload.campo_enem_ano_id), value: payload.ano_enem },
        { field_id: Number(payload.campo_enem_natureza_id), value: Number(payload.nota_natureza_enem) },
        { field_id: Number(payload.campo_enem_humanas_id), value: Number(payload.nota_humanas_enem) },
        { field_id: Number(payload.campo_enem_matematica_id), value: Number(payload.nota_matematica_enem) },
        { field_id: Number(payload.campo_enem_linguagens_id), value: Number(payload.nota_linguagens_enem) },
        { field_id: Number(payload.campo_enem_redacao_id), value: Number(payload.nota_redacao_enem) },
        { field_id: Number(payload.campo_enem_media_id), value: Number(media) }
      )
    }

    const submit = await rubeus('/submit','POST',{
      button: Number(payload.button_id),
      validate_on_server: true,
      token: payload.token,
      data: dataToSubmit
    })

    const next = submit.data?.next
    const token = submit.data?.token || payload.token

    const origensRes = await rubeus('/data-source','POST',{
      datasource: '761bdf67a9ce0fcad5306b92c1722c472bdce35b7297e96f8ce1dcbc6f1259c1',
      target: 319427,
      filter: [], nextFields: [], token
    })
    const origens = (origensRes.data || []).map(o => ({ id: o.value, title: o.label }))

    return {
      screen: 'QUASE_LA',
      data: {
        token,
        target: String(next),
        local: 'step',
        button_id: '3590278',
        person_id: String(submit.data?.redirect?.person_id || ''),
        applyment_id: String(submit.data?.redirect?.applyment_id || ''),
        campo_cpf_id: '38567',
        campo_nacionalidade_id: '38780',
        campo_ensino_medio_id: '251544',
        campo_deficiencia_id: '38575',
        campo_def_auditiva_id: '38577',
        campo_def_fala_id: '38578',
        campo_def_fisica_id: '38576',
        campo_def_intelectual_id: '38580',
        campo_def_visual_id: '38579',
        campo_def_mental_id: '38581',
        campo_def_outras_id: '38582',
        campo_def_outras_texto_id: '38583',
        campo_origem_id: '319427',
        campo_origem_outro_id: '319428',
        datasource_origem: '761bdf67a9ce0fcad5306b92c1722c472bdce35b7297e96f8ce1dcbc6f1259c1',
        origens: origens.length ? origens : [{id:"02",title:"Pesquisa no Google"}],
        erro: ''
      }
    }
  }

  if (acao === 'enviar_informacoes_complementares') {
    await rubeus('/submit','POST',{
      button: Number(payload.button_id),
      validate_on_server: true,
      token: payload.token,
      data: [
        { field_id: 38567, value: payload.cpf.replace(/\D/g,'') },
        { field_id: 38780, value: payload.nacionalidade },
        { field_id: 251544, value: payload.concluiu_ensino_medio },
        { field_id: 38575, value: payload.possui_deficiencia },
        { field_id: 319427, value: payload.como_conheceu }
      ]
    })

    return {
      screen: 'CONFIRMACAO',
      data: {
        titulo: 'Inscrição concluída',
        mensagem: 'Seus dados foram enviados com sucesso!',
        inscricao_id: payload.applyment_id || 'OK'
      }
    }
  }

  return { screen: 'ESCOLHA_PROCESSO', data: { erro: '' } }
}

export async function POST(req) {
  try {
    const body = await req.json()
    let privateKey = process.env.FLOW_PRIVATE_KEY
    if (!privateKey) throw new Error('FLOW_PRIVATE_KEY não configurada')
    privateKey = privateKey.replace(/\\n/g, '\n').trim()
    const passphrase = process.env.FLOW_PRIVATE_KEY_PASSPHRASE || ''

    const { decryptedBody, aesKeyBuffer, initialVectorBuffer } = decryptRequest(body, privateKey, passphrase)

    const responseData = await routeFlowRequest(decryptedBody)

    const encrypted = encryptResponse(responseData, aesKeyBuffer, initialVectorBuffer)
    return new Response(encrypted, { headers: { 'Content-Type': 'text/plain' } })

  } catch (e) {
    console.error('Erro ao iniciar inscrição:', e)
    console.error(e.stack)
    return new Response(`Não foi possível descriptografar a requisição do Flow: ${e.message}`, { status: 500 })
  }
}
