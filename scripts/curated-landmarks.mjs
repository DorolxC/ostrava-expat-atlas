import { shade } from './raster.mjs';
import { buildRoof, roofLight } from './roof-shapes.mjs';
import { bridgeDeck, transportGrade } from './transport.mjs';

export const curatedLandmarkStyles = new Set(['daylight', 'lithograph', 'afternoon', 'overcast', 'postcard-ochre', 'postcard-slate']);

export function curatedLandmarkReplacements(landmarks, style) {
  const buildings = new Set();
  const details = new Set();
  if (curatedLandmarkStyles.has(style)) {
    for (const landmark of landmarks) {
      if (landmark.level !== 'A') continue;
      for (const id of landmark.replaces?.buildings ?? []) buildings.add(id);
      for (const id of landmark.replaces?.details ?? []) details.add(id);
    }
  }
  return { buildings, details };
}

const interpolate = ([ax, ay], [bx, by], t) => [ax + (bx - ax) * t, ay + (by - ay) * t];
const clamp = (t, min, max) => Math.max(min, Math.min(max, t));
const distance = (a, b, { scale, pitch }) => Math.hypot(b[0] - a[0], (b[1] - a[1]) / pitch) / scale;
const archCrown = (across, radius) => Math.sqrt(Math.max(0, 1 - (across / radius) ** 2));

function facade(ring, low, high, tools, pigment) {
  const { pitch, paintedWall } = tools;
  const [ox,oy] = ring[0];
  const winding = Math.sign(ring.slice(1).reduce((area, [x,y], i) => {
    const [ax,ay] = ring[i];
    return area + (ax-ox)*(y-oy)-(x-ox)*(ay-oy);
  },0));
  for (let i = 1; i < ring.length; i++) {
    const a = ring[i - 1];
    const b = ring[i];
    const length = distance(a,b,tools);
    if (length < 0.12) continue;
    const lit = ((b[0]-a[0])*.69-(b[1]-a[1])*.72/pitch)*winding > 0;
    paintedWall(a,b,low,high,(u,h)=>pigment(u,h,lit,length,a,b),0.19);
  }
}

function archFace(x,h,{width,sill,spring,rise},stone,depth) {
  const edge = width + .22;
  const outer = spring + rise*archCrown(x,edge) + .20;
  if (Math.abs(x)>=edge || h<sill-.20 || h>=outer) return undefined;
  const crown = spring + rise*archCrown(x,width);
  if (Math.abs(x)>=width || h<sill || h>=crown) return shade(stone,h<sill ? -14 : 24);
  const glazingBar = Math.abs(x)<0.075 || (h-sill)%1.16<.13;
  return shade(depth,glazingBar ? 27 : x<-.24 ? 8 : -7);
}

function clock(x,h,height,radius,lit) {
  const u = x/radius;
  const v = (h-height)/radius;
  const r = u*u+v*v;
  if (r>=1) return undefined;
  const brass = lit ? 0xdac294 : 0xbea77d;
  if (r>.79) return brass;
  const tick = r>.59 && Math.abs(Math.sin(Math.atan2(v,u)*6))<.38;
  const hands = Math.abs(u)<.07 && v>-.17 && v<.70 ||
    Math.abs(v+u*.44)<.08 && u>0 && u<.54;
  return tick || hands || r<.018 ? brass : lit ? 0x414843 : 0x373d39;
}

function longestEdge(ring,pitch) {
  let longest=0;
  let result;
  for (let i=1;i<ring.length;i++) {
    const [ax,ay]=ring[i-1];
    const [bx,by]=ring[i];
    const length=Math.hypot(bx-ax,(by-ay)/pitch);
    if (length<=longest) continue;
    longest=length;
    result=[ring[i-1],ring[i]];
  }
  return result;
}

function clipElevation(face, knee, upper) {
  const result=[];
  for (let i=0;i<face.length;i++) {
    const a=face[i];
    const b=face[(i+1)%face.length];
    const inside=(p)=>upper ? p[2]>=knee : p[2]<=knee;
    if (inside(a)) result.push(a);
    if (inside(a)!==inside(b)) {
      const t=(knee-a[2])/(b[2]-a[2]);
      result.push([...interpolate(a,b,t),knee]);
    }
  }
  return result;
}

