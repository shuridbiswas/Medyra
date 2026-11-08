/**
 * Medyra transactional email templates. Pure functions: they return a subject plus HTML and a
 * plain-text alternative, and never send anything.
 *
 * Authentication emails (sign-up confirmation, password recovery) are NOT built here. Supabase
 * Auth sends them (through Resend SMTP, see EMAIL_SETUP.md) using supabase/templates/*.html, so
 * there is exactly one system sending auth mail.
 */

export type EmailMessage = { subject: string; html: string; text: string };

/** Escape anything dynamic before it goes into HTML. Member names are user-supplied. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const MAROON = "#7a1f35";
const INK = "#2b1a20";

export function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

function layout(opts: { preheader: string; heading: string; body: string; footer?: string }): string {
  const { preheader, heading, body, footer } = opts;
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(heading)}</title></head>
<body style="margin:0;background:#fbf7f7;font-family:Inter,Segoe UI,Arial,sans-serif;color:${INK};">
<span style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #ead9dd;border-radius:16px;">
<tr><td style="padding:28px 32px 0;font-size:22px;font-weight:700;color:${MAROON};">Medyra</td></tr>
<tr><td style="padding:20px 32px 0;font-size:20px;font-weight:700;">${escapeHtml(heading)}</td></tr>
<tr><td style="padding:12px 32px 28px;font-size:15px;line-height:1.6;">${body}</td></tr>
<tr><td style="padding:18px 32px 28px;border-top:1px solid #f0e4e7;font-size:12px;line-height:1.5;color:#6b5a5f;">
${footer ?? ""}Connect. Learn. Grow. Belong.<br>Medyra is a community space. It does not replace professional care, and posts are not verified medical advice.</td></tr>
</table></td></tr></table>
</body></html>`;
}

function button(label: string, href: string): string {
  return `<p style="margin:20px 0 0;"><a href="${escapeHtml(href)}" style="display:inline-block;background:${MAROON};color:#ffffff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:10px;">${escapeHtml(label)}</a></p>`;
}

const name = (firstName: string) => firstName.trim().slice(0, 60) || "there";

export function welcomeEmail(input: { firstName: string; username: string }): EmailMessage {
  const first = name(input.firstName);
  const profileUrl = `${siteUrl()}/profile/${encodeURIComponent(input.username)}`;
  return {
    subject: "Welcome to Medyra",
    html: layout({
      preheader: "Your Medyra profile is ready.",
      heading: `Welcome, ${first}`,
      body: `<p style="margin:0 0 12px;">Your Medyra profile is ready. You can share a post, explore other members, and say whether you are looking for or open to offering mentorship.</p>
<p style="margin:0;">A reminder as you start: never share information that could identify a patient or client. Profiles are self-reported and are not verified.</p>${button("Open your profile", profileUrl)}`,
    }),
    text: `Welcome to Medyra, ${first}.

Your profile is ready: ${profileUrl}

You can share a post, explore other members, and say whether you are looking for or open to offering mentorship. Never share information that could identify a patient or client. Profiles are self-reported and are not verified.

Connect. Learn. Grow. Belong.`,
  };
}

export type SecurityEvent = "password_changed";

const SECURITY_COPY: Record<SecurityEvent, { subject: string; line: string }> = {
  password_changed: {
    subject: "Your Medyra password was changed",
    line: "The password for your Medyra account was just changed, and your other devices were signed out.",
  },
};

export function securityNotificationEmail(input: {
  firstName: string;
  event: SecurityEvent;
}): EmailMessage {
  const first = name(input.firstName);
  const copy = SECURITY_COPY[input.event];
  const resetUrl = `${siteUrl()}/forgot-password`;
  return {
    subject: copy.subject,
    html: layout({
      preheader: copy.line,
      heading: "Account security notice",
      body: `<p style="margin:0 0 12px;">Hi ${escapeHtml(first)},</p>
<p style="margin:0 0 12px;">${escapeHtml(copy.line)}</p>
<p style="margin:0;"><strong>If this was you, no action is needed.</strong> If it was not, reset your password right away.</p>${button("Reset my password", resetUrl)}`,
    }),
    text: `Hi ${first},

${copy.line}

If this was you, no action is needed. If it was not, reset your password right away: ${resetUrl}`,
  };
}

/** Ready for the future comment-notification feature. Not sent by the app yet. */
export function commentNotificationEmail(input: {
  recipientFirstName: string;
  commenterName: string;
  postUrlPath: string;
}): EmailMessage {
  const first = name(input.recipientFirstName);
  const commenter = name(input.commenterName);
  const url = `${siteUrl()}${input.postUrlPath.startsWith("/") ? input.postUrlPath : `/${input.postUrlPath}`}`;
  const settings = `${siteUrl()}/settings`;
  return {
    subject: `${commenter} commented on your post`,
    html: layout({
      preheader: `${commenter} commented on your post.`,
      heading: "New comment on your post",
      body: `<p style="margin:0 0 12px;">Hi ${escapeHtml(first)}, ${escapeHtml(commenter)} commented on your post on Medyra.</p>${button("View the conversation", url)}`,
      footer: `You can turn these emails off in <a href="${escapeHtml(settings)}" style="color:${MAROON};">Settings</a>.<br>`,
    }),
    text: `Hi ${first}, ${commenter} commented on your post on Medyra.\n\nView the conversation: ${url}\n\nTurn these emails off in Settings: ${settings}`,
  };
}

