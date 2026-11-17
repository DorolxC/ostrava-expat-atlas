const glyphs = {
  survey: '<path d="M12 2v3m0 14v3M2 12h3m14 0h3"/><circle cx="12" cy="12" r="6"/><path d="m12 7 1.6 3.4L17 12l-3.4 1.6L12 17l-1.6-3.4L7 12l3.4-1.6L12 7Z" fill="currentColor" stroke="none"/>',
  layers: '<path d="m3 8 9-4 9 4-9 4-9-4Zm0 4.7 9 4 9-4M3 17.4l9 4 9-4"/>',
  search: '<circle cx="10.8" cy="10.8" r="6.2"/><path d="m16 16 4 4"/>',
  x: '<path d="m6 6 12 12M18 6 6 18"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/>',
  share: '<path d="M12 15V3m-4 4 4-4 4 4M6 10H5v10h14V10h-1"/>',
  filter: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="2.5" fill="var(--icon-fill, #f8f5eb)"/><circle cx="15" cy="17" r="2.5" fill="var(--icon-fill, #f8f5eb)"/>',
  grid: '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/>',
  district: '<path d="m3 7 9-4 9 4-9 4-9-4Zm0 5 9 4 9-4M3 17l9 4 9-4"/>',
  coffee: '<path d="M4 8h12v6a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V8Zm12 1h2a2.5 2.5 0 0 1 0 5h-2M3 20h16M7 5V3m5 2V3"/>',
  night: '<path d="M4 5h16l-8 9-8-9Zm8 9v6m-4 0h8M7 8h10"/>',
  work: '<rect x="4" y="5" width="16" height="11" rx="1.4"/><path d="M2 19h20m-13-3-.9 3m6.9-3 .9 3"/>',
  landmark: '<path d="m3 8 9-5 9 5v2H3V8Zm2 12h14M7 10v7m5-7v7m5-7v7M4 17h16"/>',
  sport: '<path d="M2 12h4l3-6 4 12 3-6h6"/>',
  people: '<circle cx="9" cy="8" r="3"/><path d="M3 20v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2m1-15a3 3 0 0 1 0 6m2 3a4 4 0 0 1 3 4v2"/>',
  compass: '<circle cx="12" cy="12" r="8.8"/><path d="m15.8 8.2-2.2 5.4-5.4 2.2 2.2-5.4 5.4-2.2Z"/>',
  pin: '<path d="M19 10a7 7 0 0 0-14 0c0 5 7 10 7 10s7-5 7-10Z"/><circle cx="12" cy="10" r="2.3"/>',
  north: '<path fill="currentColor" stroke="none" d="M12 1 19 19 12 15 5 19 12 1Z"/><path fill="var(--copper, #e3a26d)" stroke="none" d="M12 1v14l-7 4 7-18Z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  target: '<circle cx="12" cy="12" r="6.3"/><circle cx="12" cy="12" r="1.4"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3"/>',
  arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  external: '<path d="M13 5h6v6m0-6-9 9m-2-9H5v14h14v-3"/>',
  directions: '<path d="m12 2 10 10-10 10L2 12 12 2Z"/><path d="M8 15v-4h8m-3-3 3 3-3 3"/>',
  check: '<path d="m5 12 4.5 4.5L19 7"/>',
  move: '<path d="M12 3v18M3 12h18M9 6l3-3 3 3m-6 12 3 3 3-3M6 9l-3 3 3 3m12-6 3 3-3 3"/>',
  wind: '<path d="M3 8h11a2.5 2.5 0 1 0-2.4-3M3 12h16a2.5 2.5 0 1 1-2.4 3M3 16h7a2.5 2.5 0 1 1-2.4 3"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-8h.01"/>',
};

export const icon = (name) => '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (glyphs[name] ?? '') + '</svg>';
export function insertIcons(root) {
  for (const el of root.querySelectorAll('[data-icon]')) el.innerHTML = icon(el.dataset.icon);
}
