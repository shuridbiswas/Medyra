import type { RequestStatus } from "@/features/student-verification/machine";

/**
 * All wording for student verification, English and French. The language comes from `?lang=fr|en`
 * (default English); the app has no wider localisation layer yet. Institution names are never
 * translated by hand: they come from the registry (`name_en` / `name_fr`).
 */
export type Lang = "en" | "fr";
export const parseLang = (value: unknown): Lang => (value === "fr" ? "fr" : "en");

type Pair = { en: string; fr: string };
const pick = (p: Pair, lang: Lang) => p[lang];

export const CLAIM_LABEL: Record<string, Pair> = {
  CURRENT_STUDENT: { en: "Current student", fr: "Étudiant actuel" },
  CURRENT_PROGRAM_STUDENT: { en: "Current program student", fr: "Étudiant actuel du programme" },
};

export const METHOD_LABEL: Record<string, Pair> = {
  INSTITUTIONAL_EMAIL: { en: "School email", fr: "Courriel scolaire" },
  ISSUER_BACKED_DOCUMENT_SHARE: { en: "Issuer-backed document share", fr: "Partage de document par l'émetteur" },
  OFFICIAL_ATTESTATION_REVIEW: { en: "Official enrolment evidence", fr: "Preuve officielle d'inscription" },
  REGISTRAR_CONFIRMATION: { en: "Registrar confirmation", fr: "Confirmation du registraire" },
  FEDERATED_INSTITUTION_LOGIN: { en: "Institutional login", fr: "Connexion institutionnelle" },
};

export const METHOD_HELP: Record<string, Pair> = {
  ISSUER_BACKED_DOCUMENT_SHARE: {
    en: "The school shares an official document with Medyra through its own credential platform. A reviewer validates it.",
    fr: "L'établissement partage un document officiel avec Medyra par sa propre plateforme. Un évaluateur le valide.",
  },
  OFFICIAL_ATTESTATION_REVIEW: {
    en: "Upload an official attestation (PDF, JPG or PNG). A reviewer checks the issuer and the document before anything is approved.",
    fr: "Téléversez une attestation officielle (PDF, JPG ou PNG). Un évaluateur vérifie l'émetteur et le document avant toute approbation.",
  },
  REGISTRAR_CONFIRMATION: {
    en: "You authorise Medyra to ask the registrar to confirm your enrolment through the school's own procedure. A reviewer records the answer.",
    fr: "Vous autorisez Medyra à demander au registraire de confirmer votre inscription par la procédure de l'établissement. Un évaluateur consigne la réponse.",
  },
};

export const STATUS_LABEL: Record<RequestStatus, Pair> = {
  DRAFT: { en: "Draft", fr: "Brouillon" },
  AWAITING_EMAIL_VERIFICATION: { en: "Waiting for school email code", fr: "En attente du code du courriel scolaire" },
  AWAITING_EVIDENCE: { en: "Add your official evidence", fr: "Ajoutez votre preuve officielle" },
  SUBMITTED: { en: "Submitted, waiting for a reviewer", fr: "Soumise, en attente d'un évaluateur" },
  UNDER_REVIEW: { en: "Under review", fr: "En cours d'examen" },
  MORE_INFORMATION_REQUIRED: { en: "More information needed", fr: "Renseignements supplémentaires requis" },
  APPROVED: { en: "Approved", fr: "Approuvée" },
  REJECTED: { en: "Not approved", fr: "Non approuvée" },
  WITHDRAWN: { en: "Withdrawn", fr: "Retirée" },
  EXPIRED: { en: "Expired", fr: "Expirée" },
  REVOKED: { en: "Revoked", fr: "Révoquée" },
};

export const NEXT_STEP: Partial<Record<RequestStatus, Pair>> = {
  DRAFT: { en: "Confirm your school email (optional) or continue to the evidence step.", fr: "Confirmez votre courriel scolaire (facultatif) ou passez à la preuve." },
  AWAITING_EMAIL_VERIFICATION: { en: "Enter the code we emailed to your school address, or skip this step.", fr: "Saisissez le code envoyé à votre adresse scolaire, ou ignorez cette étape." },
  AWAITING_EVIDENCE: { en: "Get your official document, add it below, then accept the consent statement and submit.", fr: "Obtenez votre document officiel, ajoutez-le ci-dessous, acceptez la déclaration de consentement et soumettez." },
  SUBMITTED: { en: "Nothing to do. A reviewer will pick this up.", fr: "Rien à faire. Un évaluateur prendra la demande en charge." },
  UNDER_REVIEW: { en: "Nothing to do. A reviewer is checking your evidence.", fr: "Rien à faire. Un évaluateur vérifie votre preuve." },
  MORE_INFORMATION_REQUIRED: { en: "Read the reviewer's note, add what is missing and submit again.", fr: "Lisez la note de l'évaluateur, ajoutez ce qui manque et soumettez de nouveau." },
  APPROVED: { en: "You are verified for the scope shown. It lapses on the date shown.", fr: "Vous êtes vérifié pour la portée indiquée. Elle prend fin à la date indiquée." },
  REJECTED: { en: "You can start a new request with better evidence.", fr: "Vous pouvez faire une nouvelle demande avec une meilleure preuve." },
  EXPIRED: { en: "Start a new request to renew.", fr: "Faites une nouvelle demande pour renouveler." },
  REVOKED: { en: "Start a new request if this was a mistake.", fr: "Faites une nouvelle demande s'il s'agit d'une erreur." },
};

