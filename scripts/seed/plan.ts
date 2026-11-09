import {
  CAREER_STAGES, COUNTRY_CODES, EMPLOYMENT_TYPES, FIELDS, MEMBER_TYPES, PURPOSES, RESERVED_USERNAMES,
} from "../../src/features/onboarding/options.ts";
import {
  COMMENT_MAX_LENGTH, FEED_PAGE_SIZE, POST_CATEGORIES, POST_MAX_LENGTH,
} from "../../src/features/feed/options.ts";
import { EN } from "./content-en.ts";
import { FR } from "./content-fr.ts";
import { THEMES, type Corpus, type Theme } from "./content-types.ts";
import {
  CEGEPS, CITY_LABEL, degreeName, FIELD_NAME, ORGS, PEOPLE, PRO, PRO_OTHER, UNIVERSITIES,
  type Lang, type Person, type Role,
} from "./people.ts";
import { createRng, exactLength, type Rng } from "./prng.ts";
import { agreeFrench, LeastUsed, similarity } from "./text.ts";

/**
 * Deterministic plan for the Quebec development data. Pure: no network, no files. The runner
 * (seed.ts) executes it; the tests validate it against the database constraints. Every person is
 * fictional; real institutions and employers appear only as academic or geographic context.
 */

export const SEED_VALUE = 20261101;
export const EMAIL_DOMAIN = "example.com";
export const EMAIL_PREFIX = "seed+";
export const HEAVY_POSTER = "camille_lavoie";
export const BIO_SUFFIX: Record<Lang, string> = {
  fr: " (Profil fictif de test)",
  en: " (Fictional test profile)",
};
export const FICTIONAL_MARKERS = ["(Profil fictif de test)", "(Fictional test profile)"] as const;

export const TARGETS = {
  members: 100,
  incomplete: 8,
  posts: 300,
  questions: 70,
  heavyPosts: 46,
  comments: 600,
  likes: 1500,
  connections: 110,
  acceptedConnections: 80,
  follows: 90,
  frShare: 0.7,
} as const;

export type SeedEducation = {
  institution: string; qualification: string; field_of_study: string | null;
  start_year: number; end_year: number | null; currently_studying: boolean; description: string | null;
};
export type SeedExperience = {
  title: string; organization: string; employment_type: string | null; start_date: string;
  end_date: string | null; is_current: boolean; description: string | null;
};
export type SeedTag = { name: string; kind: "skill" | "interest" | "mentorship_area" };

export type SeedMember = {
  slug: string; email: string; firstName: string; lastName: string; complete: boolean;
  username: string | null; memberType: string; fields: string[]; careerStage: string | null;
  country: string | null; locationLabel: string | null; headline: string | null; bio: string | null;
  journey: string | null; aspirations: string | null; institution: string | null;
  qualification: string | null; specialty: string | null; lookingForMentorship: boolean;
  openToMentor: boolean; purposes: string[]; city: string | null; avatar: boolean; cover: boolean;
  education: SeedEducation[]; experience: SeedExperience[]; tags: SeedTag[];
  lang: Lang; role: Role; g: "f" | "m"; cityKey: string; quiet: boolean; profileCreatedAt: string;
};

export type SeedPost = {
  id: string; authorSlug: string; category: string; body: string; createdAt: string;
  editedAt: string | null; lang: Lang; theme: Theme | null;
};
export type SeedComment = {
  id: string; postId: string; authorSlug: string; body: string; createdAt: string; lang: Lang;
};
export type SeedLike = { postId: string; userSlug: string; createdAt: string };
export type SeedConnection = {
  id: string; requesterSlug: string; addresseeSlug: string; status: "pending" | "accepted";
  createdAt: string; acceptedAt: string | null;
};
export type SeedFollow = { followerSlug: string; followeeSlug: string; createdAt: string };

export type Plan = {
  members: SeedMember[]; posts: SeedPost[]; comments: SeedComment[]; likes: SeedLike[];
  connections: SeedConnection[]; follows: SeedFollow[];
};

const CORPUS: Record<Lang, Corpus> = { fr: FR, en: EN };
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WINDOW_DAYS = 120;

const FIELD_SUB: Record<string, { fr: string; en: string }> = {
  nutri: { fr: "nutrition", en: "nutrition" },
  resp: { fr: "inhalothérapie", en: "respiratory therapy" },
  lab: { fr: "analyses biomédicales", en: "biomedical laboratory work" },
  ra: { fr: "recherche clinique", en: "clinical research" },
  bio: { fr: "sciences biomédicales", en: "biomedical sciences" },
};
const fieldWord = (p: Person) => (p.sub ? FIELD_SUB[p.sub][p.lang] : FIELD_NAME[p.field][p.lang]);
const title = (p: Person) => {
  const t = p.field === "other" && p.sub ? PRO_OTHER[p.sub] : PRO[p.field];
  return p.lang === "en" ? t[2] : p.g === "f" ? t[0] : t[1];
};
const flag = (p: Person, f: string) => p.flags.includes(f);
const eSuffix = (p: Person) => (p.g === "f" ? "e" : "");

// ---------------------------------------------------------------------------------------------
// Member text
// ---------------------------------------------------------------------------------------------