function roofFaces(feature,total,minimum,shape,roofHeight,tools,{color,kind,mansard=false}) {
  const {scale,pitch,rise,flatRoof,material,slopeFace,beam,level,detailed}=tools;
  const world = feature.worldRings ?? feature.rings.map(ring=>ring.map(([x,y])=>[x/scale,y/scale]));
  const [ax,ay]=world[0][0];
  const [sx,sy]=feature.rings[0][0];
  const asScreen=([x,y])=>[sx+(x-ax)*scale,sy+(y-ay)*scale];
  const plan=buildRoof(world,pitch,{'roof:shape':shape,'roof:height':String(roofHeight)},{total,minimum});
  const ink = {kind,salt: parseInt(feature.id.slice(1),10)};
  const pattern=kind==='clay' ? 'tile' : 'metal';
  let eave = total;
  for (const shell of plan.shells) {
    eave=total-shell.height;
    if (!shell.height) {
      flatRoof(shell.rings.map(ring=>ring.map(asScreen)),rise(total),
        {...material(color),material:ink},ink.salt);
      continue;
    }
    const knee=shell.height*.36;
    const form=(z)=>!mansard ? z : z<=knee ? z/knee*shell.height*.77 :
      shell.height*.77+(z-knee)/(shell.height-knee)*shell.height*.23;
    for (const face of shell.facets) {
      const [a,b]=face;
      const bx=b[0]-a[0], by=(b[1]-a[1])/pitch;
      const c=face.slice(2).find(p=>Math.abs(bx*(p[1]-a[1])/pitch-(p[0]-a[0])*by)>1e-8);
      const lit=c ? (() => {
        const cx=c[0]-a[0], cy=(c[1]-a[1])/pitch;
        const det=bx*cy-cx*by;
        return roofLight(((b[2]-a[2])*cy-(c[2]-a[2])*by)/det,(bx*(c[2]-a[2])-cx*(b[2]-a[2]))/det);
      })() : 0;
      const pieces=mansard ? [clipElevation(face,knee,false),clipElevation(face,knee,true)] : [face];
      for (const [index,piece] of pieces.entries()) {
        if (piece.length<3) continue;
        const points=piece.map(p=>[...asScreen(p),rise(eave+form(p[2]))]);
        const colored=shade(color,lit+(mansard && index===0 ? -12 : 0));
        for (let i=2;i<points.length;i++) slopeFace(points[0],points[i-1],points[i],colored,pattern,ink);
        const seam=piece.filter(p=>Math.abs(p[2]-knee)<1e-6);
        if (mansard && index===0 && detailed && seam.length===2) {
          beam(level(asScreen(seam[0]),eave+form(knee)),level(asScreen(seam[1]),eave+form(knee)),shade(colored,19),.23);
        }
      }
    }
    for (const ring of shell.rim) {
      for(let i=1;i<ring.length;i++) {
        const a=ring[i-1], b=ring[i];
        if (a[2]<.001&&b[2]<.001) continue;
        const ap=asScreen(a),bp=asScreen(b);
        const left=[...ap,rise(eave)], right=[...bp,rise(eave)];
        const topA=[...ap,rise(eave+form(a[2]))], topB=[...bp,rise(eave+form(b[2]))];
        const plaster=shade(color,55);
        slopeFace(left,right,topB,plaster,'plaster');
        slopeFace(left,topB,topA,plaster,'plaster');
      }
    }
  }
  return eave;
}

