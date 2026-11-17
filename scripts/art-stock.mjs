import { mix, noise } from './raster.mjs';

const sets = {
  town: [
    [0xb06344,0xe2c492],[0xbf754d,0xe5b37f],[0x626a72,0xe4d5b4],[0xa65f52,0xd9b099],
    [0x846665,0xe9d9b8],[0xb57854,0xc5c9a2],[0x577174,0xe8d0aa],[0xa95339,0xead6a6],
    [0xa97660,0xd7b895],[0x686971,0xe2c5b7],[0xc1845d,0xebcb9d],[0x8a6661,0xd4a18a],
  ],
  poruba: [
    [0x9c5444,0xe5cf9e],[0xad6248,0xe5bf93],[0xba7552,0xe4b588],[0x727470,0xe1d6b5],
    [0xae624c,0xe2bd9f],[0x976458,0xe9cbc1],[0x85675c,0xd0bd99],
  ],
  houses: [
    [0xae6348,0xe6d3aa],[0x98513f,0xe0b495],[0xb96f52,0xd3bd8d],[0x686c72,0xd4cbad],
    [0x80655e,0xcbb099],[0xb27150,0xdec7a2],[0x6d7572,0xd8c9b6],[0xaa4d39,0xe9cfb5],
  ],
  modern: [
    [0x637379,0xc7c5b8],[0x729095,0xb8c9c3],[0x8a8271,0xd8c3a8],[0x59737b,0xafc1c9],
    [0x93988d,0xe2d2bc],[0x807871,0xcbb8a8],
  ],
  estate: [
    [0x737d83,0xc9b8a4],[0x84948e,0xc2c6b0],[0x727375,0xe1c9a9],[0x869092,0xc2c8c7],
    [0x969488,0xd2d0ae],[0x727d81,0xdcc1b1],
  ],
  industry: [
    [0x5e635f,0xa27a64],[0x697276,0x93796b],[0x8b6854,0xb48b6f],[0x4b6161,0x92998d],
    [0x786b62,0xb28064],[0x73807e,0xaba79a],
  ],
  ironworks: [
    [0x535550,0x966a4e],[0x765f52,0xa87554],[0x586f70,0x877464],[0x77574a,0xa36b54],
    [0x686760,0xad8c73],[0x495e62,0x8c9585],
  ],
};

export function pigments(salt, family) {
  const palette=sets[family];
  const [roof,wall]=palette[Math.min(palette.length-1,Math.floor(noise(salt,66)*palette.length))];
  return [roof,wall];
}

export function architecturalFamily(lon,lat,usage) {
  if (usage.industrial) {
    if (lon>18.264 && lon<18.293 && lat>49.8118 && lat<49.8256) return 'ironworks';
    return 'industry';
  }
  if (usage.panel) return 'estate';
  if (usage.modern) return 'modern';
  if (lon>18.275 && lon<18.298 && lat>49.8321 && lat<49.847) return 'town';
  if (lon>18.1637 && lon<18.187 && lat>49.8213 && lat<49.8369) return 'poruba';
  return 'houses';
}

// Approximate context for type inference. The footprint layer supplies
// building geometry; these ranges do not describe heritage boundaries.
export function buildingContext(lon,lat) {
  if (lon>18.165 && lon<18.1845 && lat>49.8198 && lat<49.8342) return 'poruba';
  if (lon>18.253 && lon<18.264 && lat>49.792 && lat<49.7977) return 'jubilee';
  if (lon>18.279 && lon<18.298 && lat>49.8319 && lat<49.845) return 'centre';
  if (lon>18.266 && lon<18.286 && lat>49.816 && lat<49.8248) return 'ironworks';
  return 'ordinary';
}

export function illuminated(color,lit) {
  return lit ? mix(color,0xf8e3b8,0.18) : mix(color,0x405153,0.39);
}
