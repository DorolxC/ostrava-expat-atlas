import { region } from './geo.js';

const {pitch} = region;
const lift = Math.sqrt(1 - pitch ** 2);
const turn = 2 * Math.PI;
const castX = .72;
const castY = .69 * pitch;
const castShade = 'rgba(49, 57, 64, .24)';
const contactShade = 'rgba(49, 57, 64, .28)';
const rubber = '#343b3d';

const clothes = [
  ['#943f32', '#bd5c43', '#e7a47b', '#40464f', '#d9a884'],
  ['#535d53', '#758c73', '#a9b294', '#4d4943', '#a36e52'],
  ['#8a5a2c', '#bd8637', '#e4be75', '#42494d', '#ba8a68'],
  ['#375e64', '#527f88', '#9bb9b5', '#403f44', '#e1b597'],
  ['#6a5757', '#a87873', '#d9b4a2', '#42454a', '#8d5941'],
  ['#5b5668', '#797995', '#b6b5bb', '#524943', '#c99676'],
  ['#686052', '#bdb299', '#e3d4b5', '#44484d', '#98694e'],
];
const paints = [
  [151, 79, 65], [87, 128, 145], [185, 152, 90], [178, 175, 159],
  [78, 100, 96], [123, 107, 139], [150, 117, 99], [111, 121, 126],
];

// Relative to the ground anchor in projected metres, including cast shadows.
const extents = Object.freeze({
  walker: Object.freeze({left: -.68, top: -1.88, right: 1.70, bottom: .94}),
  car: Object.freeze({left: -2.7, top: -2.8, right: 3.7, bottom: 2.25}),
  cycle: Object.freeze({left: -1.17, top: -1.80, right: 1.95, bottom: 1.13}),
});

export function actorBounds(kind) {
  return extents[kind];
}

function polygon(ctx, points, color) {
  ctx.beginPath();
  ctx.moveTo(...points[0]);
  for (let i = 1; i < points.length; i++) ctx.lineTo(...points[i]);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function line(ctx, points, width, color) {
  ctx.beginPath();
  ctx.moveTo(...points[0]);
  for (let i = 1; i < points.length; i++) ctx.lineTo(...points[i]);
  ctx.lineWidth = width;
  ctx.strokeStyle = color;
  ctx.stroke();
}

function ellipse(ctx, [x,y], rx, ry, color) {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, turn);
  ctx.fillStyle = color;
  ctx.fill();
}

function cast(project, along, across, height) {
  const [x, y] = project(along, across, 0);
  return [x + height * castX, y + height * castY];
}

function head(ctx, project, along, height, skin, hair) {
  const [x,y] = project(along, 0, height);
  ellipse(ctx, [x, y - .031], .128, .123, hair);
  ellipse(ctx, project(along + .048, 0, height - .04), .103, .091, skin);
}

function walkLeg(ctx, project, side, stride, raised, bob, color) {
  const across = side * .135;
  const ankle = .062 + raised;
  line(ctx, [project(-.045, across * .78, .88 + bob), project(.06 + stride * .67, across, .44 + raised * .36),
    project(stride, across, ankle)], .156, color);
  line(ctx, [project(stride - .058, across, ankle), project(stride + .125, across, ankle)], .115, '#343337');
}

function walkArm(ctx, project, side, stride, bob, sleeve, skin) {
  const across = side * .273;
  line(ctx, [project(.014, across * .90, 1.367 + bob), project(-stride * .36, across, 1.12 + bob),
    project(-stride * .78, across, .962 + bob)], .151, sleeve);
  ellipse(ctx, project(-stride * .83, across, .909 + bob), .077, .072, skin);
}

function paintWalker(ctx, project, forwardX, forwardY, phase, variant) {
  const [seam, coat, sunlit, trousers, skin] = clothes[variant % clothes.length];
  const near = forwardX >= 0 ? 1 : -1;
  const step = Math.sin(phase) * near * .327;
  const rise = Math.cos(phase) * near * .148;
  const bob = .022 * (1 - Math.cos(2 * phase));
  const pack = variant % 4 === 2;
  const hair = variant % 3 === 1 ? '#735642' : '#413b38';

  line(ctx, [project(0, 0, 0), cast(project, .02, 0, 1.65)], .24, castShade);
  ellipse(ctx, project(0, 0, 0), .26, .14, contactShade);
  walkLeg(ctx, project, -near, -step, Math.max(0, -rise), bob, '#41404a');
  walkLeg(ctx, project, near, step, Math.max(0, rise), bob, trousers);
  walkArm(ctx, project, -near, -step, bob, seam, skin);

  line(ctx, [project(-.04, 0, .966 + bob), project(.030, 0, 1.330 + bob)], .477, seam);
  line(ctx, [project(-.01, 0, 1.02 + bob), project(.057, 0, 1.355 + bob)], .398, coat);
  const [shoulderX, shoulderY] = project(.051, 0, 1.405 + bob);
  ellipse(ctx, [shoulderX - .064, shoulderY - .036], .152, .084, sunlit);
  if (pack && forwardY < .32) {
    line(ctx, [project(-.163, 0, 1.063 + bob), project(-.176, 0, 1.285 + bob)], .285, '#635650');
  }
  walkArm(ctx, project, near, step, bob, coat, skin);
  head(ctx, project, .084, 1.614 + bob, skin, hair);
}