export const REASON_LABEL: Record<string, Pair> = {
  approved: { en: "Approved", fr: "Approuvée" },
  not_current: { en: "Enrolment is not current", fr: "L'inscription n'est pas à jour" },
  program_not_confirmed: { en: "Program not confirmed", fr: "Programme non confirmé" },
  identity_mismatch: { en: "Identity could not be matched", fr: "Identité non concordante" },
  unverifiable_document: { en: "Document could not be verified", fr: "Document non vérifiable" },
  duplicate_identity: { en: "Already verified on another account", fr: "Déjà vérifié sur un autre compte" },
  wrong_institution: { en: "Different institution", fr: "Autre établissement" },
  withdrawn: { en: "Withdrawn", fr: "Retirée" },
  expired: { en: "Expired", fr: "Expirée" },
  revoked_fraud: { en: "Removed: misleading evidence", fr: "Retiré : preuve trompeuse" },
  revoked_error: { en: "Removed: issued in error", fr: "Retiré : émis par erreur" },
  revoked_member_request: { en: "Removed at your request", fr: "Retiré à votre demande" },
  other: { en: "Other reason", fr: "Autre raison" },
};

export const t = {
  title: { en: "Student verification", fr: "Vérification étudiante" } as Pair,
  intro: {
    en: "Verification is optional. You can use Medyra without it, and your profile and posts stay as they are. A badge shows only while an approved, unexpired credential exists. Medyra checks student status, not a right to practise any profession.",
    fr: "La vérification est facultative. Vous pouvez utiliser Medyra sans elle, et votre profil et vos publications restent inchangés. Un badge n'apparaît que tant qu'un titre approuvé et non expiré existe. Medyra vérifie le statut étudiant, pas le droit d'exercer une profession.",
  } as Pair,
  country: { en: "Country", fr: "Pays" } as Pair,
  countryValue: { en: "Canada (Quebec)", fr: "Canada (Québec)" } as Pair,
  institution: { en: "Institution", fr: "Établissement" } as Pair,
  program: { en: "Academic program", fr: "Programme d'études" } as Pair,
  noProgram: { en: "General student status (no program)", fr: "Statut étudiant général (sans programme)" } as Pair,
  noPrograms: {
    en: "No program for this institution has been reviewed against its official catalogue yet, so only general student status can be requested.",
    fr: "Aucun programme de cet établissement n'a encore été validé selon son catalogue officiel; seul le statut étudiant général peut être demandé.",
  } as Pair,
  method: { en: "How will you prove it?", fr: "Comment le prouverez-vous?" } as Pair,
  start: { en: "Start verification", fr: "Commencer la vérification" } as Pair,
  continueTo: { en: "Continue", fr: "Continuer" } as Pair,
  schoolEmail: { en: "School email", fr: "Courriel scolaire" } as Pair,
  schoolEmailHelp: {
    en: "Optional. It proves you control a school address; it never verifies enrolment by itself.",
    fr: "Facultatif. Cela prouve que vous contrôlez une adresse scolaire; cela ne vérifie jamais l'inscription à lui seul.",
  } as Pair,
  noEmailStep: {
    en: "Medyra has not confirmed an email domain for this institution, so this step is skipped. Use the official evidence below.",
    fr: "Medyra n'a pas confirmé de domaine courriel pour cet établissement; cette étape est ignorée. Utilisez la preuve officielle ci-dessous.",
  } as Pair,
  sendCode: { en: "Send code", fr: "Envoyer le code" } as Pair,
  code: { en: "Code", fr: "Code" } as Pair,
  confirmCode: { en: "Confirm code", fr: "Confirmer le code" } as Pair,
  skip: { en: "Skip this step", fr: "Ignorer cette étape" } as Pair,
  officialSource: { en: "Official instructions", fr: "Instructions officielles" } as Pair,
  openSource: { en: "Open the official page", fr: "Ouvrir la page officielle" } as Pair,
  unconfirmedInstitution: {
    en: "Medyra has not yet documented this institution's process. Ask the registrar for an official current-enrolment attestation for the present term.",
    fr: "Medyra n'a pas encore documenté la procédure de cet établissement. Demandez au registraire une attestation officielle d'inscription pour la session en cours.",
  } as Pair,
  evidence: { en: "Your evidence", fr: "Votre preuve" } as Pair,
  upload: { en: "Upload a file (PDF, JPG or PNG, up to 5 MB)", fr: "Téléverser un fichier (PDF, JPG ou PNG, 5 Mo max.)" } as Pair,
  reference: { en: "Or paste an issuer share number or link", fr: "Ou collez un numéro ou lien de partage de l'émetteur" } as Pair,
  referenceHelp: {
    en: "Medyra never opens a pasted link. A reviewer uses the institution's own validation service.",
    fr: "Medyra n'ouvre jamais un lien collé. Un évaluateur utilise le service de validation de l'établissement.",
  } as Pair,
  add: { en: "Add", fr: "Ajouter" } as Pair,
  neverSend: {
    en: "Never send a SIN, health insurance card, any password, or a full transcript with grades.",
    fr: "N'envoyez jamais un NAS, une carte d'assurance maladie, un mot de passe ou un relevé de notes complet.",
  } as Pair,
  consentTitle: { en: "Review and consent", fr: "Examen et consentement" } as Pair,
  consent: {
    en: "Medyra collects the document or reference you add, the institution and program you choose, and the decision. It does this only to check that you are a current student. Only Medyra's verification reviewers can open your evidence, through short-lived links. Evidence is deleted after a retention period (currently {days} days, pending legal review) and is never used for anything else. Only the credential scope, institution, method and dates are shown to other members. You can withdraw at any time.",
    fr: "Medyra recueille le document ou la référence que vous ajoutez, l'établissement et le programme choisis, ainsi que la décision. Elle le fait uniquement pour vérifier que vous êtes étudiant actuel. Seuls les évaluateurs de vérification de Medyra peuvent ouvrir votre preuve, par des liens de courte durée. La preuve est supprimée après une période de conservation (actuellement {days} jours, sous réserve d'examen juridique) et n'est jamais utilisée autrement. Seuls la portée du titre, l'établissement, la méthode et les dates sont visibles par les autres membres. Vous pouvez vous retirer en tout temps.",
  } as Pair,
  consentCheck: { en: "I have read this and agree to a review of my evidence.", fr: "J'ai lu ce texte et j'accepte l'examen de ma preuve." } as Pair,
  submit: { en: "Submit for review", fr: "Soumettre pour examen" } as Pair,
  withdraw: { en: "Withdraw request", fr: "Retirer la demande" } as Pair,
  status: { en: "Status", fr: "Statut" } as Pair,
  history: { en: "History", fr: "Historique" } as Pair,
  noRequests: { en: "You have no requests yet.", fr: "Vous n'avez encore aucune demande." } as Pair,
  currentCredentials: { en: "Your credentials", fr: "Vos titres" } as Pair,
  noCredentials: { en: "You are not verified. Your profile and posts still work as before.", fr: "Vous n'êtes pas vérifié. Votre profil et vos publications fonctionnent comme avant." } as Pair,
  validUntil: { en: "Valid until", fr: "Valide jusqu'au" } as Pair,
  reviewerNote: { en: "Reviewer's note", fr: "Note de l'évaluateur" } as Pair,
  scopeNote: { en: "Credential scope: student status, not professional licensure", fr: "Portée du titre : statut étudiant, et non permis d'exercer" } as Pair,
  verified: { en: "Verified", fr: "Vérifié" } as Pair,
  notVerified: { en: "Not Verified", fr: "Non vérifié" } as Pair,
  credential: { en: "Credential", fr: "Titre" } as Pair,
  lastVerified: { en: "Last verified", fr: "Dernière vérification" } as Pair,
  verificationMethod: { en: "Verification method", fr: "Méthode de vérification" } as Pair,
  backToVerification: { en: "Back to verification", fr: "Retour à la vérification" } as Pair,
};

