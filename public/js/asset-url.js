export function assetURL(base,name,revision) {
  const url=new URL(name,base);
  if(revision) url.searchParams.set('v',revision);
  return url;
}
