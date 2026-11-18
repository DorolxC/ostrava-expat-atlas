import { shade, mix } from './raster.mjs';
import { region } from '../public/js/geo.js';
import { paintBlenderModel } from './blender-models.mjs';
import {
  curatedLandmarkStyles, paintCathedral, paintMasarykSquare, paintNewCityHall,
  paintOblouk, paintOldTownHall, paintSykoraBridge,
} from './curated-landmarks.mjs';

export { curatedLandmarkReplacements } from './curated-landmarks.mjs';

const boltWalkways = [
  ['w481631668', 25, 26.05], ['w481631669', 53, 54.3],
  ['w481631674', 58, 58.8], ['w481631675', 64, 64.8],
  ['w481631676', 69, 69.8], ['w481631677', 74, 74.65],
];
const boltPiers = ['w481631667', 'w481631670', 'w481631671', 'w481631672', 'w481631673'];
const stoves = ['w481631678', 'w481631679', 'w242013766', 'w481631680'];
const townShaft = ['w462065473', 'w462065474', 'w462065476', 'w462065477'];
const bellTowers = ['w462065478', 'w462065480'];
const cathedralWalls = ['w47358795','w462065479'];

export const modeledBuildingIds = new Set([
  'w481631666', ...boltWalkways.map(([id]) => id), ...boltPiers, ...stoves,
  'w78540797', 'w506257124', ...townShaft, ...bellTowers,
]);
export const modeledAtlasBuildingIds = new Set(['w78540806','w242013755','w38935068','w33679723']);

const ironworksPalettes = {
  atlas: {
    darkSteel:0x3a3e42, edgeSteel:0x828885, platform:0x8e9488, plank:0x697774,
    rail:0xc1c5b1, railShade:0x566d6c, oxide:0xa15f45, sleeve:0x5a453c,
    glass:0x86b2ae, glassShade:0x36596d, roof:0x767e75, roofShade:0x566663,
    casing:0xe2d5b8, casingShade:0x9a9e93, truss:0x5b4840, copper:0xb38252,
  },
  foundry: {
    darkSteel:0x333740, edgeSteel:0x7f8583, platform:0x797f78, plank:0x596564,
    rail:0xa5aca0, railShade:0x4c6363, oxide:0x9a523b, sleeve:0x51403e,
    glass:0x7ca5a6, glassShade:0x334e62, roof:0x646d6b, roofShade:0x475656,
    casing:0xc9c1a9, casingShade:0x89918b, truss:0x514243, copper:0xba8051,
  },
  daylight: {
    darkSteel:0x404847, edgeSteel:0x7e8c87, platform:0x929e91, plank:0x697976,
    rail:0xabbdb2, railShade:0x536769, oxide:0x885841, sleeve:0x614d45,
    glass:0x80a8a6, glassShade:0x415f69, roof:0x8c9082, roofShade:0x586868,
    casing:0xe3dbc7, casingShade:0xb1b2a3, truss:0x564e45, copper:0xc48658,
  },
};

const iron = 0x452f28;
const oxide = 0x77503c;
const rust = 0xa06442;
const edge = 0xc39364;
const verdigris = 0x6b846d;
const paleStone = 0xead6ad;
const bronze = 0x8e663f;
const tau = Math.PI * 2;
const clamp = (n, low, high) => Math.max(low, Math.min(high, n));
const tween = (a, b, t) => [a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t];

