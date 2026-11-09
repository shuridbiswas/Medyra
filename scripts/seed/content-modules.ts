import type { Lang } from "./people.ts";

/** Hand-written fictional text for communities, mentorship, messaging and moderation. */

export type CommunitySpec = {
  slug: string;
  lang: Lang;
  name: string;
  description: string;
  kind: "profession" | "institution" | "research" | "regional" | "interest";
  visibility: "public" | "private";
  institution?: string;
  region?: string;
  /** Field that members are mostly drawn from, if any. */
  field?: string;
};

export const COMMUNITIES: CommunitySpec[] = [
  { slug: "seed-infirmieres-grand-montreal", lang: "fr", name: "Infirmières et infirmiers du Grand Montréal", description: "Un espace pour échanger sur la pratique, les stages et les parcours en soins infirmiers dans la région métropolitaine. Pas de cas de patients, seulement des questions et des expériences générales.", kind: "profession", visibility: "public", region: "Montréal, QC", field: "nursing" },
  { slug: "seed-etudiants-sante-udem", lang: "fr", name: "Étudiants en santé à l'Université de Montréal", description: "Entraide entre étudiantes et étudiants des programmes de santé : horaires de stage, méthodes d'étude, conseils de cohorte. Groupe non officiel, créé par des membres.", kind: "institution", visibility: "public", institution: "Université de Montréal", region: "Montréal, QC" },
  { slug: "seed-mcgill-health-students", lang: "en", name: "McGill health sciences students", description: "A peer space for students in health programs at McGill: placements, study habits, research assistant jobs and life between campuses. Unofficial and member-run.", kind: "institution", visibility: "public", institution: "Université McGill", region: "Montréal, QC" },
  { slug: "seed-psychologie-cycles-superieurs", lang: "fr", name: "Psychologie aux cycles supérieurs", description: "Demandes d'admission, choix de laboratoire, rédaction de mémoire : on se partage les trucs qui ont fonctionné, sans prétendre connaître les règles de chaque programme.", kind: "profession", visibility: "public", field: "psychology" },
  { slug: "seed-travail-social-terrain", lang: "fr", name: "Travail social sur le terrain", description: "Pour les stagiaires et les intervenantes et intervenants en travail social qui veulent parler de pratique réflexive, de limites professionnelles et de soutien entre pairs.", kind: "profession", visibility: "public", field: "social_work" },
  { slug: "seed-pharmacie-communautaire", lang: "fr", name: "Pharmacie communautaire au Québec", description: "Discussions générales sur la formation, les stages et la vie en pharmacie communautaire. Aucune question propre à une personne en particulier, seulement des échanges pour apprendre.", kind: "profession", visibility: "public", field: "pharmacy" },
  { slug: "seed-physio-readaptation", lang: "fr", name: "Physiothérapie et réadaptation", description: "Stages cliniques, examens pratiques, premiers emplois : un lieu pour les futures et actuelles physiothérapeutes et ergothérapeutes qui aiment comparer leurs expériences.", kind: "profession", visibility: "public", field: "physiotherapy" },
  { slug: "seed-ergo-orthophonie", lang: "fr", name: "Ergothérapie et orthophonie", description: "Communauté sur invitation pour les étudiantes, étudiants et professionnels en réadaptation qui préfèrent échanger entre pairs dans un cadre plus restreint.", kind: "profession", visibility: "private", field: "occupational_therapy" },
  { slug: "seed-recherche-clinique-quebec", lang: "fr", name: "Recherche clinique au Québec", description: "Assistantes et assistants de recherche, coordonnatrices et coordonnateurs, étudiants aux cycles supérieurs : partage de ressources, de formations et d'expériences de terrain.", kind: "research", visibility: "public", region: "Québec" },
  { slug: "seed-sante-publique-quebec", lang: "fr", name: "Santé publique et politiques", description: "Épidémiologie, promotion de la santé, évaluation de programmes : un fil pour discuter d'articles, de méthodes et de parcours en santé publique.", kind: "research", visibility: "public", field: "public_health" },
  { slug: "seed-rive-sud-sante", lang: "fr", name: "Santé sur la Rive-Sud", description: "Pour les membres de Longueuil, Brossard, Châteauguay et des environs : covoiturage de stage, offres de bénévolat et rencontres informelles entre collègues.", kind: "regional", visibility: "public", region: "Longueuil, QC" },
  { slug: "seed-laval-reseau-sante", lang: "fr", name: "Réseau santé de Laval", description: "Un coin de Laval pour les étudiantes, étudiants et professionnels de la santé et des services sociaux : trajets, stages locaux et soutien entre voisins.", kind: "regional", visibility: "public", region: "Laval, QC" },
  { slug: "seed-couronne-nord-sante", lang: "fr", name: "Couronne Nord : santé et services sociaux", description: "Terrebonne, Repentigny, Saint-Jérôme et les environs : partage d'expériences de stage, de travail et de conciliation avec les déplacements.", kind: "regional", visibility: "public", region: "Saint-Jérôme, QC" },
  { slug: "seed-estrie-sante", lang: "fr", name: "Estrie : santé et études", description: "Sherbrooke et ses environs : étudiantes, étudiants et professionnels qui veulent se rencontrer, partager des ressources et s'entraider.", kind: "regional", visibility: "public", region: "Sherbrooke, QC" },
  { slug: "seed-mentorat-premiers-pas", lang: "fr", name: "Mentorat : premiers pas", description: "Groupe sur approbation pour les personnes qui cherchent ou offrent du mentorat. On y parle d'attentes, de fréquence et de bonnes questions à poser. L'expertise de chacun est autodéclarée.", kind: "interest", visibility: "private" },
  { slug: "seed-etudier-et-travailler", lang: "fr", name: "Étudier et travailler en même temps", description: "Horaires, négociation avec l'employeur, aide financière, repos : un lieu pour celles et ceux qui jonglent entre études en santé et emploi.", kind: "interest", visibility: "public" },
  { slug: "seed-new-grads-quebec", lang: "en", name: "New grads in Quebec health", description: "For recent graduates finding their feet: first jobs, licensing paperwork questions in general terms, and honest stories about the first year. Nothing here replaces official guidance.", kind: "interest", visibility: "public" },
  { slug: "seed-cegep-vers-universite", lang: "fr", name: "Du cégep à l'université", description: "Groupe sur approbation pour les finissantes et finissants de cégep qui préparent leur passage vers un programme de santé, et pour les étudiants qui ont déjà fait le saut.", kind: "institution", visibility: "private" },
  { slug: "seed-enseignement-clinique", lang: "fr", name: "Enseignement clinique et supervision", description: "Groupe restreint pour les enseignantes, enseignants et superviseurs de stage qui veulent échanger sur l'accompagnement des étudiantes et étudiants.", kind: "profession", visibility: "private" },
  { slug: "seed-bien-etre-etudiant", lang: "fr", name: "Bien-être étudiant", description: "Conseils entre pairs sur le sommeil, la charge de travail et les pauses. Ce n'est ni une thérapie ni un service de crise : en cas de détresse, consultez une ressource professionnelle.", kind: "interest", visibility: "public" },
];

