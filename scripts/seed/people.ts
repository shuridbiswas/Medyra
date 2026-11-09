/**
 * The 50 fictional Quebec members. Names, roles and cities are hand-picked; everything else about
 * a member (headline, bio, schooling, jobs, tags) is derived in plan.ts from the tables here.
 * Real institutions appear only as academic or geographic context.
 */

export type Lang = "fr" | "en";
export type Role = "ug" | "gr" | "rg" | "hp" | "sp" | "ed" | "rs" | "ind";
export type City =
  | "Montréal" | "Laval" | "Longueuil" | "Châteauguay" | "Brossard" | "Terrebonne"
  | "Repentigny" | "Saint-Jérôme" | "Vaudreuil-Dorion" | "Sherbrooke" | "Québec";

export type Person = {
  slug: string;
  first: string;
  last: string;
  lang: Lang;
  /** Grammatical gender used only for French agreement in the fictional text. */
  g: "f" | "m";
  city: City;
  role: Role;
  field: string;
  /** For field "other": nutri, resp, lab, ra, bio. */
  sub?: string;
  stage?: "early_career" | "mid_career" | "senior";
  /** m mentor, s seeker, i incomplete, h heavy poster, q quiet, l long name, e empty bio, a also studying, n no headline */
  flags: string;
};

const P = (
  slug: string, first: string, last: string, lang: Lang, g: "f" | "m", city: City, role: Role,
  field: string, flags = "", sub?: string, stage?: Person["stage"],
): Person => ({ slug, first, last, lang, g, city, role, field, flags, sub, stage });

