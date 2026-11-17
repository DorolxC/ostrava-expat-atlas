export const region = {
  lat: 49.832,
  lon: 18.282,
  bounds: [18.074, 49.711, 18.401, 49.928],
  heading: 33,
  pitch: 0.56,
};

const radians = Math.PI / 180;
const eastMeters = 111319.49 * Math.cos(region.lat * radians);
const northMeters = 111229;
const cosine = Math.cos(region.heading * radians);
const sine = Math.sin(region.heading * radians);

export function toLocal(lon, lat) {
  return [(lon - region.lon) * eastMeters, (lat - region.lat) * northMeters];
}

export function toGeographic(x, y) {
  const east = x * cosine - y / region.pitch * sine;
  const north = -x * sine - y / region.pitch * cosine;
  return [region.lon + east / eastMeters, region.lat + north / northMeters];
}

export function projectMeters(east, north) {
  return [east * cosine - north * sine, -(east * sine + north * cosine) * region.pitch];
}

export function project(lon, lat) {
  return projectMeters(...toLocal(lon, lat));
}

export const northScreenAngle = Math.atan2(-sine, cosine * region.pitch) / radians;

export function withinCoverage(lon, lat) {
  const [west, south, east, north] = region.bounds;
  return lon >= west && lon <= east && lat >= south && lat <= north;
}
