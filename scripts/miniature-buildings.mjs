import { mix, noise, shade } from './raster.mjs';

const profiles = {
  townhouse:   { floors: 3.34, bay: 3.42, plinth: .66, cornice: .85, family: 'town' },
  secession:   { floors: 3.42, bay: 3.39, plinth: .65, cornice: .82, family: 'secession' },
  plaster:     { floors: 3.16, bay: 3.95, plinth: .73, cornice: .66, family: 'plaster' },
  functional:  { floors: 3.44, bay: 3.17, plinth: .46, cornice: .42, family: 'functional' },
  poruba:      { floors: 3.39, bay: 3.58, plinth: .96, cornice: .94, family: 'poruba' },
  panel:       { floors: 2.91, bay: 3.79, plinth: .57, cornice: .52, family: 'estate' },
  detached:    { floors: 2.94, bay: 4.26, plinth: .49, cornice: .4, family: 'houses' },
  modernHouse: { floors: 2.97, bay: 4.66, plinth: .35, cornice: .44, family: 'modernHouse' },
  row:         { floors: 3.05, bay: 3.17, plinth: .54, cornice: .58, family: 'row' },
  colony:      { floors: 3.17, bay: 3.58, plinth: .64, cornice: .64, family: 'row' },
  shop:        { floors: 3.65, bay: 4.63, plinth: .48, cornice: .51, family: 'modern' },
  office:      { floors: 3.45, bay: 3.14, plinth: .39, cornice: .47, family: 'modern' },
  civic:       { floors: 4.32, bay: 4.44, plinth: .98, cornice: .94, family: 'civic' },
  school:      { floors: 3.71, bay: 5.46, plinth: .79, cornice: .7, family: 'school' },
  works:       { floors: 5.5, bay: 5.31, plinth: .61, cornice: .68, family: 'ironworks' },
  workshop:    { floors: 4.5, bay: 5.75, plinth: .48, cornice: .55, family: 'workshop' },
  warehouse:   { floors: 5.2, bay: 7.45, plinth: .55, cornice: .54, family: 'industry' },
  ancillary:   { floors: 3.04, bay: 4.51, plinth: .36, cornice: .33, family: 'ancillary' },
};

// The historic register coordinates fall inside these OSM footprints.
// These entries use the ordinary façades; silhouettes still use OSM geometry.
const referenced = {
  w59091102: 'secession',  // Mainx and Popp, Ostravské památky 123
  w47358805: 'secession',  // Eisner Villa, Ostravské památky 70
  w47349771: 'secession',  // Berger, Ostravské památky 51
  w47349764: 'secession',  // Roth, Ostravské památky 288
  w47354162: 'functional', // ASO, Ostravské památky 106
};

const detached = /^(house|detached|semidetached_house|bungalow)$/;
const residential = /^(apartments|residential|dormitory|yes)$/;
const commercial = /^(commercial|retail|mall|supermarket|kiosk|mixed_use)$/;
const brick = /^(brick|bricks)$/;

export function sharedPartyWalls(features,pitch) {
  const owners=new Map();
  const attached=new Set();
  for (const f of features) {
    if (!/^(yes|residential|house|terrace|semidetached_house)$/.test(f.tags.building) ||
        Number(f.tags['building:levels'])>3 || f.worldRings?.length!==1) continue;
    const ring=f.worldRings[0];
    for (let i=1;i<ring.length;i++) {
      const [x0,y0]=ring[i-1];
      const [x1,y1]=ring[i];
      const length=Math.hypot(x1-x0,(y1-y0)/pitch);
      if (length<4 || length>24) continue;
      const a=ring[i-1].join(',');
      const b=ring[i].join(',');
      const key=a<b ? a+'|'+b : b+'|'+a;
      const previous=owners.get(key);
      if (previous && previous!==f.id) {
        attached.add(previous);
        attached.add(f.id);
      } else owners.set(key,f.id);
    }
  }
  return attached;
}

