// Charts drawn with d3 (loaded from vendor/d3.min.js).
const d3 = window.d3;
export const COLORS = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)'];
export const fmt = {
  usd: d3.format('$,.0f'), usd2: d3.format('$,.2f'), pct: d3.format('.0%'), spct: d3.format('+.0%'),
  mon: d3.utcFormat('%b'), monY: d3.utcFormat('%B %Y'), day: d3.utcFormat('%b %-d'), dayY: d3.utcFormat('%b %-d, %Y'),
  k: (v) => (Math.abs(v) >= 1000 ? (v < 0 ? '-$' : '$') + d3.format('.1f')(Math.abs(v) / 1000) + 'k' : d3.format('$,.0f')(v)),
};
export const P = (s) => new Date(Date.parse(s + 'T00:00:00Z'));
export const monLabel = (m) => fmt.mon(P(m + '-01'));
export const monName = (m) => fmt.monY(P(m + '-01'));

export function tip(host) {
  const t = document.createElement('div'); t.className = 'tip'; t.hidden = true; host.appendChild(t);
  return {
    show(ev, lines) {
      t.replaceChildren(...lines.map((s, i) => { const d = document.createElement('div'); d.textContent = s; if (i === 0) d.className = 'tip-h'; return d; }));
      t.hidden = false;
      const r = host.getBoundingClientRect(), w = t.offsetWidth, h = t.offsetHeight;
      let x = ev.clientX - r.left + 12, y = ev.clientY - r.top - h - 10;
      if (x + w > r.width) x = Math.max(0, ev.clientX - r.left - w - 12);
      if (y < 0) y = ev.clientY - r.top + 16;
      t.style.left = x + 'px'; t.style.top = y + 'px';
    },
    hide() { t.hidden = true; },
  };
}

export function legend(el, items) {
  const lg = document.createElement('div'); lg.className = 'legend';
  for (const [name, color, dashed] of items) {
    const s = document.createElement('span'), sw = document.createElement('span'); sw.className = 'sw';
    if (dashed) { sw.style.border = '1px dashed ' + color; sw.style.background = 'transparent'; } else sw.style.background = color;
    s.append(sw, document.createTextNode(name)); lg.appendChild(s);
  }
  el.appendChild(lg);
}

function yAxis(svg, y, W) {
  const g = svg.append('g').attr('class', 'axis').call(d3.axisLeft(y).ticks(4).tickFormat(fmt.k).tickSize(0).tickPadding(6));
  g.select('.domain').remove();
  let mw = 0; g.selectAll('text').each(function () { mw = Math.max(mw, this.getComputedTextLength()); });
  const ml = Math.ceil(mw) + 10;
  g.attr('transform', `translate(${ml},0)`);
  svg.insert('g', ':first-child').attr('class', 'grid').selectAll('line').data(y.ticks(4)).join('line')
    .attr('x1', ml).attr('x2', W).attr('y1', (d) => y(d)).attr('y2', (d) => y(d));
  return ml;
}
const xAxis = (svg, x, H, mb, fmtFn, values) => {
  const ax = d3.axisBottom(x).tickSize(0).tickPadding(6).tickFormat(fmtFn);
  if (values) ax.tickValues(values);
  svg.append('g').attr('class', 'axis').attr('transform', `translate(0,${H - mb})`).call(ax).select('.domain').remove();
};
const hits = (svg, rows, x, key, step, mt, H, mb, t, lines, onPick, label) => {
  const r = svg.append('g').selectAll('rect').data(rows).join('rect').attr('x', (d) => x(d[key]) - (step - x.bandwidth()) / 2).attr('width', step)
    .attr('y', mt).attr('height', H - mt - mb).attr('fill', 'transparent')
    .on('pointermove', (ev, d) => t.show(ev, lines(d))).on('pointerleave', () => t.hide());
  if (onPick) {
    r.attr('class', 'hit').attr('tabindex', 0).attr('role', 'button').attr('aria-label', label)
      .on('click', (ev, d) => onPick(d)).on('keydown', (ev, d) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onPick(d); } });
  }
};

