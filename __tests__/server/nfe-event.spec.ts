/**
 * @jest-environment node
 */
export {};

import { parseNfeEvent } from '@/app/lib/nfe-event';

const KEY = '35260112345678000190550010000001231000001234';

const resEvento = (tpEvento: string, chNFe = KEY) => `<?xml version="1.0"?>
<resEvento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01">
  <cOrgao>91</cOrgao><CNPJ>12345678000190</CNPJ><chNFe>${chNFe}</chNFe>
  <dhEvento>2026-09-20T10:00:00-03:00</dhEvento><tpEvento>${tpEvento}</tpEvento>
  <nSeqEvento>1</nSeqEvento><xEvento>Cancelamento homologado</xEvento>
</resEvento>`;

const procEvento = (tpEvento: string, cStat: string) => `<?xml version="1.0"?>
<procEventoNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00">
  <evento versao="1.00"><infEvento Id="ID1">
    <cOrgao>35</cOrgao><chNFe>${KEY}</chNFe><dhEvento>2026-09-20T10:00:00-03:00</dhEvento>
    <tpEvento>${tpEvento}</tpEvento></infEvento></evento>
  <retEvento versao="1.00"><infEvento><cStat>${cStat}</cStat><chNFe>${KEY}</chNFe>
    <dhRegEvento>2026-09-20T10:00:05-03:00</dhRegEvento></infEvento></retEvento>
</procEventoNFe>`;

describe('parseNfeEvent', () => {
  it('reads a cancellation summary (resEvento)', () => {
    expect(parseNfeEvent(resEvento('110111'))).toMatchObject({
      accessKey: KEY,
      eventType: '110111',
      isCancellation: true,
    });
  });

  it('reads an approved cancellation (procEventoNFe, cStat 135)', () => {
    const event = parseNfeEvent(procEvento('110111', '135'));
    expect(event).toMatchObject({ accessKey: KEY, isCancellation: true });
    expect(event?.occurredAt?.toISOString()).toBe('2026-09-20T13:00:05.000Z');
  });

  it('accepts a late-registered cancellation (cStat 155)', () => {
    expect(parseNfeEvent(procEvento('110111', '155'))?.isCancellation).toBe(true);
  });

  it('ignores a rejected event: the invoice is not cancelled', () => {
    expect(parseNfeEvent(procEvento('110111', '573'))).toBeNull();
  });

  it('does not treat another event as a cancellation', () => {
    expect(parseNfeEvent(resEvento('110110'))?.isCancellation).toBe(false); // carta de correção
    expect(parseNfeEvent(resEvento('210200'))?.isCancellation).toBe(false); // manifestação
  });

  it('returns null when the access key is missing or malformed', () => {
    expect(parseNfeEvent(resEvento('110111', '123'))).toBeNull();
    expect(parseNfeEvent('<resEvento><tpEvento>110111</tpEvento></resEvento>')).toBeNull();
  });
});
