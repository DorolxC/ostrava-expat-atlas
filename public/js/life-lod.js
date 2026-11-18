export const LIFE_MIN_ZOOM=.43;
export const STREET_LIFE_ZOOM=.72;
export const lifeLOD=zoom=>zoom<LIFE_MIN_ZOOM?'city':zoom<1.16?'neighbourhood':zoom<3.05?'street':'architecture';