/** Ready for the future connections feature. Not sent by the app yet. */
export function connectionNotificationEmail(input: {
  recipientFirstName: string;
  requesterName: string;
}): EmailMessage {
  const first = name(input.recipientFirstName);
  const requester = name(input.requesterName);
  const url = siteUrl();
  const settings = `${siteUrl()}/settings`;
  return {
    subject: `${requester} wants to connect on Medyra`,
    html: layout({
      preheader: `${requester} sent you a connection request.`,
      heading: "New connection request",
      body: `<p style="margin:0 0 12px;">Hi ${escapeHtml(first)}, ${escapeHtml(requester)} would like to connect with you on Medyra.</p>${button("Open Medyra", url)}`,
      footer: `You can turn these emails off in <a href="${escapeHtml(settings)}" style="color:${MAROON};">Settings</a>.<br>`,
    }),
    text: `Hi ${first}, ${requester} would like to connect with you on Medyra.\n\nOpen Medyra: ${url}\n\nTurn these emails off in Settings: ${settings}`,
  };
}

/** The 6-digit sign-in code. Short-lived, single purpose, and says what to do if it was not you. */
export function twoFactorCodeEmail(input: { firstName: string; code: string; minutes: number }): EmailMessage {
  const first = name(input.firstName);
  const code = input.code.replace(/[^0-9]/g, "");
  return {
    subject: `Your Medyra sign-in code: ${code}`,
    html: layout({
      preheader: `Your Medyra sign-in code is ${code}.`,
      heading: "Confirm it's you",
      body: `<p style="margin:0 0 12px;">Hi ${escapeHtml(first)},</p>
<p style="margin:0 0 12px;">Enter this code to finish signing in to Medyra:</p>
<p style="margin:0 0 16px;font-size:32px;font-weight:700;letter-spacing:6px;color:${MAROON};">${escapeHtml(code)}</p>
<p style="margin:0 0 12px;">It works for ${input.minutes} minutes and only once. Medyra will never ask you for this code by phone, chat or email.</p>
<p style="margin:0;"><strong>Didn't try to sign in?</strong> Someone may know your password. Reset it right away and ignore this code.</p>${button("Reset my password", `${siteUrl()}/forgot-password`)}`,
    }),
    text: `Hi ${first},

Your Medyra sign-in code is ${code}. It works for ${input.minutes} minutes and only once. Medyra will never ask you for this code by phone, chat or email.

Didn't try to sign in? Someone may know your password. Reset it right away: ${siteUrl()}/forgot-password`,
  };
}

