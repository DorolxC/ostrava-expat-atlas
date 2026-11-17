import { project } from './geo.js';
import { places, categories, verification } from './places.js';
import { searchPlaces } from './search.js';
import { icon, insertIcons } from './icons.js';
import { setupViewer } from './viewer.js';
import { LIFE_MIN_ZOOM } from './life.js';

const el = (id) => document.getElementById(id);
const isOpen = (node) => node.dataset.open==='true';
const escape = (text = '') => String(text).replace(/[&<>"']/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const external = ' target="_blank" rel="noopener"';
const dateFormat = new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'});
const sourceById = new Map(places.map((place)=>[place.id,place]));
const categoriesById = new Map(categories.map((category)=>[category.id,category]));
const placePoints = new Map(places.map((place)=>[place.id,project(...place.coordinates)]));
const primaryCategory = (place) => categoriesById.get(place.categories[0]);
const pinNodes = new Map();
const filters = {query:'',category:'',english:'',tags:[]};
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const compact = matchMedia('(max-width: 680px)');
const preferenceKey = 'ostrava-map-motion';
const landmarkLabels = new Set(['masaryk-square','new-city-hall','bolt-tower']);
let ambientPreference;
let ambientState = 'idle';
let ambientZoom = 0;
let filtered = places;
let selected;
let selectedFromIndex = false;
let returnFocus;
let districtRecords = [];
let resultIndex = -1;
let viewer;
let toastTimeout;
let animateResults;

try {
  const saved=localStorage.getItem(preferenceKey);
  if (saved==='on' || saved==='off') ambientPreference=saved==='on';
} catch { /* Browsing still works without persistent preferences. */ }

function disclose(node, open, trigger) {
  node.dataset.open=String(open);
  node.inert=!open;
  trigger?.setAttribute('aria-expanded',String(open));
}

function ambientOn() {
  return ambientPreference ?? !reduced.matches;
}

function updateAmbientNote() {
  const active=ambientOn();
  el('motion-toggle').setAttribute('aria-pressed',String(active));
  const note=ambientState==='unavailable' ? 'Unavailable' : !active ? 'Paused' :
    ambientZoom<LIFE_MIN_ZOOM ? 'Zoom in to see movement' : ambientState==='loading' ? 'Loading…' : 'Trees, water and trams';
  if (el('motion-note').textContent!==note) el('motion-note').textContent=note;
}

function updateAmbient() {
  updateAmbientNote();
  viewer?.setLife(ambientOn());
}

insertIcons(document);
el('category').insertAdjacentHTML('beforeend',categories.map(({id,name,fullName})=>
  '<option value="'+escape(id)+'">'+escape(fullName || name)+'</option>').join(''));
const tags=[...new Set(places.flatMap((place)=>place.tags))].sort();
el('tag-options').innerHTML=tags.map((tag)=>'<label><input type="checkbox" name="tag" value="'+escape(tag)+'">'+escape(tag)+'</label>').join('');

function createLabel({text,type,at,min,max,bearing}) {
  const node=document.createElement('span');
  node.className='map-label '+type;
  node.textContent=text;
  if (bearing!==undefined) node.style.setProperty('--bearing',bearing+'deg');
  el('map-labels').append(node);
  return {text,type,node,point:project(...at),min,max};
}

const labels=[
  {text:'Ostravice',type:'river',at:[18.29727,49.83424],min:0.46,max:2.16,bearing:-13},
  {text:'Dolní Vítkovice',type:'landmark',at:[18.2758,49.8169],min:0.88,max:1.8},
].map(createLabel);

function setDistricts(records) {
  districtRecords=records;
  const prominent=['Poruba','Ostrava - Jih','Moravská Ostrava a Přívoz','Slezská Ostrava','Vítkovice','Svinov','Mariánské Hory a Hulváky','Stará Bělá','Polanka nad Odrou','Krásné Pole'];
  const rank=(name)=>prominent.includes(name) ? prominent.indexOf(name) : 50;
  for (const district of [...records].sort((a,b)=>rank(a.name)-rank(b.name))) {
    const name=district.name==='Moravská Ostrava a Přívoz' ? 'Moravská Ostrava' : district.name.replace('Ostrava - Jih','Ostrava-Jih');
    labels.push(createLabel({text:name,type:'territory',at:district.center,min:rank(district.name)<10 ? 0.012 : 0.083,max:1.06}));
  }
  el('district-list').innerHTML=[...records].sort((a,b)=>a.name.localeCompare(b.name,'cs')).map((district)=>
    '<button class="district-row" type="button" data-district="'+escape(district.id)+'">'+escape(district.name)+
    '<span aria-hidden="true">'+icon('arrow')+'</span></button>').join('');
  viewer?.requestDraw();
}

function activeResult(index) {
  resultIndex=index;
  for (const [i,row] of Array.from(el('results').querySelectorAll('[data-place]')).entries()) {
    row.setAttribute('aria-selected',String(index===i));
  }
  if (index===-1) el('query').removeAttribute('aria-activedescendant');
  else {
    el('query').setAttribute('aria-activedescendant','result-'+index);
    el('result-'+index)?.scrollIntoView({block:'nearest'});
  }
}

function renderIndex(animate) {
  const target=el('results');
  const listing=filtered.map(({id})=>id).join(' ');
  const changed=target.dataset.listing!==listing;
  if (changed) {
    target.dataset.listing=listing;
    target.innerHTML=filtered.length ? filtered.map((place,i)=>{
      const category=primaryCategory(place);
      const verified=place.english.kind==='confirmed';
      return '<button id="result-'+i+'" class="place-result" type="button" role="option" aria-selected="false" data-place="'+escape(place.id)+'" style="--category:'+category.color+'">'
        +'<span class="result-symbol" aria-hidden="true">'+icon(category.icon)+'</span>'
        +'<span class="result-copy"><strong>'+escape(place.name)+'</strong><small>'+escape(category.name)+'</small></span>'
        +(verified ? '<span class="result-verified" title="English confirmed"><span class="sr-only">English confirmed</span>'+icon('check')+'</span>' : '')
        +'</button>';
    }).join('') : '<p class="empty">No places match your search and filters.</p>';
    target.classList.remove('list-refresh');
    cancelAnimationFrame(animateResults);
    if (animate && !reduced.matches) animateResults=requestAnimationFrame(()=>target.classList.add('list-refresh'));
    activeResult(-1);
  }
  el('clear-query').hidden=!filters.query;
  const count=filtered.length;
  el('result-count').textContent=count+(count===1 ? ' place' : ' places');
}

function refreshIndex(animate = false) {
  filtered=searchPlaces(places,filters);
  const actual=Number(!!filters.category)+Number(!!filters.english)+filters.tags.length;
  for (const id of ['active-count','filter-count']) {
    el(id).textContent=actual;
    el(id).hidden=!actual;
  }
  el('english-quick').setAttribute('aria-pressed',String(filters.english==='confirmed'));
  renderIndex(animate);
  viewer?.requestDraw();
}

function setFilterForm(open) {
  disclose(el('filters'),open,el('filter-button'));
}
function setOverview(open, focus = false) {
  disclose(el('overview-panel'),open,el('overview-toggle'));
  if (focus) el(open ? 'close-overview' : 'overview-toggle').focus({preventScroll:true});
}
function setTab(name) {
  const showPlaces=name==='place';
  el('place-section').hidden=!showPlaces;
  el('district-section').hidden=showPlaces;
  el('place-tab').setAttribute('aria-pressed',String(showPlaces));
  el('district-tab').setAttribute('aria-pressed',String(!showPlaces));
  el('query').setAttribute('aria-expanded',String(showPlaces && isOpen(el('explore-panel'))));
  if (!showPlaces) setFilterForm(false);
}
function setExplore(open, focus = '') {
  disclose(el('explore-panel'),open,el('explore'));
  el('query').setAttribute('aria-expanded',String(open && !el('place-section').hidden));
  if (!open) {
    setFilterForm(false);
    activeResult(-1);
  } else {
    setOverview(false);
    dismissPlace(false);
  }
  if (focus) el(focus).focus({preventScroll:true});
}

function updateLocation(mode='replace', options={}) {
  const url=new URL(location.href);
  if (!viewer) return url;
  const place=options.mapOnly ? null : selected?.id;
  if (place) url.searchParams.set('place',place);
  else url.searchParams.delete('place');
  if (options.withView ?? true) url.searchParams.set('view',viewer.view());
  else url.searchParams.delete('view');
  if (mode!=='none' && url.href!==location.href) history[mode==='push' ? 'pushState' : 'replaceState'](null,'',url);
  return url;
}

function dismissPlace(restore = true, update = true) {
  if (!selected) return;
  selected=undefined;
  disclose(el('details'),false);
  const restoreIndex=selectedFromIndex;
  selectedFromIndex=false;
  if (restore && restoreIndex) setExplore(true,compact.matches ? 'close-explore' : 'query');
  else if (restore) {
    const target=returnFocus?.isConnected && !returnFocus.closest('[inert], [hidden]') ? returnFocus : el('map-input');
    target.focus({preventScroll:true});
  }
  if (update) updateLocation();
  viewer?.requestDraw();
}

function renderDetails(place) {
  const quality=verification[place.english.kind];
  const checked=place.english.checked ? dateFormat.format(new Date(place.english.checked+'T12:00:00Z')) : '';
  const [lon,lat]=place.coordinates;
  const directions='https://www.google.com/maps/dir/?api=1&destination='+encodeURIComponent(lat+','+lon);
  const classes=place.categories.map((id)=>categoriesById.get(id).name).join(' · ');
  el('details').innerHTML='<div class="detail-heading"><span class="detail-topline">'+escape(classes)+'</span>'
    +'<div class="detail-actions"><button class="icon-button" id="share-place" type="button" aria-label="Share place" title="Share place">'+icon('share')+'</button>'
    +'<button class="icon-button" id="close-place" type="button" aria-label="Close place" title="Close place">'+icon('x')+'</button></div></div>'
    +'<h2 id="place-title" tabindex="-1">'+escape(place.name)+'</h2><p class="place-subtitle">'+escape(place.subtitle)+'</p>'
    +(place.image ? '<figure class="place-figure"><img src="'+escape(place.image)+'" alt="Illustrated map detail of '+escape(place.name)+'"></figure>' : '')
    +'<div class="place-entry"><p class="place-description">'+escape(place.description)+'</p>'
    +'<address class="place-address">'+escape(place.address)+'</address>'
    +'<div class="place-links"><a class="ink-button" href="'+directions+'"'+external+'>Directions '+icon('arrow')+'</a>'
    +'<a class="text-button" href="'+escape(place.website)+'"'+external+'>Website '+icon('external')+'</a></div>'
    +'<div class="verification '+place.english.kind+'"><div class="verification-heading">'+quality.name+'</div>'
    +'<p>'+escape(place.english.note ?? quality.description)+'</p>'
    +(place.english.source ? '<small><a href="'+escape(place.english.source)+'"'+external+'>Verification source</a>'+(checked ? ' · Checked '+checked : '')+'</small>' : '')+'</div>'
    +'<div class="place-tags" aria-label="Explore related places">'+place.tags.map((tag)=>'<button type="button" data-tag="'+escape(tag)+'" title="Filter by '+escape(tag)+'">'+escape(tag)+'</button>').join('')+'</div>'
    +'<div class="sources">'+(place.infoSource ? '<a href="'+escape(place.infoSource)+'"'+external+'>Place source</a>' : '')
    +'<a href="https://www.openstreetmap.org/'+escape(place.osm)+'"'+external+'>Mapped location</a></div></div>';
  el('details').scrollTop=0;
  el('close-place').onclick=()=>dismissPlace();
  el('share-place').onclick=()=>share(false);
}

function placeArea() {
  const details=el('details');
  const map=el('map');
  const top=compact.matches ? el('brand').closest('header').offsetHeight+22 : 28;
  if (!compact.matches) return {
    left:32, right:details.offsetLeft-31, top, bottom:map.clientHeight-61,
  };
  return {
    left:26, right:map.clientWidth-25, top,
    bottom:details.offsetTop-4,
    verticalFocus:['bolt-tower','new-city-hall'].includes(selected?.id) ? .72 : .5,
  };
}

function revealSelected() {
  if (selected) viewer?.revealPlace(placePoints.get(selected.id),placeArea());
}

function selectPlace(place,{index=false,navigate=true,push=true,focus=true}={}) {
  if (!place) return;
  const changed=selected?.id!==place.id;
  returnFocus=document.activeElement;
  selected=place;
  selectedFromIndex=index;
  setExplore(false);
  setOverview(false);
  renderDetails(place);
  disclose(el('details'),true);
  if (focus) el('place-title').focus({preventScroll:true});
  if (push) updateLocation(changed ? 'push' : 'replace',{withView:!navigate});
  if (navigate) viewer?.select(placePoints.get(place.id),place.id,placeArea());
  else revealSelected();
  viewer?.requestDraw();
}

function restoreRoute() {
  if (!viewer) return;
  const params=new URL(location.href).searchParams;
  const place=sourceById.get(params.get('place'));
  const hasView=viewer.loadView(params.get('view'));
  if (place) selectPlace(place,{navigate:!hasView,push:false,focus:false});
  else {
    dismissPlace(false,false);
    if (!hasView) viewer.reset();
  }
}

async function share(mapOnly) {
  const url=updateLocation('none',{mapOnly,withView:mapOnly});
  try {
    await navigator.clipboard.writeText(url.href);
    el('toast').textContent=mapOnly ? 'Map link copied' : 'Place link copied';
    el('toast').hidden=false;
    clearTimeout(toastTimeout);
    toastTimeout=setTimeout(()=>{ el('toast').hidden=true; },2200);
  } catch {
    el('share-url').value=url.href;
    el('share-dialog').showModal();
    el('share-url').select();
  }
}

function placeGroups(frame) {
  const {width,height,zoom,pointOnScreen}=frame;
  const candidates=zoom>0.15 || filters.query || filters.category || filters.english || filters.tags.length ? [...filtered] : [];
  if (selected && !candidates.includes(selected)) candidates.push(selected);
  const visible=candidates.map((place)=>{
    const point=placePoints.get(place.id);
    const [x,y]=pointOnScreen(point);
    return {place,point,x,y};
  }).filter(({x,y})=>x>8 && x<width-8 && y>36 && y<height-20 &&
    !(compact.matches ? y<87 || (x>width-184 && y<148) : x<300 && y<150));
  visible.sort((a,b)=>Number(b.place===selected)-Number(a.place===selected) || (b.place.priority??0)-(a.place.priority??0));
  const groups=[];
  const reach=zoom<0.47 ? 52 : zoom<1.15 ? 36 : 24;
  for (const p of visible) {
    const group=p.place===selected || zoom>=3.7 ? null : groups.find((g)=>
      g.members[0].place!==selected && Math.abs(g.x-p.x)<reach && Math.abs(g.y-p.y)<reach*0.8);
    if (group) group.members.push(p);
    else groups.push({x:p.x,y:p.y,members:[p]});
  }
  return groups;
}

function setPosition(node,x,y) {
  node.style.setProperty('--x',x.toFixed(2)+'px');
  node.style.setProperty('--y',y.toFixed(2)+'px');
}

function marker(group) {
  const {members}=group;
  const {place}=members[0];
  const count=members.length;
  const key=members.map((m)=>m.place.id).sort().join('+');
  let node=pinNodes.get(key);
  if (!node) {
    node=document.createElement('button');
    node.type='button';
    node.className='map-marker'+(count>1 ? ' cluster' : '');
    node.setAttribute('aria-label',count>1 ? count+' places near '+place.name : place.name);
    node.style.setProperty('--pin',primaryCategory(place).color);
    node.innerHTML='<span class="pin-face" aria-hidden="true">'+(count>1 ? count : icon(primaryCategory(place).icon))+'</span>'
      +(count>1 ? '' : '<span class="marker-name" aria-hidden="true">'+escape(place.label || place.name)+'</span>');
    node.onclick=()=>count>1 ? viewer?.fit(members.map((m)=>m.point)) : selectPlace(place);
    pinNodes.set(key,node);
    el('markers').append(node);
  }
  return {node,key,place};
}
const overlaps=(a,b)=>a.left<b.right && a.right>b.left && a.top<b.bottom && a.bottom>b.top;
const formatCoord=(part,hemisphere)=>Math.abs(part).toFixed(4)+'° '+hemisphere;

function positionFrame(frame) {
  const {width,height,zoom,pointOnScreen}=frame;
  if ((ambientZoom<LIFE_MIN_ZOOM)!==(zoom<LIFE_MIN_ZOOM)) {
    ambientZoom=zoom;
    updateAmbientNote();
  } else ambientZoom=zoom;
  const groups=placeGroups(frame);
  const occupied=groups.map(({x,y})=>({left:x-20,right:x+20,top:y-41,bottom:y+4}));
  const keys=new Set();
  for (const group of groups) {
    const {x,y,members}=group;
    const {node,key,place}=marker(group);
    keys.add(key);
    setPosition(node,x,y);
    const chosen=place===selected && members.length===1;
    node.classList.toggle('selected',chosen);
    node.classList.toggle('pin-compact',!chosen && zoom<.94 && members.length===1);
    node.setAttribute('aria-pressed',String(chosen));
    node.style.zIndex=chosen ? 9 : 2;
    const length=Math.min(172,(place.label || place.name).length*6+10);
    const left=x+20+length>width-14;
    node.classList.toggle('label-left',left);
    const start=left ? x-20-length : x+20;
    const labelBox={left:start,right:start+length,top:y-41,bottom:y-21};
    const show=members.length===1 && landmarkLabels.has(place.id) && zoom>0.7 && y>65 && start>7 &&
      !occupied.some((box)=>overlaps(box,labelBox));
    node.classList.toggle('labelled',show);
    if (show || chosen) occupied.push(labelBox);
  }
  for (const [key,node] of pinNodes) if (!keys.has(key)) {
    node.remove();
    pinNodes.delete(key);
  }

  for (const label of labels) {
    const [x,y]=pointOnScreen(label.point);
    const half=Math.min(96,label.text.length*4.6);
    const box={left:x-half,right:x+half,top:y-10,bottom:y+10};
    const hide=zoom<label.min || zoom>label.max || box.left<12 ||
      box.right>width-12 || y<(compact.matches ? 76 : 32) || y>height-51 ||
      (!compact.matches && box.left<294 && y<135) ||
      occupied.some((item)=>overlaps(item,box));
    label.node.hidden=hide;
    if (!hide) {
      setPosition(label.node,x,y);
      occupied.push(box);
    }
  }
  const meters=[5000,3000,2000,1000,500,300,200,100,50,25,10].find((value)=>frame.scaleInPixels(value)<98) ?? 10;
  el('scale-label').textContent=meters>=1000 ? meters/1000+' km' : meters+' m';
  el('scale-line').style.width=frame.scaleInPixels(meters).toFixed(1)+'px';
  el('zoom-in').disabled=!frame.canZoomIn;
  el('zoom-out').disabled=!frame.canZoomOut;
  if (frame.center) {
    const [lon,lat]=frame.center;
    const coordinates=formatCoord(lat,lat<0 ? 'S' : 'N')+'  ·  '+formatCoord(lon,lon<0 ? 'W' : 'E');
    if (el('coordinates').textContent!==coordinates) el('coordinates').textContent=coordinates;
  }
  if (isOpen(el('overview-panel'))) {
    for (const [key,value] of Object.entries(frame.inset)) el('inset-viewport').style[key]=value*100+'%';
  }
}

function applyFilters() {
  const data=new FormData(el('filters'));
  filters.category=data.get('category');
  filters.english=data.get('english');
  filters.tags=data.getAll('tag');
  refreshIndex(true);
}
function wholeCity() {
  dismissPlace(false);
  setExplore(false);
  setOverview(false);
  viewer?.wholeCity();
}
function returnToCentre() {
  dismissPlace(false);
  setExplore(false);
  setOverview(false);
  viewer?.reset();
}

for (const link of document.querySelectorAll('[data-viewpoint]')) {
  link.addEventListener('click',(event)=>{
    if (!viewer || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    const view=new URL(link.href).searchParams.get('view');
    dismissPlace(false);
    setExplore(false);
    setOverview(false);
    viewer.travelToView(view);
    if (link.closest('[inert]')) el('explore').focus({preventScroll:true});
  });
}

el('explore').onclick=()=>{
  const opening=!isOpen(el('explore-panel'));
  setExplore(opening,opening ? (compact.matches || el('place-section').hidden ? 'close-explore' : 'query') : 'explore');
};
el('close-explore').onclick=()=>setExplore(false,'explore');
el('place-tab').onclick=()=>setTab('place');
el('district-tab').onclick=()=>setTab('district');
el('query').addEventListener('input',(event)=>{
  filters.query=event.target.value;
  refreshIndex(true);
});
el('query').addEventListener('keydown',(event)=>{
  if (event.isComposing || !filtered.length) return;
  if (event.key==='Enter') {
    event.preventDefault();
    selectPlace(filtered[Math.max(0,resultIndex)],{index:true});
  }
  if (event.key==='ArrowDown' || event.key==='ArrowUp') {
    event.preventDefault();
    const next=event.key==='ArrowDown' ? (resultIndex+1)%filtered.length : (resultIndex<=0 ? filtered.length-1 : resultIndex-1);
    activeResult(next);
  }
});
el('clear-query').onclick=()=>{
  el('query').value='';
  filters.query='';
  refreshIndex();
  el('query').focus({preventScroll:true});
};
el('results').onclick=(event)=>{
  const result=event.target.closest('[data-place]');
  if (result) selectPlace(sourceById.get(result.dataset.place),{index:true});
};
el('filters').addEventListener('change',applyFilters);
el('filters').addEventListener('submit',(event)=>event.preventDefault());
el('filter-button').onclick=()=>setFilterForm(!isOpen(el('filters')));
el('filter-done').onclick=()=>{
  setFilterForm(false);
  el('filter-button').focus();
};
el('reset-filters').onclick=()=>{
  el('filters').reset();
  applyFilters();
};
el('english-quick').onclick=()=>{
  el('english').value=filters.english==='confirmed' ? '' : 'confirmed';
  applyFilters();
};
el('details').onclick=(event)=>{
  const tag=event.target.closest('[data-tag]')?.dataset.tag;
  if (!tag) return;
  const input=Array.from(el('tag-options').querySelectorAll('input')).find((node)=>node.value===tag);
  if (!input) return;
  setTab('place');
  setExplore(true);
  setFilterForm(true);
  el('tag-filters').open=true;
  input.checked=!input.checked;
  applyFilters();
  input.focus({preventScroll:true});
};
el('district-list').onclick=(event)=>{
  const id=event.target.closest('[data-district]')?.dataset.district;
  const district=districtRecords.find((item)=>String(item.id)===id);
  if (!district) return;
  setExplore(false,'explore');
  viewer?.goToDistrict(district.center);
};
el('city-overview').onclick=el('inset-whole').onclick=wholeCity;
el('brand').onclick=el('reset-view').onclick=returnToCentre;
el('zoom-in').onclick=()=>viewer?.zoomBy(1.31);
el('zoom-out').onclick=()=>viewer?.zoomBy(1/1.31);
el('overview-toggle').onclick=()=>{
  const opening=!isOpen(el('overview-panel'));
  if (opening) setExplore(false);
  setOverview(opening);
  viewer?.requestDraw();
};
el('close-overview').onclick=()=>setOverview(false,true);
el('inset-picture').onclick=(event)=>{
  if (!event.detail) {
    wholeCity();
    return;
  }
  const bounds=el('inset-picture').getBoundingClientRect();
  dismissPlace(false);
  viewer?.goFromInset((event.clientX-bounds.x)/bounds.width,(event.clientY-bounds.y)/bounds.height);
  setOverview(false,true);
};
el('motion-toggle').onclick=()=>{
  ambientPreference=!ambientOn();
  try { localStorage.setItem(preferenceKey,ambientPreference ? 'on' : 'off'); }
  catch { /* The current session still uses the chosen state. */ }
  updateAmbient();
};
reduced.addEventListener('change',updateAmbient);
el('share-map').onclick=()=>share(true);
el('about-button').onclick=()=>el('about').showModal();
el('map-input').addEventListener('pointerdown',()=>{
  setExplore(false);
  setOverview(false);
});
document.addEventListener('keydown',(event)=>{
  if (event.key==='/' && !event.ctrlKey && !event.metaKey && !event.target.closest('input, textarea, select, dialog') &&
    !document.querySelector('dialog[open]')) {
    event.preventDefault();
    setTab('place');
    setExplore(true,'query');
    return;
  }
  if (event.key!=='Escape' || document.querySelector('dialog[open]')) return;
  if (isOpen(el('overview-panel'))) setOverview(false,true);
  else if (selected) dismissPlace();
  else if (isOpen(el('filters'))) {
    setFilterForm(false);
    el('filter-button').focus();
  } else if (isOpen(el('explore-panel'))) setExplore(false,'explore');
});

refreshIndex();
try {
  const [mapViewer,districtData]=await Promise.all([
    setupViewer(el('map-art'),el('map-input'),{onFrame:positionFrame,onChange:updateLocation,onResize:revealSelected,onLifeState:(state)=>{
      ambientState=state;
      updateAmbientNote();
    }}),
    fetch(new URL('../map/districts.json',import.meta.url)).then((response)=>{
      if (!response.ok) throw new Error('The district list is unavailable.');
      return response.json();
    }),
  ]);
  viewer=mapViewer;
  updateAmbient();
  setDistricts(districtData.districts);
  el('map-message').hidden=true;
  window.addEventListener('popstate',restoreRoute);
  restoreRoute();
} catch (error) {
  console.error(error);
  el('map-message').textContent='Map artwork could not load. The place index is available.';
}