export const text = (p: Pair, lang: Lang) => pick(p, lang);

const STUDENT_NOUN: Record<string, Pair> = {
  nursing: { en: "Nursing Student", fr: "Étudiant en sciences infirmières" },
  medicine: { en: "Medical Student", fr: "Étudiant en médecine" },
};

export type BadgeCredential = {
  claim_type: string;
  institution_name: string;
  institution_name_en?: string | null;
  institution_name_fr?: string | null;
  program_name: string | null;
  category: string | null;
  category_label_en: string | null;
  category_label_fr: string | null;
  verification_method: string;
  verified_at: string;
  expires_at: string;
};

/** "Nursing Student" for a confirmed program, or just "Student": exactly what was verified, no more. */
export function credentialTitle(c: BadgeCredential, lang: Lang): string {
  if (c.claim_type === "CURRENT_PROGRAM_STUDENT" && c.category) {
    const noun = STUDENT_NOUN[c.category];
    if (noun) return noun[lang];
    const label = (lang === "fr" ? c.category_label_fr : c.category_label_en) ?? c.program_name ?? "";
    return lang === "fr" ? `Étudiant · ${label}` : `${label} Student`;
  }
  return lang === "fr" ? "Étudiant" : "Student";
}

export const institutionName = (c: BadgeCredential, lang: Lang) =>
  (lang === "fr" ? c.institution_name_fr : c.institution_name_en) ?? c.institution_name;