const BIO: Record<Lang, Record<Role, string[]>> = {
  fr: {
    ug: [
      "Étudiant{e} en {F}, je découvre encore ce qui me passionne dans le domaine.",
      "J'étudie {F} au baccalauréat et j'essaie de comprendre autant les gens que la matière.",
      "À mi-parcours de mon baccalauréat en {F}, je collectionne les questions plus que les réponses.",
    ],
    gr: [
      "Aux cycles supérieurs en {F}, je jongle entre cours, lectures et terrain.",
      "Étudiant{e} à la maîtrise en {F}, j'apprends à poser des questions de plus en plus précises.",
      "Je poursuis des études supérieures en {F} tout en gardant un pied dans la pratique.",
    ],
    rg: [
      "Diplômé{e} depuis peu en {F}, je prends mes repères dans mon premier emploi.",
      "Récemment sorti{e} de l'université en {F}, j'apprends autant des collègues que des livres.",
    ],
    hp: [
      "Je travaille en {F} dans le réseau public et j'aime les équipes qui s'entraident.",
      "{T} de formation, je tiens à garder une pratique humaine et réfléchie.",
      "Après quelques années de pratique en {F}, je m'intéresse de plus en plus à la transmission.",
    ],
    sp: [
      "Je travaille en {F} auprès de familles et d'organismes communautaires de ma région.",
      "{T}, je crois à l'importance de relations de confiance construites sur la durée.",
    ],
    ed: [
      "J'enseigne en {F} et j'accompagne des étudiants lors de leurs stages.",
      "Enseignant{e} en {F}, je suis toujours émerveillé{e} par les premières réussites des étudiants.",
      "Je partage mon temps entre la salle de classe et la supervision de stages en {F}.",
    ],
    rs: [
      "Je mène des travaux de recherche en {F} et j'aime transformer les résultats en langage simple.",
      "Chercheu{se} en {F}, j'apprécie le travail d'équipe et la rigueur des méthodes.",
    ],
    ind: [
      "Je pratique en {F} en cabinet privé et j'aime le contact direct avec les personnes que j'accompagne.",
      "{T} en pratique privée, je jongle entre accompagnement, gestion et formation continue.",
    ],
  },
  en: {
    ug: [
      "I'm studying {F} at the undergraduate level and still figuring out what excites me most.",
      "Halfway through my bachelor's in {F}, I collect questions faster than answers.",
      "I study {F} and try to understand people as much as the material.",
    ],
    gr: [
      "A graduate student in {F}, I juggle coursework, reading and fieldwork.",
      "I'm doing graduate work in {F} and learning to ask sharper questions.",
      "I study {F} at the graduate level while keeping one foot in practice.",
    ],
    rg: [
      "A recent graduate in {F}, finding my footing in a first job.",
      "Newly out of university in {F}, I learn as much from colleagues as from books.",
    ],
    hp: [
      "I work in {F} in the public health network and value teams that support each other.",
      "{A} by training, I try to keep my practice thoughtful and human.",
      "A few years into {F}, I care more and more about passing knowledge on.",
    ],
    sp: [
      "I work in {F} with families and community organizations in my area.",
      "{A}, I believe in relationships built slowly and on trust.",
    ],
    ed: [
      "I teach {F} and support students through their clinical placements.",
      "I split my time between the classroom and placement supervision in {F}.",
    ],
    rs: [
      "I do research in {F} and like turning findings into plain language.",
      "A researcher in {F}, I value teamwork and methodological rigour.",
    ],
    ind: [
      "I practise {F} privately and enjoy working directly with the people I support.",
      "{A} in private practice, balancing client work, admin and continuing education.",
    ],
  },
};
const BIO_INTEREST: Record<Lang, string[]> = {
  fr: ["Je m'intéresse particulièrement à {I}.", "Mon sujet de prédilection : {I}.", "{I} fait partie de ce qui me motive.", "On me trouve souvent à discuter de {I}."],
  en: ["I'm especially interested in {I}.", "My favourite topic: {I}.", "{I} is part of what keeps me motivated.", "You'll often find me talking about {I}."],
};
const BIO_CLOSER: Record<Lang, string[]> = {
  fr: ["Toujours heureux{e} d'échanger avec d'autres membres.", "J'aime apprendre des parcours des autres.", "Je suis ici pour apprendre et partager."],
  en: ["Always glad to exchange with other members.", "I like learning from other people's paths.", "I'm here to learn and share."],
};
const JOURNEY: Record<Lang, string[]> = {
  fr: [
    "Mon parcours n'a pas été une ligne droite : quelques changements de cap m'ont mené{e} exactement où je voulais être.",
    "J'ai commencé par un cégep général avant de trouver mon chemin vers les sciences de la santé.",
    "Un stage inattendu m'a fait changer d'idée sur ce que je voulais faire, et je ne l'ai jamais regretté.",
    "Entre études, emplois d'été et bénévolat, j'ai construit mon parcours un pas à la fois.",
  ],
  en: [
    "My path hasn't been a straight line, and a few changes of direction led me exactly where I wanted to be.",
    "I started in a general CEGEP program before finding my way into health sciences.",
    "An unexpected placement changed my mind about what I wanted to do, and I've never regretted it.",
    "Between school, summer jobs and volunteering, I built my path one step at a time.",
  ],
};
const ASPIRATIONS: Record<Lang, string[]> = {
  fr: [
    "Dans les prochaines années, j'aimerais approfondir mes compétences et accompagner à mon tour des étudiants.",
    "Je souhaite contribuer à des milieux de soins plus humains et mieux coordonnés.",
    "J'aimerais un jour combiner pratique et recherche, sans perdre le contact avec le terrain.",
    "Mon objectif : apprendre de personnes inspirantes et, plus tard, transmettre à mon tour.",
  ],
  en: [
    "In the next few years I'd like to deepen my skills and eventually support students myself.",
    "I want to contribute to care settings that are more humane and better coordinated.",
    "One day I'd like to combine practice and research without losing touch with the field.",
    "My goal: learn from inspiring people and, later, pass it on.",
  ],
};
const JOB_NOTE: Record<Lang, string[]> = {
  fr: [
    "Travail en équipe interdisciplinaire et accueil des nouveaux collègues.",
    "Participation à des comités d'amélioration de la pratique.",
    "Encadrement de stagiaires et rédaction de documents de soutien.",
    "Coordination d'activités de sensibilisation auprès du public.",
  ],
  en: [
    "Interdisciplinary teamwork and onboarding of new colleagues.",
    "Participation in practice improvement committees.",
    "Supervision of students and writing of support documents.",
    "Coordination of public awareness activities.",
  ],
};

const fill = (text: string, p: Person, interest: string) =>
  text
    .replaceAll("{F}", fieldWord(p))
    .replaceAll("{T}", title(p))
    .replaceAll("{A}", `${/^[aeiou]/i.test(title(p)) ? "An" : "A"} ${title(p).toLowerCase()}`)
    .replaceAll("{I}", interest.toLowerCase())
    .replaceAll("{e}", eSuffix(p))
    .replaceAll("{se}", p.g === "f" ? "se" : "r");
const frFix = (text: string, p: Person) => text.replace(/Chercheu\{se\}/g, p.g === "f" ? "Chercheuse" : "Chercheur");

function headlineFor(p: Person, interest: string, rng: Rng): string {
  const F = fieldWord(p);
  const T = title(p);
  const I = interest;
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const e = eSuffix(p);
  const fr: Record<Role, string[]> = {
    ug: [`Étudiant${e} au baccalauréat en ${F} | ${I}`, `${cap(F)} · étudiant${e} à l'université`],
    gr: [`Étudiant${e} à la maîtrise en ${F} | ${I}`, `${cap(F)} aux cycles supérieurs · ${I}`],
    rg: [`${p.g === "f" ? "Nouvelle diplômée" : "Nouveau diplômé"} en ${F} | ${I}`],
    hp: [`${T} | ${I}`, `${T} · ${CITY_LABEL[p.city]}`],
    sp: [`${T} | ${I}`, `${T} en milieu communautaire`],
    ed: [`Enseignant${e} en ${F} | ${I}`, `Enseignement et supervision de stages en ${F}`],
    rs: [`${p.g === "f" ? "Chercheuse" : "Chercheur"} en ${F} | ${I}`, `Recherche en ${F} · ${I}`],
    ind: [`${T} en pratique privée | ${I}`, `${T} · pratique privée`],
  };
  const en: Record<Role, string[]> = {
    ug: [`Undergraduate student in ${F} | ${I}`, `${cap(F)} student exploring ${I.toLowerCase()}`],
    gr: [`Master's student in ${F} | ${I}`, `${cap(F)} graduate student · ${I}`],
    rg: [`New ${F} graduate | ${I}`],
    hp: [`${T} | ${I}`, `${T} · ${CITY_LABEL[p.city]}`],
    sp: [`${T} | ${I}`, `${T} in community services`],
    ed: [`${cap(F)} educator | ${I}`, `Teaching and placement supervision in ${F}`],
    rs: [`Researcher in ${F} | ${I}`, `${cap(F)} research · ${I}`],
    ind: [`${T} in private practice | ${I}`, `${T} · private practice`],
  };
  return (p.lang === "fr" ? fr : en)[p.role]
    ? rng.pick((p.lang === "fr" ? fr : en)[p.role]).slice(0, 120)
    : T;
}

function bioFor(p: Person, interest: string, rng: Rng): string {
  const base = fill(rng.pick(BIO[p.lang][p.role]), p, interest);
  const mid = fill(rng.pick(BIO_INTEREST[p.lang]), p, interest);
  const end = rng.chance(0.55) ? ` ${fill(rng.pick(BIO_CLOSER[p.lang]), p, interest)}` : "";
  const city = rng.chance(0.3) ? (p.lang === "fr" ? ` Je vis à ${p.city}.` : ` Based in ${p.city}.`) : "";
  const text = `${frFix(base, p)} ${mid}${end}${city}`;
  return (p.lang === "fr" ? agreeFrench(text, p.g) : text) + BIO_SUFFIX[p.lang];
}

/** The member with an exactly 1000-character bio (max length), still ending in the marker. */
function maxBio(p: Person, rng: Rng): string {
  const pool = [...CORPUS[p.lang].longform, ...CORPUS[p.lang].generalClosers];
  const parts: string[] = [];
  let length = 0;
  for (const s of rng.shuffle(pool)) {
    parts.push(s);
    length += s.length + 1;
    if (length >= 1100) break;
  }
  const marker = BIO_SUFFIX[p.lang];
  const core = exactLength(parts.join(" "), 1000 - marker.length);
  return (p.lang === "fr" ? agreeFrench(core, p.g) : core) + marker;
}

const monthDate = (year: number, month: number) => `${year}-${String(month).padStart(2, "0")}-01`;