export function paintOldTownHall(landmark, center, tools) {
  const {parts,pitch,boxRing,average,castShadow,fittingRing,squareSpire,beam,level,rim,solid,material,detailed}=tools;
  const ochre=tools.style==='postcard-ochre', slate=tools.style==='postcard-slate';
  const body=parts.get(landmark.geometry.body);
  if (!body) return;
  const [wall]=body.rings;
  const eave = roofFaces(body,15.2,0,'hipped',4.65,tools,{color:ochre?0xb15b32:slate?0x875d5c:0xa95b42,kind:'clay',mansard:true});
  castShadow(wall,15.2);
  facade(wall,0,eave,tools,(u,h,lit,width)=>{
    const stone=lit ? (ochre?0xf3d5a3:slate?0xe2d9c3:0xe7c99b) : (ochre?0xad8b6e:slate?0x9b9a9c:0xbca076);
    const bays=Math.max(1,Math.round(width/3.8));
    const x=((u*bays)%1-.5)*width/bays;
    if (h>eave-1.0 || (h>4.9 && h<5.26)) return shade(stone,h>eave-.24 || h<5.02 ? -21 : 22);
    if (width>2.48) {
      if (h<4.6) {
        const opening=archFace(x,h,{width:.91,sill:.46,spring:3.47,rise:.62},stone,0x465150);
        if (opening!==undefined) return opening;
      } else if (h>6.03 && h<8.7 && Math.abs(x)<1.02) {
        if (h<6.31 || h>8.54 || Math.abs(x)>.76) return shade(stone,22);
        return shade(0x5a625c,Math.abs(x)<.11 || (h>7.77 && h<7.96) ? 47 : 0);
      }
    }
    const course=h<5 ? (h+.12)%.87<.13 : (h+.18)%1.48<.10;
    if (ochre && h<4.95 && Math.abs(x)>.96) {
      if (Math.abs(x)<1.25) return shade(stone,course?-24:21);
      if (detailed && h>.97 && h<1.14) return shade(stone,-24);
    }
    return shade(stone,course ? -12 : u<.09 || u>.93 ? 11 : 0);
  });
  rim(wall,eave+0.04,0xd7b284,.42);

  const [a,b]=longestEdge(wall,pitch);
  const angle=Math.atan2((b[1]-a[1])/pitch,b[0]-a[0]);
  if (detailed && eave<15) {
    const wallCenter=average(wall);
    const midpoint=interpolate(a,b,.5);
    const frame=lineFrame(a,b,tools);
    const inset=Math.sign(frame.offset(wallCenter));
    for (const t of [.39,.68]) {
      const location=frame.shift(interpolate(a,b,t),inset*1.20);
      const dormer=boxRing(...location,1.36,1.32,angle);
      if (!inset || distance(location,midpoint,tools)>frame.length/2) continue;
      facade(dormer,eave+.65,eave+2.36,tools,(u,h,lit)=>
        u>.22&&u<.78&&h>eave+1.23&&h<eave+2.10 ? 0x545c56 : lit ? 0xdaceab : 0xa88c72);
      squareSpire(dormer,eave+2.36,[[eave+3.11,.19]],0x8e5749);
    }
  }
  const tower=boxRing(...center,6.85,6.55,angle);
  castShadow(tower,landmark.dimensions.height);
  facade(tower,0,21.25,tools,(u,h,lit,width)=>{
    const stone=lit ? (ochre?0xffe3b3:slate?0xf1e4cb:0xf2dcb1) : (ochre?0xbfa07c:slate?0xac9fa0:0xc7ad87);
    const x=(u-.5)*width;
    const dial=clock(x,h,16.65,1.39,lit);
    if (dial!==undefined) return dial;
    const opening=archFace(x,h,{width:.61,sill:10.79,spring:13.08,rise:.55},stone,0x615849);
    if (opening!==undefined) return opening;
    const molding=(h>9.9&&h<10.25)||(h>14.58&&h<14.92)||h>20.3;
    if (molding) return shade(stone,h%1<.42 ? -19 : 21);
    if (u<.19||u>.81) return shade(stone,(u<.1||u>.90) ? -6 : 16);
    return shade(stone,h%1.46<.10 ? -8 : 2);
  });
  const cornice=fittingRing(tower,center,1.085);
  solid([cornice],20.9,21.88,material(0xc9b798,0xe7d2ad));
  const cap=fittingRing(tower,center,1.01);
  squareSpire(cap,21.88,[[22.45,1.05],[23.26,.96],[24.12,1.02],[25.52,.96],[27.12,.76],[28.5,.46],[29.22,.33]],0x4c5b51,'metal');
  const lantern=boxRing(...center,2.45,2.43,angle);
  facade(lantern,28.77,31.5,tools,(u,h,lit)=>
    u>.19 && u<.82 && h>29.17 && h<31.06 ? 0x4b5350 : lit ? 0xa8aa92 : 0x79867a);
  squareSpire(fittingRing(lantern,average(lantern),1.18),31.43,
    [[31.98,1.08],[32.91,.75],[34.05,.37],[34.75,.16]],0x46574e,'metal');
  beam(level(center,34.68),level(center,landmark.dimensions.height),0x947e50,.22);
  if (detailed) {
    const tipA=polarOnAxis(center,.66,angle,tools);
    const tipB=polarOnAxis(center,-.57,angle,tools);
    beam(level(tipA,36.22),level(tipB,36.22),0xac8c50,.18);
  }
}

function polarOnAxis([x,y],metres,angle,{scale,pitch}) {
  return [x+metres*scale*Math.cos(angle),y+metres*scale*pitch*Math.sin(angle)];
}

