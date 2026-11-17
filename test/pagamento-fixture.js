// Pix de exemplo (estrutura real, chave = CNPJ da UniBalsas, CRC conferido).
export const PIX = '00020126360014br.gov.bcb.pix0114073447740001895204000053039865406390.005802BR5909UNIBALSAS6006BALSAS62170513MATRICULA20276304C4F0';

// Passo do pagamento como o portal devolve (estrutura do 300701 conferida ao vivo em 16/11/2026; valores fictícios).
export function passoPagamento({ pixGuardado = '' } = {}) {
  return { success: true, data: { steps: { currentStep: { id: 300670, stage_id: 261005, content: [
    { id: 3940705, type: 'text', key: 'content-8e8d64dc' },
    { id: 3940706, type: 'container', container_content: [{ id: 3940707, type: 'text', key: 'content-2159f45b', related_component_id: 174892 }] },
    { id: 3127970, type: 'radio', key: '38702', field_id: 38702, field_settings_id: 3127970, ps_table: 1, value_now: 'C' },
    { id: 3940708, type: 'container', container_content: [
      { id: 3940709, type: 'button', label: 'Portal do candidato', related_component_id: 174878, logics: [] },
      { id: 3940437, type: 'button', label: 'Realizar pagamento', store_data: 1, related_component_id: 226402, logic_enabled: 1, logics: [{ fixed_value: 'P', component_id: 226402 }] },
      { id: 3940438, type: 'button', label: 'Realizar pagamento', store_data: 0, related_component_id: 226386, logic_enabled: 1, logics: [{ fixed_value: 'C', component_id: 226386 }] },
      { id: 3940439, type: 'button', label: 'Gerar boleto', store_data: 1, related_component_id: 174893, logic_enabled: 1, logics: [{ fixed_value: 'B' }] }] },
    { id: 3940713, type: 'container', container_content: [
      { id: 3127971, type: 'text', key: '38656', field_id: 38656, field_settings_id: 3127971, ps_table: 1, value_now: '544149' },
      { id: 3127972, type: 'text', key: '53443', field_id: 53443, field_settings_id: 3127972, ps_table: 1 },
      { id: 3127973, type: 'text', key: '38661', field_id: 38661, field_settings_id: 3127973, ps_table: 1 },
      { id: 3127974, type: 'text', key: '38658', field_id: 38658, field_settings_id: 3127974, ps_table: 1 }] }
  ], applicantData: [
    { field_id: 38544, value: 'MARIA DA SILVA' }, { field_id: 38546, value: '99988880001' },
    { field_id: 53443, value: '390.00' }, { field_id: 38661, value: 'R$ 390,00' }, { field_id: 38658, value: '39000' }, { field_id: 38702, value: 'C' },
    ...(pixGuardado ? [{ field_id: 50901, value: pixGuardado }] : [])
  ] } } } };
}