/** The code that proves control of a school address. It confirms the address only, never enrolment. */
export function institutionalCodeEmail(input: { code: string; minutes: number; institution: string }): EmailMessage {
  const code = input.code.replace(/[^0-9]/g, "");
  const school = escapeHtml(input.institution);
  return {
    subject: `Medyra school email code: ${code} / Code de courriel scolaire`,
    html: layout({
      preheader: `Your Medyra school email code is ${code}.`,
      heading: "Confirm your school email / Confirmez votre courriel scolaire",
      body: `<p style="margin:0 0 12px;">Enter this code in Medyra to show you control this ${school} address:</p>
<p style="margin:0 0 16px;font-size:32px;font-weight:700;letter-spacing:6px;color:${MAROON};">${escapeHtml(code)}</p>
<p style="margin:0 0 12px;">It works for ${input.minutes} minutes and only once. Confirming an address does not verify your enrolment; that needs official evidence.</p>
<p style="margin:0 0 12px;">Saisissez ce code dans Medyra pour montrer que vous contrôlez cette adresse (${school}). Il est valide ${input.minutes} minutes et une seule fois. Confirmer une adresse ne vérifie pas votre inscription; il faut une preuve officielle.</p>
<p style="margin:0;">Not you? Ignore this email. / Ce n'est pas vous? Ignorez ce courriel.</p>`,
    }),
    text: `Your Medyra school email code is ${code}. It works for ${input.minutes} minutes and only once. Confirming an address does not verify your enrolment.

Votre code Medyra est ${code}. Il est valide ${input.minutes} minutes et une seule fois. Confirmer une adresse ne vérifie pas votre inscription.

Not you? Ignore this email. / Ce n'est pas vous? Ignorez ce courriel.`,
  };
}

export type VerificationNotice =
  | "received"
  | "email_confirmed"
  | "more_information"
  | "approved"
  | "rejected"
  | "revoked";

const NOTICE_TEXT: Record<VerificationNotice, { en: [string, string]; fr: [string, string] }> = {
  received: {
    en: ["We received your student verification request", "A reviewer will look at it. You can follow it on your dashboard."],
    fr: ["Nous avons reçu votre demande de vérification étudiante", "Un évaluateur l'examinera. Vous pouvez la suivre dans votre tableau de bord."],
  },
  email_confirmed: {
    en: ["Your school email is confirmed", "This confirms the address only. Official evidence is still needed to verify your enrolment."],
    fr: ["Votre courriel scolaire est confirmé", "Cela confirme l'adresse seulement. Une preuve officielle reste nécessaire pour vérifier votre inscription."],
  },
  more_information: {
    en: ["More information is needed", "A reviewer left a note for you on your dashboard."],
    fr: ["Des renseignements supplémentaires sont requis", "Un évaluateur vous a laissé une note dans votre tableau de bord."],
  },
  approved: {
    en: ["Your student verification was approved", "Your Verified badge now shows on your profile and posts until the credential expires. You can see its scope on your dashboard."],
    fr: ["Votre vérification étudiante a été approuvée", "Votre badge Vérifié apparaît sur votre profil et vos publications jusqu'à l'expiration. Consultez sa portée dans votre tableau de bord."],
  },
  rejected: {
    en: ["Your student verification was not approved", "Details are on your dashboard, where you can start a new request."],
    fr: ["Votre vérification étudiante n'a pas été approuvée", "Les détails sont dans votre tableau de bord, où vous pouvez faire une nouvelle demande."],
  },
  revoked: {
    en: ["A student credential was removed", "Details are on your dashboard."],
    fr: ["Un titre étudiant a été retiré", "Les détails sont dans votre tableau de bord."],
  },
};

/** Short, bilingual, and always a pointer to the dashboard. Never contains evidence or reviewer notes. */
export function verificationNoticeEmail(input: { firstName: string; notice: VerificationNotice }): EmailMessage {
  const first = name(input.firstName);
  const t = NOTICE_TEXT[input.notice];
  const url = `${siteUrl()}/verification/student/status`;
  return {
    subject: `${t.en[0]} / ${t.fr[0]}`,
    html: layout({
      preheader: t.en[0],
      heading: t.en[0],
      body: `<p style="margin:0 0 12px;">Hi ${escapeHtml(first)}, ${escapeHtml(t.en[1])}</p>
<p style="margin:0 0 12px;">Bonjour ${escapeHtml(first)}, ${escapeHtml(t.fr[1])}</p>${button("Open my dashboard / Ouvrir mon tableau de bord", url)}`,
    }),
    text: `Hi ${first}, ${t.en[1]}

Bonjour ${first}, ${t.fr[1]}

${url}`,
  };
}