export function paintMasarykSquare(landmark, tools) {
  const {parts,scale,pitch,screen,map,box,profile,polar,beam,level,castShadow}=tools;
  const fountain=parts.get(landmark.geometry.fountain)?.rings[0][0];
  if (fountain) {
    // Existing runtime fountain sampling looks just above the mapped anchor.
    // Draw cool wet granite there and keep the jets flush with the paving.
    const rx=2.22*scale,ry=1.04*scale;
    map.ellipse(fountain[0],fountain[1]-.34*scale,rx,ry,(x,y,dx,dy)=>{
      const color=dx*dx+dy*dy<.67 ? 0x5b8590 : 0x879693;
      if (map.depth[y*map.width+x]<1) map.pixel(x,y,color,0.1);
    });
    const jets=landmark.dimensions.jets;
    for(let i=0;i<jets;i++) {
      const across=i-(jets-1)/2;
      const point=[fountain[0]+across*1.89*scale,fountain[1]+across*.38*scale*pitch];
      map.ellipse(point[0],point[1],.48*scale,.33*scale,(x,y)=>map.pixel(x,y,0x60747a,.11));
      const jet=landmark.dimensions.jetHeight*(i===2 ? .92 : i%2===0 ? .47 : .67);
      beam(level(point,.1),level(point,jet),0xb3d6d2,.24);
      beam(level(point,jet*.56),level(point,jet),0xe4ebe0,.15);
    }
  }
  const marian=screen(landmark.fixtures.marian.point);
  const florian=screen(landmark.fixtures.florian.point);
  const bust=screen(landmark.fixtures.masaryk.point);
  const sandstone=0xcdb48c;
  const angle=.34;
  const base=tools.boxRing(...marian,3.7,3.14,angle);
  castShadow(base,11.6);
  box(marian,3.7,3.14,0,.26,0xb5a28a,sandstone,angle);
  box(marian,2.36,2.23,.26,1.52,sandstone,0xddcaa1,angle);
  box(marian,1.5,1.45,1.52,2.13,sandstone,0xe2cba3,angle);
  profile(marian,[[2.13,.48],[2.46,.43],[9.25,.31],[9.43,.46],[9.80,.43]],sandstone,10);
  profile(marian,[[9.8,.43],[10.18,.38],[10.85,.30],[11.28,.19],[11.57,.18]],0xd5bf94,10);
  if (tools.detailed) {
    for (const theta of [.16,1.73,3.30,4.87]) {
      profile(polar(marian,1.21,theta),[[1.33,.18],[1.51,.25],[1.77,.17]],0xc4ab85,8);
    }
  }
  box(florian,2.18,1.96,0,.24,0xa99578,sandstone,angle);
  box(florian,1.27,1.15,.24,1.86,sandstone,0xe4cca1,angle);
  profile(florian,[[1.86,.49],[2.26,.36],[2.84,.41],[3.16,.24],[3.44,.17]],0xd0b48b,10);
  box(bust,.92,.94,0,1.46,0xa79b82,0xc5b696,angle);
  profile(bust,[[1.46,.36],[1.67,.28],[2.03,.17],[2.21,.11]],0x526554,9);
}