export const COMMUNITY_RULES: Record<Lang, string> = {
  fr: "1. Respect avant tout. 2. Aucune information permettant d'identifier un patient ou un client. 3. Pas de conseils médicaux : on partage des expériences. 4. Pas de publicité. 5. Signalez plutôt que de répondre à la provocation.",
  en: "1. Be respectful. 2. Never share information that could identify a patient or client. 3. No medical advice: we share experiences. 4. No advertising. 5. Report instead of engaging with provocation.",
};

export const ANNOUNCEMENTS: Record<Lang, { title: string; body: string }[]> = {
  fr: [
    { title: "Bienvenue dans le groupe", body: "Merci d'être ici. Prenez deux minutes pour lire les règles, puis présentez-vous si le cœur vous en dit. Les questions de débutantes et débutants sont les bienvenues." },
    { title: "Rappel sur la confidentialité", body: "Aucun détail permettant d'identifier une personne soignée ne doit être publié, même modifié. En cas de doute, reformulez en scénario général ou abstenez-vous." },
    { title: "Fil de partage d'horaires de stage", body: "Ce mois-ci, nous ouvrons un fil pour comparer les horaires de stage et les astuces de déplacement. Soyez brefs et gentils." },
    { title: "Nouvelle personne à la modération", body: "Une nouvelle personne se joint à la modération pour répondre plus vite aux demandes d'adhésion. Merci de votre patience." },
    { title: "Pause des fêtes", body: "La modération sera plus lente pendant la période des fêtes. Les signalements restent possibles en tout temps." },
  ],
  en: [
    { title: "Welcome to the group", body: "Thanks for being here. Please take two minutes to read the rules, then introduce yourself if you like. Beginner questions are very welcome." },
    { title: "Reminder about confidentiality", body: "Never post details that could identify someone in care, even altered ones. If unsure, rewrite as a general scenario or leave it out." },
    { title: "Placement schedule thread", body: "This month we're opening a thread to compare placement schedules and commuting tips. Keep it short and kind." },
  ],
};