function wheel(ctx, project, forwardX, forwardY, along, across, radius, width) {
  const [x, y] = project(along, across, radius);
  ctx.beginPath();
  ctx.save();
  ctx.transform(forwardX, forwardY * pitch, 0, -lift, x, y);
  ctx.arc(0, 0, radius, 0, turn);
  ctx.restore();
  ctx.lineWidth = width;
  ctx.strokeStyle = rubber;
  ctx.stroke();
}

function cycleLeg(ctx, project, side, phase, color) {
  const angle = phase + (side < 0 ? Math.PI : 0);
  const extension = Math.cos(angle) * .16;
  const pedal = .385 + Math.sin(angle) * .148;
  const across = side * .155;
  line(ctx, [project(-.225, across * .75, .93), project(.19 + extension * .72, across, .67),
    project(-.082 + extension, across, pedal + .043)], .137, color);
  line(ctx, [project(-.13 + extension, across, pedal), project(.004 + extension, across, pedal)], .101, rubber);
}

function cycleArm(ctx, project, side, color, skin) {
  const across = side * .222;
  line(ctx, [project(.143, across * .79, 1.276), project(.348, across, 1.086),
    project(.464, across, .999)], .132, color);
  ellipse(ctx, project(.477, across, .978), .064, .056, skin);
}

function paintCycle(ctx, project, forwardX, forwardY, phase, variant) {
  const [seam, jersey, sunlit, trousers, skin] = clothes[variant % clothes.length];
  const near = forwardX >= 0 ? 1 : -1;
  const back = project(-.552, 0, .324);
  const front = project(.567, 0, .324);
  const seat = project(-.235, 0, .829);
  const crank = project(-.079, 0, .385);
  const headset = project(.408, 0, .837);
  const bar = project(.467, 0, .978);

  line(ctx, [project(-.69, 0, 0), project(.69, 0, 0)], .164, contactShade);
  line(ctx, [project(-.552, 0, 0), cast(project, -.552, 0, .29),
    cast(project, -.25, 0, .88), cast(project, .31, 0, 1.47)], .20, castShade);
  cycleLeg(ctx, project, -near, phase, '#43434b');
  wheel(ctx, project, forwardX, forwardY, -.552, 0, .324, .090);
  wheel(ctx, project, forwardX, forwardY, .567, 0, .324, .090);
  line(ctx, [front, headset, seat, crank, back, seat], .081, '#647a76');
  line(ctx, [crank, headset, bar], .088, '#8b9993');
  line(ctx, [project(-.344, 0, .856), project(-.156, 0, .856)], .086, '#444446');
  line(ctx, [project(.467, -.224, .978), project(.467, .224, .978)], .083, rubber);
  ellipse(ctx, back, .065, .058, '#9daba4');
  ellipse(ctx, front, .065, .058, '#9daba4');

  cycleArm(ctx, project, -near, seam, skin);
  line(ctx, [project(-.184, 0, .971), project(.123, 0, 1.259)], .396, seam);
  line(ctx, [project(-.182, 0, 1.015), project(.143, 0, 1.284)], .332, jersey);
  line(ctx, [project(-.104, 0, 1.115), project(.127, 0, 1.339)], .113, sunlit);
  cycleLeg(ctx, project, near, phase, trousers);
  cycleArm(ctx, project, near, jersey, skin);
  head(ctx, project, .328, 1.474, skin, '#3b434a');
  ellipse(ctx, project(.312, 0, 1.538), .148, .077, sunlit);
}

function tint([red, green, blue], amount) {
  const delta = Math.round(amount);
  return `rgb(${red + delta}, ${green + delta}, ${blue + delta})`;
}

function carOutline(rear, nose, width, corner) {
  return [
    [rear, -width + corner], [rear + corner, -width], [nose - corner, -width], [nose, -width + corner],
    [nose, width - corner], [nose - corner, width], [rear + corner, width], [rear, width - corner],
  ];
}

function carModel(estate) {
  const length = estate ? 2.31 : 2.073;
  const width = estate ? .912 : .852;
  return {
    length,
    width,
    tire: estate ? .32 : .30,
    lower: carOutline(-length + .09, length - .09, width - .07, .25),
    shoulder: carOutline(-length, length, width, .28),
    glazing: carOutline(estate ? -1.72 : -1.50, 1.022, width - .085, .17),
    roof: carOutline(estate ? -1.48 : -1.18, .39, width - .209, .21),
    height: estate ? 1.495 : 1.415,
  };
}

const cars = [carModel(false), carModel(true)];