export function paintNewCityHall(landmark, tools) {
  const {parts,scale,pitch,rise,average,solid,material,flatRoof,rim,rails,beam,level,squareSpire,castShadow}=tools;
  const {wings,plinth,shaft,terrace,crown,mast}=landmark.geometry;
  const civic=parts.get(wings);
  const tower=parts.get(shaft)?.rings[0];
  if (civic) {
    const eave = 20.25; // Five mapped storeys.
    const core=tower && average(tower);
    const plaza=core && [core[0]-37*scale,core[1]+37*scale*pitch];
    const [outline]=civic.rings;
    const entrance=plaza && outline.slice(0,-1).reduce((closest,a,i)=>{
      const b=outline[i+1];
      if (distance(a,b,tools)<28) return closest;
      const position=interpolate(a,b,.5);
      return !closest || distance(position,plaza,tools)<closest.fromPlaza ?
        {a,fromPlaza:distance(position,plaza,tools)} : closest;
    },null);
    castShadow(civic.rings[0],eave);
    flatRoof(civic.rings,rise(eave),{...material(0xd0c1a5,0x727e7a),material:{kind:'zinc'}},68);
    for (const ring of civic.rings) {
      facade(ring,0,eave,tools,(u,h,lit,width,a)=>{
        const stone=lit ? 0xdbcaab : 0xb0a18a;
        const bays=Math.max(1,Math.round(width/3.7));
        const x=((u*bays)%1-.5)*width/bays;
        const row=(h-.4+4.05)%4.05;
        const front=(u-.5)*width;
        if (a===entrance?.a && Math.abs(front)<7.5) {
          if (h<7.75) {
            const bay=(front+7.5)%5-2.5;
            const opening=archFace(bay,h,{width:1.46,sill:.12,spring:4.66,rise:1.43},stone,0x435354);
            return opening ?? shade(stone,h%1.37<.14 ? -11 : 12);
          }
          if (h<8.52) return shade(stone,h>8.22 ? 27 : -20);
        }
        if (h>19.35 || h>4.46 && h<4.85) return shade(stone,h>20.0 || h<4.56 ? -21 : 20);
        if (width>2.7 && Math.abs(x)<1.06 && row>.76 && row<3.08) {
          if (Math.abs(x)>.81 || row<1.00 || row>2.90) return shade(stone,row<1.02 ? 28 : 9);
          const pane=lit ? 0x536664 : 0x455b61;
          return shade(pane,Math.abs(x)<.08||row>2.32&&row<2.49 ? 29 : x<-.28 ? 7 : -5);
        }
        return shade(stone,row<.10 ? -10 : h<.72 ? -15 : 0);
      });
      rim(ring,eave+0.06,0xa9a694,.38);
    }
  }
  if (!tower) return;
  const core=average(tower);
  const support=parts.get(plinth)?.rings[0];
  const gallery=parts.get(terrace)?.rings[0];
  const roof=parts.get(crown)?.rings[0];
  const spire=parts.get(mast)?.rings[0];
  const platform=landmark.dimensions.terrace;
  castShadow(tower,landmark.dimensions.height);
  if (support) {
    const pointToPlaza=[core[0]-37*scale,core[1]+37*scale*pitch];
    const front=Object.fromEntries(support.slice(1).map((q,i)=>{
      const p=support[i];
      const [x,y]=interpolate(p,q,.5);
      return [p.join(','),Math.hypot(x-pointToPlaza[0],(y-pointToPlaza[1])/pitch)];
    }));
    const frontFace=Math.min(...Object.values(front));
    facade(support,0,22,tools,(u,h,lit,width,a)=>{
      const stone=lit ? 0xe3d4ba : 0xb6a989;
      const bay=(u*(h<12 ? 3 : 5))%1-.5;
      if (h>21.21 || h>11.43 && h<12.18) return shade(stone,h%1>.6 ? 26 : -17);
      if (front[a.join(',')]===frontFace && h<11.4) {
        const entry=archFace(bay*width/3,h,{width:1.25,sill:.66,spring:6.0,rise:1.08},stone,0x414f52);
        if (entry!==undefined) return entry;
      }
      if (h>13.4 && Math.abs(bay)<.24 && (h-13.4)%4.24<2.68) {
        return Math.abs(bay)>.18 ? shade(stone,21) : shade(0x596a64,Math.abs(bay)<.028 ? 33 : 3);
      }
      return shade(stone,h%1.37<.1 ? -12 : 0);
    });
    flatRoof([support],rise(22),{...material(0xdacead,0x78847c),material:{kind:'zinc'}},14);
    rim(support,22.05,0xc0b39b,.43);
  }
  facade(tower,21.88,platform-.46,tools,(u,h,lit,width)=>{
    const copper=lit ? 0x789d87 : 0x51746c;
    const x=(u-.5)*width;
    const dial=clock(x,h,63.52,1.67,lit);
    if (dial!==undefined) return dial;
    const bay=(u*13)%1;
    const shadePatch=(Math.floor(h/2.87)+Math.floor(u*11)*3)%7-3;
    if (u<.075||u>.925||Math.abs(u-.244)<.021||Math.abs(u-.756)<.021) return shade(copper,u<.05||u>.95 ? -17 : 19);
    if (h>24.0 && h<57.9 && u>.268 && u<.732) {
      const row=(h-24.0)%3.76;
      const glass=lit ? 0x587f76 : 0x385b5f;
      return row<.77||bay<.17 ? shade(copper,row<.22 ? 18 : -9) : shade(glass,row<1.05 ? -12 : bay>.69 ? 18 : 0);
    }
    return shade(copper,bay<.15 ? 9 : (h-21.88)%3.04<.13 ? -12 : shadePatch*2);
  });
  for (const p of tower.slice(0,-1)) beam(level(p,22.12),level(p,platform-.5),0x829d85,.32);
  if (!gallery||!roof||!spire) return;
  solid([gallery],platform-.54,platform,material(0x4e685e,0x92947e));
  rails(gallery,platform+.04,0x779a84,1.08);
  const lantern=tools.fittingRing(tower,core,.84);
  facade(lantern,platform,77.0,tools,(u,h,lit)=>
    u>.10 && u<.90 && h>74.0 && h<76.48 && (u*8)%1>.17 ?
      shade(lit ? 0x4d6d65 : 0x3f5655,u%.24<.10 ? 11 : 0) : lit ? 0x90a78d : 0x628678);
  tools.laid(tools.fittingRing(tower,core,.97),77.1,0x849889);
  solid([roof],77.0,79.0,material(0x5d7c72,0x879c84));
  squareSpire(roof,79.0,[[79.35,.94],[81.05,.45]],0x638777,'metal');
  solid([spire],81,landmark.dimensions.height,material(0x788477));
}