export function modelLandmarks({ map, scale, features, landmarks, screen, boxRing, rise, wallFace, flatRoof, slopeFace, pilot, style }) {
  const pitch = region.pitch;
  const detailed = scale >= 1.5;
  const curated = curatedLandmarkStyles.has(style);
  const atlas = curated || style === 'atlas' || style === 'foundry';
  const industrialInk = atlas ? (ironworksPalettes[style === 'lithograph' ? 'foundry' : style]??ironworksPalettes.daylight) : undefined;
  const shadowCast=style==='afternoon'||style?.startsWith('postcard-')?1.30:style==='overcast'?.88:1;
  const ironworksPilot = atlas || pilot === 'ironworks';
  const centrePilot = atlas || pilot === 'centre';
  const inside = ([x,y]) => x > -113*scale && x < map.width+113*scale
    && y > -120*scale && y < map.height+171*scale;
  const visible = landmarks.map(item=>[item,screen(item.point)]).filter(([item,center])=>{
    if (item.model!=='blender') return inside(center);
    const [x,y]=center;
    const pad=(item.reach+35)*scale;
    return x>-pad && x<map.width+pad && y>-pad && y<map.height+pad;
  });
  const bindings = new Set(curated ? visible.flatMap(([item])=>
    item.level === 'A' ? Object.values(item.geometry).flat() : []) : []);
  const parts = new Map();
  for (const kind of bindings.size ? ['building','part','road','detail'] : ['building','part']) {
    for (const feature of features(kind)) {
      if (bindings.has(feature.id) || modeledBuildingIds.has(feature.id) || feature.id === 'w38935068' || feature.id === 'w47987365' ||
          (atlas && (modeledAtlasBuildingIds.has(feature.id) || feature.id === 'w462065472')) ||
          (centrePilot && cathedralWalls.includes(feature.id))) {
        parts.set(feature.id,feature);
      }
    }
  }

  function average(ring) {
    const n = ring.length > 2 ? ring.length-1 : ring.length;
    return ring.slice(0,n).reduce(([x,y],p) => [x+p[0]/n,y+p[1]/n],[0,0]);
  }

  const loop = (center, radius, sides=28) => Array.from({length:sides+1},(_,i) => polar(center,radius,i/sides*tau));
  const polar = (center, radius, t) => [
    center[0]+Math.cos(t)*radius*scale,
    center[1]+Math.sin(t)*radius*scale*pitch,
  ];
  const level = (point, h) => [...point,h];
  const slope = (point, h) => [...point,rise(h)];
  const material = (wall, roof=wall) => ({ wall,roof,small:true });
  const laid = (ring, height, color) => flatRoof([ring],rise(height),material(color),13);

  function walls(rings, low, high, style) {
    for (const ring of rings) {
      for (let i=1;i<ring.length;i++) wallFace(ring[i-1],ring[i],rise(low),rise(high),style,i);
    }
  }

  function solid(rings, low, high, style) {
    walls(rings,low,high,style);
    flatRoof(rings,rise(high),style,37);
  }

  function box(center, width, depth, low, high, color, cap=color, angle=0) {
    solid([boxRing(...center,width,depth,angle)],low,high,material(color,cap));
  }

  function triangle(a,b,c,color,pigment) {
    const [ax,ay,az] = a;
    const [bx,by,bz] = b;
    const [cx,cy,cz] = c;
    const ya = ay-rise(az);
    const yb = by-rise(bz);
    const yc = cy-rise(cz);
    const denom = (yb-yc)*(ax-cx)+(cx-bx)*(ya-yc);
    if (Math.abs(denom)<0.002) return;
    map.polygon([[[ax,ya],[bx,yb],[cx,yc]]],(x,y) => {
      const px = x+0.5-cx;
      const py = y+0.5-yc;
      const u = ((yb-yc)*px+(cx-bx)*py)/denom;
      const v = ((yc-ya)*px+(ax-cx)*py)/denom;
      const height=cz+u*(az-cz)+v*(bz-cz);
      const z = rise(height);
      // A fixed depth step keeps overlapping mesh panels ordered across
      // local Float32 depth buffers with different section origins.
      const depth=pigment ? Math.round(z*1.45*1024)/1024 : z*1.45;
      map.pixel(x,y,pigment ? pigment(x+.5,y+.5+z,height) : color,y+0.5+depth);
    });
  }

  function quad(a,b,c,d,color) {
    triangle(a,b,c,color);
    triangle(a,c,d,color);
  }

  function profile(center, levels, color, sides=28) {
    const rings = levels.map(([h,r]) => ({ h,points:loop(center,r,sides) }));
    for (let row=1;row<rings.length;row++) {
      const low = rings[row-1];
      const high = rings[row];
      for (let i=1;i<=sides;i++) {
        const sun = -Math.cos(((i-0.5)/sides)*tau+0.72);
        const channel = shade(color,Math.round(sun*19+(sun>0 ? 4 : -7)));
        quad(level(low.points[i-1],low.h),level(low.points[i],low.h),
          level(high.points[i],high.h),level(high.points[i-1],high.h),channel);
      }
    }
    const top = rings.at(-1);
    laid(top.points,top.h,shade(color,23));
    return top.points;
  }

  function beam(a,b,color,metres=0.46) {
    const [ax,ay,ah] = a;
    const [bx,by,bh] = b;
    const za = rise(ah);
    const zb = rise(bh);
    const ya = ay-za;
    const yb = by-zb;
    const dx = bx-ax;
    const dy = yb-ya;
    const length = Math.hypot(dx,dy);
    if (length < 0.02) return;
    const radius = Math.max(0.38,metres*scale/2);
    const nx = -dy/length*radius;
    const ny = dx/length*radius;
    const width = dx*dx+dy*dy;
    const depthStart = ay+za*0.45;
    const depthEnd = by+zb*0.45;
    if (radius < 0.57) {
      const steps = Math.ceil(length);
      for (let i=0;i<=steps;i++) {
        const t = i/steps;
        const depth = depthStart+(depthEnd-depthStart)*t+0.26;
        // Compare connected rung and upright samples at the precision of the
        // depth buffer, so ties resolve in draw order in both tile sections.
        map.pixel(Math.floor(ax+dx*t),Math.floor(ya+dy*t),color,ironworksPilot ? Math.fround(depth) : depth);
      }
      return;
    }
    map.polygon([[[ax+nx,ya+ny],[bx+nx,yb+ny],[bx-nx,yb-ny],[ax-nx,ya-ny]]],(x,y) => {
      const px = x+0.5-ax;
      const py = y+0.5-ya;
      const t = clamp((px*dx+py*dy)/width,0,1);
      const cross = (px*nx+py*ny)/(radius*radius);
      const pigment = cross > 0.57 ? shade(color,13) : cross < -0.58 ? shade(color,-15) : color;
      map.pixel(x,y,pigment,depthStart+(depthEnd-depthStart)*t+0.28);
    });
  }

  function route(points, color, metres) {
    for (let i=1;i<points.length;i++) beam(points[i-1],points[i],color,metres);
  }

  function rim(ring, h, color, metres=0.42) {
    route(ring.map((p)=>level(p,h)),color,metres);
  }

  function rails(ring, h, color, spacing=3.1, bottomRail=true) {
    rim(ring,h+1.12,color,0.28);
    if (detailed && bottomRail) rim(ring,h+0.56,shade(color,-10),0.17);
    for (let i=1;i<ring.length;i++) {
      const a = ring[i-1];
      const b = ring[i];
      const length = Math.hypot((b[0]-a[0])/scale,(b[1]-a[1])/scale/pitch);
      const count = Math.max(1,Math.ceil(length/spacing));
      for (let step=0;step<count;step++) {
        const point = tween(a,b,step/count);
        beam(level(point,h),level(point,h+1.12),shade(color,-12),0.2);
      }
    }
  }

  function wrapGallery(rings, anchor, high, low, index) {
    // A shallow ramp within the mapped walkway outline gives the stacked decks
    // the alternating, screw-like silhouette of the observation tower.
    const theta = 0.38 + (index%2)*Math.PI/2;
    const across = Math.cos(theta)*0.076/scale;
    const along = -Math.sin(theta)*0.076/(scale*pitch);
    const datum = (x,y) => (x-anchor[0])*across+(y-anchor[1])*along;
    const ramp = (p,h) => level(p,h+datum(...p));
    const lift = rise(1);
    const top = rings.map((ring)=>ring.map(([x,y])=>[x,y-rise(high+datum(x,y))]));
    map.polygon(top,(x,y)=>{
      const ground = (y+0.5+lift*(high+(x+0.5-anchor[0])*across-anchor[1]*along))/(1-lift*along);
      const z = rise(high+datum(x+0.5,ground));
      const span = (x-anchor[0])/scale*1.75+(ground-anchor[1])/scale*0.8;
      const plank = Math.floor(span)%4===0;
      const deck = industrialInk
        ? shade(plank ? industrialInk.plank : industrialInk.platform,((Math.floor(span)+24)&3)*3)
        : plank ? 0x899b99 : 0xaeada1;
      map.pixel(x,y,deck,y+0.5+z*1.45+0.11);
    });
    for (const ring of rings) {
      for (let i=1;i<ring.length;i++) {
        const a = ring[i-1];
        const b = ring[i];
        const face = industrialInk ? shade(industrialInk.darkSteel,b[1]>a[1] ? 17 : 7) : 0x56686a;
        quad(ramp(a,low),ramp(b,low),ramp(b,high),ramp(a,high),face);
        beam(ramp(a,high),ramp(b,high),industrialInk?.edgeSteel ?? 0xc5ccc2,0.30);
        if (industrialInk) beam(ramp(a,low-0.11),ramp(b,low-0.11),industrialInk.darkSteel,0.36);
      }
    }
    const ring = rings[0];
    for (let i=1;i<ring.length;i++) {
      const a = ring[i-1];
      const b = ring[i];
      beam(ramp(a,high+1.12),ramp(b,high+1.12),industrialInk?.rail ?? 0xb5c4bf,0.23);
      beam(ramp(a,high+0.52),ramp(b,high+0.52),industrialInk?.railShade ?? 0x687d7f,0.14);
      const length = Math.hypot(b[0]-a[0],(b[1]-a[1])/pitch)/scale;
      const count = Math.max(1,Math.ceil(length/1.75));
      for (let step=0;step<count;step++) {
        const p = tween(a,b,step/count);
        beam(ramp(p,high),ramp(p,high+1.12),industrialInk?.edgeSteel ?? 0x82989a,0.177);
      }
    }
  }

  function paintedWall(a,b,low,high,paint,bias=0.13) {
    const [ax,ay] = a;
    const [bx,by] = b;
    const bottom = rise(low);
    const top = rise(high);
    const dx = bx-ax;
    const dy = by-ay;
    const sun = dy/dx > 0;
    if (Math.abs(dx)<0.06) return;
    map.polygon([[[ax,ay-bottom],[bx,by-bottom],[bx,by-top],[ax,ay-top]]],(x,y) => {
      const u = (x+0.5-ax)/dx;
      const ground = ay+u*dy;
      const h = (ground-y-0.5)/rise(1);
      const pigment = paint(u,h,sun);
      if (pigment !== undefined) map.pixel(x,y,pigment,ground+(ground-y-0.5)*0.45+bias);
    });
  }

  function castShadow(ring, height) {
    const dx = Math.min(88,height*0.72*shadowCast)*scale;
    const dy = Math.min(48,height*0.69*region.pitch*shadowCast)*scale;
    for (const step of [0.20,0.39,0.58,0.76,0.89,1]) {
      map.polygon([ring.map(([x,y])=>[x+dx*step,y+dy*step])],(x,y)=>{
        const i = y*map.width+x;
        if (map.depth[i]<0) map.pixel(x,y,mix(map.pixels[i],0x405052,0.38-step*0.13),0);
      });
    }
  }

  function ladder(center, lower, upper, angle, color) {
    const left = polar(center,0.51,angle);
    const right = polar(center,0.51,angle+Math.PI);
    for (const point of [left,right]) beam(level(point,lower),level(point,upper),color,0.14);
    if (!detailed) return;
    for(let h=lower;h<upper;h+=0.58) beam(level(left,h),level(right,h),shade(color,9),0.14);
  }

  function pipe(points, diameter, color) {
    if (diameter*scale>2.8) route(points,shade(color,-25),diameter+0.35);
    route(points,color,diameter);
    if (!detailed || diameter<1.55) return;
    const upper = points.map(([x,y,h])=>[x-diameter*scale*0.16,y,h+diameter*0.20]);
    route(upper,shade(color,22),diameter*0.24);
  }

  function truss(a,b, hA,hB, color, span=4.8) {
    const count = Math.max(1,Math.ceil(Math.hypot((b[0]-a[0])/scale,(b[1]-a[1])/scale/pitch)/span));
    const bound = 3.5;
    beam(level(a,hA),level(b,hB),shade(color,-18),0.72);
    beam(level(a,hA+bound),level(b,hB+bound),color,0.61);
    for (let i=0;i<count;i++) {
      const t = i/count;
      const u = (i+1)/count;
      const p = tween(a,b,t);
      const q = tween(a,b,u);
      const hp = hA+(hB-hA)*t;
      const hq = hA+(hB-hA)*u;
      beam(level(p,hp),level(p,hp+bound),color,0.43);
      beam(level(p,hp+bound),level(q,hq),shade(color,8),0.41);
      if (detailed && i%2===0) beam(level(p,hp),level(q,hq+bound),shade(color,-16),0.29);
    }
    beam(level(b,hB),level(b,hB+bound),color,0.46);
  }

  function catwalk(a,b,low,high,width,color) {
    const angle = Math.atan2((b[1]-a[1])/pitch,b[0]-a[0]);
    const corners = [
      polar(a,width/2,angle-Math.PI/2),polar(a,width/2,angle+Math.PI/2),
      polar(b,width/2,angle-Math.PI/2),polar(b,width/2,angle+Math.PI/2),
    ];
    const [al,ar,bl,br] = corners;
    quad(level(al,low),level(ar,low),level(br,high),level(bl,high),shade(color,20));
    truss(al,bl,low,high,color);
    truss(ar,br,low,high,shade(color,-11));
  }

  function ribs(center,radius,low,high,color,count,diameter) {
    for (let i=0;i<count;i++) {
      const p = polar(center,radius,i/count*tau);
      beam(level(p,low),level(p,high),color,diameter);
    }
  }

  function furnaceKit(center, main, number) {
    const f = main ? 1 : number === 4 ? 0.91 : 0.82;
    const h = (metres) => metres*f;
    const around = (radius, angle) => polar(center,radius*f,angle);
    const footprint = boxRing(...center,25*f,20*f,0.31);
    castShadow(footprint,h(65));
    profile(center,[
      [h(5),6.9*f],[h(12),6.9*f],[h(19),8.4*f],[h(26),9*f],[h(32),8.5*f],
      [h(38),7.5*f],[h(44),5.7*f],[h(49),4.45*f],
    ],ironworksPilot ? (number===6 ? 0x62423c : 0x864c39) : number===6 ? 0x6c4a3a : 0x79513b);
    for (const [levelH,r] of [[10,7],[17,8],[23,9.1],[27,9.1],[33,8.55],[41,6.75],[46,5.2]]) {
      rim(loop(center,r*f,26),h(levelH),levelH===23 ? rust : oxide,levelH===23 ? 0.66 : 0.45);
    }

    const mapped = main
      ? boltPiers.filter((id)=>parts.has(id)).map((id)=>average(parts.get(id).rings[0]))
      : [];
    const piers = mapped.length>=4 ? mapped.slice(0,5) : [0.54,2.18,3.65,5.15].map((angle)=>around(number===6 ? 11.4 : 12.5,angle));
    piers.sort((a,b)=>Math.atan2(a[1]-center[1],a[0]-center[0])-Math.atan2(b[1]-center[1],b[0]-center[0]));
    const decks = [10,24.7,38.6,52.8];
    for (const [i,foot] of piers.entries()) {
      const next = piers[(i+1)%piers.length];
      box(foot,2.24*f,2.17*f,0,4,0x74716a,0x9b8a70,0.31);
      beam(level(foot,3.4),level(foot,h(56.1)),ironworksPilot ? 0x353434 : iron,1.1);
      const flange = polar(foot,0.37*f,0.3);
      beam(level(flange,3.4),level(flange,h(56.1)),industrialInk?.edgeSteel ?? oxide,0.35);
      for (const [j,deck] of decks.entries()) {
        const riseTo = decks[j+1];
        const railColor = deck===24.7 || deck===52.8 ? 0xb29254 : oxide;
        beam(level(foot,h(deck)),level(next,h(deck)),oxide,0.89);
        if (deck===24.7 || deck===52.8) {
          beam(level(foot,h(deck+1.36)),level(next,h(deck+1.36)),railColor,0.32);
          for(let k=0;k<4;k++) {
            const p = tween(foot,next,k/4);
            beam(level(p,h(deck)),level(p,h(deck+1.36)),shade(railColor,-17),0.23);
          }
        }
        if (riseTo===undefined) continue;
        const corner = tween(foot,next,0.46);
        beam(level(foot,h(deck)),level(corner,h(riseTo)),shade(iron,13),0.68);
        beam(level(corner,h(riseTo)),level(next,h(deck)),iron,0.6);
        if (ironworksPilot) {
          const span = tween(foot,next,0.50);
          const gussetA = tween(foot,next,0.11);
          const gussetB = tween(foot,next,0.89);
          beam(level(gussetA,h(deck+0.3)),level(gussetB,h(deck+0.3)),0x9e735a,0.21);
          beam(level(span,h(deck)),level(span,h(deck+3.1)),0x5f4d46,0.32);
          triangle(level(foot,h(deck)),level(foot,h(deck+1.5)),level(gussetA,h(deck)),0x686063);
          triangle(level(next,h(deck)),level(next,h(deck+1.5)),level(gussetB,h(deck)),0x61524b);
          if (industrialInk && detailed) {
            for (const joint of [gussetA,gussetB]) {
              beam(level(joint,h(deck+0.02)),level(joint,h(deck+0.52)),industrialInk.copper,0.26);
            }
          }
        }
      }
    }
    const liftSide = piers[0];
    if (detailed) ladder(liftSide,h(8),h(52),0.91,edge);

    for (const [alt,r] of [[22.5,10.8],[38.6,9.6],[52.4,8.9]]) {
      const deck = loop(center,r*f,12);
      solid([deck,loop(center,(r-1.6)*f,12)],h(alt-0.85),h(alt),material(industrialInk?.darkSteel ?? iron,
        industrialInk ? shade(industrialInk.sleeve,20) : 0x9a7e5d));
      rails(deck,h(alt),alt===38.6 ? 0xaf9056 : shade(oxide,27),4.0);
    }

    const dust = around(number===6 ? 15.8 : 15.0,2.54);
    profile(dust,[[6,2.5*f],[12,3.5*f],[h(34),3.55*f],[h(38),2.2*f],[h(39.2),1.37*f]],shade(oxide,10),20);
    rim(loop(dust,3.49*f,20),h(29),rust,0.57);
    rails(loop(dust,4.14*f,20),h(31),0xa08656,4.9,false);
    pipe([
      level(dust,h(36.2)),level(dust,h(41.4)),level(polar(dust,1.1*f,-0.35),h(42.4)),
      level(around(10.8,2.37),h(42.4)),level(around(6.5,2.33),h(46.5)),level(center,h(48.5)),
    ],2.0*f,rust);

    const bustle = loop(center,10.35*f,30);
    pipe(bustle.map((p)=>level(p,h(17.0))),1.76*f,shade(oxide,6));
    for (const angle of [0.67,1.82,3.06,4.12,5.3]) {
      pipe([level(around(10.35,angle),h(17)),level(around(9.85,angle),h(13.3)),level(around(8.38,angle),h(12.6))],0.69*f,rust);
    }
    if (ironworksPilot) {
      const seams = [[17.35,10.42,0x473431],[23.4,9.14,0xaa6847],[26.8,9.16,0x503833],[35.3,7.93,0xa3654d]];
      for (const [alt,radius,color] of seams) rim(loop(center,radius*f,30),h(alt),color,0.27);
      const ducts = [0.76,2.88,4.7];
      for (const angle of ducts) {
        const limb = [
          level(around(8.76,angle),h(18.2)),level(around(9.9,angle),h(18.2)),
          level(around(10.75,angle),h(19.4)),level(around(10.75,angle),h(27.6)),
          level(around(9.96,angle),h(28.7)),level(around(8.62,angle),h(28.7)),
        ];
        pipe(limb,0.84*f,industrialInk?.oxide ?? 0xa56142);
        for (const at of [21.1,25.6]) {
          const a = around(10.42,angle-0.037);
          const b = around(11.05,angle+0.037);
          beam(level(a,h(at)),level(b,h(at)),industrialInk?.copper ?? 0xda9460,0.29);
          if (industrialInk && detailed) {
            beam(level(a,h(at+0.34)),level(b,h(at+0.34)),industrialInk.sleeve,0.34);
          }
        }
      }
    }

    // Inclined carriage rails and trussed walkways on the machinery side.
    const skipA = around(main ? 52 : number===4 ? 42 : 33,0.33);
    const skipB = around(8.35,0.33);
    catwalk(skipA,skipB,h(7.8),h(48),4.5*f,0x694735);
    const skipAngle = Math.atan2((skipB[1]-skipA[1])/pitch,skipB[0]-skipA[0]);
    for (const s of [-0.55,0.55]) {
      const offset = (p) => polar(p,s*f,skipAngle+Math.PI/2);
      beam(level(offset(skipA),h(9.2)),level(offset(skipB),h(49.4)),industrialInk?.edgeSteel ?? shade(oxide,22),0.48);
    }
    if (industrialInk && detailed) {
      const ties = Math.ceil(Math.hypot(skipA[0]-skipB[0],(skipA[1]-skipB[1])/pitch)/(scale*1.55));
      for (let i=0;i<ties;i++) {
        const progress = (i+0.5)/ties;
        const point = tween(skipA,skipB,progress);
        const alt = h(8.95+40.2*progress);
        beam(level(polar(point,0.96*f,skipAngle+Math.PI/2),alt),
          level(polar(point,0.96*f,skipAngle-Math.PI/2),alt),industrialInk.sleeve,0.36);
      }
    }
    const baseSupport = tween(skipA,skipB,0.25);
    const tallSupport = tween(skipA,skipB,0.62);
    for (const [p,top] of [[baseSupport,h(17.3)],[tallSupport,h(32.7)]]) {
      const legs = [polar(p,3.2*f,1.97),polar(p,3.2*f,5.11)];
      beam(level(legs[0],0),level(p,top),iron,0.92);
      beam(level(legs[1],0),level(p,top),oxide,0.92);
      beam(level(legs[0],1),level(legs[1],1),shade(oxide,-9),0.54);
    }
    if (!main) {
      const head = boxRing(...center,18*f,16*f,0.3);
      rim(head,h(58),oxide,1.08);
      for (const point of head.slice(0,-1)) beam(level(point,h(53)),level(point,h(58)),iron,0.9);
      box(around(2.4,4.7),7.3*f,5.5*f,h(45),h(54),0x694a35,0x876751,0.3);
      pipe([level(center,h(49)),level(around(0.4,2.25),h(57)),level(around(6.7,2.25),h(57))],1.78*f,oxide);
    }
  }

  function hotBlastStoves() {
    for (const [i,id] of stoves.entries()) {
      const f = parts.get(id);
      if (!f) continue;
      const footprint = f.rings[0];
      const center = average(footprint);
      const radius = footprint.slice(0,-1).reduce((sum,p)=>sum+Math.hypot(p[0]-center[0],(p[1]-center[1])/pitch)/scale,0)/(footprint.length-1);
      const body = ironworksPilot ? (i%2 ? 0x805044 : 0x985f47) : i%2 ? 0x765347 : 0x81604b;
      castShadow(footprint,34.5);
      profile(center,[[1,radius],[28.7,radius],[31.6,radius*0.93],[33.8,radius*0.72],[34.9,radius*0.42]],body,26);
      for (const y of [4.0,13,23.5,28.5]) rim(loop(center,radius+0.16,26),y,shade(oxide,-6),0.53);
      ribs(center,radius+0.1,6,28.5,shade(body,-22),8,0.26);
      const riser = polar(center,radius+1.16,1.02);
      pipe([level(riser,2.7),level(riser,18.4),level(polar(center,radius+0.52,1.02),19.4),level(polar(center,radius-0.25,1.02),19.4)],1.28,0x916044);
      if (detailed) ladder(polar(center,radius+0.24,0.82),6,29,2.08,0x937f65);
      if (ironworksPilot) {
        for (const [alt,color] of [[9.2,0xb47656],[14.0,0x5c413b],[23.8,0xb47656],[29.0,0xb5a08a]]) {
          rim(loop(center,radius+0.11,26),alt,color,0.21);
        }
        const tie = polar(center,radius+0.15,1.56);
        const vent = polar(center,radius+0.37,1.56);
        beam(level(tie,5.0),level(tie,27.5),0x624f48,0.42);
        beam(level(vent,7.1),level(vent,24.1),0xa57f6a,0.20);
        if (industrialInk && detailed) {
          const barrel = loop(center,radius+0.028,26);
          for (let face=1;face<barrel.length;face++) {
            paintedWall(barrel[face-1],barrel[face],2,28.2,(u,h,lit)=>{
              const course = (Math.floor(h/1.44)+face*5)%7;
              const weld = h%1.44;
              if (weld<0.10) return shade(body,lit ? -19 : -35);
              if (u>0.84 && weld<0.44) return shade(body,lit ? 24 : 6);
              if (course===1 || course===6) return shade(body,lit ? course===1 ? 9 : -8 : course===1 ? -13 : -26);
              return undefined;
            },0.045);
          }
        }
      }
    }
  }

  function boltTower(towerPoint, landmark) {
    furnaceKit(towerPoint,true,1);
    hotBlastStoves();
    const glassPart = parts.get(landmark?.geometry.glass ?? 'w481631666');
    const glass = glassPart?.rings[0] ?? loop(polar(towerPoint,5.6,-0.46),5.45,34);
    const anchor = average(glass);
    walls([glass],53.9,77.0,material(0x5f7c80,0xa8aba2));
    for (let i=1;i<glass.length;i++) {
      const a = glass[i-1];
      const b = glass[i];
      paintedWall(a,b,54,75.4,(u,h,lit)=> {
        if (industrialInk) {
          const band = (h-54)%4.92;
          const tone = lit ? industrialInk.glass : industrialInk.glassShade;
          if (band<0.24 || u<0.069 || u>0.955) return lit ? industrialInk.rail : industrialInk.edgeSteel;
          if (band<0.46) return shade(tone,-26);
          const sweep = (i*0.149+u*0.175+(h-54)*0.037)%1;
          const stripe = sweep>0.73 && sweep<0.84 ? 24 : sweep>0.69 && sweep<0.91 ? 10 : sweep<0.22 ? -20 : 0;
          if (landmark && band>3.12 && band<3.37) return shade(tone,lit ? 20 : -8);
          return shade(tone,stripe + (i%5-2)*3);
        }
        if (ironworksPilot) {
          const band = (h-54)%4.92;
          if (band<0.23 || u<0.075 || u>0.955) return lit ? 0xc2cfc8 : 0x53747a;
          if (band<0.49) return lit ? 0x789a9e : 0x41626a;
          const reflection = (i%11*0.162+u*0.40+(h-54)*0.023)%1;
          const tint = reflection>0.67 && reflection<0.83 ? 26 : reflection<0.18 ? -16 : 0;
          return shade(lit ? 0x80aeb0 : 0x476f80,tint);
        }
        const steel = (h%5.18)<0.21 || u<0.14 || u>0.94;
        if (steel) return lit ? 0x9ba7a2 : 0x43585a;
        const curtains = (i%7===3 || i%7===4) && h>59.4 && h<68.0;
        return curtains ? (lit ? 0x6c7e79 : 0x3a555c) : shade(lit ? 0x7d9d9f : 0x50717f,i%4*6);
      });
      const top=landmark?.dimensions.height ?? 78.65+(i%3===2 ? 0.5 : 0.1);
      beam(level(a,75),level(a,top),i%3===1 && landmark ? 0x536565 : 0x677473,0.29);
    }
    laid(glass,77.1,industrialInk?.roof ?? (ironworksPilot ? 0xb9bfb2 : shade(0x9aa8a0,9)));
    const rimRoof = loop(anchor,5.86,35);
    rails(rimRoof,77.1,0x889892,2,false);
    box(polar(anchor,1.8,-0.22),3.0,3.6,77.0,landmark?.dimensions.height ?? 78.1,
      industrialInk?.roofShade ?? 0x838f8a,0xb4b9ac,0.25);
    if (industrialInk) {
      rim(glass,77.24,industrialInk.rail,0.33);
      for (const [i,p] of glass.entries()) {
        if (i%4!==0) continue;
        beam(level(p,77.18),level(tween(p,anchor,0.52),77.18),industrialInk.roofShade,0.21);
      }
    }

    for (const [i,[legacyId,low,high]] of boltWalkways.entries()) {
      const id=landmark?.geometry.galleries[i-2] ?? legacyId;
      const deckFeature = parts.get(id);
      if (!deckFeature) continue;
      const rings = deckFeature.rings;
      const color = i<2 ? material(0x594a36,0x9d875e) : material(0x778c86,0xadb1a3);
      if (ironworksPilot && i>1) {
        wrapGallery(rings.length>1 ? rings : [rings[0],glass],anchor,high,low,i);
      } else if (i<2 || rings.length>1) solid(rings,low,high,color);
      else {
        // The light upper walkways are open around the glass drum.
        solid([rings[0],glass],low,high,color);
      }
      if (!ironworksPilot || i<2) rails(rings[0],high,i<2 ? 0xbea060 : 0x9ba7a4,3.15,true);
      if (i>1) {
        for (const point of rings[0].slice(0,-1)) {
          beam(level(point,high),level(tween(point,anchor,0.22),77.6),landmark ? 0x718884 : 0x889896,0.14);
        }
      }
    }
  }

  function gasometer(landmark) {
    const source = parts.get(landmark?.geometry.shell ?? 'w78540797');
    if (!source) return;
    const footprint = source.rings[0];
    const cap = parts.get(landmark?.geometry.crown ?? 'w506257124')?.rings;
    const center = average(landmark && cap ? cap[0] : footprint);
    // The original 71-metre circular shell is inside the mapped outline of its annexes.
    const radius = landmark ? landmark.dimensions.diameter/2 : 35.18;
    const shell = loop(center,radius,56);
    const casing = loop(center,radius+0.52,28);
    const gray = 0x676863;
    const top = 26.9;
    castShadow(footprint,29);
    solid(source.rings,0,8.6,material(0x494b46,0x76756c));
    const lateral = footprint.reduce((far,p)=>{
      const r = (a) => Math.hypot(a[0]-center[0],(a[1]-center[1])/pitch);
      return r(p)>r(far) ? p : far;
    });
    const entrance = Math.atan2((lateral[1]-center[1])/pitch,lateral[0]-center[0]);
    for (let i=1;i<shell.length;i++) {
      const theta = (i-0.5)/56*tau;
      const opening = Math.abs(Math.atan2(Math.sin(theta-entrance),Math.cos(theta-entrance)))<0.73;
      paintedWall(shell[i-1],shell[i],0,top,(u,h,lit)=>{
        if (ironworksPilot) {
          const panelJoint = u>0.94 || u<0.047;
          const joint = (h-0.38)%2.62;
          if (opening && h>1.1 && h<8.3) {
            if (panelJoint || (u*2.1)%1<0.075 || h>7.9 || (h-0.4)%3.54<0.14) {
              return lit ? 0x9da9a0 : 0x5f7370;
            }
            return shade(lit ? 0x779e9a : 0x4b676d,(i%4)*8);
          }
          if (opening && h>15.2 && h<23 && i%8<6) {
            return shade(lit ? 0x86a7a3 : 0x5a757d,panelJoint ? -24 : 0);
          }
          if (h<10.82) {
            const sooty = h<1.4 ? -13 : i%5*3;
            return shade(lit ? 0x6b6760 : 0x494c4d,(joint<0.15 || panelJoint) ? -17 : sooty);
          }
          const weather = industrialInk ? (Math.floor(h*1.7+u*4)+i*19)%9-4 : 0;
          const wash = (u>0.81 ? -10 : 0) + (i%7)*3 + (h<12.0 || h>25.9 ? -13 : 0) + weather;
          const fastener = panelJoint && joint>0.18 && joint<0.35;
          if (industrialInk && (panelJoint || joint<0.11)) return shade(lit ? industrialInk.casing : industrialInk.casingShade,-24+wash);
          return shade(lit ? industrialInk?.casing ?? 0xd9cfb5 : industrialInk?.casingShade ?? 0xa0a59a,fastener ? -29 : wash);
        }
        const rivets = detailed && (h%1.92)<0.12 && (u<0.07 || u>0.92);
        if (rivets) return shade(lit ? gray : 0x4b514e,20);
        if (opening && h>1.1 && h<8.3) {
          if (u<0.08 || u>0.54 && u<0.60 || h>7.9 || h>3.8 && h<4.1) return lit ? 0xaaaea1 : 0x626e67;
          return shade(lit ? 0x789390 : 0x536e73,(i%3)*6);
        }
        if (opening && h>15.2 && h<23 && i%8<6) return lit ? 0x789395 : 0x58727a;
        if (h<10.8) return shade(lit ? gray : 0x48514f,h%2.65<0.15 ? -14 : (i%6)*2);
        return shade(lit ? 0xc7c4ac : 0x8f978b,u>0.64 ? -7 : (i%5)*3);
      });
    }
    const roofSides = 56;
    const roofRise = 1.7;
    const inner = loop(center,10.1,roofSides);
    for (let i=1;i<=roofSides;i++) {
      const fan = Math.cos((i/roofSides+0.12)*tau)*10;
      const pigment = industrialInk ? shade(industrialInk.roof,Math.round(fan)+(i%7)*3-10)
        : ironworksPilot ? shade(0x848783,(i%7)*5-13) : shade(0x85877d,(i%7)*2-7);
      quad(level(shell[i-1],top),level(shell[i],top),level(inner[i],top+roofRise),level(inner[i-1],top+roofRise),pigment);
      if (i%2===0) beam(level(shell[i],top+0.10),level(inner[i],top+roofRise+0.12),industrialInk?.roofShade ?? 0x646a62,0.26);
    }
    if (industrialInk && detailed) {
      for (const seam of [17.35,25.4,31.0]) {
        const amount = (radius-seam)/(radius-10.1);
        rim(loop(center,seam,56),top+roofRise*amount+0.07,shade(industrialInk.roof,landmark ? -16 : -10),0.14);
      }
    }
    const roofCap = cap ?? [inner];
    solid(roofCap,27.9,30,ironworksPilot ? material(0x5f6864,landmark ? 0x9ea494 : 0xadafa0) : material(0x8b8f86,0xa9aa9e));
    if (ironworksPilot && detailed) {
      for (const ring of roofCap) {
        rim(ring,30.04,0xc3c0aa,0.28);
        const first = ring[0];
        const opposing = ring[Math.floor((ring.length-1)/2)];
        if (first && opposing) beam(level(first,30.08),level(opposing,30.08),0x717f79,0.29);
      }
    }
    for (const y of [8.6,10.8,17.7,25.2,27.0]) rim(casing,y,y>=25 ? 0x62564c : 0x514940,y>=25 ? 0.59 : 0.45);
    rails(casing,27.25,0x67645a,3.3);
    for (let i=1;i<casing.length;i++) {
      const a = casing[i-1];
      const b = casing[i];
      const bracket = polar(a,1.55,(i-1)/28*tau);
      beam(level(a,0.9),level(a,29.5),landmark ? 0x474944 : ironworksPilot ? 0x534d49 : 0x56534b,0.66);
      beam(level(a,27.7),level(bracket,29.2),0x7f7361,0.55);
      if (i%4===0) beam(level(bracket,29.0),level(bracket,30.2),0x514e44,0.23);
      if (landmark && detailed) {
        const bracketTop = polar(a,1.52,(i-1)/28*tau);
        beam(level(a,29.47),level(bracketTop,29.47),0x73796d,0.31);
        beam(level(a,27.43),level(bracketTop,29.47),0x615c4e,0.21);
      }
      for (const [low,high] of [[10.9,17.7],[17.8,26.8]]) {
        beam(level(a,low),level(b,high),industrialInk?.truss ?? 0x685649,0.35);
        beam(level(a,high),level(b,low),industrialInk ? shade(industrialInk.truss,17) : 0x77604e,0.30);
        if (ironworksPilot) {
          const p = tween(a,b,0.5);
          const gusset = polar(p,0.18,(i-0.5)/28*tau);
          beam(level(gusset,(low+high)/2-0.39),level(gusset,(low+high)/2+0.39),0xa27653,0.34);
        }
      }
    }
  }

  function energyHall() {
    const hall = parts.get('w78540806');
    if (!hall) return;
    // The 1930s energy centre keeps its mapped brick pilasters and long ridge.
    // The cardinal corners come from the detailed OSM ring, including the annex.
    const ring = hall.rings[0];
    if (ring.length<50) {
      solid(hall.rings,0,30.6,material(0xb37154,0x94664e));
      return;
    }
    const near = tween(ring[0],ring[49],0.5);
    const far = tween(ring[24],ring[25],0.5);
    const dx = far[0]-near[0];
    const dy = (far[1]-near[1])/pitch;
    const length = Math.hypot(dx,dy);
    const acrossX = -dy/length;
    const acrossY = dx/length/pitch;
    const across = ([x,y]) => (x-near[0])*acrossX+(y-near[1])*acrossY;
    const ridge = 30.6;
    const fall = 0.236/scale;
    const eave = 24.0;
    const heightAt = (point) => ridge-Math.abs(across(point))*fall;
    const wallsInk = style==='foundry' ? 0xa46550 : 0xb37154;
    const roofInk = style==='foundry' ? 0x795548 : 0x94664e;
    castShadow(ring,ridge);
    walls(hall.rings,0,eave,material(wallsInk));
    for (let i=1;i<ring.length;i++) {
      const a = ring[i-1];
      const b = ring[i];
      const segment = Math.hypot(b[0]-a[0],(b[1]-a[1])/pitch)/scale;
      if (segment<0.18) continue;
      const higherA = heightAt(a);
      const higherB = heightAt(b);
      const acrossA = across(a);
      const acrossB = across(b);
      const direct = (b[1]-a[1])/(b[0]-a[0])>0;
      const shadeSide = direct ? 13 : -23;
      if (acrossA*acrossB<0) {
        const peak = tween(a,b,acrossA/(acrossA-acrossB));
        quad(level(a,eave),level(peak,eave),level(peak,ridge),level(a,higherA),shade(wallsInk,shadeSide));
        quad(level(peak,eave),level(b,eave),level(b,higherB),level(peak,ridge),shade(wallsInk,shadeSide));
      } else {
        quad(level(a,eave),level(b,eave),level(b,higherB),level(a,higherA),shade(wallsInk,shadeSide));
      }
      paintedWall(a,b,0,ridge,(u,h,lit)=>{
        const crest = heightAt(tween(a,b,u));
        if (h>crest-0.07) return;
        const brick = lit ? wallsInk : shade(wallsInk,-28);
        const bays = Math.max(1,Math.round(segment/6.65));
        const panel = u*bays%1;
        const center = Math.abs(panel-0.5);
        const windowHead = 20.7-1.20*(center/0.30)**2;
        if (segment>3.4 && center<0.30 && h>9.5 && h<windowHead) {
          const muntin = (panel-0.2)*6.64%1<0.12 || (h-9.5)%2.48<0.18;
          const base = lit ? 0x74847c : 0x465956;
          return shade(base,muntin ? -34 : 7*(Math.floor(h/2.48+panel*7)%3-1));
        }
        if (segment>3.4 && center<0.34 && h>9.12 && h<windowHead+0.49) {
          return shade(brick,h>windowHead || h<9.55 ? 23 : -22);
        }
        if (panel<0.10 || panel>0.90) return shade(brick,panel<0.07 ? 15 : -5);
        if (h>crest-0.58 || h<2.4 || h>8.15 && h<8.60) return shade(brick,h%0.86<0.19 ? -26 : 10);
        const course = Math.floor(h/0.40);
        const joint = (panel*segment/bays*1.7+(course%2)*0.5)%1;
        return shade(brick,detailed && (h%0.40<0.055 || joint<0.08) ? -16 : (course*3+i*7)%11-5);
      },0.19);
    }
    const lift = rise(1);
    for (const side of [-1,1]) {
      const half = [];
      for (let i=1;i<ring.length;i++) {
        const a = ring[i-1];
        const b = ring[i];
        const da = across(a)*side;
        const db = across(b)*side;
        if (da>=0) half.push(a);
        if (da*db<0) half.push(tween(a,b,da/(da-db)));
      }
      if (half.length<3) continue;
      half.push(half[0]);
      map.polygon([half.map((p)=>[p[0],p[1]-rise(heightAt(p))])],(x,y)=>{
        const sx = x+0.5;
        const py = y+0.5;
        const ground = (py+lift*(ridge-side*fall*((sx-near[0])*acrossX-near[1]*acrossY)))/(1+lift*side*fall*acrossY);
        const z = rise(heightAt([sx,ground]));
        const span = Math.abs(across([sx,ground]))/scale;
        const along = ((sx-near[0])*dx+(ground-near[1])/pitch*dy)/length/scale;
        const pane = Math.abs(span-4.5)<0.79 && along>4.3 && along<length/scale-4.3;
        const seams = (Math.floor(along/2.5)*23+Math.floor(span/1.10)*7)&15;
        const standing = (along+1.3)%2.5<0.12 || (span+0.4)%6.8<0.10;
        const pigment = pane ? shade(0x636f67,standing ? -21 : seams-6)
          : shade(roofInk,(side===1 ? 12 : -15)+(standing ? -24 : seams-7));
        map.pixel(x,y,pigment,py+z*1.45+0.148);
      });
    }
    for (let i=1;i<ring.length;i++) {
      const a = ring[i-1];
      const b = ring[i];
      const tint = shade(roofInk,(b[1]-a[1])/(b[0]-a[0])>0 ? 28 : 6);
      const da = across(a);
      const db = across(b);
      const cut = da*db<0 ? [level(tween(a,b,da/(da-db)),ridge)] : [];
      route([level(a,heightAt(a)),...cut,level(b,heightAt(b))],tint,0.44);
    }
    beam(level(near,ridge+0.07),level(far,ridge+0.07),shade(roofInk,25),0.51);
  }

  function ironworksWaterTower() {
    const source = parts.get('w242013755');
    if (!source) return;
    const ring = source.rings[0];
    const center = average(ring);
    const radius = ring.slice(0,-1).reduce((sum,p)=>
      sum+Math.hypot(p[0]-center[0],(p[1]-center[1])/pitch)/scale,0)/(ring.length-1);
    const steel = industrialInk.edgeSteel;
    castShadow(loop(center,radius*0.43,18),30);
    profile(center,[[0,radius*0.36],[2,radius*0.31],[18.9,radius*0.29],[20.1,radius*0.4]],0x938f80,18);
    profile(center,[[18.5,radius*0.35],[20.4,radius*0.94],[21.5,radius],[28.7,radius],
      [29.4,radius*0.96],[30,radius*0.81],[30.5,radius*0.39]],steel,36);
    for (const h of [21.3,25.9,28.48]) rim(loop(center,radius*1.002,36),h,shade(steel,h===28.48 ? 20 : -18),0.33);
    if (detailed) {
      ribs(center,radius*1.004,21.4,28.45,shade(steel,-21),24,0.18);
      ladder(polar(center,radius*0.34,1.84),3.2,18.55,0.7,industrialInk.darkSteel);
    }
  }

  function fittingRing(ring, centre, factor) {
    return ring.map((p)=>tween(centre,p,factor));
  }

  function squareSpire(footprint, base, sections, color, pattern) {
    const centre = average(footprint);
    let previous = footprint;
    let previousHeight = base;
    for (const [h,factor] of sections) {
      const ring = fittingRing(footprint,centre,factor);
      for (let i=1;i<ring.length;i++) {
        const a = slope(previous[i-1],previousHeight);
        const b = slope(previous[i],previousHeight);
        const c = slope(ring[i],h);
        const d = slope(ring[i-1],h);
        const pigment = shade(color,(b[1]-a[1])/(b[0]-a[0])<0 ? 18 : -14);
        slopeFace(a,b,c,pigment,pattern);
        slopeFace(a,c,d,pigment,pattern);
        if (detailed) beam(level(previous[i-1],previousHeight),level(ring[i-1],h),shade(pigment,17),0.155);
        if (atlas && detailed && h-previousHeight>1.25) {
          for (const u of [0.28,0.52,0.76]) {
            const foot = tween(previous[i-1],previous[i],u);
            const crest = tween(ring[i-1],ring[i],u);
            beam(level(foot,previousHeight+0.02),level(crest,h+0.02),shade(pigment,u===0.52 ? 11 : -11),0.15);
          }
        }
      }
      previous = ring;
      previousHeight = h;
    }
    laid(previous,previousHeight,shade(color,21));
  }

  function clockPaint(u,h,length,center,radius,lit,frame) {
    const dx = (u-0.50)*length/radius;
    const dy = (h-center)/radius;
    const d = dx*dx+dy*dy;
    if (d>=1) return;
    if (d>0.82 || Math.abs(dx)<0.04 && dy>-0.15
      || Math.abs(dy-dx*0.42)<0.055 && dx>0.02 && dx<0.53) return frame;
    return lit ? 0xe7d6a3 : 0xc2bb9d;
  }

  function newTownHall() {
    const core = parts.get('w462065474')?.rings[0];
    if (!core) return;
    const center = average(core);
    const observation = parts.get('w462065473')?.rings[0] ?? fittingRing(core,center,1.28);
    const crown = parts.get('w462065476')?.rings[0] ?? fittingRing(core,center,0.69);
    const mast = parts.get('w462065477')?.rings[0] ?? fittingRing(core,center,0.08);
    castShadow(core,75);
    const plinth = atlas ? parts.get('w462065472') : undefined;
    if (plinth) {
      for (const ring of plinth.rings) {
        for (let i=1;i<ring.length;i++) {
          const a = ring[i-1];
          const b = ring[i];
          const width = Math.hypot(b[0]-a[0],(b[1]-a[1])/pitch)/scale;
          const bays = Math.max(1,Math.round(width/4.32));
          paintedWall(a,b,9,21.8,(u,h,lit)=>{
            const stone = lit ? 0xdac9a8 : 0xa89a80;
            const bay = (u*bays)%1;
            const sill = h>18.5 ? 18.7 : h>14 ? 14.5 : 10.1;
            const row = h-sill;
            if (row>0.52 && row<2.92 && bay>0.27 && bay<0.73) {
              const pane = lit ? 0x73857b : 0x536c66;
              return shade(pane,Math.abs(bay-0.5)<0.047 || Math.abs(row-1.72)<0.103 ? -24 : 8);
            }
            if (row>0.27 && row<0.55 && bay>0.20 && bay<0.80) return shade(stone,17);
            return shade(stone,h>20.3 ? (h%0.84<0.19 ? -13 : 14) : bay<0.08 ? 12 : h%1.73<0.11 ? -9 : 0);
          },0.18);
        }
        rim(ring,21.9,0xbaa78b,0.36);
      }
    }
    walls([core],21,72.5,material(0x607f69));
    for (let i=1;i<core.length;i++) {
      const a = core[i-1];
      const b = core[i];
      const length = Math.hypot((b[0]-a[0])/scale,(b[1]-a[1])/scale/pitch);
      paintedWall(a,b,21,72.5,(u,h,lit)=>{
        if (h>59 && h<64.5) {
          const dial = clockPaint(u,h,length,62.0,1.75,lit,0x415741);
          if (dial!==undefined) return dial;
        }
        const line = (u*5)%1;
        if (centrePilot) {
          const patina = atlas ? (lit ? 0x7e997e : 0x3d7068) : lit ? 0x7e9271 : 0x426d62;
          const recessed = h>=23 && h<=57.8 && u>0.28 && u<0.71;
          if (!recessed) {
            const cladding = h%3.91<0.13 ? -12 : line<0.09 ? 15 : u<0.12 || u>0.90 ? -13 : 0;
            const mottled = atlas ? (Math.floor(h/1.7+u*5)*3+i*7)%11-5 : 0;
            return shade(patina,cladding+mottled);
          }
          const row = (h-23)%5.21;
          const mullion = (u-0.28)*8.5%1;
          if (row<0.72 || mullion<0.15) return shade(patina,row<0.26 ? 19 : 3);
          return shade(lit ? 0x668e82 : 0x375d60,row<1.15 ? -12 : mullion>0.81 ? 10 : 0);
        }
        if (h>=23 && h<=57.8 && u>0.28 && u<0.71 && h%5.2>0.52) {
          if (line<0.08 || h%5.2<0.81) return lit ? 0x7f967a : 0x4d725d;
          return lit ? 0x718d7b : 0x4e6c66;
        }
        return lit ? shade(verdigris,line<0.13 ? 13 : -2) : shade(0x4b6b5a,line<0.13 ? 11 : -2);
      });
      beam(level(a,22),level(a,73),0x7e9a7e,0.43);
      beam(level(tween(a,b,0.2),23),level(tween(a,b,0.2),71.5),0x819984,0.18);
      if (centrePilot) {
        beam(level(tween(a,b,0.78),23),level(tween(a,b,0.78),71.5),0x779686,0.20);
        for (const h of [22.2,30.7,51.8,58.1,66.2,71.4]) beam(level(a,h),level(b,h),0x668e78,0.25);
      }
    }
    solid([observation],72.45,73.04,material(0x5c7358,0x9d9d78));
    rails(observation,73.06,0x6c8a6c,1.14);
    const foyer = fittingRing(core,center,0.86);
    walls([foyer],73.02,77.0,material(0x627f6d));
    for(let i=1;i<foyer.length;i++) {
      paintedWall(foyer[i-1],foyer[i],73.11,76.9,(u,h,lit)=>{
        const glazing = u>0.10 && u<0.9 && h>74 && h<76.5 && (u*7)%1>0.22;
        return glazing ? 0x455f59 : lit ? 0x8ba183 : 0x597762;
      });
    }
    laid(fittingRing(core,center,0.98),77.12,0x77916f);
    solid([crown],77.0,79.0,material(0x587864,0x809678));
    if (centrePilot) {
      squareSpire(crown,79,[[79.3,0.94],[81.1,0.48]],0x578474);
      rim(crown,79.1,0x96a478,0.39);
    } else squareSpire(crown,79,[[81.1,0.48]],0x577c68);
    solid([mast],81.0,85.6,material(0x637366));
    const mastCenter = average(mast);
    beam(level(mastCenter,83.0),level(polar(mastCenter,1.53,0.05),83.2),0x70857a,0.19);
  }

  function oldTownHall(point) {
    const base = boxRing(...point,7.8,7.5,-0.35);
    walls([base],5.7,20.1,material(0xe3d7bb));
    for(let i=1;i<base.length;i++) {
      const a = base[i-1];
      const b = base[i];
      const length = Math.hypot((b[0]-a[0])/scale,(b[1]-a[1])/scale/pitch);
      paintedWall(a,b,5.7,20.1,(u,h,lit)=>{
        const dial = clockPaint(u,h,length,15.8,1.3,lit,0x50584d);
        if (dial!==undefined) return dial;
        if (centrePilot) {
          const face = lit ? 0xf3e2c4 : 0xbfac8c;
          const arch = Math.abs(u-0.5)/0.103;
          const head = 12.25+1.2*Math.sqrt(Math.max(0,1-arch*arch));
          if (arch<1 && h>10.3 && h<head) return lit ? 0x766c56 : 0x5e574b;
          if (arch<1.23 && h>9.99 && h<head+0.4) return shade(face,16);
          const pilaster = (u>0.11 && u<0.21 || u>0.79 && u<0.88) && h>7.7 && h<19.5;
          if (pilaster) return shade(face,u%0.1<0.065 ? 16 : -12);
          return shade(face,(h>8.3 && h<8.7 || h>18.1 && h<18.7) ? 11 : h%2.11<0.15 ? -6 : 1);
        }
        if (h>10.2 && h<13.3 && Math.abs(u-0.5)<0.075) return lit ? 0x827460 : 0x625c52;
        const mortar = u<0.13 || u>0.85;
        return shade(lit ? 0xe9dec4 : 0xb7a98d,mortar && (h%1.22)<0.46 ? -10 : 0);
      });
    }
    box(point,8.5,8.3,19.6,20.7,0xc5b899,0xf2dfc2,-0.35);
    const plinth = fittingRing(base,point,0.9);
    if (centrePilot) {
      squareSpire(plinth,20.7,[[21.45,1.02],[22.55,0.97],[23.9,0.72],[25.1,0.49],[26.5,0.43]],0x5d7c70);
      rim(plinth,20.93,0x738979,0.25);
    } else squareSpire(plinth,20.7,[[23.0,0.89],[24.4,0.59],[26.5,0.43]],0x526255);
    const lantern = boxRing(...point,2.6,2.56,-0.35);
    walls([lantern],25.9,28.5,material(0x869083));
    for (let i=1;i<lantern.length;i++) paintedWall(lantern[i-1],lantern[i],26.0,28.45,(u,h)=>{
      if (u>0.22 && u<0.77 && h>26.4 && h<27.99) return 0x5b6960;
      return 0xaab1a1;
    });
    squareSpire(fittingRing(lantern,point,1.15),28.35,[[29.7,0.73],[30.8,0.26]],0x536d62);
    beam(level(point,30.5),level(point,32.5),bronze,0.17);
  }

  function cathedral() {
    if (centrePilot) {
      for (const [i,id] of cathedralWalls.entries()) {
        const facade = parts.get(id);
        if (!facade) continue;
        const lower = i===0 ? 0 : 15;
        const upper = i===0 ? 15 : 30;
        const sill = lower + (i===0 ? 4.0 : 4.8);
        const spring = upper - 4.32;
        for (const ring of facade.rings) {
          for (let edgeIndex=1;edgeIndex<ring.length;edgeIndex++) {
            const a = ring[edgeIndex-1];
            const b = ring[edgeIndex];
            const length = Math.hypot(b[0]-a[0],(b[1]-a[1])/pitch)/scale;
            const bays = Math.max(1,Math.round(length/7.15));
            paintedWall(a,b,lower,upper,(u,h,lit)=> {
              const ivory = lit ? 0xe0c5a1 : 0xbaa07f;
              const bay = (u*bays)%1;
              const arch = Math.abs(bay-0.5)/0.22;
              const crown = spring+2.0*Math.sqrt(Math.max(0,1-arch*arch));
              if (length>2.5 && arch<1 && h>sill && h<crown) {
                const glass = atlas ? shade(lit ? 0x65786c : 0x455c58,
                  (Math.floor((h-sill)*0.89)*3+Math.floor(bay*8)+edgeIndex)%9*3-12)
                  : h>spring-0.5 ? 0x6a7968 : lit ? 0x53675c : 0x404f48;
                const mullions = Math.abs(bay-0.5)<0.018 || (h-sill)%1.55<0.13;
                const archLight = atlas && h>spring && Math.abs(arch-(h-spring)*0.32)<0.064;
                return shade(glass,mullions || archLight ? 28 : bay<0.4 ? 10 : 0);
              }
              if (length>2.5 && arch<1.2 && h>sill-0.52 && h<crown+0.54) {
                if (atlas && h>spring) {
                  const voussoir = (Math.atan2((h-spring)/2,(bay-0.5)/0.22)*4.5)%1;
                  if (voussoir<0.10) return shade(ivory,-12);
                }
                return shade(ivory,arch<1.04 ? -20 : 23);
              }
              if (h-lower<1.26) return shade(ivory,(h-lower)%0.49<0.14 ? -18 : -4);
              if (h>upper-1.34) return shade(ivory,h>upper-0.55 ? -9 : 25);
              if (bay<0.09 || bay>0.93) return shade(ivory,bay<0.07 ? 15 : -13);
              return shade(ivory,h%1.52<0.09 ? -7 : 0);
            },0.19);
          }
        }
      }
    }
    for (const id of bellTowers) {
      const footprint = parts.get(id)?.rings[0];
      if (!footprint) continue;
      const center = average(footprint);
      const cornice = fittingRing(footprint,center,1.055);
      castShadow(footprint,67);
      walls([footprint],0,48.2,material(0xc9ae85));
      for (let i=1;i<footprint.length;i++) {
        const a = footprint[i-1];
        const b = footprint[i];
        paintedWall(a,b,13.7,48.2,(u,h,lit)=>{
          if (centrePilot) {
            const stone = lit ? 0xefdbc1 : 0xc1a778;
            const opening = Math.abs(u-0.5)/0.174;
            const head = 43.3+3.0*Math.sqrt(Math.max(0,1-opening*opening));
            if (opening<1 && h>36.15 && h<head) {
              const louvre = (h-36.15)%0.91;
              return shade(lit ? 0x645843 : 0x4d483e,louvre<0.23 || Math.abs(u-0.5)<0.021 ? 22 : 0);
            }
            if (opening<1.28 && h>35.6 && h<head+0.53) return shade(stone,opening<1.13 ? -19 : 18);
            const stringcourse = (h>=28.7 && h<=29.7) || (h>33.4 && h<34.65) || (h>=46.7 && h<47.6);
            if (stringcourse) return shade(stone,h%1.0<0.72 ? 21 : -14);
            const slit = Math.abs(u-0.5)<0.103 && h>24.28 && h<27.4;
            if (slit) return shade(0x736457,h>26.9 || Math.abs(u-0.5)>0.073 ? 38 : 0);
            const pilaster = u>0.09 && u<0.21 || u>0.78 && u<0.90;
            return shade(stone,pilaster ? (u%0.19<0.11 ? 21 : -11) : h%2.11<0.11 ? -8 : 0);
          }
          const stone = lit ? paleStone : 0xb49b7d;
          const radius = Math.abs(u-0.5)/0.145;
          const bellLintel = 43.9+2.2*Math.sqrt(Math.max(0,1-radius*radius));
          const arch = radius<1 && h>36.8 && h<bellLintel;
          const trim = radius<1.16 && h>35.9 && h<bellLintel+0.62;
          if (arch) return (h%1.12)<0.24 || Math.abs(u-0.50)<0.02 ? 0x86775e : 0x625d4c;
          if (trim) return shade(stone,17);
          const quoin = (u<0.126 || u>0.874) && h%1.54<0.67;
          const corniceBand = h>28.5 && h<29.4 || h>33.7 && h<34.45 || h>46.7 && h<47.2;
          const slit = Math.abs(u-0.5)<0.087 && h>25.3 && h<28.3;
          if (slit) return 0x8e785c;
          return shade(stone,corniceBand ? 20 : quoin ? 12 : h%2.11<0.1 ? -7 : 0);
        });
      }
      solid([cornice],47.8,49.2,material(0xb9a488,0xe0c9a1));
      if (centrePilot) {
        const spire = fittingRing(footprint,center,0.97);
        squareSpire(spire,49.25,[[49.72,0.98],[52.6,0.88],[59.65,0.48],[63.0,0.27],[65.75,0.11]],0x4f7a6b);
        rim(spire,49.48,0x82a18b,0.39);
      } else squareSpire(fittingRing(footprint,center,0.97),49.25,[[52.6,0.88],[62.4,0.32],[65.75,0.11]],0x55796e);
      beam(level(center,65.4),level(center,67.7),bronze,0.2);
      const crossA = polar(center,0.68,0.17);
      const crossB = polar(center,0.68,0.17+Math.PI);
      beam(level(crossA,66.72),level(crossB,66.72),bronze,0.17);
    }
  }

  function porubaGate() {
    const part = parts.get('w38935068');
    if (!part) return;
    const ring = part.rings[0];
    const center = average(ring);
    if (atlas && ring.length>=6) {
      // Porubská passes along the shared edge of these two mapped volumes.
      // Cut the same vault out of both façades so the road meets the opening.
      const south = ring[4];
      const north = ring[5];
      const dx = north[0]-south[0];
      const dy = (north[1]-south[1])/pitch;
      const span = Math.hypot(dx,dy)*scale;
      const offset = ([x,y]) => (-(x-south[0])*dy+(y-south[1])*dx/pitch)/span;
      const sideWing = parts.get('w33679723')?.rings[0];
      for (const outline of [ring,sideWing]) {
        if (!outline) continue;
        const landmark = outline===ring;
        const eave = landmark ? 26.3 : 23.4;
        const ridge = landmark ? 31.7 : 27.4;
        const core = average(outline);
        const upper = fittingRing(outline,core,landmark ? 0.42 : 0.35);
        for (let i=1;i<outline.length;i++) {
          const a = outline[i-1];
          const b = outline[i];
          const distance = Math.hypot(b[0]-a[0],(b[1]-a[1])/pitch)/scale;
          if (distance<0.19) continue;
          const panels = Math.max(1,Math.round(distance/3.12));
          paintedWall(a,b,0,eave,(u,h,lit)=>{
            const point = tween(a,b,u);
            const across = Math.abs(offset(point));
            const normalized = across/4.65;
            const opening = 14.0+4.35*Math.sqrt(Math.max(0,1-normalized*normalized));
            if (normalized<1 && h<opening) return undefined;
            const stone = lit ? 0xd8b58e : 0xb39577;
            const relief = h>18.8 && h<21.5 && normalized<1.05;
            if (relief) {
              const panel = ((offset(point)+4.85)/2.33)%1;
              const ornament = Math.abs(panel-0.5) + Math.abs(h-20.0)*0.27;
              return shade(lit ? 0xb27d5f : 0x967157,panel<0.10 || h<19.2 || h>21.05 ? -24 : ornament<0.25 ? 18 : -4);
            }
            if (normalized<1.20 && h<opening+0.77) {
              const joints = h<13.9 ? h%1.14 : (Math.atan2(h-14,across)*6.3)%1;
              return shade(stone,normalized<1.04 || joints<0.09 ? -22 : 21);
            }
            const pane = (u*panels)%1;
            const row = (h+0.25)%3.2;
            const base = h<4.2 || h>eave-1.05 || h>22.3 && h<22.72;
            if (base) return shade(stone,h%0.7<0.16 ? -18 : 7);
            if (distance>2.4 && normalized>1.29 && pane>0.26 && pane<0.71 && row>0.77 && row<2.26) {
              const window = lit ? 0x777771 : 0x5d6868;
              return shade(window,Math.abs(pane-0.50)<0.047 || Math.abs(row-1.58)<0.09 ? 20 : -13);
            }
            if (pane<0.12 || pane>0.88) return shade(stone,pane<0.077 ? 19 : -18);
            return shade(stone,row<0.11 ? -12 : 0);
          },0.17);
          const pigment = (b[1]-a[1])/(b[0]-a[0])>0 ? 0xaa694b : 0x865744;
          const capA = upper[i-1];
          const capB = upper[i];
          quad(level(a,eave),level(b,eave),level(capB,ridge),level(capA,ridge),pigment);
          beam(level(a,eave+0.05),level(b,eave+0.05),0xc29c74,0.49);
          if (detailed) {
            const count = Math.max(1,Math.round(distance/2.55));
            for (let r=0;r<count;r++) {
              const u = (r+0.5)/count;
              beam(level(tween(a,b,u),eave),level(tween(capA,capB,u),ridge),
                shade(pigment,r%3===2 ? -18 : 11),0.16);
            }
          }
        }
        laid(upper,ridge,0xa46c51);
        rim(upper,ridge+0.05,0xbf8661,0.25);
      }
      return;
    }
    for(const h of [21.8,26.8,29.55,31.9]) rim(fittingRing(ring,center,1.018),h,h===26.8 ? 0xc17d50 : 0xe1bb8a,0.52);
    for(let i=1;i<ring.length;i++) {
      const a = ring[i-1];
      const b = ring[i];
      const span = Math.hypot((b[0]-a[0])/scale,(b[1]-a[1])/scale/pitch);
      if (span<13) continue;
      paintedWall(a,b,22.3,29.4,(u,h,lit)=>{
        const panel = (u*3)%1;
        const trim = lit ? 0xe5c097 : 0xba8766;
        if (panel<0.08 || panel>0.92 || h>28.8 || h<22.8) return trim;
        if (panel>0.28 && panel<0.71 && h>23.5 && h<27.64) return lit ? 0x806d60 : 0x635957;
        return undefined;
      });
      for (const u of [0.15,0.33,0.67,0.85]) {
        const base = tween(a,b,u);
        beam(level(base,22.1),level(base,29.3),0xe0b88e,0.46);
      }
    }
  }

  function chimney(anchor, height, radius, materialName) {
    const color = materialName==='steel' ? 0x765141 : materialName==='concrete' ? 0xa29c8d : 0x90644e;
    profile(anchor,[[0,radius],[height*0.19,radius*0.93],[height*0.92,radius*0.70],[height-0.66,radius*0.70],
      [height-0.49,radius*0.84],[height,radius*0.85]],color,16);
    const ring = loop(anchor,radius*0.62,16);
    laid(ring,height+0.03,0x3e3c36);
    if (detailed && height>22) ladder(polar(anchor,radius*0.96,0.82),1,height,2.2,shade(color,7));
  }

  const modelTools = {
    map, scale, pitch, parts, detailed, style, screen, boxRing, rise, flatRoof, slopeFace, average,
    castShadow, fittingRing, squareSpire, beam, level, route, rim, rails, solid, material,
    box, profile, polar, paintedWall, laid, quad,
  };
  const curatedPainters = {
    'old-hall': (item,center)=>paintOldTownHall(item,center,modelTools),
    'masaryk-square': (item)=>paintMasarykSquare(item,modelTools),
    'town-hall': (item)=>paintNewCityHall(item,modelTools),
    cathedral: (item)=>paintCathedral(item,modelTools),
    oblouk: (item)=>paintOblouk(item,modelTools),
    'sykora-bridge': (item)=>paintSykoraBridge(item,modelTools),
    blender: (item,center)=>{
      for (const id of item.replaces.buildings) {
        const footprint=parts.get(id);
        if (footprint?.kind!=='building') continue;
        const height=parseFloat(footprint.tags.height)||14;
        castShadow(footprint.rings[0],Math.min(38,height));
      }
      paintBlenderModel(item,center,scale,triangle);
    },
  };
  for (const [item,center] of visible) {
    const registered=curated && item.level==='A' ? item : undefined;
    if (registered && Object.hasOwn(curatedPainters,item.model)) {
      curatedPainters[item.model](item,center);
      continue;
    }
    switch (item.model) {
      case 'bolt': boltTower(center,registered); break;
      case 'furnace': furnaceKit(center,false,item.number); break;
      case 'gong': gasometer(registered); break;
      case 'town-hall': newTownHall(); break;
      case 'old-hall': oldTownHall(center); break;
      case 'cathedral': cathedral(); break;
      case 'oblouk': porubaGate(); break;
    }
  }

  if (atlas) {
    energyHall();
    ironworksWaterTower();
  }

  for (const f of features('structure')) {
    const anchor = f.rings[0][0];
    if (!inside(anchor)) continue;
    const type = f.tags.man_made;
    const height = Math.min(145,Math.max(5,parseFloat(f.tags.height) || (type==='chimney' ? 26 : 13)));
    const radius = parseFloat(f.tags.diameter)/2;
    switch (type) {
      case 'chimney': chimney(anchor,height,radius || Math.min(4.3,0.7+height/50),f.tags.material); break;
      case 'water_tower':
        profile(anchor,[[0,radius||2.3],[height*0.72,radius||2.3],[height*0.76,(radius||2.3)*1.8],
          [height*0.94,(radius||2.3)*1.8],[height,(radius||2.3)*1.58]],0x9c886e,20);
        break;
      case 'crane': {
        const jib = polar(anchor,7,0.7);
        const counterweight = polar(anchor,3,3.84);
        beam(level(anchor,0),level(anchor,height),0xa1864a,0.75);
        beam(level(counterweight,height),level(jib,height),0xc5a05a,0.78);
        beam(level(jib,height),level(jib,height-5),0x544e40,0.38);
        break;
      }
    }
  }
}
