// The Bank of Canada's official daily USD to CAD rate, fetched from the browser. No server involved.
const URL = 'https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json?recent=1';
export async function latestUsdCad() {
  const r = await fetch(URL, {cache: 'no-store'});
  if (!r.ok) throw new Error('Bank of Canada returned ' + r.status);
  const o = (await r.json()).observations?.[0];
  const rate = Number(o?.FXUSDCAD?.v);
  if (!(rate > 0.5 && rate < 3)) throw new Error('No rate in the Bank of Canada reply');
  return {rate, date: o.d};
}
