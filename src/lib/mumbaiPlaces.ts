export type MumbaiPlace = {
  name: string;
  area: string;
  lat: number;
  lon: number;
};

/**
 * Local Mumbai-area search index used during the test phase.
 *
 * This keeps autocomplete fast and avoids sending a geocoding request on
 * every keystroke. Device geolocation is still global and uses the user's
 * exact coordinates anywhere in the world.
 */
export const MUMBAI_PLACES: MumbaiPlace[] = [
  { name: "Mumbai", area: "Mumbai", lat: 18.9388, lon: 72.8354 },
  { name: "Colaba", area: "South Mumbai", lat: 18.9067, lon: 72.8147 },
  { name: "Cuffe Parade", area: "South Mumbai", lat: 18.9146, lon: 72.8202 },
  { name: "Fort", area: "South Mumbai", lat: 18.9339, lon: 72.8356 },
  { name: "Churchgate", area: "South Mumbai", lat: 18.9322, lon: 72.8264 },
  { name: "Marine Lines", area: "South Mumbai", lat: 18.9442, lon: 72.8237 },
  { name: "Marine Drive", area: "South Mumbai", lat: 18.9430, lon: 72.8238 },
  { name: "Nariman Point", area: "South Mumbai", lat: 18.9256, lon: 72.8242 },
  { name: "Girgaon", area: "South Mumbai", lat: 18.9543, lon: 72.8179 },
  { name: "Charni Road", area: "South Mumbai", lat: 18.9519, lon: 72.8185 },
  { name: "Malabar Hill", area: "South Mumbai", lat: 18.9548, lon: 72.7985 },
  { name: "Walkeshwar", area: "South Mumbai", lat: 18.9538, lon: 72.7977 },
  { name: "Tardeo", area: "South Mumbai", lat: 18.9676, lon: 72.8141 },
  { name: "Mahalaxmi", area: "South Mumbai", lat: 18.9826, lon: 72.8240 },
  { name: "Byculla", area: "South Mumbai", lat: 18.9777, lon: 72.8354 },
  { name: "Mazgaon", area: "South Mumbai", lat: 18.9686, lon: 72.8426 },
  { name: "Parel", area: "Central Mumbai", lat: 18.9977, lon: 72.8376 },
  { name: "Lower Parel", area: "Central Mumbai", lat: 18.9988, lon: 72.8258 },
  { name: "Worli", area: "Central Mumbai", lat: 19.0178, lon: 72.8170 },
  { name: "Prabhadevi", area: "Central Mumbai", lat: 19.0169, lon: 72.8296 },
  { name: "Dadar West", area: "Central Mumbai", lat: 19.0180, lon: 72.8420 },
  { name: "Dadar East", area: "Central Mumbai", lat: 19.0188, lon: 72.8478 },
  { name: "Matunga West", area: "Central Mumbai", lat: 19.0270, lon: 72.8424 },
  { name: "Matunga East", area: "Central Mumbai", lat: 19.0273, lon: 72.8553 },
  { name: "Mahim West", area: "Western Mumbai", lat: 19.0419, lon: 72.8408 },
  { name: "Mahim East", area: "Central Mumbai", lat: 19.0433, lon: 72.8500 },
  { name: "Sion", area: "Central Mumbai", lat: 19.0434, lon: 72.8619 },
  { name: "Wadala", area: "Central Mumbai", lat: 19.0170, lon: 72.8582 },
  { name: "Sewri", area: "Central Mumbai", lat: 19.0004, lon: 72.8593 },
  { name: "Antop Hill", area: "Central Mumbai", lat: 19.0264, lon: 72.8664 },
  { name: "Bandra West", area: "Western Suburbs", lat: 19.0607, lon: 72.8362 },
  { name: "Bandra East", area: "Western Suburbs", lat: 19.0596, lon: 72.8464 },
  { name: "Khar West", area: "Western Suburbs", lat: 19.0726, lon: 72.8375 },
  { name: "Khar East", area: "Western Suburbs", lat: 19.0714, lon: 72.8501 },
  { name: "Santacruz West", area: "Western Suburbs", lat: 19.0811, lon: 72.8374 },
  { name: "Santacruz East", area: "Western Suburbs", lat: 19.0817, lon: 72.8533 },
  { name: "Vile Parle West", area: "Western Suburbs", lat: 19.0991, lon: 72.8423 },
  { name: "Vile Parle East", area: "Western Suburbs", lat: 19.0990, lon: 72.8538 },
  { name: "Juhu", area: "Western Suburbs", lat: 19.1075, lon: 72.8263 },
  { name: "Andheri West", area: "Western Suburbs", lat: 19.1364, lon: 72.8296 },
  { name: "Andheri East", area: "Western Suburbs", lat: 19.1197, lon: 72.8468 },
  { name: "Versova", area: "Western Suburbs", lat: 19.1310, lon: 72.8130 },
  { name: "Lokhandwala Complex", area: "Andheri West", lat: 19.1438, lon: 72.8247 },
  { name: "Oshiwara", area: "Western Suburbs", lat: 19.1510, lon: 72.8341 },
  { name: "Jogeshwari West", area: "Western Suburbs", lat: 19.1439, lon: 72.8428 },
  { name: "Jogeshwari East", area: "Western Suburbs", lat: 19.1349, lon: 72.8640 },
  { name: "Goregaon West", area: "Western Suburbs", lat: 19.1663, lon: 72.8526 },
  { name: "Goregaon East", area: "Western Suburbs", lat: 19.1695, lon: 72.8693 },
  { name: "Aarey Colony", area: "Goregaon East", lat: 19.1551, lon: 72.8848 },
  { name: "Malad West", area: "Western Suburbs", lat: 19.1860, lon: 72.8410 },
  { name: "Malad East", area: "Western Suburbs", lat: 19.1862, lon: 72.8579 },
  { name: "Kandivali West", area: "Western Suburbs", lat: 19.2055, lon: 72.8387 },
  { name: "Kandivali East", area: "Western Suburbs", lat: 19.2058, lon: 72.8706 },
  { name: "Borivali West", area: "Western Suburbs", lat: 19.2307, lon: 72.8567 },
  { name: "Borivali East", area: "Western Suburbs", lat: 19.2291, lon: 72.8668 },
  { name: "Dahisar West", area: "Western Suburbs", lat: 19.2497, lon: 72.8530 },
  { name: "Dahisar East", area: "Western Suburbs", lat: 19.2507, lon: 72.8664 },
  { name: "Mira Road", area: "Mumbai Metropolitan Region", lat: 19.2812, lon: 72.8744 },
  { name: "Kurla West", area: "Eastern Suburbs", lat: 19.0726, lon: 72.8795 },
  { name: "Kurla East", area: "Eastern Suburbs", lat: 19.0656, lon: 72.8863 },
  { name: "Chembur", area: "Eastern Suburbs", lat: 19.0522, lon: 72.9005 },
  { name: "Tilak Nagar", area: "Chembur", lat: 19.0688, lon: 72.8954 },
  { name: "Govandi", area: "Eastern Suburbs", lat: 19.0552, lon: 72.9150 },
  { name: "Mankhurd", area: "Eastern Suburbs", lat: 19.0485, lon: 72.9322 },
  { name: "Deonar", area: "Eastern Suburbs", lat: 19.0480, lon: 72.9077 },
  { name: "Ghatkopar West", area: "Eastern Suburbs", lat: 19.0866, lon: 72.9081 },
  { name: "Ghatkopar East", area: "Eastern Suburbs", lat: 19.0790, lon: 72.9080 },
  { name: "Vidyavihar", area: "Eastern Suburbs", lat: 19.0797, lon: 72.8973 },
  { name: "Vikhroli West", area: "Eastern Suburbs", lat: 19.1110, lon: 72.9250 },
  { name: "Vikhroli East", area: "Eastern Suburbs", lat: 19.1117, lon: 72.9350 },
  { name: "Powai", area: "Eastern Suburbs", lat: 19.1176, lon: 72.9060 },
  { name: "Chandivali", area: "Powai / Andheri East", lat: 19.1105, lon: 72.9005 },
  { name: "Kanjurmarg West", area: "Eastern Suburbs", lat: 19.1280, lon: 72.9230 },
  { name: "Kanjurmarg East", area: "Eastern Suburbs", lat: 19.1290, lon: 72.9370 },
  { name: "Bhandup West", area: "Eastern Suburbs", lat: 19.1439, lon: 72.9356 },
  { name: "Bhandup East", area: "Eastern Suburbs", lat: 19.1462, lon: 72.9464 },
  { name: "Nahur West", area: "Eastern Suburbs", lat: 19.1548, lon: 72.9368 },
  { name: "Nahur East", area: "Eastern Suburbs", lat: 19.1555, lon: 72.9474 },
  { name: "Mulund West", area: "Eastern Suburbs", lat: 19.1726, lon: 72.9425 },
  { name: "Mulund East", area: "Eastern Suburbs", lat: 19.1690, lon: 72.9602 },
  { name: "Mulund Colony", area: "Mulund West", lat: 19.1761, lon: 72.9510 },
  { name: "Saki Naka", area: "Andheri East", lat: 19.1030, lon: 72.8870 },
  { name: "Marol", area: "Andheri East", lat: 19.1162, lon: 72.8805 },
  { name: "MIDC Andheri", area: "Andheri East", lat: 19.1194, lon: 72.8722 },
  { name: "BKC", area: "Bandra East", lat: 19.0676, lon: 72.8697 },
  { name: "Kalina", area: "Santacruz East", lat: 19.0745, lon: 72.8687 },
  { name: "Vakola", area: "Santacruz East", lat: 19.0810, lon: 72.8623 }
];

export function searchMumbaiPlaces(query: string, limit = 8): MumbaiPlace[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [];

  const terms = normalized.split(/\s+/).filter(Boolean);

  return MUMBAI_PLACES
    .map((place) => {
      const haystack = `${place.name} ${place.area} Mumbai`.toLowerCase();

      const matchesAll = terms.every((term) => haystack.includes(term));
      if (!matchesAll) return null;

      let score = 0;
      const name = place.name.toLowerCase();
      const area = place.area.toLowerCase();

      if (name === normalized) score += 100;
      if (name.startsWith(normalized)) score += 50;
      if (name.includes(normalized)) score += 25;
      if (area.startsWith(normalized)) score += 15;
      if (area.includes(normalized)) score += 8;

      return { place, score };
    })
    .filter((item): item is { place: MumbaiPlace; score: number } => item !== null)
    .sort((a, b) => b.score - a.score || a.place.name.localeCompare(b.place.name))
    .slice(0, limit)
    .map((item) => item.place);
}

export function findMumbaiPlace(name: string): MumbaiPlace | undefined {
  const normalized = name.trim().toLowerCase();
  return MUMBAI_PLACES.find((place) => place.name.toLowerCase() === normalized);
}