const BASE: Person[] = [
  // Montréal (22)
  P("camille_lavoie", "Camille", "Lavoie", "fr", "f", "Montréal", "gr", "nursing", "hsa"),
  P("amira_benali", "Amira", "Benali", "fr", "f", "Montréal", "ug", "psychology", "s"),
  P("jean_baptiste_louis", "Jean-Baptiste", "Louis", "fr", "m", "Montréal", "ug", "social_work", "s"),
  P("sofia_ramirez", "Sofía", "Ramírez", "en", "f", "Montréal", "gr", "psychology", "s"),
  P("mei_ling_chan", "Mei-Ling", "Chan", "en", "f", "Montréal", "gr", "public_health"),
  P("daniel_cohen", "Daniel", "Cohen", "en", "m", "Montréal", "ug", "medicine", "s"),
  P("fatima_zahra_idrissi", "Fatima-Zahra", "Idrissi", "fr", "f", "Montréal", "hp", "nursing", "m", undefined, "mid_career"),
  P("nadine_pierre", "Nadine", "Pierre", "en", "f", "Montréal", "sp", "social_work", "m", undefined, "mid_career"),
  P("olivier_gagnon", "Olivier", "Gagnon", "fr", "m", "Montréal", "hp", "pharmacy", "a", undefined, "early_career"),
  P("priyanka_nair", "Priyanka", "Nair", "en", "f", "Montréal", "hp", "physiotherapy", "", undefined, "early_career"),
  P("andre_tremblay", "André", "Tremblay", "fr", "m", "Montréal", "ed", "nursing", "m", undefined, "senior"),
  P("sarah_mitchell", "Sarah", "Mitchell", "en", "f", "Montréal", "rs", "psychology", "m", undefined, "mid_career"),
  P("hugo_bouchard", "Hugo", "Bouchard", "fr", "m", "Montréal", "rs", "public_health", "", undefined, "early_career"),
  P("yasmine_haddad", "Yasmine", "Haddad", "en", "f", "Montréal", "ind", "psychology", "m", undefined, "mid_career"),
  P("kevin_nguyen", "Kevin", "Nguyen", "en", "m", "Montréal", "ug", "pharmacy", "q"),
  P("lucia_fernandez", "Lucía", "Fernández", "en", "f", "Montréal", "gr", "occupational_therapy", "s"),
  P("marie_eve_st_pierre", "Marie-Ève", "St-Pierre", "fr", "f", "Montréal", "hp", "nursing", "", undefined, "early_career"),
  P("tariq_ahmed", "Tariq", "Ahmed", "en", "m", "Montréal", "hp", "other", "", "resp", "early_career"),
  P("maria_guadalupe_h", "María Guadalupe de los Ángeles", "Hernández-Villeneuve", "fr", "f", "Montréal", "ed", "psychology", "ml", undefined, "senior"),
  P("ethan_goldberg", "Ethan", "Goldberg", "en", "m", "Montréal", "ug", "nursing", "qe"),
  P("chloe_dubois", "Chloé", "Dubois", "fr", "f", "Montréal", "ug", "other", "i", "nutri"),
  P("samuel_roy", "Samuel", "Roy", "fr", "m", "Montréal", "rs", "other", "", "ra", "mid_career"),
  // Laval (6)
  P("isabelle_cote", "Isabelle", "Côté", "fr", "f", "Laval", "hp", "nursing", "a", undefined, "mid_career"),
  P("mohamed_amine_trabelsi", "Mohamed-Amine", "Trabelsi", "fr", "m", "Laval", "gr", "audiology"),
  P("anais_lapointe", "Anaïs", "Lapointe", "fr", "f", "Laval", "ug", "nursing"),
  P("jonathan_levesque", "Jonathan", "Lévesque", "fr", "m", "Laval", "ind", "physiotherapy", "", undefined, "mid_career"),
  P("stephanie_morin", "Stéphanie", "Morin", "fr", "f", "Laval", "rs", "nursing", "m", undefined, "mid_career"),
  P("raymond_fortin", "Raymond", "Fortin", "fr", "m", "Laval", "ed", "pharmacy", "n", undefined, "senior"),
  // Longueuil (5)
  P("mathieu_belanger", "Mathieu", "Bélanger", "fr", "m", "Longueuil", "ug", "physiotherapy", "s"),
  P("nathalie_pelletier", "Nathalie", "Pelletier", "fr", "f", "Longueuil", "hp", "psychology", "a", undefined, "mid_career"),
  P("dominique_gauthier", "Dominique", "Gauthier", "fr", "f", "Longueuil", "ind", "social_work", "", undefined, "senior"),
  P("aisha_diallo", "Aisha", "Diallo", "fr", "f", "Longueuil", "rg", "nursing", "sq"),
  P("vincent_leclerc", "Vincent", "Leclerc", "fr", "m", "Longueuil", "gr", "social_work", "s"),
  // Châteauguay (3)
  P("genevieve_fournier", "Geneviève", "Fournier", "fr", "f", "Châteauguay", "hp", "occupational_therapy", "", undefined, "mid_career"),
  P("pascal_bergeron", "Pascal", "Bergeron", "fr", "m", "Châteauguay", "hp", "pharmacy", "i"),
  P("elise_archambault", "Élise", "Archambault", "fr", "f", "Châteauguay", "ug", "psychology"),
  // Brossard (3)
  P("wei_zhang", "Wei", "Zhang", "en", "m", "Brossard", "gr", "other", "q", "bio"),
  P("laurence_simard", "Laurence", "Simard", "fr", "f", "Brossard", "rg", "physiotherapy", "s"),
  P("karim_bensalem", "Karim", "Bensalem", "en", "m", "Brossard", "hp", "nursing", "", undefined, "early_career"),
  // Terrebonne (2)
  P("josee_charbonneau", "Josée", "Charbonneau", "fr", "f", "Terrebonne", "sp", "social_work", "", undefined, "mid_career"),
  P("alexis_martel", "Alexis", "Martel", "fr", "m", "Terrebonne", "ug", "nursing", "i"),
  // Repentigny (2)
  P("catherine_lachance", "Catherine", "Lachance", "fr", "f", "Repentigny", "hp", "speech_language_pathology", "", undefined, "early_career"),
  P("simon_desrosiers", "Simon", "Desrosiers", "en", "m", "Repentigny", "rs", "medicine", "", undefined, "mid_career"),
  // Saint-Jérôme (2)
  P("melodie_paquette", "Mélodie", "Paquette", "fr", "f", "Saint-Jérôme", "ug", "social_work", "i"),
  P("yannick_ouellet", "Yannick", "Ouellet", "fr", "m", "Saint-Jérôme", "hp", "other", "q", "lab", "early_career"),
  // Vaudreuil-Dorion (2)
  P("emily_thompson", "Emily", "Thompson", "en", "f", "Vaudreuil-Dorion", "hp", "nursing", "", undefined, "mid_career"),
  P("rosalie_tessier", "Rosalie", "Tessier", "fr", "f", "Vaudreuil-Dorion", "ind", "occupational_therapy", "", undefined, "mid_career"),
  // Sherbrooke (1)
  P("gabriel_poirier", "Gabriel", "Poirier", "fr", "m", "Sherbrooke", "ed", "physiotherapy", "", undefined, "senior"),
  // Québec (2)
  P("sophie_gagnon", "Sophie", "Gagnon", "fr", "f", "Québec", "ed", "social_work", "", undefined, "senior"),
  P("tanya_picard", "Tanya", "Picard", "en", "f", "Québec", "ind", "other", "", "nutri", "mid_career"),
];

