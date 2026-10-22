// Domains accepted as authoritative sources: statistics offices, international
// agencies, space/earth science agencies, major surveys and peer-reviewed
// publishers. Anything else (brands, news, aggregators) fails validation.
export const AUTHORITATIVE_DOMAINS = [
  // International agencies
  'worldbank.org', 'europa.eu', 'fao.org', 'who.int', 'itu.int', 'unep.org', 'oecd.org',
  'un.org', 'unesco.org', 'unicef.org', 'ilo.org', 'unwto.org', 'iea.org', 'wmo.int',
  'undp.org', 'unhcr.org', 'imf.org', 'unstats.un.org', 'ipcc.ch', 'cbd.int', 'iucn.org',
  'iucnredlist.org', 'irena.org', 'wto.org', 'wipo.int', 'paho.org', 'olympics.com',
  // Space and earth science
  'nasa.gov', 'usgs.gov', 'noaa.gov', 'esa.int', 'jpl.nasa.gov', 'copernicus.eu',
  // National statistics offices and government statistics
  'istat.it', 'ons.gov.uk', 'gov.uk', 'census.gov', 'bls.gov', 'ine.es', 'insee.fr',
  'destatis.de', 'stat.go.jp', 'e-stat.go.jp', 'abs.gov.au', 'statcan.gc.ca', 'cbs.nl',
  'scb.se', 'ssb.no', 'stats.govt.nz', 'ibge.gov.br', 'inegi.org.mx', 'cso.ie', 'dst.dk',
  'stat.fi', 'statistik.at', 'bfs.admin.ch', 'admin.ch', 'ine.pt', 'statbel.fgov.be',
  'stat.gov.pl', 'ksh.hu', 'czso.cz', 'statistics.gov.hk', 'singstat.gov.sg', 'kostat.go.kr',
  'stats.gov.cn', 'mospi.gov.in', 'statssa.gov.za', 'indec.gob.ar', 'ine.cl', 'dane.gov.co',
  'hagstofa.is', 'stat.ee', 'csb.gov.lv', 'stat.gov.lt', 'nisra.gov.uk', 'gov.scot',
  'nrscotland.gov.uk', 'cdc.gov', 'nih.gov', 'usda.gov', 'nces.ed.gov', 'ed.gov', 'nsf.gov',
  'eia.gov', 'epa.gov', 'fws.gov', 'nps.gov', 'transportation.gov', 'bts.gov', 'fhwa.dot.gov',
  'nhtsa.gov', 'fcc.gov', 'ntia.gov', 'si.edu', 'loc.gov', 'archives.gov', 'aihw.gov.au',
  'canada.ca', 'nhs.uk', 'ukri.org', 'metoffice.gov.uk', 'bom.gov.au', 'ign.es', 'mapa.gob.es',
  'bundesbank.de', 'bancaditalia.it', 'ecb.europa.eu', 'federalreserve.gov', 'bankofengland.co.uk',
  'boj.or.jp', 'sport.ec.europa.eu', 'sportengland.org', 'insee.fr', 'ined.fr', 'cnrs.fr',
  // Major surveys
  'gallup.com', 'pewresearch.org', 'eurofound.europa.eu',
  // Peer-reviewed publishers and indexes
  'doi.org', 'nature.com', 'science.org', 'plos.org', 'pnas.org', 'cell.com', 'thelancet.com',
  'bmj.com', 'jamanetwork.com', 'nejm.org', 'wiley.com', 'springer.com', 'sciencedirect.com',
  'royalsocietypublishing.org', 'frontiersin.org', 'mdpi.com', 'oup.com', 'academic.oup.com',
  'tandfonline.com', 'biorxiv.org', 'iop.org', 'iopscience.iop.org', 'aanda.org', 'agu.org',
  'elifesciences.org', 'peerj.com', 'cambridge.org', 'sagepub.com', 'pubs.acs.org', 'acs.org',
  'ncbi.nlm.nih.gov', 'pmc.ncbi.nlm.nih.gov', 'pubmed.ncbi.nlm.nih.gov', 'biomedcentral.com',
  'annualreviews.org', 'esajournals.onlinelibrary.wiley.com', 'journals.uchicago.edu',
];

export function isAuthoritativeUrl(url) {
  let host;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return AUTHORITATIVE_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
}