export function paintCathedral(landmark, tools) {
  const {parts,average,castShadow,fittingRing,squareSpire,solid,material,beam,level,polar,rim}=tools;
  const {aisles,nave,towers}=landmark.geometry;
  for (const [i,id] of [aisles,nave].entries()) {
    const body=parts.get(id);
    if (!body) continue;
    const roofColor=i ? 0x677876 : 0x67726d;
    const eave=roofFaces(body,i ? 38 : 15,0,i ? 'gabled' : 'flat',i ? 8 : 0,tools,{color:roofColor,kind:'zinc'});
    if (i===0) castShadow(body.rings[0],30);
    const base=i ? 14.8 : 0;
    for(const ring of body.rings) {
      facade(ring,base,eave,tools,(u,h,lit,width)=>{
        const lime=lit ? 0xe9cba4 : 0xb69e85;
        const trim=lit ? 0xb7846b : 0x927264;
        const bays=Math.max(1,Math.round(width/(i ? 6.25 : 6.56)));
        const x=((u*bays)%1-.5)*width/bays;
        const windowWidth=i ? 1.21 : 1.25;
        if (width>2.9) {
          const window=archFace(x,h,{width:windowWidth,sill:base+(i ? 5.2 : 3.02),spring:eave-4.32,rise:1.12},
            trim,lit ? 0x536d6b : 0x425955);
          if (window!==undefined) return window;
        }
        if (h>eave-1.18) return shade(lime,h>eave-.27 ? 21 : -20);
        if (h<base+.79) return shade(lime,-25);
        if (width>2.5 && Math.abs(x)>width/bays*.41 && h>base+1.4) return shade(trim,h%1.26<.11 ? -12 : 4);
        return shade(lime,h%2.18<.11 ? -9 : 0);
      });
      rim(ring,eave+.08,0xc4a688,.34);
    }
  }
  for (const id of towers) {
    const f=parts.get(id);
    const ring=f?.rings[0];
    if (!ring) continue;
    const center=average(ring);
    const tip=Number(f.tags.height) || 68;
    const eave=tip-(Number(f.tags['roof:height']) || 18);
    castShadow(ring,tip);
    facade(ring,0,eave,tools,(u,h,lit,width)=>{
      const stone=lit ? 0xf0d5b6 : 0xc0a58d;
      const pilaster=lit ? 0xca967b : 0x8e6f60;
      const x=(u-.5)*width;
      const dial=width>3.5 ? clock(x,h,32.26,1.14,lit) : undefined;
      if (dial!==undefined) return dial;
      if (width>2.95) {
        const belfry=archFace(x,h,{width:width*.18,sill:36.75,spring:eave-6.6,rise:2.06},stone,lit ? 0x63594c : 0x4b493e);
        if (belfry!==undefined) return shade(belfry, h%1.02<.13 ? 11 : 0);
      }
      if (h>eave-1.82 || h>34.36&&h<35.38 || h>27.5&&h<28.42) return shade(stone,h%1>.41 ? 23 : -21);
      if ((u>.071&&u<.197 || u>.803&&u<.929) && width>2.75) return shade(pilaster,h%1.85<.10 ? -15 : 5);
      if (h>19.55&&h<23.64&&Math.abs(x)<.51&&width>3.3) return shade(0x676458,h>23.30 ? 30 : 0);
      return shade(stone,h%2.11<.10 ? -9 : 0);
    });
    const cornice=fittingRing(ring,center,1.055);
    solid([cornice],eave-.95,eave,material(0xc7a888,0xe0c4a7));
    const spire=fittingRing(ring,center,.94);
    squareSpire(spire,eave,[[eave+.68,1.027],[eave+2.8,.89],[tip-7.7,.45],[tip-3.9,.235],[tip-1.95,.079]],0x517f70,'metal');
    beam(level(center,tip-2.08),level(center,tip),0x9a8150,.24);
    beam(level(polar(center,.76,.32),tip-.71),level(polar(center,.76,.32+Math.PI),tip-.71),0xad9360,.20);
  }
}