const MORE: Person[] = [
  // Montréal (+28)
  P("lina_bouzid", "Lina", "Bouzid", "fr", "f", "Montréal", "ug", "psychology"),
  P("mathis_rousseau", "Mathis", "Rousseau", "fr", "m", "Montréal", "ug", "medicine", "s"),
  P("nour_el_amin", "Nour", "El-Amin", "en", "f", "Montréal", "gr", "public_health"),
  P("emmanuel_joseph", "Emmanuel", "Joseph", "fr", "m", "Montréal", "ug", "nursing", "s"),
  P("valentina_rojas", "Valentina", "Rojas", "fr", "f", "Montréal", "gr", "speech_language_pathology"),
  P("jason_li", "Jason", "Li", "en", "m", "Montréal", "ug", "pharmacy"),
  P("sabrina_cormier", "Sabrina", "Cormier", "fr", "f", "Montréal", "hp", "nursing", "", undefined, "early_career"),
  P("rachid_mansouri", "Rachid", "Mansouri", "fr", "m", "Montréal", "hp", "pharmacy", "m", undefined, "mid_career"),
  P("clara_beaulieu", "Clara", "Beaulieu", "fr", "f", "Montréal", "hp", "occupational_therapy", "", undefined, "early_career"),
  P("david_azoulay", "David", "Azoulay", "en", "m", "Montréal", "hp", "physiotherapy", "", undefined, "mid_career"),
  P("ghislaine_noel", "Ghislaine", "Noël", "fr", "f", "Montréal", "sp", "social_work", "m", undefined, "mid_career"),
  P("abdoulaye_sow", "Abdoulaye", "Sow", "fr", "m", "Montréal", "rg", "nursing", "s"),
  P("hannah_goldstein", "Hannah", "Goldstein", "en", "f", "Montréal", "ed", "psychology", "m", undefined, "senior"),
  P("pierre_luc_demers", "Pierre-Luc", "Demers", "fr", "m", "Montréal", "rs", "public_health", "", undefined, "early_career"),
  P("leila_karimi", "Leila", "Karimi", "en", "f", "Montréal", "rs", "medicine", "", undefined, "mid_career"),
  P("charles_vachon", "Charles", "Vachon", "fr", "m", "Montréal", "ind", "speech_language_pathology", "", undefined, "mid_career"),
  P("imane_cherkaoui", "Imane", "Cherkaoui", "fr", "f", "Montréal", "ind", "social_work", "m", undefined, "mid_career"),
  P("oliver_wright", "Oliver", "Wright", "en", "m", "Montréal", "hp", "other", "", "resp", "early_career"),
  P("stephanie_leung", "Stephanie", "Leung", "en", "f", "Montréal", "gr", "audiology", "s"),
  P("antoine_gervais", "Antoine", "Gervais", "fr", "m", "Montréal", "ug", "social_work"),
  P("marwa_ben_salah", "Marwa", "Ben Salah", "fr", "f", "Montréal", "ug", "other", "q", "nutri"),
  P("jean_philippe_cyr", "Jean-Philippe", "Cyr", "fr", "m", "Montréal", "gr", "nursing", "s"),
  P("camila_torres", "Camila", "Torres", "fr", "f", "Montréal", "ug", "occupational_therapy", "s"),
  P("bao_tran", "Bảo", "Trần", "en", "m", "Montréal", "ug", "psychology", "i"),
  P("francoise_lemieux", "Françoise", "Lemieux", "fr", "f", "Montréal", "hp", "psychology", "m", undefined, "mid_career"),
  P("yves_ladouceur", "Yves", "Ladouceur", "fr", "m", "Montréal", "ed", "pharmacy", "", undefined, "senior"),
  P("kimberly_ross", "Kimberly", "Ross", "en", "f", "Montréal", "hp", "other", "q", "lab", "early_career"),
  P("fabien_morissette", "Fabien", "Morissette", "fr", "m", "Montréal", "hp", "audiology", "i", undefined, "mid_career"),
  // Laval (+6)
  P("melissa_arsenault", "Mélissa", "Arsenault", "fr", "f", "Laval", "ug", "nursing"),
  P("patrick_dionne", "Patrick", "Dionne", "fr", "m", "Laval", "hp", "physiotherapy", "", undefined, "mid_career"),
  P("sandrine_gosselin", "Sandrine", "Gosselin", "fr", "f", "Laval", "gr", "psychology", "s"),
  P("omar_el_khoury", "Omar", "El Khoury", "fr", "m", "Laval", "ed", "social_work", "", undefined, "senior"),
  P("josianne_blais", "Josianne", "Blais", "fr", "f", "Laval", "rs", "nursing", "", undefined, "mid_career"),
  P("martin_perreault", "Martin", "Perreault", "fr", "m", "Laval", "ind", "occupational_therapy", "", undefined, "mid_career"),
  // Longueuil (+5)
  P("audrey_trottier", "Audrey", "Trottier", "fr", "f", "Longueuil", "ug", "pharmacy"),
  P("mohammed_tahiri", "Mohammed", "Tahiri", "fr", "m", "Longueuil", "hp", "nursing", "", undefined, "mid_career"),
  P("kateri_deschamps", "Kateri", "Deschamps", "fr", "f", "Longueuil", "sp", "social_work", "", undefined, "early_career"),
  P("benoit_lalonde", "Benoît", "Lalonde", "fr", "m", "Longueuil", "rg", "physiotherapy", "s"),
  P("elena_petrova", "Elena", "Petrova", "en", "f", "Longueuil", "gr", "social_work"),
  // Brossard (+2), Châteauguay (+2), Terrebonne (+2), Saint-Jérôme (+1), Vaudreuil-Dorion (+1)
  P("jessica_wong", "Jessica", "Wong", "en", "f", "Brossard", "ug", "nursing"),
  P("samir_belhadj", "Samir", "Belhadj", "fr", "m", "Brossard", "hp", "pharmacy", "", undefined, "early_career"),
  P("vanessa_dube", "Vanessa", "Dubé", "fr", "f", "Châteauguay", "hp", "nursing", "", undefined, "mid_career"),
  P("louis_philippe_gagne", "Louis-Philippe", "Gagné", "fr", "m", "Châteauguay", "ug", "psychology"),
  P("emilie_hebert", "Émilie", "Hébert", "fr", "f", "Terrebonne", "gr", "occupational_therapy"),
  P("maxime_cloutier", "Maxime", "Cloutier", "fr", "m", "Terrebonne", "hp", "physiotherapy", "i", undefined, "early_career"),
  P("gabrielle_lauzon", "Gabrielle", "Lauzon", "fr", "f", "Saint-Jérôme", "hp", "psychology", "", undefined, "early_career"),
  P("nicholas_brown", "Nicholas", "Brown", "en", "m", "Vaudreuil-Dorion", "hp", "medicine", "", undefined, "mid_career"),
  // Sherbrooke (+2), Québec (+1)
  P("amelie_fecteau", "Amélie", "Fecteau", "fr", "f", "Sherbrooke", "gr", "public_health"),
  P("raphael_dufour", "Raphaël", "Dufour", "fr", "m", "Sherbrooke", "rs", "psychology", "", undefined, "early_career"),
  P("genevieve_lavallee", "Geneviève", "Lavallée", "fr", "f", "Québec", "hp", "nursing", "", undefined, "mid_career"),
];