export const MENTOR_BIO: Record<Lang, string[]> = {
  fr: [
    "Après plusieurs années de pratique, j'aime accompagner des étudiantes et étudiants dans leurs premiers stages et leurs choix de parcours. Je pose beaucoup de questions et j'impose peu de réponses.",
    "J'ai changé de milieu deux fois et ça m'a appris à écouter avant de conseiller. Je peux aider à réfléchir à une transition, à une demande d'admission ou à la conciliation études-travail.",
    "J'enseigne et je supervise des stages depuis longtemps. Mon rôle de mentor, c'est d'offrir un regard extérieur, jamais de remplacer un superviseur de stage.",
    "Je travaille en pratique autonome et je sais que démarrer seul peut être intimidant. Je partage volontiers mes essais, mes erreurs et ce que je referais autrement.",
    "Mon parcours passe par la recherche et la clinique. J'aime aider les gens à voir comment les deux se parlent, et à choisir un premier projet réaliste.",
    "J'ai fait mes études en travaillant. Je peux parler d'horaires, de fatigue et de petites stratégies qui m'ont aidée à tenir.",
  ],
  en: [
    "After several years in practice I enjoy supporting students through their first placements and career choices. I ask a lot of questions and offer few answers.",
    "I've changed workplaces twice and learned to listen before advising. I can help you think through a transition, an application or balancing work and study.",
    "I've worked in teaching and supervision for years. As a mentor I offer an outside view, never a replacement for a placement supervisor.",
  ],
};

export const MENTOR_EXPERTISE: Record<Lang, string[]> = {
  fr: ["Entrée dans la profession", "Études supérieures et recherche", "Pratique privée", "Stages cliniques", "Conciliation études-travail", "Transition de carrière"],
  en: ["Entering the profession", "Graduate studies and research", "Private practice", "Clinical placements", "Balancing work and study", "Career transitions"],
};

export const MENTOR_TOPICS = ["placements", "career-change", "grad-school", "private-practice", "research", "work-study", "first-job", "teaching"];

export const MENTEE_GOALS: Record<Lang, string[]> = {
  fr: [
    "J'aimerais mieux comprendre comment préparer mes demandes d'admission à la maîtrise et choisir un laboratoire. Une rencontre par mois me conviendrait très bien.",
    "Je commence mon premier stage bientôt et j'aimerais discuter de la façon de poser des questions sans déranger l'équipe, et d'organiser mes notes.",
    "Je cherche un regard extérieur sur mon choix entre la pratique clinique et la recherche. Je n'attends pas de réponse toute faite, seulement des pistes.",
    "J'aimerais apprendre à concilier un emploi à temps partiel et mes études sans m'épuiser. Quelques conseils pratiques m'aideraient beaucoup.",
    "Je termine bientôt mes études et je voudrais préparer mes premières entrevues. Je souhaite surtout savoir quelles questions poser aux employeurs.",
    "Je voudrais explorer la pratique autonome un jour et comprendre par quoi commencer, dans les grandes lignes, sans entrer dans les détails réglementaires.",
  ],
  en: [
    "I'd like to understand how to prepare graduate applications and choose a lab. One meeting a month would suit me well.",
    "I'm starting my first placement soon and want to talk about asking questions without disturbing the team, and organizing my notes.",
    "I'm looking for an outside view on choosing between clinical practice and research. I don't expect ready-made answers, only directions.",
  ],
};