function educationFor(p: Person, rng: Rng): SeedEducation[] {
  const unis = UNIVERSITIES[p.field] ?? UNIVERSITIES.other;
  const uni = () => rng.pick(unis);
  const cegep = () =>
    p.lang === "en" ? rng.pick(["Dawson College", "Vanier College", "John Abbott College"]) : rng.pick(CEGEPS.filter((c) => !/Dawson|Vanier|John/.test(c)));
  const F = (lvl: "dec" | "bac" | "mast" | "doc") => degreeName(p.field, lvl, p.lang, p.sub);
  const fos = FIELD_NAME[p.field][p.lang];
  const row = (
    institution: string, qualification: string, start: number, end: number | null, current = false,
  ): SeedEducation => ({
    institution, qualification, field_of_study: fos, start_year: start, end_year: current ? null : end,
    currently_studying: current, description: null,
  });
  const onlyDec = p.field === "other" && (p.sub === "resp" || p.sub === "lab");
  const dec = (bacStart: number) => row(cegep(), F("dec"), bacStart - 2, bacStart);
  const out: SeedEducation[] = [];
  switch (p.role) {
    case "ug": {
      const s = rng.int(2024, 2025);
      out.push(row(uni(), F("bac"), s, null, true), dec(s));
      break;
    }
    case "gr": {
      const s = rng.int(2020, 2022);
      out.push(row(uni(), F("mast"), 2025, null, true), row(uni(), F("bac"), s, s + 3), dec(s));
      break;
    }
    case "rg":
      out.push(row(uni(), F("bac"), 2022, 2025), dec(2022));
      break;
    case "hp":
    case "sp": {
      if (onlyDec) {
        const s = rng.int(2014, 2022);
        out.push(row(cegep(), F("dec"), s, s + 3));
        break;
      }
      const s = rng.int(2006, 2020);
      out.push(row(uni(), F("bac"), s, s + (p.field === "nursing" || p.field === "pharmacy" ? 4 : 3)), dec(s));
      if (flag(p, "a")) {
        out.unshift(row(uni(), p.field === "psychology" ? F("doc") : F("mast"), 2025, null, true));
      }
      break;
    }
    case "ed": {
      const s = rng.int(1998, 2006);
      out.push(row(uni(), F("mast"), s + 4, s + 7), row(uni(), F("bac"), s, s + 3));
      if (p.field === "psychology" || p.field === "social_work") out.unshift(row(uni(), F("doc"), s + 7, s + 12));
      break;
    }
    case "rs": {
      const s = rng.int(2002, 2012);
      out.push(row(uni(), F("doc"), s + 4, s + 9), row(uni(), F("bac"), s, s + 3));
      break;
    }
    case "ind": {
      const s = rng.int(2000, 2014);
      out.push(row(uni(), F("mast"), s + 3, s + 5), row(uni(), F("bac"), s, s + 3));
      break;
    }
  }
  return out;
}

function experienceFor(p: Person, rng: Rng): SeedExperience[] {
  const org = () => rng.pick(ORGS[p.city]);
  const t = title(p);
  const note = () => (rng.chance(0.5) ? rng.pick(JOB_NOTE[p.lang]) : null);
  const fr = p.lang === "fr";
  const job = (
    ttl: string, organization: string, type: string, startY: number, startM: number,
    end: [number, number] | null,
  ): SeedExperience => ({
    title: ttl, organization, employment_type: type, start_date: monthDate(startY, startM),
    end_date: end ? monthDate(end[0], end[1]) : null, is_current: end === null, description: note(),
  });
  const placement = job(fr ? "Stagiaire clinique" : "Clinical placement student", org(), "placement", 2026, 1, [2026, 4]);
  const volunteer = job(fr ? "Bénévole" : "Volunteer", org(), "volunteer", 2025, rng.int(1, 9), null);
  switch (p.role) {
    case "ug":
      return rng.chance(0.6) ? [placement, volunteer] : [placement];
    case "gr": {
      const out = [placement];
      if (flag(p, "h")) out.push(job(fr ? "Infirmière clinicienne" : "Registered nurse", org(), "part_time", 2023, 6, null));
      else if (rng.chance(0.5)) out.push(job(fr ? `Assistant${eSuffix(p)} de recherche` : "Research assistant", rng.pick(UNIVERSITIES[p.field] ?? UNIVERSITIES.other), "part_time", 2025, 9, null));
      return out;
    }
    case "rg":
      return [
        job(fr ? "Stagiaire clinique" : "Clinical placement student", org(), "placement", 2025, 1, [2025, 4]),
        job(t, org(), "part_time", 2025, rng.int(6, 10), null),
      ];
    case "hp":
    case "sp": {
      const years = p.stage === "mid_career" ? rng.int(8, 14) : rng.int(2, 5);
      const startY = 2026 - years;
      const mid = Math.floor(years / 2);
      return [
        job(t, org(), "full_time", startY + mid, rng.int(1, 12), null),
        job(fr ? `${t} (début de carrière)` : `${t} (early career)`, org(), "full_time", startY, rng.int(1, 6), [startY + mid, 1]),
      ];
    }
    case "ed": {
      const uni = rng.pick(UNIVERSITIES[p.field] ?? UNIVERSITIES.other);
      return [
        job(fr ? `Enseignant${eSuffix(p)} en ${fieldWord(p)}` : `Lecturer in ${fieldWord(p)}`, uni, "part_time", 2012, rng.int(1, 9), null),
        job(t, org(), "full_time", 2004, rng.int(1, 9), [2012, 6]),
      ];
    }
    case "rs":
      return [
        job(fr ? (p.g === "f" ? "Chercheuse" : "Chercheur") : "Researcher", org(), "full_time", 2018, rng.int(1, 9), null),
        job(fr ? `Assistant${eSuffix(p)} de recherche` : "Research assistant", rng.pick(UNIVERSITIES[p.field] ?? UNIVERSITIES.other), "full_time", 2012, rng.int(1, 9), [2018, 5]),
      ];
    case "ind":
      return [
        job(fr ? `${t}, pratique privée` : `${t}, private practice`, fr ? "Pratique privée (travail autonome)" : "Private practice (self-employed)", "self_employed", 2018, rng.int(1, 12), null),
        job(t, org(), "full_time", 2010, rng.int(1, 9), [2018, 3]),
      ];
  }
}

function tagsFor(p: Person, rng: Rng): { tags: SeedTag[]; interests: string[] } {
  const corpus = CORPUS[p.lang];
  const mentor = flag(p, "m");
  const seeker = flag(p, "s");
  const skills = rng.sample(corpus.skills[p.field] ?? corpus.skills.other, rng.int(3, 5)).map((name) => ({ name, kind: "skill" as const }));
  const interests = rng.sample(corpus.interests, rng.int(1, 3));
  const areas = rng
    .sample(corpus.mentorship, mentor ? 2 : seeker ? 1 : rng.int(0, 1))
    .map((name) => ({ name, kind: "mentorship_area" as const }));
  return {
    tags: [...skills, ...interests.map((name) => ({ name, kind: "interest" as const })), ...areas],
    interests,
  };
}

const MEMBER_TYPE: Record<Role, string> = {
  ug: "undergraduate_student", gr: "graduate_student", rg: "recent_graduate",
  hp: "healthcare_professional", sp: "social_services_professional", ed: "educator",
  rs: "researcher", ind: "healthcare_professional",
};
const STAGE: Record<Role, string> = {
  ug: "student", gr: "student", rg: "new_graduate", hp: "early_career", sp: "early_career",
  ed: "senior", rs: "mid_career", ind: "mid_career",
};