function lineFrame(a,b,{scale,pitch}) {
  const length=distance(a,b,{scale,pitch});
  const dx=(b[0]-a[0])/(length*scale),dy=(b[1]-a[1])/(length*scale*pitch);
  const offset=([x,y])=>(-(x-a[0])*dy+(y-a[1])*dx/pitch)/scale;
  const shift=([x,y],d)=>[x-dy*d*scale,y+dx*d*scale*pitch];
  return {offset,shift,length};
}

export function paintOblouk(landmark, tools) {
  const {wings,passage,sidePassages,riverWings,riverPassage,riverSidePassages}=landmark.geometry;
  paintObloukPortal(wings,passage,sidePassages,tools,{
    roofs:[31.7,27.4], roofDepth:[5.4,4.0], radius:4.65, spring:13.35, rise:4.48,
  });
  paintObloukPortal(riverWings,riverPassage,riverSidePassages,tools,{
    roofs:[17.9,18.6], roofDepth:[3.8,4.0], radius:4.20, spring:7.65, rise:3.15,
  });
}

function paintObloukPortal(wings, passage, sidePassages, tools, {roofs,roofDepth,radius,spring,rise}) {
  const {parts,castShadow,rim,beam,level,quad,detailed}=tools;
  const path=parts.get(passage)?.rings[0];
  if (!path || path.length!==2) return;
  const frame=lineFrame(...path,tools);
  const side = sidePassages.map(id=>parts.get(id)?.rings[0]).filter(Boolean)
    .map(ring=>frame.offset(interpolate(ring[0],ring.at(-1),.5)));
  const reliefBase=spring+rise+.91;
  for (const [i,id] of wings.entries()) {
    const body=parts.get(id);
    if (!body) continue;
    const ring=body.rings[0];
    const roof=roofs[i];
    const eave=roofFaces(body,roof,0,'hipped',roofDepth[i],tools,{color:0xb26b49,kind:'clay'});
    castShadow(ring,roof);
    facade(ring,0,eave,tools,(u,h,lit,width,a,b)=>{
      const point=interpolate(a,b,u);
      const left=frame.offset(point);
      const across=Math.abs(left);
      const crown=spring+rise*archCrown(across,radius);
      const face=lit ? 0xe2be96 : 0xb4987d;
      if (across<radius&&h<crown) return undefined;
      const smallDistance=Math.min(...side.map(pos=>Math.abs(pos-left)));
      const smallCrown=3.40+1.2*archCrown(smallDistance,1.27);
      if (smallDistance<1.27 && h<smallCrown) return undefined;
      if (smallDistance<1.57 && h<smallCrown+.46) return shade(face,smallDistance<1.36 ? -19 : 21);
      if (across<radius+.83 && h<spring+rise*archCrown(across,radius+.83)+.50) {
        const joint=h<spring ? h%1.08 : Math.abs(Math.atan2(h-spring,left)*5.1%1);
        return shade(face,h<crown+.18 || joint<.09 ? -22 : 22);
      }
      if (across<radius+.83 && h>reliefBase && h<reliefBase+2.43) {
        const reliefHeight=h-reliefBase;
        const panel=(left+7.3)/1.47%1;
        const relief=Math.abs(panel-.5)*1.1+Math.abs(reliefHeight-1.26)*.31;
        const terracotta=lit ? 0xaf735a : 0x8f6551;
        return shade(terracotta,reliefHeight<.26||reliefHeight>2.18 ? -18 : relief<.38 ? 26 : -6);
      }
      if (h<.79 || h>eave-1.27 || h>5.16&&h<5.54 || h>22.04&&h<22.45) return shade(face,h%1.1<.38 ? -16 : 18);
      const bays=Math.max(1,Math.round(width/3.0));
      const bay=(u*bays)%1;
      const row=(h-.44+3.26)%3.26;
      if (width>2.4 && across>5.63 && bay>.26 && bay<.74 && row>.90 && row<2.6) {
        if (bay<.30||bay>.70||row<1.04) return shade(face,row<1.04 ? 29 : -7);
        return shade(lit ? 0x716e63 : 0x535d5c,Math.abs(bay-.5)<.049||row>1.89&&row<2.07 ? 25 : -4);
      }
      return shade(face,bay<.093 ? 13 : bay>.9 ? -11 : row<.09 ? -12 : 0);
    });
    rim(ring,eave+.07,0xc7a682,.33);
  }
  for (const direction of [-1,1]) {
    const steps=12;
    for(let i=1;i<=steps;i++) {
      const a=direction*radius*(i-1)/steps, b=direction*radius*i/steps;
      const h=spring+rise*archCrown(a,radius);
      const g=spring+rise*archCrown(b,radius);
      const p0=frame.shift(path[0],a), p1=frame.shift(path[0],b), q0=frame.shift(path[1],a), q1=frame.shift(path[1],b);
      quad(level(p0,h-.09),level(p1,g-.09),level(q1,g-.09),level(q0,h-.09),shade(0x816d58,(i%3)*4+direction*5));
      if (detailed && i%3===0) beam(level(p1,g-.11),level(q1,g-.11),0xa8896c,.15);
    }
  }
}