export const MENTOR_REPLY: Record<Lang, string[]> = {
  fr: ["Avec plaisir, présentons-nous cette semaine.", "Merci pour ta demande, ça me fera plaisir d'en discuter."],
  en: ["Happy to, let's set up a first chat this week.", "Thanks for asking, I'd be glad to talk it through."],
};
export const MENTOR_DECLINE: Record<Lang, string[]> = {
  fr: ["Merci de ta demande. Ma capacité est atteinte pour l'instant, mais je te souhaite le meilleur."],
  en: ["Thanks for asking. My capacity is full right now, but I wish you all the best."],
};
export const FEEDBACK: Record<Lang, string[]> = {
  fr: ["Des échanges simples et utiles. J'ai quitté chaque rencontre avec une piste concrète.", "Une écoute attentive et des questions justes. Merci pour le temps offert."],
  en: ["Simple and useful conversations. I left each meeting with something concrete.", "Attentive listening and good questions. Thank you for the time."],
};

export const MESSAGES: Record<Lang, string[]> = {
  fr: [
    "Salut! J'ai vu ton message sur les stages, est-ce que tu aurais cinq minutes pour qu'on en parle?",
    "Merci pour la réponse hier, ça m'a vraiment aidé.",
    "Tu as déjà pris un cours avec cette professeure? On m'a dit qu'elle était très claire.",
    "Je finis à 16 h demain, on se rejoint à la bibliothèque après?",
    "Bonne chance pour ton examen, tu vas t'en sortir.",
    "As-tu retrouvé le document que tu cherchais pour ton travail?",
    "Je t'envoie le lien de l'article dont je te parlais, il est assez court.",
    "Super, merci! On se reparle en fin de semaine.",
    "Est-ce que ton groupe d'étude a encore de la place?",
    "Bravo pour ta présentation, elle était très bien structurée.",
    "J'ai changé mon horaire de stage, je te donne des nouvelles bientôt.",
    "Ça te tente d'aller marcher dehors après la période de lecture?",
    "Merci d'avoir partagé tes notes, c'est généreux.",
    "Je suis un peu stressée cette semaine, mais ça va aller.",
    "On se dit à lundi alors, bonne fin de journée!",
    "Tu connais un bon café calme près du campus?",
  ],
  en: [
    "Hi! I saw your post about placements, do you have five minutes to chat?",
    "Thanks for the reply yesterday, it really helped.",
    "Have you taken a class with that professor? I heard she's very clear.",
    "I finish at 4 tomorrow, want to meet at the library after?",
    "Good luck with your exam, you'll do fine.",
    "Did you ever find the document you were looking for?",
    "Sending the link to the article I mentioned, it's pretty short.",
    "Great, thanks! Let's talk again at the end of the week.",
    "Does your study group still have room?",
    "Congrats on the presentation, it was really well structured.",
  ],
};

export const GROUP_TITLES: Record<Lang, string[]> = {
  fr: ["Cohorte stage hiver", "Groupe d'étude du mercredi", "Covoiturage Rive-Sud"],
  en: ["Placement cohort", "Wednesday study group"],
};

/** Benign synthetic report details: nothing about real people or clinical situations. */
export const REPORT_DETAILS = [
  "[seed] Test report: this looks like an advertisement.",
  "[seed] Test report: off topic for this group.",
  "[seed] Test report: the tone seems unfriendly.",
  "[seed] Test report: possibly shares too much personal detail.",
];

export const WARN_MESSAGE = "Your post was reviewed and does not follow the community guidelines. Please read them again before posting.";
export const APPEAL_MESSAGE = "I believe this decision was a mistake. The post was a general question about studying.";