function buildMembers(rng: Rng, nowMs: number): SeedMember[] {
  return PEOPLE.map((p, index) => {
    const complete = !flag(p, "i");
    const base = {
      slug: p.slug, email: `${EMAIL_PREFIX}${p.slug}@${EMAIL_DOMAIN}`, firstName: p.first, lastName: p.last,
      lang: p.lang, role: p.role, g: p.g, cityKey: p.city, quiet: flag(p, "q"),
    };
    if (!complete) {
      return {
        ...base, complete: false, username: null, memberType: "other", fields: [], careerStage: null,
        country: null, locationLabel: null, headline: null, bio: null, journey: null, aspirations: null,
        institution: null, qualification: null, specialty: null, lookingForMentorship: false,
        openToMentor: false, purposes: [], city: null, avatar: false, cover: false, education: [],
        experience: [], tags: [], profileCreatedAt: new Date(nowMs - rng.int(1, 14) * DAY).toISOString(),
      };
    }
    const { tags, interests } = tagsFor(p, rng);
    const education = educationFor(p, rng);
    const mentor = flag(p, "m");
    const seeker = flag(p, "s");
    const purposes = rng.sample(PURPOSES.map((x) => x.value as string), rng.int(1, 3));
    if (mentor && !purposes.includes("become_mentor")) purposes[0] = "become_mentor";
    if (seeker && !purposes.includes("find_mentor")) purposes[0] = "find_mentor";
    const fieldList = p.slug === "sofia_ramirez" || p.slug === "mei_ling_chan" ? [p.field] : [p.field];
    const memberType = p.role === "ind" && p.field === "social_work" ? "social_services_professional" : MEMBER_TYPE[p.role];
    const stage = p.role === "hp" || p.role === "sp" || p.role === "ind" ? (p.stage ?? STAGE[p.role]) : p.role === "ed" ? "senior" : STAGE[p.role];
    const lead = education.find((e) => e.currently_studying) ?? education[0];
    return {
      ...base, complete: true, username: p.slug, memberType, fields: fieldList, careerStage: stage,
      country: "CA", locationLabel: CITY_LABEL[p.city],
      headline: flag(p, "n") ? null : headlineFor(p, interests[0], rng),
      bio: flag(p, "e") ? null : flag(p, "l") ? maxBio(p, rng) : bioFor(p, interests[0], rng),
      journey: rng.chance(0.6) ? (p.lang === "fr" ? agreeFrench(rng.pick(JOURNEY.fr), p.g) : rng.pick(JOURNEY.en)) : null,
      aspirations: rng.chance(0.55) ? (p.lang === "fr" ? agreeFrench(rng.pick(ASPIRATIONS.fr), p.g) : rng.pick(ASPIRATIONS.en)) : null,
      institution: lead?.institution ?? null,
      qualification: lead ? lead.qualification.slice(0, 120) : null,
      specialty: rng.chance(0.55) ? interests[0].slice(0, 120) : null,
      lookingForMentorship: seeker, openToMentor: mentor, purposes,
      city: rng.chance(0.7) ? p.city : null,
      avatar: ![3, 6, 9].includes(index % 10), cover: [0, 2].includes(index % 5),
      education, experience: experienceFor(p, rng), tags,
      profileCreatedAt: new Date(nowMs - 200 * DAY).toISOString(),
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Posts
// ---------------------------------------------------------------------------------------------

type ThemeRule = { fields?: string[]; roles?: Role[] };
export const THEME_RULES: Record<Theme, ThemeRule> = {
  placement: { roles: ["ug", "gr", "rg"] },
  oiiq: { fields: ["nursing"], roles: ["ug", "gr", "rg"] },
  psygrad: { fields: ["psychology"], roles: ["ug", "gr", "rg"] },
  cegep: { roles: ["ug", "gr", "rg"] },
  swintern: { fields: ["social_work"], roles: ["ug", "gr", "rg"] },
  bedside: { fields: ["nursing"], roles: ["hp", "rs", "gr"] },
  pharm: { fields: ["pharmacy"], roles: ["ug", "gr", "rg"] },
  mentor: {},
  mcgillres: { roles: ["ug", "gr", "rs", "rg"] },
  workstudy: { roles: ["ug", "gr", "rg"] },
  physio: { fields: ["physiotherapy", "occupational_therapy"], roles: ["ug", "gr", "rg"] },
  hospra: {},
};
const THEME_CATEGORIES: Record<Theme, string[]> = {
  placement: ["academic_life", "personal_achievement", "general_discussion", "professional_advice"],
  oiiq: ["academic_life", "professional_advice", "personal_achievement", "general_discussion"],
  psygrad: ["academic_life", "career_journey", "professional_advice", "personal_achievement"],
  cegep: ["academic_life", "general_discussion", "career_journey", "personal_achievement"],
  swintern: ["academic_life", "career_journey", "professional_advice", "general_discussion"],
  bedside: ["career_journey", "research_knowledge", "professional_advice"],
  pharm: ["academic_life", "general_discussion", "career_journey"],
  mentor: ["professional_advice", "career_journey", "general_discussion", "personal_achievement"],
  mcgillres: ["research_knowledge", "academic_life", "personal_achievement"],
  workstudy: ["academic_life", "general_discussion", "professional_advice", "personal_achievement"],
  physio: ["academic_life", "professional_advice", "personal_achievement", "general_discussion"],
  hospra: ["career_journey", "research_knowledge", "professional_advice", "general_discussion"],
};
const NON_QUESTION_CATEGORIES = POST_CATEGORIES.map((c) => c.value as string).filter((c) => c !== "questions");

type Slot = {
  lang: Lang;
  kind: "q" | "std" | "casual" | "long" | "esc" | "huge";
  theme: Theme | null;
  category: string;
  payload?: string;
};

function candidatesFor(theme: Theme | null, pool: Person[]): Person[] {
  if (!theme) return pool;
  const rule = THEME_RULES[theme];
  const full = pool.filter((p) => (!rule.fields || rule.fields.includes(p.field)) && (!rule.roles || rule.roles.includes(p.role)));
  if (full.length > 0) return full;
  const byField = pool.filter((p) => !rule.fields || rule.fields.includes(p.field));
  if (byField.length > 0) return byField;
  const byRole = pool.filter((p) => !rule.roles || rule.roles.includes(p.role));
  return byRole.length > 0 ? byRole : pool;
}

const MAX_SIMILARITY_GENERATED = 0.42;

export const PARAGRAPH = "\n\n";

class PostWriter {
  private rng: Rng;
  private used: Record<Lang, LeastUsed>;
  private accepted: string[] = [];
  constructor(rng: Rng) {
    this.rng = rng;
    this.used = { fr: new LeastUsed(rng), en: new LeastUsed(rng) };
  }
  private accept(body: string): boolean {
    for (const prev of this.accepted) if (similarity(prev, body) > MAX_SIMILARITY_GENERATED) return false;
    this.accepted.push(body);
    return true;
  }
  /** Tries up to a few hundred combinations until one is clearly different from every earlier post. */
  compose(lang: Lang, theme: Theme, question: boolean): string {
    const t = CORPUS[lang].themes[theme];
    const lu = this.used[lang];
    for (let attempt = 0; attempt < 400; attempt++) {
      const shape = this.rng.next();
      const parts: string[] = [];
      const s = lu.pick(t.s);
      if (question) {
        parts.push(s, lu.pick(t.q));
        if (this.rng.chance(0.4)) parts.splice(1, 0, lu.pick(t.d));
        if (this.rng.chance(0.25)) parts.push(lu.pick(CORPUS[lang].generalClosers));
      } else if (shape < 0.2) {
        parts.push(s, lu.pick(t.d));
      } else if (shape < 0.8) {
        parts.push(s, lu.pick(t.d), this.rng.chance(0.25) ? lu.pick(CORPUS[lang].generalClosers) : lu.pick(t.c));
      } else {
        parts.push(s, lu.pick(t.d), lu.pick(t.d), lu.pick(t.c));
      }
      const body = parts.join(this.rng.chance(0.3) && parts.length > 3 ? PARAGRAPH : " ");
      if (this.accept(body)) return body;
    }
    throw new Error(`Could not compose a distinct ${lang} post for ${theme}`);
  }
  take(body: string) {
    this.accepted.push(body);
  }
}

function longPost(lang: Lang, theme: Theme, rng: Rng, writer: PostWriter): string {
  const t = CORPUS[lang].themes[theme];
  const sentences = rng.shuffle([...t.s, ...t.d, ...t.c]).slice(0, 8);
  const paragraphs = [sentences.slice(0, 3), sentences.slice(3, 6), sentences.slice(6)].map((x) => x.join(" "));
  const body = paragraphs.join(PARAGRAPH);
  writer.take(body);
  return body;
}

function hugePost(lang: Lang, rng: Rng): string {
  const c = CORPUS[lang];
  const extras = [...c.themes.oiiq.s, ...c.themes.oiiq.d, ...c.themes.oiiq.c];
  const sentences = [...c.longform, ...extras];
  const paragraphs: string[] = [];
  for (let i = 0; i < sentences.length; i += 4) paragraphs.push(sentences.slice(i, i + 4).join(" "));
  void rng;
  return paragraphs.join(PARAGRAPH);
}

function fitTotal(counts: number[], target: number, rng: Rng, max: number, weights?: number[]): number[] {
  const out = [...counts];
  let sum = out.reduce((a, b) => a + b, 0);
  let guard = 0;
  while (sum !== target && guard++ < 1_000_000) {
    if (sum < target) {
      const i = weights ? weightedIndex(weights, out, rng, max) : rng.int(0, out.length - 1);
      if (out[i] < max) {
        out[i]++;
        sum++;
      }
    } else {
      const i = rng.int(0, out.length - 1);
      if (out[i] > 0) {
        out[i]--;
        sum--;
      }
    }
  }
  if (sum !== target) throw new Error("Could not fit the requested total");
  return out;
}
function weightedIndex(weights: number[], current: number[], rng: Rng, max: number): number {
  const eligible = weights.map((w, i) => (current[i] < max ? w + current[i] * 0.3 : 0));
  const total = eligible.reduce((a, b) => a + b, 0);
  let r = rng.next() * total;
  for (let i = 0; i < eligible.length; i++) {
    r -= eligible[i];
    if (r <= 0) return i;
  }
  return eligible.length - 1;
}

export function buildPlan(now: Date = new Date(), seed: number = SEED_VALUE): Plan {
  const rng = createRng(seed);
  const nowMs = now.getTime();
  const iso = (ms: number) => new Date(ms).toISOString();
  const members = buildMembers(rng, nowMs);
  const people = new Map(PEOPLE.map((p) => [p.slug, p]));
  const bySlug = new Map(members.map((m) => [m.slug, m]));
  const completed = members.filter((m) => m.complete);
  const poolFor = (lang: Lang) => PEOPLE.filter((p) => p.lang === lang && !flag(p, "i") && !flag(p, "q"));

  // --- slots: language, kind, theme, category ---------------------------------------------------
  const frTotal = Math.round(TARGETS.posts * TARGETS.frShare);
  const frQuestions = Math.round(TARGETS.questions * TARGETS.frShare);
  const fixed = {
    fr: { q: frQuestions, casual: FR.casual.length, long: 4, esc: FR.escaping.length, huge: 1 },
    en: { q: TARGETS.questions - frQuestions, casual: EN.casual.length, long: 2, esc: EN.escaping.length, huge: 0 },
  };
  const slots: Slot[] = [];
  const themeUse: Record<string, number> = {};
  const nextTheme = (lang: Lang, allowed: readonly Theme[]) => {
    const best = allowed.reduce((a, b) => ((themeUse[`${lang}:${a}`] ?? 0) <= (themeUse[`${lang}:${b}`] ?? 0) ? a : b));
    themeUse[`${lang}:${best}`] = (themeUse[`${lang}:${best}`] ?? 0) + 1;
    return best;
  };
  for (const lang of ["fr", "en"] as const) {
    const f = fixed[lang];
    for (let i = 0; i < f.q; i++) {
      slots.push({ lang, kind: "q", theme: nextTheme(lang, rng.shuffle(THEMES)), category: "questions" });
    }
    for (const sentence of rng.shuffle(CORPUS[lang].casual)) {
      slots.push({ lang, kind: "casual", theme: null, category: rng.pick(["general_discussion", "general_discussion", "personal_achievement", "academic_life"]), payload: sentence });
    }
    for (let i = 0; i < f.long; i++) {
      const theme = nextTheme(lang, rng.shuffle(THEMES));
      slots.push({ lang, kind: "long", theme, category: rng.pick(THEME_CATEGORIES[theme]) });
    }
    CORPUS[lang].escaping.forEach((e) => slots.push({ lang, kind: "esc", theme: null, category: e.category, payload: e.body }));
    if (f.huge) slots.push({ lang, kind: "huge", theme: null, category: "general_discussion" });
  }
  const catCount: Record<string, number> = {};
  for (const s of slots) catCount[s.category] = (catCount[s.category] ?? 0) + 1;
  const have = (lang: Lang) => slots.filter((s) => s.lang === lang).length;
  const stdFr = frTotal - have("fr");
  const stdEn = TARGETS.posts - frTotal - have("en");
  for (const [lang, n] of [["fr", stdFr], ["en", stdEn]] as const) {
    for (let i = 0; i < n; i++) {
      const category = NON_QUESTION_CATEGORIES.reduce((a, b) => ((catCount[a] ?? 0) <= (catCount[b] ?? 0) ? a : b));
      const allowed = THEMES.filter((t) => THEME_CATEGORIES[t].includes(category));
      const theme = nextTheme(lang, allowed);
      catCount[category] = (catCount[category] ?? 0) + 1;
      slots.push({ lang, kind: "std", theme, category });
    }
  }
  if (slots.length !== TARGETS.posts) throw new Error(`Expected ${TARGETS.posts} post slots, got ${slots.length}`);

  // --- bodies ------------------------------------------------------------------------------------
  const writer = new PostWriter(rng);
  for (const slot of rng.shuffle(slots)) {
    if (slot.kind === "casual" || slot.kind === "esc") {
      slot.payload ??= "";
      writer.take(slot.payload);
    } else if (slot.kind === "huge") {
      slot.payload = hugePost(slot.lang, rng);
      writer.take(slot.payload);
    } else if (slot.kind === "long") {
      slot.payload = longPost(slot.lang, slot.theme!, rng, writer);
    } else {
      slot.payload = writer.compose(slot.lang, slot.theme!, slot.kind === "q");
    }
  }

  // --- authors ------------------------------------------------------------------------------------
  const authors = new Map<Slot, string>();
  const heavyCompatible = new Set<Theme>(["placement", "oiiq", "cegep", "bedside", "mentor", "mcgillres", "workstudy", "hospra"]);
  const frShuffled = rng.shuffle(slots.filter((s) => s.lang === "fr" && (s.kind === "std" || s.kind === "q") && s.theme && heavyCompatible.has(s.theme)));
  if (frShuffled.length < TARGETS.heavyPosts) throw new Error("Not enough compatible slots for the heavy poster");
  for (const s of frShuffled.slice(0, TARGETS.heavyPosts)) authors.set(s, HEAVY_POSTER);
  const counts = new Map<string, number>();
  for (const slot of rng.shuffle(slots)) {
    if (authors.has(slot)) continue;
    const pool = candidatesFor(slot.theme, poolFor(slot.lang).filter((p) => p.slug !== HEAVY_POSTER));
    const open = pool.filter((p) => (counts.get(p.slug) ?? 0) < 14);
    const choices = open.length > 0 ? open : pool;
    // Weighted so some members post a lot and others rarely.
    const weighted = choices.flatMap((p) => Array<string>(1 + (p.slug.length % 5)).fill(p.slug));
    const slug = rng.pick(weighted);
    counts.set(slug, (counts.get(slug) ?? 0) + 1);
    authors.set(slot, slug);
  }

  // --- timestamps (spaced at least 40 minutes apart per author, inside the last 120 days) ---------
  const bySlugSlots = new Map<string, Slot[]>();
  for (const slot of slots) {
    const a = authors.get(slot)!;
    (bySlugSlots.get(a) ?? bySlugSlots.set(a, []).get(a)!).push(slot);
  }
  const offsets = new Map<Slot, number>();
  for (const [, list] of bySlugSlots) {
    const taken: number[] = [];
    let guard = 0;
    while (taken.length < list.length && guard++ < 200_000) {
      const candidate = rng.int(120, WINDOW_DAYS * 24 * 60 - 60);
      if (taken.every((t) => Math.abs(t - candidate) >= 40)) taken.push(candidate);
    }
    if (taken.length < list.length) throw new Error("Could not space posts apart");
    list.forEach((slot, i) => offsets.set(slot, taken[i]));
  }
  const posts: SeedPost[] = rng.shuffle(slots).map((slot) => {
    const createdMs = nowMs - offsets.get(slot)! * MINUTE;
    const edited = rng.chance(0.08);
    const editedMs = createdMs + rng.int(30, 72 * 60) * MINUTE;
    const author = people.get(authors.get(slot)!)!;
    const raw = slot.payload!;
    const body = slot.lang === "fr" ? agreeFrench(raw, author.g) : raw;
    return {
      id: rng.uuid(), authorSlug: author.slug, category: slot.category,
      body: slot.kind === "huge" ? exactLength(body, POST_MAX_LENGTH) : body,
      createdAt: iso(createdMs), editedAt: edited && editedMs < nowMs - 5 * MINUTE ? iso(editedMs) : null,
      lang: slot.lang, theme: slot.theme,
    };
  });

  // --- comments ---------------------------------------------------------------------------------
  const comments: SeedComment[] = [];
  const commentUsed: Record<Lang, LeastUsed> = { fr: new LeastUsed(rng), en: new LeastUsed(rng) };
  const accepted: Record<Lang, string[]> = { fr: [], en: [] };
  const commenterPool = (lang: Lang) => {
    const same = completed.filter((m) => m.lang === lang);
    const others = completed.filter((m) => m.lang !== lang);
    return rng.chance(0.9) ? same : others;
  };
  const commentBody = (lang: Lang, theme: Theme | null): string => {
    const c = CORPUS[lang];
    for (let attempt = 0; attempt < 600; attempt++) {
      const useTheme = theme && rng.chance(0.7);
      const core = commentUsed[lang].pick(useTheme ? c.themes[theme!].r : c.replies);
      const second = rng.chance(0.7) ? commentUsed[lang].pick(c.replies, [core]) : "";
      const opener = !second && rng.chance(0.3) ? `${rng.pick(c.openers)} ` : "";
      const ending = rng.chance(0.25) ? ` ${rng.pick(c.endings)}` : "";
      const text = `${opener}${core}${second ? ` ${second}` : ""}${ending}`;
      if (!accepted[lang].some((prev) => similarity(prev, text) > 0.55 || prev === text)) {
        accepted[lang].push(text);
        return text;
      }
      commentUsed[lang].release(core);
      if (second) commentUsed[lang].release(second);
    }
    throw new Error(`Could not compose a distinct ${lang} comment`);
  };
  const longComments: Record<Lang, string[]> = { fr: [], en: [] };
  {
    const frLong = [...FR.longform];
    const half = Math.ceil(frLong.length / 2);
    for (const part of [frLong.slice(0, half), frLong.slice(half)]) {
      const text = part.join(" ");
      longComments.fr.push(exactLength(text.length >= COMMENT_MAX_LENGTH ? text : `${text} ${FR.generalClosers.join(" ")}`, COMMENT_MAX_LENGTH));
    }
    longComments.en.push(exactLength(EN.longform.join(" "), COMMENT_MAX_LENGTH));
  }
  for (const lang of ["fr", "en"] as const) {
    const target = lang === "fr" ? Math.round(TARGETS.comments * TARGETS.frShare) : TARGETS.comments - Math.round(TARGETS.comments * TARGETS.frShare);
    const langPosts = posts.filter((p) => p.lang === lang);
    const base = langPosts.map(() => {
      const r = rng.next();
      return r < 0.3 ? 0 : r < 0.58 ? 1 : r < 0.72 ? 2 : r < 0.86 ? rng.int(3, 4) : r < 0.96 ? rng.int(5, 7) : rng.int(8, 12);
    });
    const weights = langPosts.map(() => 1 + rng.next() * 3);
    const perPost = fitTotal(base, target, rng, 12, weights);
    let longLeft = [...longComments[lang]];
    langPosts.forEach((post, i) => {
      const postMs = Date.parse(post.createdAt);
      const author = people.get(post.authorSlug)!;
      for (let k = 0; k < perPost[i]; k++) {
        const selfReply = rng.chance(0.1);
        const poolChoice = commenterPool(lang).filter((m) => m.slug !== post.authorSlug && (!m.quiet || rng.chance(0.2)));
        const writer = selfReply ? bySlug.get(post.authorSlug)! : rng.pick(poolChoice.length > 0 ? poolChoice : completed.filter((m) => m.slug !== post.authorSlug));
        const latest = Math.min(postMs + 10 * DAY, nowMs - 5 * MINUTE);
        const createdMs = Math.min(postMs + rng.int(10 * MINUTE, Math.max(11 * MINUTE, latest - postMs)), nowMs - 5 * MINUTE);
        let body: string;
        if (longLeft.length > 0 && rng.chance(0.02 + (longLeft.length > 0 && i === langPosts.length - 1 ? 1 : 0))) {
          body = longLeft.shift()!;
        } else {
          body = commentBody(lang, post.theme);
          if (lang === "fr") body = agreeFrench(body, writer.g, author.g);
        }
        comments.push({ id: rng.uuid(), postId: post.id, authorSlug: writer.slug, body, createdAt: iso(createdMs), lang });
      }
    });
    // Any long comment not placed yet replaces an ordinary one on the busiest post.
    for (const text of longLeft) {
      const victim = comments.find((c) => c.lang === lang && c.body.length < COMMENT_MAX_LENGTH);
      if (victim) victim.body = text;
    }
    longLeft = [];
  }

  // --- likes -------------------------------------------------------------------------------------
  const likes: SeedLike[] = [];
  const likeBase = posts.map(() => {
    const r = rng.next();
    return r < 0.22 ? 0 : r < 0.95 ? 1 + Math.floor(-Math.log(1 - rng.next()) * 2.2) : rng.int(10, 18);
  });
  const likeWeights = posts.map(() => 0.5 + rng.next() * 2);
  const perPostLikes = fitTotal(likeBase.map((n) => Math.min(n, 20)), TARGETS.likes, rng, 28, likeWeights);
  posts.forEach((post, i) => {
    const postMs = Date.parse(post.createdAt);
    const candidates = rng.shuffle(completed.filter((m) => m.slug !== post.authorSlug && (!m.quiet || rng.chance(0.4))));
    for (const m of candidates.slice(0, perPostLikes[i])) {
      likes.push({ postId: post.id, userSlug: m.slug, createdAt: iso(Math.min(postMs + rng.int(2 * MINUTE, 6 * DAY), nowMs - 2 * MINUTE)) });
    }
  });
  // If a post had too few candidates, top the total up on other posts.
  const likeKeys = new Set(likes.map((l) => `${l.postId}:${l.userSlug}`));
  let guard = 0;
  while (likes.length < TARGETS.likes && guard++ < 100_000) {
    const post = posts[rng.int(0, posts.length - 1)];
    const m = rng.pick(completed);
    const key = `${post.id}:${m.slug}`;
    if (m.slug === post.authorSlug || likeKeys.has(key)) continue;
    likeKeys.add(key);
    likes.push({ postId: post.id, userSlug: m.slug, createdAt: iso(Math.min(Date.parse(post.createdAt) + rng.int(2 * MINUTE, 6 * DAY), nowMs - 2 * MINUTE)) });
  }

  // --- network: connections and follows ------------------------------------------------------------
  const connections: SeedConnection[] = [];
  const follows: SeedFollow[] = [];
  const pairKeys = new Set<string>();
  const followKeys = new Set<string>();
  const done = (arr: unknown[], n: number) => arr.length >= n;
  const pros = completed.filter((m) => ["hp", "sp", "ind", "ed", "rs"].includes(m.role));
  const students = completed.filter((m) => m.role === "ug" || m.role === "gr" || m.role === "rg");
  const researchers = completed.filter((m) => m.role === "rs");
  const mentors = completed.filter((m) => m.openToMentor);
  const seekers = completed.filter((m) => m.lookingForMentorship);
  const field = (m: SeedMember) => m.fields[0];
  const addConnection = (a: SeedMember, b: SeedMember, status: "pending" | "accepted") => {
    const key = [a.slug, b.slug].sort().join("|");
    if (a.slug === b.slug || pairKeys.has(key) || connections.length >= TARGETS.connections) return false;
    pairKeys.add(key);
    const createdMs = nowMs - rng.int(2, 100) * DAY - rng.int(0, 23) * HOUR;
    const acceptedMs = status === "accepted" ? Math.min(createdMs + rng.int(1, 120) * HOUR, nowMs - HOUR) : null;
    connections.push({
      id: rng.uuid(), requesterSlug: a.slug, addresseeSlug: b.slug, status, createdAt: iso(createdMs),
      acceptedAt: acceptedMs === null ? null : iso(acceptedMs),
    });
    return true;
  };
  const addFollow = (a: SeedMember, b: SeedMember) => {
    const key = `${a.slug}|${b.slug}`;
    if (a.slug === b.slug || followKeys.has(key) || follows.length >= TARGETS.follows) return false;
    followKeys.add(key);
    follows.push({ followerSlug: a.slug, followeeSlug: b.slug, createdAt: iso(nowMs - rng.int(1, 110) * DAY - rng.int(0, 23) * HOUR) });
    return true;
  };
  const pending = TARGETS.connections - TARGETS.acceptedConnections;
  // 1. Seekers ask mentors (some pending), 2. students ask professionals in their field,
  // 3. classmates, 4. researchers.
  for (const s of rng.shuffle(seekers)) {
    const options = mentors.filter((m) => field(m) === field(s));
    const target = options.length > 0 ? rng.pick(options) : rng.pick(mentors);
    addConnection(s, target, connections.filter((c) => c.status === "pending").length < pending ? "pending" : "accepted");
  }
  for (const s of rng.shuffle(students)) {
    const options = pros.filter((m) => field(m) === field(s) && m.lang === s.lang);
    if (options.length > 0 && !done(connections, 22)) {
      addConnection(s, rng.pick(options), connections.filter((c) => c.status === "pending").length < pending ? "pending" : "accepted");
    }
  }
  const classmates = rng.shuffle(students);
  for (let i = 0; i < classmates.length && connections.length < 34; i++) {
    const peer = classmates.find((o, j) => j !== i && (field(o) === field(classmates[i]) || o.cityKey === classmates[i].cityKey));
    if (peer) addConnection(classmates[i], peer, "accepted");
  }
  for (const r of rng.shuffle(researchers)) {
    for (const s of rng.sample(students, 2)) addConnection(s, r, "accepted");
  }
  while (connections.length < TARGETS.connections) {
    addConnection(rng.pick(completed), rng.pick(completed), "accepted");
  }
  // Keep exactly the requested number of accepted connections.
  const acceptedNow = connections.filter((c) => c.status === "accepted").length;
  if (acceptedNow !== TARGETS.acceptedConnections) {
    const diff = acceptedNow - TARGETS.acceptedConnections;
    for (const c of connections) {
      if (diff > 0 && c.status === "accepted" && connections.filter((x) => x.status === "accepted").length > TARGETS.acceptedConnections) {
        c.status = "pending";
        c.acceptedAt = null;
      } else if (diff < 0 && c.status === "pending" && connections.filter((x) => x.status === "accepted").length < TARGETS.acceptedConnections) {
        c.status = "accepted";
        c.acceptedAt = iso(Math.min(Date.parse(c.createdAt) + 6 * HOUR, nowMs - HOUR));
      }
    }
  }
  for (const s of rng.shuffle(students)) {
    const options = [...pros, ...mentors].filter((m) => field(m) === field(s));
    if (options.length > 0) addFollow(s, rng.pick(options));
  }
  for (const m of rng.shuffle(mentors)) for (const f of rng.sample(students, 2)) addFollow(f, m);
  for (const r of researchers) for (const f of rng.sample(completed, 3)) addFollow(f, r);
  while (follows.length < TARGETS.follows) addFollow(rng.pick(completed), rng.pick(completed));

  // --- profile creation dates: different ages, always before a member's first activity -------------
  const firstSeen = new Map<string, number>();
  const see = (slug: string, ms: number) => firstSeen.set(slug, Math.min(firstSeen.get(slug) ?? Infinity, ms));
  for (const p of posts) see(p.authorSlug, Date.parse(p.createdAt));
  for (const c of comments) see(c.authorSlug, Date.parse(c.createdAt));
  for (const l of likes) see(l.userSlug, Date.parse(l.createdAt));
  for (const c of connections) { see(c.requesterSlug, Date.parse(c.createdAt)); see(c.addresseeSlug, Date.parse(c.createdAt)); }
  for (const f of follows) { see(f.followerSlug, Date.parse(f.createdAt)); see(f.followeeSlug, Date.parse(f.createdAt)); }
  for (const m of members) {
    if (!m.complete) continue;
    const first = firstSeen.get(m.slug);
    const ms = first === undefined ? nowMs - rng.int(5, 120) * DAY : first - rng.int(2, 28) * DAY - (rng.chance(0.35) ? rng.int(30, 140) * DAY : 0);
    m.profileCreatedAt = iso(Math.min(ms, nowMs - DAY));
  }

  return {
    members,
    posts: posts.sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    comments, likes, connections, follows,
  };
}

// ---------------------------------------------------------------------------------------------
// Validation (mirrors the database constraints; the tests and the runner both use it)
// ---------------------------------------------------------------------------------------------

const enumValues = {
  memberType: MEMBER_TYPES.map((m) => m.value as string),
  field: FIELDS.map((f) => f.value as string),
  stage: CAREER_STAGES.map((s) => s.value as string),
  employment: EMPLOYMENT_TYPES.map((e) => e.value as string),
  purpose: PURPOSES.map((p) => p.value as string),
  category: POST_CATEGORIES.map((c) => c.value as string),
};
const LIMITS = { skill: 30, interest: 20, mentorship_area: 10 } as const;

export function validatePlan(plan: Plan, now: Date = new Date()): string[] {
  const problems: string[] = [];
  const bad = (message: string) => problems.push(message);
  const nowMs = now.getTime();
  const usernames = new Set<string>();
  const emails = new Set<string>();
  const slugs = new Set<string>();
  const countryCodes = new Set<string>(COUNTRY_CODES as readonly string[]);

  for (const m of plan.members) {
    const who = m.slug;
    if (slugs.has(m.slug)) bad(`${who}: duplicate slug`);
    slugs.add(m.slug);
    if (emails.has(m.email)) bad(`${who}: duplicate email`);
    emails.add(m.email);
    if (!/^seed\+[a-z0-9_]+@example\.com$/.test(m.email)) bad(`${who}: email not in the seed pattern`);
    if (m.firstName.length < 1 || m.firstName.length > 60) bad(`${who}: first name length`);
    if (m.lastName.length > 60) bad(`${who}: last name length`);
    if (m.username !== null) {
      if (!/^[a-z0-9_]{3,30}$/.test(m.username)) bad(`${who}: username format`);
      if ((RESERVED_USERNAMES as readonly string[]).includes(m.username)) bad(`${who}: reserved username`);
      if (usernames.has(m.username)) bad(`${who}: duplicate username`);
      usernames.add(m.username);
    }
    if (m.headline && m.headline.length > 120) bad(`${who}: headline length`);
    if (m.bio !== null) {
      if (m.bio.length > 1000) bad(`${who}: bio length`);
      if (!m.bio.endsWith(BIO_SUFFIX[m.lang])) bad(`${who}: bio must end with the fictional-profile marker in its language`);
    }
    if (m.journey && m.journey.length > 2000) bad(`${who}: journey length`);
    if (m.aspirations && m.aspirations.length > 1000) bad(`${who}: aspirations length`);
    if (m.locationLabel && m.locationLabel.length > 80) bad(`${who}: location length`);
    if (m.city && m.city.length > 80) bad(`${who}: city length`);
    for (const v of [m.institution, m.qualification, m.specialty]) {
      if (v && v.length > 120) bad(`${who}: institution/qualification/specialty length`);
    }
    if (!enumValues.memberType.includes(m.memberType)) bad(`${who}: member type`);
    for (const f of m.fields) if (!enumValues.field.includes(f)) bad(`${who}: field ${f}`);
    if (m.careerStage && !enumValues.stage.includes(m.careerStage)) bad(`${who}: career stage`);
    if (m.country && !countryCodes.has(m.country)) bad(`${who}: country`);
    for (const p of m.purposes) if (!enumValues.purpose.includes(p)) bad(`${who}: purpose`);
    if (m.complete) {
      if (!m.username || m.fields.length < 1 || !m.careerStage || !m.country) bad(`${who}: completed profile is missing essentials`);
    } else if (m.username !== null) bad(`${who}: incomplete members have no username`);

    for (const e of m.education) {
      if (e.institution.length < 1 || e.institution.length > 120) bad(`${who}: education institution`);
      if (e.qualification.length < 1 || e.qualification.length > 120) bad(`${who}: education qualification`);
      if (e.start_year < 1940 || e.start_year > 2100) bad(`${who}: education start year`);
      if (e.end_year !== null && (e.end_year < e.start_year || e.end_year > 2100)) bad(`${who}: education end year`);
      if (e.currently_studying && e.end_year !== null) bad(`${who}: current program with an end year`);
    }
    if (m.education.length > 20) bad(`${who}: too many education rows`);
    for (const x of m.experience) {
      if (x.title.length < 1 || x.title.length > 120) bad(`${who}: experience title`);
      if (x.organization.length < 1 || x.organization.length > 120) bad(`${who}: experience organization`);
      if (x.employment_type && !enumValues.employment.includes(x.employment_type)) bad(`${who}: employment type`);
      if (x.end_date !== null && x.end_date < x.start_date) bad(`${who}: experience dates out of order`);
      if (x.is_current && x.end_date !== null) bad(`${who}: current job with an end date`);
      if (x.description && x.description.length > 2000) bad(`${who}: experience description`);
    }
    if (m.experience.length > 30) bad(`${who}: too many experience rows`);

    const seen = new Set<string>();
    const perKind = { skill: 0, interest: 0, mentorship_area: 0 };
    for (const t of m.tags) {
      if (t.name.length < 2 || t.name.length > 40) bad(`${who}: tag length "${t.name}"`);
      if (t.name !== t.name.trim()) bad(`${who}: tag not trimmed`);
      if (/[<>]/.test(t.name)) bad(`${who}: tag has markup`);
      const key = `${t.kind}:${t.name.toLowerCase()}`;
      if (seen.has(key)) bad(`${who}: duplicate tag ${t.name}`);
      seen.add(key);
      perKind[t.kind]++;
    }
    for (const kind of Object.keys(LIMITS) as (keyof typeof LIMITS)[]) {
      if (perKind[kind] > LIMITS[kind]) bad(`${who}: too many ${kind} tags`);
    }
    if (m.complete && (m.tags.length < 3 || m.tags.length > 10)) bad(`${who}: expected 3-10 tags, got ${m.tags.length}`);
    if (!(Date.parse(m.profileCreatedAt) < nowMs)) bad(`${who}: profile created in the future`);
  }

  const completed = new Set(plan.members.filter((m) => m.complete).map((m) => m.slug));
  const memberCreated = new Map(plan.members.map((m) => [m.slug, Date.parse(m.profileCreatedAt)]));
  const postIds = new Set<string>();
  const postHour = new Map<string, number[]>();
  for (const p of plan.posts) {
    if (postIds.has(p.id)) bad(`post ${p.id}: duplicate id`);
    postIds.add(p.id);
    if (!completed.has(p.authorSlug)) bad(`post ${p.id}: author is not a completed member`);
    if (!enumValues.category.includes(p.category)) bad(`post ${p.id}: category`);
    if (!/\S/.test(p.body) || p.body.length > POST_MAX_LENGTH) bad(`post ${p.id}: body`);
    const created = Date.parse(p.createdAt);
    if (!(created < nowMs)) bad(`post ${p.id}: created in the future`);
    if (!(created > nowMs - (WINDOW_DAYS + 1) * DAY)) bad(`post ${p.id}: older than ${WINDOW_DAYS} days`);
    if (!(created > (memberCreated.get(p.authorSlug) ?? Infinity))) bad(`post ${p.id}: before its author's profile existed`);
    if (p.editedAt !== null && !(Date.parse(p.editedAt) > created && Date.parse(p.editedAt) < nowMs)) bad(`post ${p.id}: edited_at out of range`);
    (postHour.get(p.authorSlug) ?? postHour.set(p.authorSlug, []).get(p.authorSlug)!).push(created);
  }
  for (const [slug, times] of postHour) {
    for (const t of times) {
      if (times.filter((o) => o >= t && o < t + HOUR).length > 20) bad(`${slug}: more than 20 posts in an hour`);
    }
  }

  const commentIds = new Set<string>();
  const commentHour = new Map<string, number[]>();
  const postTime = new Map(plan.posts.map((p) => [p.id, Date.parse(p.createdAt)]));
  for (const c of plan.comments) {
    if (commentIds.has(c.id)) bad(`comment ${c.id}: duplicate id`);
    commentIds.add(c.id);
    if (!postTime.has(c.postId)) bad(`comment ${c.id}: unknown post`);
    if (!completed.has(c.authorSlug)) bad(`comment ${c.id}: author is not a completed member`);
    if (!/\S/.test(c.body) || c.body.length > COMMENT_MAX_LENGTH) bad(`comment ${c.id}: body`);
    const created = Date.parse(c.createdAt);
    if (!(created > (postTime.get(c.postId) ?? Infinity))) bad(`comment ${c.id}: not after its post`);
    if (!(created < nowMs)) bad(`comment ${c.id}: created in the future`);
    if (!(created > (memberCreated.get(c.authorSlug) ?? Infinity))) bad(`comment ${c.id}: before its author's profile existed`);
    (commentHour.get(c.authorSlug) ?? commentHour.set(c.authorSlug, []).get(c.authorSlug)!).push(created);
  }
  for (const [slug, times] of commentHour) {
    for (const t of times) {
      if (times.filter((o) => o >= t && o < t + HOUR).length > 60) bad(`${slug}: more than 60 comments in an hour`);
    }
  }

  const likePairs = new Set<string>();
  for (const l of plan.likes) {
    const key = `${l.postId}:${l.userSlug}`;
    if (likePairs.has(key)) bad(`like ${key}: duplicate`);
    likePairs.add(key);
    if (!postTime.has(l.postId)) bad(`like ${key}: unknown post`);
    if (!completed.has(l.userSlug)) bad(`like ${key}: member is not completed`);
    if (!(Date.parse(l.createdAt) > (postTime.get(l.postId) ?? Infinity))) bad(`like ${key}: not after its post`);
    if (!(Date.parse(l.createdAt) < nowMs)) bad(`like ${key}: created in the future`);
  }

  const pairs = new Set<string>();
  for (const c of plan.connections) {
    const key = [c.requesterSlug, c.addresseeSlug].sort().join("|");
    if (c.requesterSlug === c.addresseeSlug) bad(`connection ${key}: self`);
    if (pairs.has(key)) bad(`connection ${key}: duplicate pair`);
    pairs.add(key);
    if (!completed.has(c.requesterSlug) || !completed.has(c.addresseeSlug)) bad(`connection ${key}: member not completed`);
    if (c.status === "accepted" ? c.acceptedAt === null : c.acceptedAt !== null) bad(`connection ${key}: status and accepted_at disagree`);
    if (!(Date.parse(c.createdAt) < nowMs)) bad(`connection ${key}: in the future`);
    if (c.acceptedAt !== null && !(Date.parse(c.acceptedAt) > Date.parse(c.createdAt) && Date.parse(c.acceptedAt) < nowMs)) bad(`connection ${key}: accepted_at out of range`);
  }
  const followPairs = new Set<string>();
  for (const f of plan.follows) {
    const key = `${f.followerSlug}|${f.followeeSlug}`;
    if (f.followerSlug === f.followeeSlug) bad(`follow ${key}: self`);
    if (followPairs.has(key)) bad(`follow ${key}: duplicate`);
    followPairs.add(key);
    if (!completed.has(f.followerSlug) || !completed.has(f.followeeSlug)) bad(`follow ${key}: member not completed`);
    if (!(Date.parse(f.createdAt) < nowMs)) bad(`follow ${key}: in the future`);
  }
  return problems;
}

export const PAGE_SIZE = FEED_PAGE_SIZE;

/** Counts used by the dry run, the verifier and the report. */
export function describePlan(plan: Plan) {
  const tally = <T>(items: T[], key: (item: T) => string) => {
    const out: Record<string, number> = {};
    for (const item of items) out[key(item)] = (out[key(item)] ?? 0) + 1;
    return out;
  };
  const byRole: Record<Role, string> = { ug: "student", gr: "student", rg: "professional", hp: "professional", sp: "professional", ed: "educator", rs: "researcher", ind: "independent" };
  const members = plan.members;
  return {
    members: members.length,
    completed: members.filter((m) => m.complete).length,
    incomplete: members.filter((m) => !m.complete).length,
    byCity: tally(members, (m) => m.cityKey),
    byRole: tally(members, (m) => byRole[m.role]),
    byLanguage: tally(members, (m) => m.lang),
    openToMentor: members.filter((m) => m.openToMentor).length,
    lookingForMentorship: members.filter((m) => m.lookingForMentorship).length,
    avatars: members.filter((m) => m.avatar).length,
    covers: members.filter((m) => m.cover).length,
    education: members.reduce((n, m) => n + m.education.length, 0),
    experience: members.reduce((n, m) => n + m.experience.length, 0),
    tags: members.reduce((n, m) => n + m.tags.length, 0),
    posts: plan.posts.length,
    postsByCategory: tally(plan.posts, (p) => p.category),
    postsByLanguage: tally(plan.posts, (p) => p.lang),
    questions: plan.posts.filter((p) => p.category === "questions").length,
    editedPosts: plan.posts.filter((p) => p.editedAt).length,
    comments: plan.comments.length,
    commentsByLanguage: tally(plan.comments, (c) => c.lang),
    likes: plan.likes.length,
    connections: plan.connections.length,
    acceptedConnections: plan.connections.filter((c) => c.status === "accepted").length,
    follows: plan.follows.length,
  };
}