export function paintSykoraBridge(landmark, tools) {
  const {parts,beam,route,level,detailed}=tools;
  const {road,walkways}=landmark.geometry;
  const lanes=road.map(id=>parts.get(id));
  const paths=walkways.map(id=>parts.get(id));
  if ([...lanes,...paths].some(feature=>!feature || !bridgeDeck(feature.tags) || transportGrade(feature.tags)!==1)) return;
  const [first,second]=lanes.map(f=>f.rings[0]);
  if (first.length<2||second.length<2) return;
  const firstEnds=[first[0],first.at(-1)], secondEnds=[second[0],second.at(-1)];
  const join=firstEnds.flatMap((p,i)=>secondEnds.map((q,j)=>({i,j,gap:distance(p,q,tools)})))
    .find(({gap})=>gap<.10);
  if (!join) return;
  const {span,archRise,deckWidth}=landmark.dimensions;
  const a=firstEnds[1-join.i], b=secondEnds[1-join.j];
  if (distance(a,b,tools)<span) return;
  const frame=lineFrame(a,b,tools);
  if (frame.length<span || paths.some(p=>p.rings[0].length!==2)) return;
  const start=(1-span/frame.length)/2;
  const end=1-start;
  const stops=detailed ? 24 : 16;
  const panels=12;
  for (const [side,path] of paths.entries()) {
    const [footA,footB]=path.rings[0];
    const sign=Math.sign(frame.offset(footA));
    const railOffset=deckWidth/2-Math.abs(frame.offset(footA));
    if (!sign || railOffset<-.9 || railOffset>1.65) continue;
    const archOffset=sign*deckWidth*.296;
    const onArch=(t)=>frame.shift(interpolate(a,b,start+(end-start)*t),archOffset);
    const high=(t)=>.46+4*archRise*t*(1-t);
    const low=(t)=>Math.max(.29,high(t)-1.08);
    const sun=side===0;
    const metal=sun ? 0xa3aba0 : 0x88948b;
    const web=sun ? 0x64776f : 0x62716b;
    const tie=sun ? 0x586d67 : 0x687872;
    const samples=Array.from({length:stops+1},(_,i)=>i/stops);
    route(samples.map(t=>level(onArch(t),high(t))),metal,.61);
    route(samples.map(t=>level(onArch(t),low(t))),web,.42);
    beam(level(onArch(0),.20),level(onArch(1),.20),tie,.50);
    for(let i=0;i<panels;i++) {
      const u=i/panels, v=(i+1)/panels;
      const p=onArch(u), q=onArch(v);
      beam(level(p,.27),level(p,low(u)),web,.36);
      beam(level(p,low(u)),level(q,high(v)),shade(metal,-9),.24);
      if (detailed && i>0 && i<panels-1) {
        const joint=interpolate(p,q,.12);
        beam(level(joint,low(u)-.16),level(joint,low(u)+.27),shade(web,-7),.29);
      }
    }
    const nearRail=frame.shift(footA,sign*railOffset);
    const farRail=frame.shift(footB,sign*(deckWidth/2-Math.abs(frame.offset(footB))));
    beam(level(nearRail,1.07),level(farRail,1.07),metal,.30);
    const uprights=Math.max(1,Math.round(frame.length/3.22));
    for(let i=0;i<=uprights;i++) {
      const point=interpolate(nearRail,farRail,i/uprights);
      beam(level(point,.08),level(point,1.07),web,.18);
    }
  }
}