function paintShell(ctx, project, forwardX, forwardY, bottom, top, zBottom, zTop, color, glass) {
  const lower = bottom.map(([x,y]) => project(x, y, zBottom));
  const upper = top.map(([x,y]) => project(x, y, zTop));
  for (let i = 0; i < bottom.length; i++) {
    const j = (i + 1) % bottom.length;
    const [a,b,c,d] = [lower[i], lower[j], upper[j], upper[i]];
    if ((b[0] - a[0]) * (d[1] - a[1]) <= (b[1] - a[1]) * (d[0] - a[0])) continue;
    const dx = bottom[j][0] - bottom[i][0];
    const dy = bottom[j][1] - bottom[i][1];
    const normalX = dx * forwardY + dy * forwardX;
    const normalY = -dx * forwardX + dy * forwardY;
    const sun = -(normalX * .72 + normalY * .69) / Math.hypot(dx, dy);
    polygon(ctx, [a,b,c,d], glass ? tint([65, 87, 95], sun * 17) : tint(color, -23 + 20 * sun));
  }
  polygon(ctx, upper, tint(color, glass ? 31 : 11));
}

function paintCar(ctx, project, forwardX, forwardY, variant) {
  const paint = paints[variant % paints.length];
  const {length, width, tire, lower, shoulder, glazing, roof, height} = cars[variant % 3 === 0 ? 1 : 0];
  const hood = .879;
  polygon(ctx, shoulder.map(([x,y]) => cast(project, x, y, hood)), castShade);
  polygon(ctx, lower.map(([x,y]) => project(x, y, 0)), contactShade);

  for (const side of [-1, 1]) {
    const across = side * (width - .069);
    for (const axle of [-1, 1]) {
      const along = axle * (length - .685);
      const [x,y] = project(along, across, tire);
      ellipse(ctx, [x,y], .107, .136, '#4c5250');
      wheel(ctx, project, forwardX, forwardY, along, across, tire, .185);
    }
  }
  paintShell(ctx, project, forwardX, forwardY, lower, shoulder, .273, hood, paint, false);
  paintShell(ctx, project, forwardX, forwardY, glazing, roof, hood, height, paint, true);
  for (const side of [-1, 1]) {
    const across = side * width * .74;
    line(ctx, [project(length - .241, across, hood + .004), project(length - .098, across * .83, hood + .004)],
      .118, '#f2e0b1');
    line(ctx, [project(-length + .264, across, hood + .004), project(-length + .103, across * .86, hood + .004)],
      .133, '#9a433d');
  }
}

// Heading follows the uncompressed ground tangent. Phase is one full gait or pedal cycle per 2π.
export function paintActor(ctx, {kind, x, y, zoom, heading, phase = 0, variant = 0}) {
  const forwardX = Math.cos(heading);
  const forwardY = Math.sin(heading);
  const style = variant >>> 0;
  const project = (along, across, height) => [
    along * forwardX - across * forwardY,
    (along * forwardY + across * forwardX) * pitch - height * lift,
  ];
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(zoom, zoom);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (kind === 'walker') paintWalker(ctx, project, forwardX, forwardY, phase, style);
  else if (kind === 'cycle') paintCycle(ctx, project, forwardX, forwardY, phase, style);
  else if (kind === 'car') paintCar(ctx, project, forwardX, forwardY, style);
  ctx.restore();
}

// The vector source stays sharp in close-ups. At ordinary atlas scale a
// bounded pose cache avoids repainting each tiny set of paths during a flight.
export function createActorPainter() {
  const sprites=new Map();
  const artScale=6;
  const bearings=32;
  const poses=8;
  const wrap=(angle,count)=>((Math.round(angle*count/turn)%count)+count)%count;
  return function paint(context,actor) {
    if (actor.zoom>3.25) return paintActor(context,actor);
    const {kind,x,y,zoom,heading,phase,variant}=actor;
    const angle=wrap(heading,bearings), gait=kind==='car' ? 0 : wrap(phase,poses);
    const colors=kind==='car' ? paints.length : clothes.length;
    const color=variant%colors;
    const key=kind+'/'+angle+'/'+gait+'/'+color;
    let sprite=sprites.get(key);
    const {left,top,right,bottom}=actorBounds(kind);
    if (!sprite) {
      const width=Math.ceil((right-left)*artScale),height=Math.ceil((bottom-top)*artScale);
      sprite=typeof OffscreenCanvas==='function' ? new OffscreenCanvas(width,height) :
        Object.assign(document.createElement('canvas'),{width,height});
      const ink=sprite.getContext('2d');
      if (!ink) return paintActor(context,actor);
      paintActor(ink,{kind,x:-left*artScale,y:-top*artScale,zoom:artScale,heading:angle*turn/bearings,
        phase:gait*turn/poses,variant:color});
      if (sprites.size>=360) sprites.delete(sprites.keys().next().value);
      sprites.set(key,sprite);
    }
    context.imageSmoothingEnabled=true;
    context.drawImage(sprite,x+left*zoom,y+top*zoom,sprite.width/artScale*zoom,sprite.height/artScale*zoom);
  };
}
