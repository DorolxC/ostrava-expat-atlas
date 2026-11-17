import { noise } from './raster.mjs';

const forms = {
  house:      { floors: 2.88, spacing: 3.76, sill: .28, lintel: .75, left: .23, right: .76, plinth: .47 },
  streetwall: { floors: 3.48, spacing: 3.30, sill: .24, lintel: .78, left: .22, right: .74, plinth: .64 },
  civic:      { floors: 4.05, spacing: 4.02, sill: .22, lintel: .81, left: .20, right: .78, plinth: .71 },
  slab:       { floors: 3.03, spacing: 3.49, sill: .30, lintel: .73, left: .12, right: .88, plinth: .58 },
  office:     { floors: 3.55, spacing: 3.58, sill: .27, lintel: .77, left: .14, right: .87, plinth: .57 },
  hall:       { floors: 4.65, spacing: 5.83, sill: .33, lintel: .83, left: .20, right: .78, plinth: .49 },
};

export function facadeArchitecture({civic,industrial,panel,modern,heritage,small,levels},salt) {
  const type = industrial ? 'hall' : panel ? 'slab' : civic ? 'civic' : modern ? 'office' : heritage ? 'streetwall' : 'house';
  const form=forms[type];
  // The window spacing varies by building, never by the tile being painted.
  // Stair cores are represented as a recessed bay within the panel façade.
  const spread=type==='hall' ? 1.4 : type==='slab' ? .1 : .76;
  return {...form,type,spacing:form.spacing+(noise(salt,597)-.5)*spread,
    core:panel ? Math.round(noise(salt,899)) : -1,
    dressed:!small && (type==='streetwall'||type==='civic'),
    levels:Math.max(0, Math.round(levels)),
  };
}

export function metres(value) {
  const raw=String(value??'').trim().replace(',','.');
  const metric=raw.match(/^(\d+(?:\.\d+)?)\s*(?:m|metres?)?$/i);
  if (metric) return Number(metric[1]);
  const imperial=raw.match(/^(\d+(?:\.\d+)?)\s*(?:'|ft)\s*(\d+(?:\.\d+)?)?\s*(?:"|in)?$/i);
  return imperial ? Number(imperial[1])*.3048+Number(imperial[2]??0)*.0254 : 0;
}
