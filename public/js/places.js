export const categories = [
  { id: 'food', name: 'Food & Coffee', icon: 'coffee', color: '#9b5839' },
  { id: 'night', name: 'Bars & Nightlife', icon: 'night', color: '#77527e' },
  { id: 'work', name: 'Cowork & Study', fullName: 'Coworking & Study', icon: 'work', color: '#3d687b' },
  { id: 'culture', name: 'Culture', fullName: 'Culture & Experiences', icon: 'landmark', color: '#b35235' },
  { id: 'sports', name: 'Sports & Wellness', icon: 'sport', color: '#477454' },
  { id: 'community', name: 'Communities & Events', icon: 'people', color: '#806725' },
  { id: 'essentials', name: 'Expat Essentials', icon: 'compass', color: '#33594e' },
];

export const verification = {
  confirmed: { name: 'English confirmed', description: 'A source confirms a specific English-language offering.' },
  reported: { name: 'Community reported', description: 'A community report describes English service.' },
  unverified: { name: 'Not verified', description: 'English-language availability is unverified.' },
};

const checked = '2026-11-15';
const status = (note, source, kind = 'confirmed') => ({ kind, note, source, checked });
const unverified = { kind: 'unverified' };
const dov = 'https://www.dolnivitkovice.cz/en/dolni-vitkovice-en/';
const tours = 'https://www.visitostrava.eu/en/discover-ostrava/guiding-services/choose-your-adventure/874-city-centre.html';

