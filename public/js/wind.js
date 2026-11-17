// The same travelling front drives the anchored canopy and detached seeds.
export function windArrival(x, y, seed, seconds) {
  return seconds - x * .012 - y * .010 + (seed % 19 - 9) * .019;
}

export function windGust(arrival, swell = Math.sin(arrival * 1.19)) {
  return Math.max(0, swell * .86 + Math.sin(arrival * .68 + .86) * .24) ** 1.6;
}