// Stacked bars by month, one colour per key.
export function stackedMonths(el, rows, keys, colorOf, {picked, onPick, ariaLabel} = {}) {
  el.replaceChildren();
  legend(el, keys.map((k) => [k, colorOf(k)]));
  const W = Math.max(el.clientWidth, 280), H = 250, mt = 20, mb = 24;
  const svg = d3.select(el).append('svg').attr('width', W).attr('height', H).attr('role', 'img').attr('aria-label', ariaLabel || '');
  const stack = d3.stack().keys(keys).offset(d3.stackOffsetDiverging)(rows);
  const lo = Math.min(0, d3.min(stack, (s) => d3.min(s, (d) => d[0])) || 0), hi = Math.max(1, d3.max(stack, (s) => d3.max(s, (d) => d[1])) || 1);
  const y = d3.scaleLinear().domain([lo, hi * 1.1]).nice().range([H - mb, mt]);
  const ml = yAxis(svg, y, W);
  const x = d3.scaleBand().domain(rows.map((r) => r.month)).range([ml + 4, W]).padding(0.22);
  svg.append('g').selectAll('g').data(stack).join('g').style('fill', (s) => colorOf(s.key))
    .selectAll('rect').data((s) => s).join('rect')
    .attr('x', (d) => x(d.data.month)).attr('width', x.bandwidth())
    .attr('y', (d) => y(Math.max(d[0], d[1]))).attr('height', (d) => Math.abs(y(d[0]) - y(d[1])))
    .attr('opacity', (d) => (picked && d.data.month !== picked ? 0.4 : 1));
  const short = x.bandwidth() < 40;
  svg.append('g').selectAll('text').data(rows).join('text').attr('class', 'svgtext').attr('text-anchor', 'middle')
    .attr('x', (r) => x(r.month) + x.bandwidth() / 2).attr('y', (r) => y(Math.max(0, r.total)) - 5)
    .text((r) => (short ? (Math.abs(r.total) >= 1000 ? Math.round(r.total / 1000) + 'k' : Math.round(r.total)) : fmt.k(r.total)));
  xAxis(svg, x, H, mb, monLabel);
  hits(svg, rows, x, 'month', x.step(), mt, H, mb, tip(el),
    (r) => [monName(r.month), ...keys.map((k) => k + ': ' + fmt.usd(r[k])), 'Total: ' + fmt.usd(r.total), ...(onPick ? ['Click for details'] : [])], onPick, (r) => 'Show ' + monName(r.month));
}

export function weeklyChart(el, rows, k) {
  el.replaceChildren();
  legend(el, [['Weekly total', COLORS[0]], ['4-week average', COLORS[1]], ['Run rate per week', 'var(--ref)', true]]);
  const W = Math.max(el.clientWidth, 280), H = 250, mt = 14, mb = 24;
  const svg = d3.select(el).append('svg').attr('width', W).attr('height', H).attr('role', 'img').attr('aria-label', 'Weekly card spend with 4-week average');
  const lo = Math.min(0, d3.min(rows, (r) => r.spend) || 0), hi = Math.max(1, d3.max(rows, (r) => r.spend) || 1, k ? k.perWeek : 0);
  const y = d3.scaleLinear().domain([lo, hi * 1.05]).nice().range([H - mb, mt]);
  const ml = yAxis(svg, y, W);
  const x = d3.scaleBand().domain(rows.map((r) => r.week)).range([ml + 4, W]).padding(0.15);
  svg.append('g').selectAll('rect').data(rows).join('rect').style('fill', COLORS[0]).attr('opacity', 0.7)
    .attr('x', (r) => x(r.week)).attr('width', x.bandwidth()).attr('y', (r) => y(Math.max(0, r.spend))).attr('height', (r) => Math.abs(y(r.spend) - y(0)));
  svg.append('path').datum(rows).attr('fill', 'none').style('stroke', COLORS[1]).attr('stroke-width', 2)
    .attr('d', d3.line().x((r) => x(r.week) + x.bandwidth() / 2).y((r) => y(r.avg4)));
  if (k) {
    svg.append('line').attr('class', 'ref').attr('x1', ml).attr('x2', W).attr('y1', y(k.perWeek)).attr('y2', y(k.perWeek));
    svg.append('text').attr('class', 'svgmuted').attr('x', W - 2).attr('y', y(k.perWeek) - 5).attr('text-anchor', 'end').text('Run rate ' + fmt.usd(k.perWeek) + '/wk');
  }
  xAxis(svg, x, H, mb, (w) => fmt.mon(P(w)), rows.filter((r) => +r.week.slice(8, 10) <= 7).map((r) => r.week));
  const t = tip(el);
  svg.append('g').selectAll('rect').data(rows).join('rect').attr('x', (r) => x(r.week)).attr('width', x.step())
    .attr('y', mt).attr('height', H - mt - mb).attr('fill', 'transparent')
    .on('pointermove', (ev, r) => t.show(ev, ['Week of ' + fmt.dayY(P(r.week)), 'Spend: ' + fmt.usd(r.spend), '4-week average: ' + fmt.usd(r.avg4)]))
    .on('pointerleave', () => t.hide());
}

