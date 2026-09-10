const token = import.meta.env.VITE_TDT_TOKEN?.trim() || '';

const defaults = {
  vectorUrl: 'https://t{s}.tianditu.gov.cn/vec_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=vec&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&tk={token}',
  vectorLabelUrl: 'https://t{s}.tianditu.gov.cn/cva_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=cva&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&tk={token}',
  imageryUrl: 'https://t{s}.tianditu.gov.cn/img_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=img&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&tk={token}',
  imageryLabelUrl: 'https://t{s}.tianditu.gov.cn/cia_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=cia&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&tk={token}',
};

function withToken(template) {
  return template.replace('{token}', encodeURIComponent(token));
}

export const mapConfig = {
  token,
  vectorUrl: withToken(import.meta.env.VITE_TDT_VECTOR_URL || defaults.vectorUrl),
  vectorLabelUrl: withToken(import.meta.env.VITE_TDT_VECTOR_LABEL_URL || defaults.vectorLabelUrl),
  imageryUrl: withToken(import.meta.env.VITE_TDT_IMAGERY_URL || defaults.imageryUrl),
  imageryLabelUrl: withToken(import.meta.env.VITE_TDT_IMAGERY_LABEL_URL || defaults.imageryLabelUrl),
  subdomains: (import.meta.env.VITE_TDT_SUBDOMAINS || '01234567').split(''),
  mapMatchingUrl: import.meta.env.VITE_MAP_MATCHING_URL || 'https://routing.openstreetmap.de/routed-foot/match/v1/driving',
};