/** 100 fictional members. The first 50 are the original cast; the rest widen every role and region. */
export const PEOPLE: Person[] = [...BASE, ...MORE];

export const CITY_LABEL: Record<City, string> = {
  "Montréal": "Montréal, QC",
  Laval: "Laval, QC",
  Longueuil: "Longueuil, QC",
  "Châteauguay": "Châteauguay, QC",
  Brossard: "Brossard, QC",
  Terrebonne: "Terrebonne, QC",
  Repentigny: "Repentigny, QC",
  "Saint-Jérôme": "Saint-Jérôme, QC",
  "Vaudreuil-Dorion": "Vaudreuil-Dorion, QC",
  Sherbrooke: "Sherbrooke, QC",
  "Québec": "Québec, QC",
};

/** Real health organizations, used only as geographic context for fictional jobs. */
export const ORGS: Record<City, string[]> = {
  "Montréal": [
    "CHUM", "Centre universitaire de santé McGill (CUSM)", "CHU Sainte-Justine", "Hôpital général juif",
    "Hôpital Maisonneuve-Rosemont", "Hôpital du Sacré-Cœur de Montréal", "CIUSSS du Centre-Sud-de-l'Île-de-Montréal",
    "CIUSSS de l'Ouest-de-l'Île-de-Montréal",
  ],
  Laval: ["Hôpital de la Cité-de-la-Santé", "CISSS de Laval"],
  Longueuil: ["Hôpital Pierre-Boucher", "Hôpital Charles-Le Moyne", "CISSS de la Montérégie-Centre"],
  "Châteauguay": ["CISSS de la Montérégie-Ouest", "Hôpital Charles-Le Moyne"],
  Brossard: ["Hôpital Charles-Le Moyne", "CISSS de la Montérégie-Centre"],
  Terrebonne: ["CISSS de Lanaudière", "Hôpital de la Cité-de-la-Santé"],
  Repentigny: ["CISSS de Lanaudière"],
  "Saint-Jérôme": ["CISSS des Laurentides"],
  "Vaudreuil-Dorion": ["CISSS de la Montérégie-Ouest", "CIUSSS de l'Ouest-de-l'Île-de-Montréal"],
  Sherbrooke: ["CIUSSS de l'Estrie – CHUS"],
  "Québec": ["CHU de Québec – Université Laval", "CIUSSS de la Capitale-Nationale"],
};