// Horizontal bars. items: {name, value, text, tip[], color?, dim?}
export function hbars(el, items, {onClick, bh = 18, ariaLabel = ''} = {}) {
  el.replaceChildren();
  if (!items.length) { const p = document.createElement('p'); p.className = 'muted'; p.textContent = 'Nothing matches these filters.'; el.appendChild(p); return; }
  const W = Math.max(el.clientWidth, 260), gap = 8, H = items.length * (bh + gap);
  const svg = d3.select(el).append('svg').attr('width', W).attr('height', H).attr('role', 'img').attr('aria-label', ariaLabel);
  const yy = (i) => i * (bh + gap);
  const labs = svg.append('g').selectAll('text').data(items).join('text').attr('class', 'svgtext')
    .attr('x', 0).attr('y', (d, i) => yy(i) + bh / 2).attr('dy', '0.35em').text((d) => d.name);
  let lw = 0; labs.each(function () { lw = Math.max(lw, this.getComputedTextLength()); });
  lw = Math.min(lw, W * 0.42) + 10;
  const probe = svg.append('text').attr('class', 'svgmuted').text(d3.greatest(items.map((d) => d.text), (s) => s.length) || '');
  const vw = probe.node().getComputedTextLength() + 10; probe.remove();
  const lo = Math.min(0, d3.min(items, (d) => d.value)), hi = Math.max(1, d3.max(items, (d) => d.value));
  const x = d3.scaleLinear().domain([lo, hi]).range([lw + (lo < 0 ? vw : 0), Math.max(lw + 60, W - vw)]);
  const t = tip(el);
  const bars = svg.append('g').selectAll('rect').data(items).join('rect').style('fill', (d) => d.color || COLORS[0]).attr('rx', 2)
    .attr('opacity', (d) => (d.dim ? 0.3 : 1))
    .attr('x', (d) => Math.min(x(0), x(d.value))).attr('width', (d) => Math.max(1, Math.abs(x(d.value) - x(0))))
    .attr('y', (d, i) => yy(i)).attr('height', bh)
    .on('pointermove', (ev, d) => t.show(ev, d.tip)).on('pointerleave', () => t.hide());
  if (onClick) {
    bars.attr('class', 'bar').attr('tabindex', 0).attr('role', 'button').attr('aria-label', (d) => 'Filter to ' + d.name)
      .on('click', (ev, d) => onClick(d)).on('keydown', (ev, d) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onClick(d); } });
  }
  if (lo < 0) svg.append('line').attr('class', 'zero').attr('x1', x(0)).attr('x2', x(0)).attr('y1', 0).attr('y2', H - gap);
  svg.append('g').selectAll('text').data(items).join('text').attr('class', 'svgmuted').attr('dy', '0.35em')
    .attr('text-anchor', (d) => (d.value < 0 ? 'end' : 'start'))
    .attr('x', (d) => (d.value < 0 ? x(d.value) - 6 : x(d.value) + 6)).attr('y', (d, i) => yy(i) + bh / 2).text((d) => d.text);
}