export function buildingArchetype({ id, tags, context, footprint, span, small, industrial, civic, levels, salt, attached }) {
  const use = tags['building:part'] || tags.building || 'yes';
  const material = tags['building:material'] || tags.material;
  const flat = tags['roof:shape']==='flat';
  const historic = Boolean(tags.historic && tags.historic!=='no');
  const domestic = detached.test(use);
  const apartment = residential.test(use);
  const grouped = apartment && (levels===0 || levels>=2) && span>=13;
  const reference=referenced[id];
  let type;
  if (small) type='ancillary';
  else if (reference) type=reference;
  else if (use==='warehouse') type='warehouse';
  else if (industrial || context==='ironworks' && use==='yes' && footprint>=360) {
    type=context==='ironworks' && !['service','transformer_tower'].includes(use) ? 'works' : 'workshop';
  } else if (/^(school|kindergarten|university|college)$/.test(use) ||
      /^(school|kindergarten|university|college)$/.test(tags.amenity)) type='school';
  else if (civic) type='civic';
  else if (context==='poruba' && !flat && grouped && levels<=6 && footprint>=160) type='poruba';
  else if (apartment && levels>=6 && footprint>=135 && (context!=='centre' || flat || levels>=8)) type='panel';
  else if (context==='jubilee' && grouped && levels<=3 && footprint>=105 && !flat) type='colony';
  else if (/^(office|hotel)$/.test(use)) type='office';
  else if (commercial.test(use)) {
    type=context==='centre' && flat && !historic && footprint<720 ? 'functional' : 'shop';
  } else if (use==='terrace' || use==='semidetached_house' || attached && context!=='centre' && footprint<310 && span<36) type='row';
  else if (context==='centre' && grouped && (!domestic || historic)) {
    type=flat && !historic ? 'functional' :
      (historic || levels>=3 && levels<=5 && !brick.test(material)) && span<42 && noise(salt,71)>.72 ?
        'secession' : span<34 ? 'townhouse' : 'plaster';
  } else if (domestic || apartment && footprint<=150 && levels<=2) {
    type=flat && !historic ? 'modernHouse' : 'detached';
  } else if (apartment && (levels>=3 || footprint>=210)) type='plaster';
  else type='detached';

  const form=profiles[type];
  const commerce=commercial.test(use) || /^(cafe|pub|bar|restaurant|pharmacy|bank)$/.test(tags.amenity);
  return {
    ...form,
    type,
    fidelity: reference || tags.height || levels || tags['roof:shape'] || material || use!=='yes' || attached ? 'B' : 'C',
    flat: type==='functional'||type==='modernHouse'||type==='warehouse'||type==='office'||type==='panel',
    shopfront: commerce || id==='w47349771'||id==='w47349764',
    brick: brick.test(material) || type==='works' && !material,
  };
}