export const places = [
  {
    id: 'bolt-tower', name: 'Dolní Vítkovice', subtitle: 'Lower Vítkovice · Bolt Tower',
    coordinates: [18.276676, 49.819391], osm: 'node/2495938893', address: 'Ruská 2993, Ostrava–Vítkovice',
    categories: ['culture'], tags: ['Industrial heritage', 'English tours', 'Viewpoint'],
    description: 'Climb above a former blast furnace at Ostrava’s landmark ironworks. The Bolt Tower’s spiral walkway looks out across the steelworks and the city.',
    website: dov, infoSource: 'https://www.visitostrava.eu/en/discover-ostrava/museums-and-attractions/8520-bolt-tower.html',
    english: status('Printed English tour texts are available. English-speaking guides can be arranged in advance for groups of 10 or more.', dov),
    image: 'map/ironworks.png', label: 'Dolní Vítkovice', priority: 10,
  },
  {
    id: 'expat-centre', name: 'Ostrava Expat Centre', subtitle: 'City centre',
    coordinates: [18.288176, 49.835438], osm: 'node/13371642101', address: 'Tyršova 1683/20, Moravská Ostrava',
    categories: ['essentials', 'community'], tags: ['Newcomer essential', 'Czech courses'],
    description: 'A first stop for settling into Ostrava. The centre offers newcomer consultations, Czech language classes and opportunities to meet other international residents.',
    website: 'https://ostravaexpat.eu/', infoSource: 'https://ostravaexpat.eu/get-in-touch/',
    english: status('The centre provides English-language guidance and offers consultations to international residents.', 'https://ostravaexpat.eu/'),
    priority: 10,
  },
  {
    id: 'plato', name: 'PLATO Ostrava', subtitle: 'Former municipal slaughterhouse',
    coordinates: [18.280962, 49.835814], osm: 'node/11112924342', address: 'Porážková 26, Moravská Ostrava',
    categories: ['culture'], tags: ['Contemporary art', 'English tours'],
    description: 'Contemporary art in Ostrava’s restored municipal slaughterhouse, with exhibitions and an adjoining permaculture garden.',
    website: 'https://plato-ostrava.cz/en/', infoSource: 'https://www.visitostrava.eu/en/discover-ostrava/sights-and-architecture/152-plato-ostrava.html',
    english: status('PLATO explicitly offers this guided programme for secondary schools in English. Check the listings for the language of other events.', 'https://plato-ostrava.cz/en/Prostor/Pro-Skoly/Stredni/Komentovana-Prohlidka-Pro-SS'),
    priority: 8,
  },
  {
    id: 'cokafe-centrum', name: 'CØKAFE Centrum', subtitle: 'Nádražní',
    coordinates: [18.286182, 49.836706], osm: 'node/6312678203', address: 'Nádražní 1266/26, Moravská Ostrava',
    categories: ['food'], tags: ['Coffee'], description: 'The city-centre branch of an Ostrava coffee roaster, just off Stodolní on Nádražní.',
    website: 'https://cokafe.com/kontakt/', english: unverified, priority: 6,
  },
  {
    id: 'impact-hub', name: 'Impact Hub Ostrava', subtitle: 'Sokolská třída',
    coordinates: [18.292299, 49.839329], osm: 'node/5127034085', address: 'Sokolská třída 1263/24, Moravská Ostrava',
    categories: ['work', 'community'], tags: ['Day passes', 'Laptop friendly', 'Coworking'],
    description: 'A central coworking space with day passes, meeting rooms and a programme of networking events.',
    website: 'https://www.impacthub.cz/en/ostrava/', english: unverified, priority: 7,
  },
  {
    id: 'dock', name: 'Dock', subtitle: 'Ostravice riverfront',
    coordinates: [18.296065, 49.836532], osm: 'node/3993267006', address: 'Havlíčkovo nábřeží 28, Moravská Ostrava',
    categories: ['night', 'food'], tags: ['Coffee', 'Riverfront'],
    description: 'A riverside café and bistro by day, with a bar and occasional cultural events in the evening.',
    website: 'https://www.clubdock.cz/', english: unverified, priority: 8,
  },
  {
    id: 'new-city-hall', name: 'New City Hall', subtitle: 'Nová radnice · Viewing tower',
    coordinates: [18.291693, 49.841729], osm: 'node/10314515115', address: 'Prokešovo náměstí 1803/8, Moravská Ostrava',
    categories: ['culture', 'essentials'], tags: ['Viewpoint', 'Visitor information'],
    description: 'The landmark tower at New City Hall has panoramic views and a tourist information office on the sixth floor.',
    website: 'https://www.visitostrava.eu/en/information/tourist-information-offices/8566-new-city-hall-viewing-tower.html',
    english: unverified, label: 'New City Hall', priority: 9,
  },
  {
    id: 'komenskeho-sady', name: 'Komenského sady', subtitle: 'Ostravice riverfront',
    coordinates: [18.290906, 49.844934], osm: 'way/37937446', address: 'Komenského sady, Moravská Ostrava',
    categories: ['sports'], tags: ['Public park', 'Riverfront'],
    description: 'A large riverside park behind New City Hall, with a lime-tree avenue, paths for walks and rides, and open space for a picnic.',
    website: 'https://www.visitostrava.eu/cz/objevuj-ostravu/pamatky-a-architektura/423-komenskeho-sady.html',
    english: unverified, label: 'Komenského sady', priority: 8,
  },
  {
    id: 'masaryk-square', name: 'Masaryk Square', subtitle: 'Masarykovo náměstí · Historic centre',
    coordinates: [18.292126, 49.835366], osm: 'node/5654655891', address: 'Masarykovo náměstí, Moravská Ostrava',
    categories: ['culture'], tags: ['Public square', 'Architecture'],
    description: 'The historic city square is lined by cafés and the Old Town Hall, now home to the Ostrava Museum.',
    website: tours, infoSource: 'https://www.visitostrava.eu/soubory_texty/556_3-pruvodce-en-2022-pdf.pdf',
    english: unverified, image: 'map/city-centre.png', label: 'Masaryk Square', priority: 10,
  },
  {
    id: 'stodolni', name: 'Stodolní Street', subtitle: 'City centre',
    coordinates: [18.284765, 49.835760], osm: 'way/24923031', address: 'Stodolní, Moravská Ostrava',
    categories: ['night'], tags: ['Nightlife district'],
    description: 'Ostrava’s nightlife street. Follow it west from Nádražní to find a concentration of bars, clubs and restaurants.',
    website: 'https://ostrava.cz/cs/turista/prezentace/prezentacni-materialy/prezentacni-materialy/OSTRAVAskldakaCZpress.pdf',
    english: unverified, label: 'Stodolní Street', priority: 8,
  },
  {
    id: 'nova-karolina', name: 'Forum Nová Karolina', subtitle: 'Karolina',
    coordinates: [18.285126, 49.830783], osm: 'way/98290906', address: 'Jantarová 3344/4, Moravská Ostrava',
    categories: ['essentials'], tags: ['Shopping centre'],
    description: 'A large shopping centre on the former Karolina industrial site, close to the Karolina tram stop and Trojhalí.',
    website: 'https://www.forumnovakarolina.cz/', english: unverified, label: 'Nová Karolina', priority: 7,
  },
  {
    id: 'trojhali', name: 'Trojhalí Karolina', subtitle: 'Karolina',
    coordinates: [18.286654, 49.828734], osm: 'way/48214517', address: 'K Trojhalí 3361/5, Moravská Ostrava',
    categories: ['sports', 'community'], tags: ['Indoor courts', 'Industrial heritage'],
    description: 'Former industrial halls repurposed as a covered public square and sports venue. The sports hall has a separate reception.',
    website: 'https://trojhali.cz/en/contact.html', english: unverified,
  },
  {
    id: 'house-of-art', name: 'House of Art', subtitle: 'Dům umění',
    coordinates: [18.286783, 49.834056], osm: 'node/4583691449', address: 'Jurečkova 1750/9, Moravská Ostrava',
    categories: ['culture'], tags: ['Art gallery', 'Architecture'],
    description: 'An interwar exhibition pavilion housing the Gallery of Fine Arts in Ostrava, with a rotating programme of shows.',
    website: 'https://www.gvuo.cz/en/about-us', infoSource: 'https://www.gvuo.cz/en/contacts', english: unverified,
  },
  {
    id: 'science-centre', name: 'Science and Technology Centre', subtitle: 'Velký svět techniky · Lower Vítkovice',
    coordinates: [18.2829995, 49.819554], osm: 'way/78540988', address: 'Lower Vítkovice, Ostrava–Vítkovice',
    categories: ['culture'], tags: ['Hands-on exhibits', 'Student friendly'],
    description: 'An interactive science museum in Lower Vítkovice. The centre publishes student concessions for its exhibitions.',
    website: 'https://www.dolnivitkovice.cz/en/science-and-technology-centre/tickets/', english: unverified,
  },
  {
    id: 'gong', name: 'Gong', subtitle: 'Lower Vítkovice',
    coordinates: [18.279576, 49.819102], osm: 'way/78540797', address: 'Lower Vítkovice, Ostrava–Vítkovice',
    categories: ['culture', 'community'], tags: ['Industrial heritage', 'Events venue'],
    description: 'A former gas holder converted to a concert, exhibition and conference venue at the ironworks.',
    website: 'https://www.dolnivitkovice.cz/en/', english: unverified,
  },
  {
    id: 'silesian-castle', name: 'Silesian Ostrava Castle', subtitle: 'Slezskoostravský hrad',
    coordinates: [18.299333, 49.830528], osm: 'way/52131377', address: 'Hradní, Slezská Ostrava',
    categories: ['culture'], tags: ['Architecture', 'Events venue'],
    description: 'A restored castle on the Silesian side of the Ostravice, a short walk from the city centre via the castle footbridge.',
    website: 'https://www.cerna-louka.cz/slezskoostravskyhrad/o-hradu/', english: unverified, priority: 7,
  },
];