/** Real universities and CEGEPs, as academic context, by field. */
export const UNIVERSITIES: Record<string, string[]> = {
  nursing: ["Université de Montréal", "Université McGill", "Université Laval", "Université de Sherbrooke", "Université du Québec à Trois-Rivières", "Université du Québec en Outaouais"],
  medicine: ["Université McGill", "Université de Montréal", "Université de Sherbrooke", "Université Laval"],
  psychology: ["Université de Montréal", "Université McGill", "Université du Québec à Montréal (UQAM)", "Université Concordia", "Université de Sherbrooke", "Université Laval", "Université du Québec à Trois-Rivières"],
  social_work: ["Université de Montréal", "Université McGill", "Université du Québec à Montréal (UQAM)", "Université Laval", "Université de Sherbrooke", "Université du Québec en Outaouais"],
  pharmacy: ["Université de Montréal", "Université Laval"],
  physiotherapy: ["Université de Montréal", "Université McGill", "Université Laval", "Université de Sherbrooke"],
  occupational_therapy: ["Université de Montréal", "Université McGill", "Université Laval", "Université de Sherbrooke", "Université du Québec à Trois-Rivières"],
  speech_language_pathology: ["Université de Montréal", "Université McGill", "Université Laval"],
  audiology: ["Université de Montréal", "Université McGill"],
  public_health: ["Université de Montréal", "Université McGill", "Université Laval", "INRS"],
  other: ["Université de Montréal", "Université McGill", "Université du Québec à Montréal (UQAM)", "Université Concordia", "Polytechnique Montréal", "École de technologie supérieure (ÉTS)", "INRS", "Université de Sherbrooke"],
};
export const CEGEPS = [
  "Cégep Ahuntsic", "Collège Édouard-Montpetit", "Collège de Maisonneuve", "Cégep de Rosemont",
  "Collège Montmorency", "Dawson College", "Vanier College", "John Abbott College",
];

/** Nouns for each field, French and English. */
export const FIELD_NAME: Record<string, { fr: string; en: string }> = {
  nursing: { fr: "sciences infirmières", en: "nursing" },
  medicine: { fr: "médecine", en: "medicine" },
  psychology: { fr: "psychologie", en: "psychology" },
  social_work: { fr: "travail social", en: "social work" },
  pharmacy: { fr: "pharmacie", en: "pharmacy" },
  physiotherapy: { fr: "physiothérapie", en: "physiotherapy" },
  occupational_therapy: { fr: "ergothérapie", en: "occupational therapy" },
  speech_language_pathology: { fr: "orthophonie", en: "speech-language pathology" },
  audiology: { fr: "audiologie", en: "audiology" },
  public_health: { fr: "santé publique", en: "public health" },
  other: { fr: "sciences de la santé", en: "health sciences" },
};