// Façade samples lie inside their OSM wall plane, including frames and
// recessed balcony graphics. u is frontage and h is height above the wall base.
export function miniatureWall({ design, palette, lit, wall, trim, dark, length, height, rise, scale, courtyard, salt }) {
  const {type,bay,plinth,cornice}=design.architecture;
  const metres=length/scale;
  const stature=rise(1);
  const floorGuess=design.facade.levels ? design.facade.levels-design.minimum/design.architecture.floors :
    height/(stature*design.architecture.floors);
  const floors=Math.max(1,Math.round(floorGuess));
  const floorHeight=height/floors;
  const bays=Math.max(1,Math.round(metres/(bay*(courtyard ? 1.12 : 1))));
  const breadth=metres/bays;
  const opening=metres>=2.95 && height/stature>=2.6 && type!=='ancillary';
  const main=!courtyard && metres>=design.span*.65;
  const detail=scale>=1.45;
  const print=palette.technique==='lithograph';
  const trimLight=shade(trim,lit ? 15 : 5);
  const plinthShadow=shade(wall,lit ? -37 : -28);
  const reveal=mix(wall,dark,.82);
  const frame=mix(trim,dark,.24);
  const sill=shade(trim,lit ? 5 : -7);
  const glass=lit ? palette.litGlass : palette.shadeGlass;
  const ink=lit ? palette.window : shade(palette.window,-10);
  const reflection=mix(glass,trimLight,.32);
  const backing=mix(wall,dark,.39);
  const fascia=mix(wall,trim,.67);
  const weathered=detail && palette.light?.weathered;
  const postcard=palette.postcard && !courtyard && main && (type==='townhouse'||type==='secession'||type==='civic');
  const corniceCut=weathered && main && ['poruba','townhouse','secession','civic'].includes(type);
  const plaster=weathered && ['poruba','townhouse','secession','plaster','colony','row','detached','panel'].includes(type);
  const shopColor=[0x617e72,0xa2644c,0x6a7c8c,0x977455][Math.floor(noise(salt,246)*4)];
  const panelAccent=[0x8ea097,0xc6a375,0xb38e84,0x929cac][Math.floor(noise(salt,247)*4)];
  const doorTone=lit ? mix(shopColor,ink,.44) : mix(shopColor,ink,.65);
  const centralBay=Math.floor(bays/2);
  const porubaEntranceStep=bays>=8 ? 4 : bays>=5 ? 3 : bays;
  const verticalArch=type==='secession'||type==='civic'||type==='colony';

  function pane(x,y,halfWidth,low,high,curved=false) {
    const top=curved ? high-Math.max(0,Math.abs(x)-halfWidth*.38)*.5 : high;
    if (Math.abs(x)>halfWidth || y<low || y>top) return undefined;
    if (y>top-.057||Math.abs(x)>halfWidth-.042) return reveal;
    if (y<low+.052) return ink;
    if (detail && (Math.abs(x)<.031 || curved && y>low+.55*(high-low) && y<low+.70*(high-low))) return frame;
    if (detail && !print && x<-.025 && y>top-.16) return reflection;
    return y>low+.54*(high-low) ? glass : ink;
  }

  return (u,h,wx,wy) => {
    const ground=h/floorHeight;
    const storey=Math.floor(ground);
    const v=ground-storey;
    const spaced=u*bays;
    const col=Math.floor(spaced);
    const x=spaced-col-.5;
    const ax=Math.abs(x);
    const edge=Math.min(u,1-u)*metres;
    const ledge=(height-h)/stature;
    const elevation=h/stature;
    const groundFloor=storey===0 && design.minimum<.45;
    if (elevation<plinth) return elevation<plinth*.31 ? plinthShadow :
      elevation>plinth*.72 ? fascia : backing;
    if (ledge<cornice) {
      if (ledge<cornice*.35) return trimLight;
      if (corniceCut && ledge>cornice*.53 && ledge<cornice*.81 && ax>.29 && ax<.42) return fascia;
      if (ledge<cornice*.63) return fascia;
      return plinthShadow;
    }
    if (edge<.27) return lit ? fascia : backing;
    if (postcard && edge<1.05 && v<.96 && (storey<2 || palette.postcard==='slate')) {
      const course=(elevation/.46)%1;
      return course<.18 ? backing : course>.76 && lit ? trimLight : fascia;
    }
    if (postcard && !groundFloor && v>.84 && v<.92 && ax<.38 &&
      (type==='secession'||storey===floors-1)) {
      return v>.89 ? (ax<.14?trimLight:fascia) : backing;
    }
    if (design.portal && metres>10 && Math.abs(u-.51)<.2 && elevation<17-26*(u-.51)**2) {
      return Math.abs(u-.51)>.176 ? trim : ink;
    }
    if (type==='ancillary' && main && design.doorway && groundFloor && ax<.32 && v<.68) {
      if (ax>.285 || v>.61) return backing;
      return detail && Math.floor(elevation/.31)%3===0 ? shade(doorTone,13) : doorTone;
    }
    if (opening && edge>.60) {
      if (groundFloor && main && design.architecture.shopfront) {
        if (v>.72 && v<.88 && ax<.47) return print ? fascia : (ax<.05 ? trimLight : shopColor);
        if (v>.14 && v<.70 && ax<.42) {
          if (ax>.37 || x>.12 && x<.18 || detail && v>.49 && v<.55) return doorTone;
          return v>.44 ? glass : ink;
        }
      }
      switch (type) {
        case 'poruba': {
          if (ax>.382 && !courtyard) {
            if ((v>.84 || v<.16) && (storey===0 || storey===floors-2)) return v>.9 ? trimLight : fascia;
            return ax>.468 ? backing : ax>.43 ? trimLight : fascia;
          }
          if (groundFloor && main && (col-centralBay)%porubaEntranceStep===0) {
            const arch=v<.70-ax*ax*2.2;
            if (ax<.30 && arch) return ax<.235 && v<.57-ax*ax*2.5 ? doorTone : fascia;
            if (ax<.09 && v>.66 && v<.76) return trimLight;
          }
          if (v>.81 && v<.91 && (storey===0 || storey===floors-2)) return v>.86 ? trimLight : backing;
          const window=pane(x,v,.225,.24,.72);
          if (window!==undefined) return window;
          if (ax<.29 && v>.16 && v<.25) return v>.202 ? trimLight : backing;
          if (!courtyard && !print && storey===floors-1 && col%2===centralBay%2 &&
            v>.76 && v<.83 && ax<.13) return v>.8 ? trimLight : shade(fascia,-9);
          if (!courtyard && ax<.30 && v>.72 && v<.79) return fascia;
          break;
        }
        case 'panel': {
          if (bays>=4 && col%5===2) {
            if (ax<.3 && v>.37 && v<.64) return v>.49 ? glass : ink;
            if (ax<.44) return mix(backing,panelAccent,.49);
          }
          if (v>.88||ax>.485) return backing;
          if (!groundFloor && col%3===0 && ax<.42 && v>.18 && v<.75) {
            if (v<.35) return v>.29 ? panelAccent : backing;
            return ax>.31 ? backing : x>.13 ? frame : glass;
          }
          const window=pane(x,v,.372,.30,.72);
          if (window!==undefined) return window;
          if (ax<.42 && v>.22 && v<.30) return fascia;
          break;
        }
        case 'functional':
        case 'office': {
          const band=v>.30 && v<.74;
          if (band && edge>metres*.06) {
            if (v<.366 || v>.692 || ax>.462) return dark;
            if (detail && !print && v>.57) return ax<.045 ? frame : reflection;
            return ax<.04 ? frame : v>.46 ? glass : ink;
          }
          if (v>.23 && v<.30) return type==='functional' ? trimLight : fascia;
          break;
        }
        case 'shop': {
          if (v>.73 && v<.82 && main) return shopColor;
          if (v>.28 && v<.70 && (groundFloor || col%3!==1)) {
            if (ax>.43 || ax<.032 || v<.34) return reveal;
            return v>.54 ? glass : ink;
          }
          break;
        }
        case 'works':
        case 'workshop': {
          if (ax>.425) return ax>.484 ? trim : backing;
          if (groundFloor && main && col%4===1 && ax<.35 && v<.66) {
            return detail && Math.floor(elevation/.38)%3===0 ? shade(doorTone,15) : doorTone;
          }
          if (ax<.36 && v>.42 && v<.88) {
            if (v<.47||v>.82||ax>.31||detail && (ax<.045||Math.abs(v-.638)<.032)) return reveal;
            return v>.68 ? glass : ink;
          }
          if (v>.34 && v<.43 && ax<.38) return fascia;
          break;
        }
        case 'warehouse': {
          if (ax>.46) return trim;
          if (groundFloor && main && col%3!==2 && ax<.37 && v<.72) {
            if (v>.65 || ax>.32) return backing;
            return detail && Math.floor(elevation/.43)%3===0 ? shade(doorTone,17) : doorTone;
          }
          if (v>.53 && v<.73 && ax<.39) return ax<.048 ? reveal : glass;
          break;
        }
        case 'detached':
        case 'modernHouse': {
          if (groundFloor && main && col===bays-1 && bays>=2 && ax<.225 && v<.68) {
            return ax>.175 || v>.62 ? trim : doorTone;
          }
          const window=pane(x,v,type==='modernHouse' ? .38 : .265,.30,.73);
          if (window!==undefined) return window;
          if (detail && !print && type==='detached' && main && ax<.26 && v>.267 && v<.32 &&
            noise(salt,325+col)>.78) return v>.29 ? 0x778358 : 0xa36d51;
          if (ax<.31 && v>.225 && v<.30) return sill;
          if (detail && type==='detached' && main && breadth>3.6 && noise(salt,487)>.55 && ax>.27 && ax<.39 && v>.30 && v<.71) {
            return shopColor;
          }
          break;
        }
        case 'row':
        case 'colony': {
          if (ax>.45) return ax>.48 ? backing : fascia;
          if (groundFloor && main && col%2===0 && ax<.23 && v<.73-(verticalArch ? x*x : 0)) {
            if (ax>.18 || v>.66) return trim;
            return doorTone;
          }
          const window=pane(x,v,.255,.26,.76,verticalArch);
          if (window!==undefined) return window;
          if (ax<.32 && v>.18 && v<.265) return sill;
          if (type==='colony' && ax<.29 && v>.76 && v<.82) return fascia;
          break;
        }
        case 'school':
        case 'civic': {
          if (ax>.4 && type==='civic') return ax>.467 ? backing : fascia;
          if (groundFloor && main && col===centralBay && v<.84-ax*ax*2.4 && ax<.36) {
            return v<.76-ax*ax*2.4 && ax<.27 ? doorTone : trimLight;
          }
          const window=pane(x,v,type==='school' ? .351 : .245,.225,.81,verticalArch);
          if (window!==undefined) return window;
          if (v>.137 && v<.225) return v>.185 ? trimLight : backing;
          break;
        }
        default: {
          if (!courtyard && storey===0 && v>.87 && v<.945) return v>.9 ? trimLight : backing;
          const inset=type==='plaster' ? .28 : .225;
          const balcony=!print && !courtyard && main && storey>0 && (col===centralBay || bays>=6 && col%4===1) &&
            (type==='secession' || type==='plaster' && noise(salt,559)>.64);
          if (balcony && ax<.352 && v>.17 && v<.38) {
            if (v<.24) return v>.20 ? trimLight : backing;
            return detail && Math.floor((x+.5)*13)%2===0 || v>.346 ? rail : mix(wall,dark,.26);
          }
          const window=pane(x,v,inset,.238,.77,verticalArch);
          if (window!==undefined) return window;
          if (ax<inset+.095 && v>.157 && v<.241) return v>.202 ? sill : backing;
          if (!courtyard && v>.77 && v<.85 && ax<inset+.078) {
            return type==='secession' ? (ax<.082 ? trimLight : ax>.17 ? fascia : wall) :
              type==='townhouse' ? fascia : wall;
          }
        }
      }
    }
    if (print && (wx+2*wy)%6===0 && (!lit || v<.19)) return shade(wall,-14);
    if (design.architecture.brick && detail) {
      const course=elevation/.38;
      const vertical=(u*metres/.88+Math.floor(course)*.5)%1;
      if (course%1<.15 || vertical<.075) return shade(wall,-12);
      return shade(wall,Math.round((noise(Math.floor(course),Math.floor(u*metres/.88),salt)-.5)*13));
    }
    if (detail && storey===0 && v<.33 && (type==='poruba'||type==='townhouse'||type==='secession')) {
      return elevation%.68<.095 ? backing : wall;
    }
    if (plaster) {
      const age=noise(Math.floor(u*metres/1.34),Math.floor(elevation/1.02),salt+593);
      const wear=storey===0 && v<.42 ? -3 : 0;
      return shade(wall,Math.round((age-.5)*(type==='panel'?8:12))+wear);
    }
    return wall;
  };
}

const rail=0x595951;
