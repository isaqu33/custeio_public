/**
 * @jest-environment node
 */
export {};

import { gzipSync } from 'node:zlib';
import {
  SefazBlockedError,
  SefazTransportError,
  buildDistNsuEnvelope,
  parseDistNsuResponse,
} from '@/app/lib/sefaz-client';

function soapResponse(retDistDFeInt: string) {
  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body>' +
    '<nfeDistDFeInteresseResponse xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe">' +
    '<nfeDistDFeInteresseResult>' +
    `<retDistDFeInt xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01">${retDistDFeInt}</retDistDFeInt>` +
    '</nfeDistDFeInteresseResult></nfeDistDFeInteresseResponse></soap:Body></soap:Envelope>'
  );
}

const zip = (xml: string) => gzipSync(Buffer.from(xml, 'utf8')).toString('base64');

describe('buildDistNsuEnvelope', () => {
  it('builds a SOAP 1.2 distNSU request with the cursor and environment', () => {
    const xml = buildDistNsuEnvelope({
      cnpj: '36870237000170',
      cUFAutor: '35',
      tpAmb: 2,
      ultNSU: '000000000000000',
    });
    expect(xml).toContain('http://www.w3.org/2003/05/soap-envelope');
    expect(xml).toContain('<tpAmb>2</tpAmb>');
    expect(xml).toContain('<cUFAutor>35</cUFAutor>');
    expect(xml).toContain('<CNPJ>36870237000170</CNPJ>');
    expect(xml).toContain('<distNSU><ultNSU>000000000000000</ultNSU></distNSU>');
  });

  it('rejects malformed inputs instead of sending them to SEFAZ', () => {
    const ok = {
      cnpj: '36870237000170',
      cUFAutor: '35',
      tpAmb: 1 as const,
      ultNSU: '000000000000000',
    };
    expect(() => buildDistNsuEnvelope({ ...ok, cnpj: '123' })).toThrow('cnpj');
    expect(() => buildDistNsuEnvelope({ ...ok, cUFAutor: 'SP' })).toThrow('cUFAutor');
    expect(() => buildDistNsuEnvelope({ ...ok, ultNSU: '1' })).toThrow('ultNSU');
  });
});

describe('parseDistNsuResponse', () => {
  it('returns no documents on cStat 137', () => {
    const result = parseDistNsuResponse(
      soapResponse(
        '<tpAmb>2</tpAmb><cStat>137</cStat><xMotivo>Nenhum documento localizado</xMotivo>' +
          '<ultNSU>000000000000000</ultNSU><maxNSU>000000000000000</maxNSU>',
      ),
    );
    expect(result).toMatchObject({ cStat: '137', ultNSU: '000000000000000', documents: [] });
  });

  it('gunzips every docZip and keeps NSU/schema, including a single-document batch', () => {
    const one = parseDistNsuResponse(
      soapResponse(
        '<cStat>138</cStat><xMotivo>Documento localizado</xMotivo>' +
          '<ultNSU>000000000000001</ultNSU><maxNSU>000000000000001</maxNSU>' +
          `<loteDistDFeInt><docZip NSU="000000000000001" schema="resNFe_v1.01">${zip('<resNFe/>')}</docZip></loteDistDFeInt>`,
      ),
    );
    expect(one.documents).toEqual([
      { nsu: '000000000000001', schema: 'resNFe_v1.01', xml: '<resNFe/>' },
    ]);

    const two = parseDistNsuResponse(
      soapResponse(
        '<cStat>138</cStat><xMotivo>ok</xMotivo><ultNSU>000000000000002</ultNSU><maxNSU>000000000000002</maxNSU>' +
          '<loteDistDFeInt>' +
          `<docZip NSU="000000000000001" schema="resNFe_v1.01">${zip('<a/>')}</docZip>` +
          `<docZip NSU="000000000000002" schema="procNFe_v4.00">${zip('<b/>')}</docZip>` +
          '</loteDistDFeInt>',
      ),
    );
    expect(two.documents.map((d) => d.xml)).toEqual(['<a/>', '<b/>']);
  });

  it('throws SefazBlockedError with a 1h horizon on cStat 656', () => {
    const answered = '2026-09-24T10:00:00-03:00';
    let caught: unknown;
    try {
      parseDistNsuResponse(
        soapResponse(
          `<cStat>656</cStat><xMotivo>Consumo Indevido</xMotivo><dhResp>${answered}</dhResp>`,
        ),
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(SefazBlockedError);
    expect((caught as SefazBlockedError).blockedUntil.getTime()).toBe(
      new Date(answered).getTime() + 60 * 60 * 1000,
    );
  });

  it('throws SefazTransportError when the body is not a distribution answer', () => {
    expect(() => parseDistNsuResponse('<html>gateway error</html>')).toThrow(SefazTransportError);
  });
});