/** Profession titles: [French feminine, French masculine, English]. */
export const PRO: Record<string, [string, string, string]> = {
  nursing: ["Infirmière clinicienne", "Infirmier clinicien", "Registered nurse"],
  medicine: ["Médecin", "Médecin", "Physician"],
  psychology: ["Psychologue", "Psychologue", "Psychologist"],
  social_work: ["Travailleuse sociale", "Travailleur social", "Social worker"],
  pharmacy: ["Pharmacienne", "Pharmacien", "Pharmacist"],
  physiotherapy: ["Physiothérapeute", "Physiothérapeute", "Physiotherapist"],
  occupational_therapy: ["Ergothérapeute", "Ergothérapeute", "Occupational therapist"],
  speech_language_pathology: ["Orthophoniste", "Orthophoniste", "Speech-language pathologist"],
  audiology: ["Audiologiste", "Audiologiste", "Audiologist"],
  public_health: ["Professionnelle en santé publique", "Professionnel en santé publique", "Public health professional"],
  other: ["Professionnelle de la santé", "Professionnel de la santé", "Health professional"],
};
export const PRO_OTHER: Record<string, [string, string, string]> = {
  resp: ["Inhalothérapeute", "Inhalothérapeute", "Respiratory therapist"],
  lab: ["Technologue en analyses biomédicales", "Technologue en analyses biomédicales", "Medical laboratory technologist"],
  nutri: ["Nutritionniste", "Nutritionniste", "Dietitian-nutritionist"],
  ra: ["Coordonnatrice de recherche clinique", "Coordonnateur de recherche clinique", "Clinical research coordinator"],
  bio: ["Étudiante en sciences biomédicales", "Étudiant en sciences biomédicales", "Biomedical sciences student"],
};

/** Degree names by field and level. Broad, truthful descriptions; not official program titles. */
export function degreeName(field: string, level: "dec" | "bac" | "mast" | "doc", lang: Lang, sub?: string): string {
  const f = FIELD_NAME[field] ?? FIELD_NAME.other;
  if (level === "dec") {
    if (lang === "en") return field === "psychology" || field === "social_work" ? "DEC in Social Science" : "DEC in Health Science";
    return field === "psychology" || field === "social_work" ? "DEC en sciences humaines" : "DEC en sciences de la nature";
  }
  if (field === "other" && sub) {
    const map: Record<string, { fr: [string, string]; en: [string, string] }> = {
      nutri: { fr: ["Baccalauréat en nutrition", "Maîtrise en nutrition"], en: ["Bachelor's degree in nutrition", "Master's degree in nutrition"] },
      resp: { fr: ["DEC en techniques d'inhalothérapie", "Certificat en sciences de la santé"], en: ["DEC in respiratory therapy technology", "Certificate in health sciences"] },
      lab: { fr: ["DEC en technologie d'analyses biomédicales", "Certificat en sciences de la santé"], en: ["DEC in biomedical laboratory technology", "Certificate in health sciences"] },
      ra: { fr: ["Baccalauréat en sciences biomédicales", "Maîtrise en sciences biomédicales"], en: ["Bachelor's degree in biomedical sciences", "Master's degree in biomedical sciences"] },
      bio: { fr: ["Baccalauréat en sciences biomédicales", "Maîtrise en sciences biomédicales"], en: ["Bachelor's degree in biomedical sciences", "Master's degree in biomedical sciences"] },
    };
    const m = map[sub];
    return level === "bac" ? m[lang][0] : m[lang][1];
  }
  if (field === "pharmacy" && level !== "doc") return lang === "fr" ? (level === "bac" ? "Doctorat de premier cycle en pharmacie" : "Maîtrise en pharmacie") : level === "bac" ? "Doctor of Pharmacy (PharmD)" : "Master's degree in pharmacy";
  if (field === "medicine" && level === "bac") return lang === "fr" ? "Doctorat en médecine" : "Doctor of Medicine (MD)";
  const base = lang === "fr" ? f.fr : f.en;
  if (level === "bac") return lang === "fr" ? `Baccalauréat en ${base}` : `Bachelor's degree in ${base}`;
  if (level === "mast") return lang === "fr" ? `Maîtrise en ${base}` : `Master's degree in ${base}`;
  return lang === "fr" ? `Doctorat en ${base}` : `Doctoral degree in ${base}`;
}