// Side-by-side bars per month. keys: [[field, label, color]]
export function grouped(el, rows, keys, {ariaLabel = '', dashed, picked, onPick} = {}) {
  el.replaceChildren();
  legend(el, keys.map((k) => [k[1], k[2], dashed && dashed === k[0]]));
  const W = Math.max(el.clientWidth, 280), H = 240, mt = 14, mb = 24;
  const svg = d3.select(el).append('svg').attr('width', W).attr('height', H).attr('role', 'img').attr('aria-label', ariaLabel);
  const y = d3.scaleLinear().domain([0, Math.max(1, d3.max(rows, (r) => d3.max(keys, (k) => r[k[0]]))) * 1.05]).nice().range([H - mb, mt]);
  const ml = yAxis(svg, y, W);
  const x0 = d3.scaleBand().domain(rows.map((r) => r.month)).range([ml + 4, W]).padding(0.2);
  const x1 = d3.scaleBand().domain(keys.map((k) => k[0])).range([0, x0.bandwidth()]).padding(0.08);
  const g = svg.append('g').selectAll('g').data(rows).join('g').attr('transform', (r) => `translate(${x0(r.month)},0)`)
    .attr('opacity', (r) => (picked && r.month !== picked ? 0.45 : 1));
  for (const [k, , c] of keys) {
    const rect = g.append('rect').attr('x', x1(k)).attr('width', x1.bandwidth()).attr('y', (r) => y(Math.max(0, r[k]))).attr('height', (r) => y(0) - y(Math.max(0, r[k])));
    if (dashed === k) rect.attr('fill', 'none').style('stroke', c).attr('stroke-dasharray', '3 2'); else rect.style('fill', c);
  }
  xAxis(svg, x0, H, mb, monLabel);
  hits(svg, rows, x0, 'month', x0.step(), mt, H, mb, tip(el), (r) => [monName(r.month), ...keys.map((k) => k[1] + ': ' + fmt.usd(r[k[0]]))], onPick, (r) => 'Show ' + monName(r.month));
}

// Lines over time. series: [{name, color, points: [{date, value}]}]; marks: [{date, label}]
export function lineChart(el, series, {marks = [], ariaLabel = ''} = {}) {
  el.replaceChildren();
  legend(el, series.map((s) => [s.name, s.color]));
  const W = Math.max(el.clientWidth, 280), H = 260, mt = 14, mb = 24;
  const svg = d3.select(el).append('svg').attr('width', W).attr('height', H).attr('role', 'img').attr('aria-label', ariaLabel);
  const all = series.flatMap((s) => s.points);
  if (!all.length) return;
  const y = d3.scaleLinear().domain([0, d3.max(all, (p) => p.value) * 1.05]).nice().range([H - mb, mt]);
  const ml = yAxis(svg, y, W);
  const x = d3.scaleUtc().domain(d3.extent(all, (p) => P(p.date))).range([ml + 4, W - 8]);
  svg.append('g').attr('class', 'axis').attr('transform', `translate(0,${H - mb})`).call(d3.axisBottom(x).ticks(Math.max(2, Math.floor(W / 90))).tickFormat(d3.utcFormat('%Y')).tickSizeOuter(0));
  for (const m of marks) {
    const xm = x(P(m.date)); if (xm < ml || xm > W) continue;
    svg.append('line').attr('class', 'ref').attr('x1', xm).attr('x2', xm).attr('y1', mt).attr('y2', H - mb);
    svg.append('text').attr('class', 'svgmuted').attr('x', xm + 4).attr('y', mt + 10).text(m.label);
  }
  const line = d3.line().x((p) => x(P(p.date))).y((p) => y(p.value));
  for (const s of series) svg.append('path').datum(s.points).attr('fill', 'none').style('stroke', s.color).attr('stroke-width', 2.2).attr('d', line);
  const t = tip(el), bis = d3.bisector((p) => P(p.date)).center;
  const guide = svg.append('line').attr('class', 'ref').attr('y1', mt).attr('y2', H - mb).style('opacity', 0);
  svg.append('rect').attr('class', 'hit').attr('x', ml).attr('y', mt).attr('width', W - ml).attr('height', H - mt - mb).style('fill', 'transparent')
    .on('pointermove', (ev) => {
      const [mx] = d3.pointer(ev), d = x.invert(mx);
      const rows = series.map((s) => { const p = s.points[bis(s.points, d)]; return p && [s.name, p]; }).filter(Boolean);
      if (!rows.length) return;
      guide.attr('x1', mx).attr('x2', mx).style('opacity', 1);
      t.show(ev, [fmt.monY(d), ...rows.map(([n, p]) => n + ': ' + fmt.usd(p.value))]);
    })
    .on('pointerleave', () => { guide.style('opacity', 0); t.hide(); });
}
