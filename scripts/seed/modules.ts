import {
  ANNOUNCEMENTS, APPEAL_MESSAGE, COMMUNITIES, COMMUNITY_RULES, FEEDBACK, GROUP_TITLES, MENTEE_GOALS, MENTOR_BIO,
  MENTOR_DECLINE, MENTOR_EXPERTISE, MENTOR_REPLY, MENTOR_TOPICS, MESSAGES, REPORT_DETAILS, WARN_MESSAGE,
  type CommunitySpec,
} from "./content-modules.ts";
import { EN } from "./content-en.ts";
import { FR } from "./content-fr.ts";
import { THEMES, type Corpus, type Theme } from "./content-types.ts";
import type { Lang } from "./people.ts";
import { THEME_RULES, type Plan, type SeedMember } from "./plan.ts";
import { createRng, type Rng } from "./prng.ts";
import { LeastUsed, similarity } from "./text.ts";
import { literal, managementQuery } from "./sql.ts";

/**
 * Fictional content for communities, forums, mentorship, messaging and moderation.
 * buildModules() is pure and deterministic; runModules() writes it. Content is created through the
 * real database functions wherever the schema forbids direct inserts (the acting member is set with
 * request.jwt.claims inside the same transaction, so auth.uid() and every check behave as in the
 * app), then backdated, because members cannot set created_at.
 */

const CORPUS: Record<Lang, Corpus> = { fr: FR, en: EN };
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

type Slug = string;
export type ForumQ = { id: number; lang: Lang; topic: string; kind: string; title: string; body: string; author: Slug; anonymous: boolean; at: string; theme: Theme };
export type ForumA = { id: number; q: number; lang: Lang; body: string; author: Slug; anonymous: boolean; at: string };
export type ForumR = { id: number; a: number; lang: Lang; body: string; author: Slug; anonymous: boolean; at: string };

export type ModulePlan = {
  communities: (CommunitySpec & { owner: Slug; moderators: Slug[]; members: Slug[]; pending: Slug[]; banned: Slug | null; createdAt: string; rules: string })[];
  announcements: { community: string; author: Slug; title: string; body: string; at: string }[];
  communityPosts: { id: string; community: string; author: Slug; category: string; body: string; at: string }[];
  forumQuestions: ForumQ[];
  forumAnswers: ForumA[];
  forumReplies: ForumR[];
  accepted: { q: number; a: number }[];
  forumVotes: { a: number; user: Slug }[];
  forumFollows: { q: number; user: Slug }[];
  mentors: { slug: Slug; bio: string; expertise: string; years: number; org: string | null; topics: string[]; languages: string[]; capacity: number; formats: string[]; windows: { weekday: number; start: number; end: number }[] }[];
  mentorRequests: { mentee: Slug; mentor: Slug; goals: string; format: string; state: "pending" | "accepted" | "declined"; completed: boolean; note: string | null; at: string; decidedAt: string }[];
  dms: { a: Slug; b: Slug; outcome: "active" | "accepted" | "pending" | "declined"; first: string; at: string; replies: { from: Slug; body: string; at: string }[] }[];
  groups: { creator: Slug; title: string; members: Slug[]; at: string; messages: { from: Slug; body: string; at: string }[] }[];
  reports: { reporter: Slug; kind: "post" | "comment" | "profile" | "question" | "answer" | "reply" | "community" | "mentor"; ref: string | number; reason: string; details: string; decision: "open" | "claim" | "dismiss" | "warn" | "remove_content" | "suspend"; suspendSlug?: Slug }[];
  saved: { user: Slug; post: string }[];
  blocks: { blocker: Slug; blocked: Slug }[];
  mutes: { muter: Slug; muted: Slug }[];
  restricted: Slug[];
  unlisted: Slug[];
  prefsOff: Slug[];
  dataRequests: { user: Slug; kind: "export" | "deletion" }[];
  admin: Slug;
};

const iso = (ms: number) => new Date(ms).toISOString();
const field = (m: SeedMember) => m.fields[0];

export function buildModules(plan: Plan, now: Date): ModulePlan {
  const rng = createRng(20261108);
  const nowMs = now.getTime();
  const done = plan.members.filter((m) => m.complete);
  const by = new Map(plan.members.map((m) => [m.slug, m]));
  const joined = (m: SeedMember) => Date.parse(m.profileCreatedAt) + HOUR;
  /** A moment between the later of two lower bounds and `daysAgoMax` days before now. */
  const when = (floor: number, daysBeforeNow = 1) => {
    const lo = Math.max(floor, nowMs - 115 * DAY);
    const hi = nowMs - daysBeforeNow * DAY;
    return hi > lo ? rng.int(lo, hi) : hi;
  };
  const langPool = (lang: Lang) => done.filter((m) => m.lang === lang && !m.quiet);
  const pros = done.filter((m) => ["hp", "sp", "ed", "rs", "ind"].includes(m.role));
  const students = done.filter((m) => ["ug", "gr", "rg"].includes(m.role));

  // ---- communities ----------------------------------------------------------------------------
  const communities: ModulePlan["communities"] = COMMUNITIES.map((spec) => {
    const eligible = pros.filter((m) => m.lang === spec.lang || rng.chance(0.2));
    const fieldMatch = eligible.filter((m) => !spec.field || field(m) === spec.field);
    const owner = rng.pick(fieldMatch.length ? fieldMatch : eligible);
    const mods = rng.sample(eligible.filter((m) => m.slug !== owner.slug), rng.int(1, 2));
    const poolForMembers = done.filter((m) => !m.quiet || rng.chance(0.3)).filter((m) => (spec.field ? field(m) === spec.field || rng.chance(0.3) : true));
    const members = rng
      .sample(poolForMembers.filter((m) => m.slug !== owner.slug && !mods.some((x) => x.slug === m.slug)), spec.visibility === "private" ? rng.int(6, 12) : rng.int(10, 26))
      .map((m) => m.slug);
    const outsiders = done.filter((m) => ![owner.slug, ...mods.map((x) => x.slug), ...members].includes(m.slug));
    return {
      ...spec, owner: owner.slug, moderators: mods.map((m) => m.slug), members,
      pending: spec.visibility === "private" ? rng.sample(outsiders, 2).map((m) => m.slug) : [],
      banned: spec.slug === "seed-etudiants-sante-udem" || spec.slug === "seed-bien-etre-etudiant" ? rng.pick(outsiders).slug : null,
      createdAt: iso(when(Math.max(joined(owner), nowMs - 118 * DAY), 20)),
      rules: COMMUNITY_RULES[spec.lang],
    };
  });
  // The banned member must not also be pending anywhere else for the same community.
  const announcements: ModulePlan["announcements"] = [];
  communities.forEach((c, i) => {
    if (i % 5 === 4) return;
    const list = ANNOUNCEMENTS[c.lang];
    const a = list[i % list.length];
    announcements.push({ community: c.slug, author: c.owner, title: a.title, body: a.body, at: iso(Date.parse(c.createdAt) + rng.int(1, 6) * HOUR) });
  });
  const feedBodies = plan.posts.map((p) => p.body);
  const lu: Record<Lang, LeastUsed> = { fr: new LeastUsed(rng), en: new LeastUsed(rng) };
  const communityPosts: ModulePlan["communityPosts"] = [];
  const cats = ["general_discussion", "academic_life", "professional_advice", "career_journey", "questions"];
  for (let i = 0; i < 45; i++) {
    const c = communities[i % communities.length];
    const author = by.get(rng.pick([c.owner, ...c.moderators, ...c.members]))!;
    const lang = author.lang;
    const theme = rng.pick(THEMES);
    for (let attempt = 0; attempt < 200; attempt++) {
      const t = CORPUS[lang].themes[theme];
      const body = `${lu[lang].pick(t.s)} ${lu[lang].pick(t.d)}`;
      if (feedBodies.some((b) => similarity(b, body) > 0.5) || communityPosts.some((p) => similarity(p.body, body) > 0.5)) continue;
      const at = when(Math.max(Date.parse(c.createdAt), joined(author)) + HOUR, 1);
      communityPosts.push({ id: rng.uuid(), community: c.slug, author: author.slug, category: rng.pick(cats), body, at: iso(at) });
      break;
    }
  }

  // ---- forums -----------------------------------------------------------------------------------
  const topicOf: Record<Theme, [string, string]> = {
    placement: ["clinical-education", "academic"], oiiq: ["study-and-exams", "academic"],
    psygrad: ["career-and-transitions", "career"], cegep: ["study-and-exams", "academic"],
    swintern: ["professional-practice", "scenario"], bedside: ["evidence-and-research", "evidence"],
    pharm: ["techniques-and-methods", "technique"], mentor: ["teaching-and-mentoring", "other"],
    mcgillres: ["evidence-and-research", "evidence"], workstudy: ["wellbeing-and-burnout", "other"],
    physio: ["clinical-education", "technique"], hospra: ["career-and-transitions", "career"],
  };
  const authorFor = (lang: Lang, theme: Theme | null, exclude: Slug[] = []) => {
    const rule = theme ? THEME_RULES[theme] : {};
    const pool = langPool(lang).filter((m) => !exclude.includes(m.slug));
    const strict = pool.filter((m) => (!rule.fields || rule.fields.includes(field(m))) && (!rule.roles || rule.roles.includes(m.role)));
    const loose = pool.filter((m) => !rule.fields || rule.fields.includes(field(m)));
    return rng.pick(strict.length ? strict : loose.length ? loose : pool);
  };
  const PREFIX: Record<Lang, string[]> = {
    fr: ["Question de cohorte : ", "Pour celles et ceux qui y sont passés : ", "Besoin de pistes : "],
    en: ["Cohort question: ", "For those who've been there: ", "Looking for ideas: "],
  };
  const forumQuestions: ForumQ[] = [];
  const usedTitles = new Set<string>();
  const forumLu: Record<Lang, LeastUsed> = { fr: new LeastUsed(rng), en: new LeastUsed(rng) };
  const themeCycle: Record<Lang, Theme[]> = { fr: rng.shuffle(THEMES), en: rng.shuffle(THEMES) };
  const counts = { fr: 84, en: 36 };
  let qid = 0;
  for (const lang of ["fr", "en"] as const) {
    for (let i = 0; i < counts[lang]; i++) {
      const theme = themeCycle[lang][i % THEMES.length];
      const t = CORPUS[lang].themes[theme];
      const author = authorFor(lang, theme);
      for (let attempt = 0; attempt < 300; attempt++) {
        let title = forumLu[lang].pick(t.q);
        if (usedTitles.has(title)) title = `${rng.pick(PREFIX[lang])}${title.charAt(0).toLowerCase()}${title.slice(1)}`;
        if (usedTitles.has(title) || title.length > 150) continue;
        const body = `${forumLu[lang].pick(t.s)}${rng.chance(0.5) ? ` ${forumLu[lang].pick(t.d)}` : ""}${rng.chance(0.3) ? ` ${rng.pick(CORPUS[lang].generalClosers)}` : ""}`;
        if (forumQuestions.some((q) => similarity(q.body, body) > 0.5)) continue;
        usedTitles.add(title);
        const [topic, kind] = topicOf[theme];
        forumQuestions.push({ id: qid++, lang, topic, kind, title, body, author: author.slug, anonymous: rng.chance(0.15), at: iso(when(joined(author), 3)), theme });
        break;
      }
    }
  }
  const answerPool: Record<Lang, LeastUsed> = { fr: new LeastUsed(rng), en: new LeastUsed(rng) };
  const forumAnswers: ForumA[] = [];
  const accepted: ModulePlan["accepted"] = [];
  let aid = 0;
  for (const q of forumQuestions) {
    const n = rng.chance(0.15) ? 0 : rng.chance(0.2) ? 3 : rng.chance(0.4) ? 2 : 1;
    const t = CORPUS[q.lang].themes[q.theme];
    const first = forumAnswers.length;
    for (let k = 0; k < n; k++) {
      const author = authorFor(q.lang, null, [q.author, ...forumAnswers.slice(first).map((a) => a.author)]);
      for (let attempt = 0; attempt < 300; attempt++) {
        const body = [answerPool[q.lang].pick(t.d), rng.chance(0.7) ? answerPool[q.lang].pick(t.c) : answerPool[q.lang].pick(CORPUS[q.lang].generalClosers)].join(" ");
        if (forumAnswers.some((a) => similarity(a.body, body) > 0.5)) continue;
        forumAnswers.push({ id: aid++, q: q.id, lang: q.lang, body, author: author.slug, anonymous: rng.chance(0.12), at: iso(Math.max(Date.parse(q.at), joined(author)) + rng.int(1, 60) * HOUR) });
        break;
      }
    }
    if (forumAnswers.length > first && rng.chance(0.5)) accepted.push({ q: q.id, a: forumAnswers[first].id });
  }
  // Answers must come after their question and before now.
  for (const a of forumAnswers) if (Date.parse(a.at) > nowMs - HOUR) a.at = iso(nowMs - HOUR);
  const forumReplies: ForumR[] = [];
  let rid = 0;
  const replyLu: Record<Lang, LeastUsed> = { fr: new LeastUsed(rng), en: new LeastUsed(rng) };
  for (let i = 0; i < 100 && forumAnswers.length; i++) {
    const a = forumAnswers[rng.int(0, forumAnswers.length - 1)];
    const q = forumQuestions[a.q];
    const author = authorFor(a.lang, null, [a.author]);
    for (let attempt = 0; attempt < 300; attempt++) {
      const body = `${replyLu[a.lang].pick(CORPUS[a.lang].themes[q.theme].r)}${rng.chance(0.5) ? ` ${replyLu[a.lang].pick(CORPUS[a.lang].replies)}` : ""}`;
      if (forumReplies.some((r) => similarity(r.body, body) > 0.55)) continue;
      forumReplies.push({ id: rid++, a: a.id, lang: a.lang, body, author: author.slug, anonymous: rng.chance(0.1), at: iso(Math.min(nowMs - HOUR, Math.max(Date.parse(a.at), joined(author)) + rng.int(1, 48) * HOUR)) });
      break;
    }
  }
  const forumVotes: ModulePlan["forumVotes"] = [];
  const voteKeys = new Set<string>();
  for (let guard = 0; forumVotes.length < 400 && guard < 20000 && forumAnswers.length; guard++) {
    const a = rng.pick(forumAnswers);
    const u = rng.pick(done);
    const key = `${a.id}|${u.slug}`;
    if (u.slug === a.author || voteKeys.has(key) || (u.quiet && rng.chance(0.7))) continue;
    voteKeys.add(key);
    forumVotes.push({ a: a.id, user: u.slug });
  }
  const forumFollows: ModulePlan["forumFollows"] = [];
  const followKeys = new Set<string>();
  for (let guard = 0; forumFollows.length < 150 && guard < 20000; guard++) {
    const q = rng.pick(forumQuestions);
    const u = rng.pick(done);
    const key = `${q.id}|${u.slug}`;
    if (followKeys.has(key) || u.slug === q.author) continue;
    followKeys.add(key);
    forumFollows.push({ q: q.id, user: u.slug });
  }

  // ---- mentorship -------------------------------------------------------------------------------
  const mentorPool = pros.filter((m) => m.openToMentor).concat(rng.sample(pros.filter((m) => !m.openToMentor), 4));
  const mentors: ModulePlan["mentors"] = mentorPool.map((m, i) => {
    const bios = MENTOR_BIO[m.lang];
    return {
      slug: m.slug, bio: bios[i % bios.length], expertise: MENTOR_EXPERTISE[m.lang][i % MENTOR_EXPERTISE[m.lang].length],
      years: rng.int(5, 25), org: m.experience[0]?.organization ?? null, topics: rng.sample(MENTOR_TOPICS, rng.int(2, 4)),
      languages: m.lang === "fr" ? (rng.chance(0.6) ? ["Français", "English"] : ["Français"]) : ["English", "Français"],
      capacity: rng.int(3, 6), formats: rng.sample(["video", "phone", "chat", "in_person"], rng.int(1, 3)),
      windows: [{ weekday: rng.int(1, 3), start: 17 * 60, end: 19 * 60 }, { weekday: rng.int(4, 6), start: 9 * 60, end: 12 * 60 }],
    };
  });
  const mentorRequests: ModulePlan["mentorRequests"] = [];
  const pairKeys = new Set<string>();
  const load = new Map<string, number>();
  const states = [...Array(9).fill("pending"), ...Array(15).fill("accepted"), ...Array(6).fill("declined")] as ("pending" | "accepted" | "declined")[];
  for (const state of rng.shuffle(states)) {
    for (let guard = 0; guard < 500; guard++) {
      const mentee = rng.pick(students.filter((m) => m.lookingForMentorship || rng.chance(0.3)));
      const mentorSpec = rng.pick(mentors);
      const mentor = by.get(mentorSpec.slug)!;
      const key = `${mentee.slug}|${mentor.slug}`;
      if (pairKeys.has(key) || (state === "accepted" && (load.get(mentor.slug) ?? 0) >= mentorSpec.capacity - 1)) continue;
      pairKeys.add(key);
      if (state === "accepted") load.set(mentor.slug, (load.get(mentor.slug) ?? 0) + 1);
      const goals = rng.pick(MENTEE_GOALS[mentee.lang]);
      const at = when(Math.max(joined(mentee), joined(mentor)), 12);
      mentorRequests.push({
        mentee: mentee.slug, mentor: mentor.slug, goals, format: rng.pick(mentorSpec.formats), state,
        completed: state === "accepted" && mentorRequests.filter((r) => r.completed).length < 5 && rng.chance(0.35), note: state === "declined" ? rng.pick(MENTOR_DECLINE[mentor.lang]) : null,
        at: iso(at), decidedAt: iso(Math.min(nowMs - 2 * HOUR, at + rng.int(2, 72) * HOUR)),
      });
      break;
    }
  }

  // ---- messaging --------------------------------------------------------------------------------
  const connected = plan.connections.filter((c) => c.status === "accepted");
  const connKey = (a: Slug, b: Slug) => [a, b].sort().join("|");
  const connectedSet = new Set(connected.map((c) => connKey(c.requesterSlug, c.addresseeSlug)));
  const msgLu: Record<Lang, LeastUsed> = { fr: new LeastUsed(rng), en: new LeastUsed(rng) };
  const dmKeys = new Set<string>();
  const dms: ModulePlan["dms"] = [];
  const outcomes = [...Array(14).fill("active"), ...Array(4).fill("accepted"), ...Array(3).fill("pending"), ...Array(2).fill("declined")] as ModulePlan["dms"][number]["outcome"][];
  for (const outcome of outcomes) {
    for (let guard = 0; guard < 500; guard++) {
      let a: SeedMember, b: SeedMember;
      if (outcome === "active") {
        const c = rng.pick(connected);
        [a, b] = [by.get(c.requesterSlug)!, by.get(c.addresseeSlug)!];
      } else {
        [a, b] = [rng.pick(done), rng.pick(done)];
        if (connectedSet.has(connKey(a.slug, b.slug))) continue;
      }
      const key = connKey(a.slug, b.slug);
      if (a.slug === b.slug || dmKeys.has(key)) continue;
      dmKeys.add(key);
      const at = when(Math.max(joined(a), joined(b)), 6);
      const replies: ModulePlan["dms"][number]["replies"] = [];
      if (outcome === "active" || outcome === "accepted") {
        const n = rng.int(2, 14);
        let t = at;
        for (let i = 0; i < n; i++) {
          t = Math.min(nowMs - HOUR, t + rng.int(5, 600) * 60_000);
          const from = i % 2 === 0 ? b : a;
          replies.push({ from: from.slug, body: msgLu[from.lang].pick(MESSAGES[from.lang]), at: iso(t) });
        }
      }
      dms.push({ a: a.slug, b: b.slug, outcome, first: msgLu[a.lang].pick(MESSAGES[a.lang]), at: iso(at), replies });
      break;
    }
  }
  const groups: ModulePlan["groups"] = [];
  const byRequester = new Map<string, Slug[]>();
  for (const c of connected) {
    (byRequester.get(c.requesterSlug) ?? byRequester.set(c.requesterSlug, []).get(c.requesterSlug)!).push(c.addresseeSlug);
  }
  const creators = [...byRequester].filter(([, list]) => list.length >= 3).slice(0, 3);
  creators.forEach(([creator, list], i) => {
    const owner = by.get(creator)!;
    const members = list.slice(0, rng.int(3, Math.min(6, list.length)));
    const at = when(Math.max(joined(owner), ...members.map((s) => joined(by.get(s)!))), 8);
    const messages: ModulePlan["groups"][number]["messages"] = [];
    let t = at;
    for (let k = 0; k < 12; k++) {
      t = Math.min(nowMs - HOUR, t + rng.int(10, 900) * 60_000);
      const from = by.get(rng.pick([creator, ...members]))!;
      messages.push({ from: from.slug, body: msgLu[from.lang].pick(MESSAGES[from.lang]), at: iso(t) });
    }
    groups.push({ creator, title: GROUP_TITLES[owner.lang][i % GROUP_TITLES[owner.lang].length], members, at: iso(at), messages });
  });

  // ---- moderation, saved items, blocks, privacy ----------------------------------------------------
  const admin = by.get("andre_tremblay")!.slug;
  const nonAdmin = done.filter((m) => m.slug !== admin);
  const post = () => rng.pick(plan.posts).id;
  const decisions: ModulePlan["reports"][number]["decision"][] = ["open", "open", "open", "open", "claim", "claim", "claim", "dismiss", "dismiss", "dismiss", "dismiss", "warn", "warn", "remove_content", "suspend"];
  const reports: ModulePlan["reports"] = decisions.map((decision, i) => {
    const reporter = rng.pick(nonAdmin).slug;
    const reason = rng.pick(["spam", "other", "inappropriate_content"]);
    const details = rng.pick(REPORT_DETAILS);
    if (decision === "remove_content") return { reporter, kind: "reply", ref: forumReplies.find((r) => !r.anonymous)?.id ?? 0, reason, details, decision };
    if (decision === "suspend") return { reporter, kind: "profile", ref: "kimberly_ross", reason, details, decision, suspendSlug: "kimberly_ross" };
    const kinds = ["post", "post", "comment", "question", "profile", "community", "mentor", "answer"] as const;
    const kind = kinds[i % kinds.length];
    const ref: string | number =
      kind === "post" ? post() : kind === "comment" ? rng.pick(plan.comments).id : kind === "question" ? (forumQuestions.find((q) => !q.anonymous)?.id ?? 0)
        : kind === "profile" ? rng.pick(nonAdmin).slug : kind === "community" ? communities[i % communities.length].slug : kind === "mentor" ? mentors[i % mentors.length].slug : (forumAnswers.find((a) => !a.anonymous)?.id ?? 0);
    return { reporter, kind, ref, reason, details, decision };
  });
  const saved: ModulePlan["saved"] = [];
  const savedKeys = new Set<string>();
  for (let guard = 0; saved.length < 160 && guard < 5000; guard++) {
    const u = rng.pick(done);
    const p = rng.pick(plan.posts);
    const key = `${u.slug}|${p.id}`;
    if (savedKeys.has(key) || p.authorSlug === u.slug) continue;
    savedKeys.add(key);
    saved.push({ user: u.slug, post: p.id });
  }
  const linked = new Set([...plan.connections.map((c) => connKey(c.requesterSlug, c.addresseeSlug)), ...plan.follows.map((f) => connKey(f.followerSlug, f.followeeSlug))]);
  const pairs = (n: number) => {
    const out: [Slug, Slug][] = [];
    for (let guard = 0; out.length < n && guard < 5000; guard++) {
      const [a, b] = [rng.pick(done), rng.pick(done)];
      if (a.slug === b.slug || linked.has(connKey(a.slug, b.slug)) || a.slug === admin || b.slug === admin) continue;
      linked.add(connKey(a.slug, b.slug));
      out.push([a.slug, b.slug]);
    }
    return out;
  };
  const blocks = pairs(3).map(([blocker, blocked]) => ({ blocker, blocked }));
  const mutes = pairs(3).map(([muter, muted]) => ({ muter, muted }));
  const some = (n: number) => rng.sample(done.filter((m) => m.slug !== admin && m.slug !== "kimberly_ross"), n).map((m) => m.slug);
  return {
    communities, announcements, communityPosts, forumQuestions, forumAnswers, forumReplies, accepted, forumVotes, forumFollows,
    mentors, mentorRequests, dms, groups, reports, saved, blocks, mutes,
    restricted: some(6), unlisted: some(5), prefsOff: some(8),
    dataRequests: [{ user: some(1)[0], kind: "export" }, { user: some(1)[0], kind: "deletion" }],
    admin,
  };
}

/** Problems that would break a database constraint (used by tests and before writing). */
export function validateModules(m: ModulePlan): string[] {
  const bad: string[] = [];
  const dupes = (label: string, list: string[]) => new Set(list).size !== list.length && bad.push(`${label}: duplicate texts`);
  for (const q of m.forumQuestions) {
    if (q.title.length < 10 || q.title.length > 150) bad.push(`question ${q.id}: title length`);
    if (!/\S/.test(q.body) || q.body.length > 5000) bad.push(`question ${q.id}: body`);
  }
  dupes("forum titles", m.forumQuestions.map((q) => q.title));
  dupes("forum question bodies", m.forumQuestions.map((q) => q.body));
  dupes("forum answers", m.forumAnswers.map((a) => a.body));
  for (const c of m.communities) {
    if (c.description.length < 10 || c.description.length > 600) bad.push(`${c.slug}: description length`);
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(c.slug) || c.slug.length < 3 || c.slug.length > 48) bad.push(`${c.slug}: slug`);
    if (c.name.length < 3 || c.name.length > 80) bad.push(`${c.slug}: name`);
  }
  for (const r of m.mentorRequests) if (r.goals.length < 20 || r.goals.length > 1500) bad.push("mentorship goals length");
  for (const x of m.mentors) {
    if (x.bio.length < 20 || x.bio.length > 1200) bad.push(`${x.slug}: bio length`);
    if (x.topics.length < 1 || x.topics.length > 10) bad.push(`${x.slug}: topics`);
  }
  const pend = m.mentorRequests.filter((r) => r.state === "pending").map((r) => `${r.mentee}|${r.mentor}`);
  dupes("pending mentorship pairs", pend);
  return bad;
}

// ---------------------------------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------------------------------

type Ctx = { ref: string; token: string; ids: Map<string, string>; mod: ModulePlan; plan: Plan; log: (m: string) => void };

const as = (id: string) => `select set_config('request.jwt.claims', ${literal(JSON.stringify({ sub: id, role: "authenticated" }))}, true);`;

export async function runModules(ctx: Ctx): Promise<Record<string, number>> {
  const { ref, token, ids, mod, plan, log } = ctx;
  const q = <T = Record<string, unknown>>(sql: string) => managementQuery<T[]>(ref, token, sql);
  const id = (slug: string) => {
    const v = ids.get(slug);
    if (!v) throw new Error(`No account id for ${slug}`);
    return literal(v);
  };
  const raw = (slug: string) => ids.get(slug)!;
  const chunk = <T>(list: T[], n: number) => Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, (i + 1) * n));
  const seeded = "email like 'seed+%@example.com'";
  const [existing] = await q<Record<string, number>>(`select
    (select count(*) from public.communities where slug like 'seed-%')::int communities,
    (select count(*) from public.forum_identity i join auth.users u on u.id = i.author_id where u.${seeded})::int forum,
    (select count(*) from public.forum_questions f join auth.users u on u.id = f.author_id where u.${seeded})::int forum_open,
    (select count(*) from public.mentor_profiles m join auth.users u on u.id = m.user_id where u.${seeded})::int mentors,
    (select count(*) from public.conversation_participants c join auth.users u on u.id = c.user_id where u.${seeded})::int conversations,
    (select count(*) from public.reports where details like '[seed]%')::int reports`);
  const tick = (name: string) => log(`  ${name}`);

  // staff: the sanctioned dev path is a row in staff_roles, inserted by the project owner with SQL.
  await q(`insert into public.staff_roles (user_id, role) values (${id(mod.admin)}, 'admin') on conflict do nothing`);

  // ---- communities (direct inserts; owner row comes from the trigger) ----
  if (existing.communities === 0) {
    for (const c of mod.communities) {
      await q(`insert into public.communities (slug, name, description, kind, visibility, rules, institution, region_label, country, created_by, created_at, updated_at)
        values (${literal(c.slug)}, ${literal(c.name)}, ${literal(c.description)}, ${literal(c.kind)}, ${literal(c.visibility)}, ${literal(c.rules)}, ${literal(c.institution ?? null)}, ${literal(c.region ?? null)}, 'CA', ${id(c.owner)}, ${literal(c.createdAt)}, ${literal(c.createdAt)});
        ${c.moderators.length ? `insert into public.community_members (community_id, user_id, role, joined_at) select id, u, 'moderator', ${literal(c.createdAt)} from public.communities, unnest(array[${c.moderators.map(id).join(",")}]::uuid[]) u where slug = ${literal(c.slug)} on conflict do nothing;` : ""}
        insert into public.community_members (community_id, user_id, role, joined_at) select id, u, 'member', ${literal(c.createdAt)}::timestamptz + interval '1 day' from public.communities, unnest(array[${c.members.map(id).join(",")}]::uuid[]) u where slug = ${literal(c.slug)} on conflict do nothing;
        ${c.pending.length ? `insert into public.community_requests (community_id, user_id, message, status, created_at) select id, u, 'Hello, I would like to join.', 'pending', now() - interval '2 days' from public.communities, unnest(array[${c.pending.map(id).join(",")}]::uuid[]) u where slug = ${literal(c.slug)};` : ""}
        ${c.banned ? `insert into public.community_bans (community_id, user_id, banned_by, reason, created_at) select id, ${id(c.banned)}, ${id(c.owner)}, 'spam', now() - interval '5 days' from public.communities where slug = ${literal(c.slug)} on conflict do nothing;` : ""}`);
    }
    for (const a of mod.announcements) {
      await q(`insert into public.community_announcements (community_id, author_id, title, body, created_at, updated_at) select id, ${id(a.author)}, ${literal(a.title)}, ${literal(a.body)}, ${literal(a.at)}, ${literal(a.at)} from public.communities where slug = ${literal(a.community)}`);
    }
    for (const part of chunk(mod.communityPosts, 15)) {
      await q(`insert into public.posts (id, author_id, category, body, created_at, updated_at, community_id) values ${part
        .map((p) => `(${literal(p.id)}, ${id(p.author)}, ${literal(p.category)}, ${literal(p.body)}, ${literal(p.at)}, ${literal(p.at)}, (select id from public.communities where slug = ${literal(p.community)}))`)
        .join(",")} on conflict (id) do nothing`);
    }
    tick(`communities: ${mod.communities.length}, announcements ${mod.announcements.length}, community posts ${mod.communityPosts.length}`);
  } else tick("communities: already present, skipped");

  // ---- forums (through ask_question / post_answer / post_reply, then backdated) ----
  const qIds = new Map<number, string>();
  const aIds = new Map<number, string>();
  const [{ n: haveQuestions }] = await q<{ n: number }>("select count(*)::int n from public.forum_questions");
  if (haveQuestions === mod.forumQuestions.length) {
    tick("forums: already complete, skipped");
  } else {
    if (haveQuestions > 0 || existing.forum > 0) {
      // A previous run stopped half way: rebuild the forum from scratch (nothing else points at it yet).
      await q(`delete from public.forum_questions; delete from public.forum_identity where author_id in (select id from auth.users where ${seeded})`);
      tick("forums: partial data from an interrupted run removed, rebuilding");
    }
    for (const fq of mod.forumQuestions) {
      const [row] = await q<{ id: string }>(`${as(raw(fq.author))}
        select set_config('seed.id', (select public.ask_question(${literal(fq.topic)}, ${literal(fq.kind)}, ${literal(fq.title)}, ${literal(fq.body)}, ${fq.anonymous}, true))::text, true);
        update public.forum_questions set created_at = ${literal(fq.at)}, updated_at = ${literal(fq.at)} where id = current_setting('seed.id')::uuid;
        update public.forum_identity set created_at = ${literal(fq.at)} where content_type = 'question' and content_id = current_setting('seed.id')::uuid;
        select current_setting('seed.id') as id`);
      qIds.set(fq.id, row.id);
    }
    for (const fa of mod.forumAnswers) {
      const [row] = await q<{ id: string }>(`${as(raw(fa.author))}
        select set_config('seed.id', (select public.post_answer(${literal(qIds.get(fa.q)!)}, ${literal(fa.body)}, ${fa.anonymous}))::text, true);
        update public.forum_answers set created_at = ${literal(fa.at)}, updated_at = ${literal(fa.at)} where id = current_setting('seed.id')::uuid;
        update public.forum_identity set created_at = ${literal(fa.at)} where content_type = 'answer' and content_id = current_setting('seed.id')::uuid;
        select current_setting('seed.id') as id`);
      aIds.set(fa.id, row.id);
    }
    const replyIds = new Map<number, string>();
    for (const fr of mod.forumReplies) {
      const [row] = await q<{ id: string }>(`${as(raw(fr.author))}
        select set_config('seed.id', (select public.post_reply(${literal(aIds.get(fr.a)!)}, ${literal(fr.body)}, ${fr.anonymous}))::text, true);
        update public.forum_replies set created_at = ${literal(fr.at)} where id = current_setting('seed.id')::uuid;
        update public.forum_identity set created_at = ${literal(fr.at)} where content_type = 'reply' and content_id = current_setting('seed.id')::uuid;
        select current_setting('seed.id') as id`);
      replyIds.set(fr.id, row.id);
    }
    for (const ac of mod.accepted) await q(`update public.forum_questions set accepted_answer_id = ${literal(aIds.get(ac.a)!)} where id = ${literal(qIds.get(ac.q)!)}`);
    for (const part of chunk(mod.forumVotes, 100)) {
      await q(`insert into public.forum_votes (answer_id, user_id, created_at) values ${part.map((v) => `(${literal(aIds.get(v.a)!)}, ${id(v.user)}, ${literal(forumAnswerAt(mod, v.a))})`).join(",")} on conflict do nothing`);
    }
    for (const part of chunk(mod.forumFollows, 100)) {
      await q(`insert into public.forum_follows (question_id, user_id, created_at) values ${part.map((f) => `(${literal(qIds.get(f.q)!)}, ${id(f.user)}, ${literal(mod.forumQuestions[f.q].at)})`).join(",")} on conflict do nothing`);
    }
    tick(`forums: ${mod.forumQuestions.length} questions, ${mod.forumAnswers.length} answers, ${mod.forumReplies.length} replies, ${mod.forumVotes.length} votes, ${mod.forumFollows.length} follows`);
  }

  // ---- mentorship ----
  if (existing.mentors === 0) {
    for (const m of mod.mentors) {
      await q(`insert into public.mentor_profiles (user_id, bio, expertise, experience_years, organization, topics, languages, capacity, session_formats, accepting, acknowledged)
        values (${id(m.slug)}, ${literal(m.bio)}, ${literal(m.expertise)}, ${m.years}, ${literal(m.org)}, array[${m.topics.map(literal).join(",")}], array[${m.languages.map(literal).join(",")}], ${m.capacity}, array[${m.formats.map(literal).join(",")}], true, true);
        insert into public.mentor_availability (mentor_id, weekday, start_minute, end_minute, timezone) values ${m.windows.map((w) => `(${id(m.slug)}, ${w.weekday}, ${w.start}, ${w.end}, 'America/Toronto')`).join(",")}`);
    }
    let accepted = 0, completed = 0;
    for (const r of mod.mentorRequests) {
      const [row] = await q<{ id: string }>(`insert into public.mentorship_requests (mentee_id, mentor_id, goals, preferred_format, status, created_at) values (${id(r.mentee)}, ${id(r.mentor)}, ${literal(r.goals)}, ${literal(r.format)}, 'pending', ${literal(r.at)}) returning id`);
      if (r.state === "pending") continue;
      if (r.state === "declined") {
        await q(`${as(raw(r.mentor))} select public.decide_mentorship_request(${literal(row.id)}, false, ${literal(r.note)});
          update public.mentorship_requests set decided_at = ${literal(r.decidedAt)} where id = ${literal(row.id)}`);
        continue;
      }
      await q(`${as(raw(r.mentor))} select public.decide_mentorship_request(${literal(row.id)}, true, ${literal(MENTOR_REPLY[by(plan, r.mentor).lang][0])});
        update public.mentorship_requests set decided_at = ${literal(r.decidedAt)} where id = ${literal(row.id)};
        update public.mentorships set started_at = ${literal(r.decidedAt)} where request_id = ${literal(row.id)};
        update public.conversations set created_at = ${literal(r.decidedAt)} where id = (select conversation_id from public.mentorships where request_id = ${literal(row.id)})`);
      accepted++;
      if (r.completed) {
        const ended = iso(Math.min(Date.now() - DAY, Date.parse(r.decidedAt) + 30 * DAY));
        await q(`${as(raw(r.mentor))} select public.set_mentorship_status((select id from public.mentorships where request_id = ${literal(row.id)}), 'completed');
          update public.mentorships set ended_at = ${literal(ended)} where request_id = ${literal(row.id)};
          insert into public.mentorship_feedback (mentorship_id, author_id, rating, comment, created_at) select id, ${id(r.mentee)}, ${4 + (completed % 2)}, ${literal(FEEDBACK[by(plan, r.mentee).lang][completed % 2])}, ${literal(ended)} from public.mentorships where request_id = ${literal(row.id)}`);
        completed++;
      }
    }
    tick(`mentorship: ${mod.mentors.length} mentors, ${mod.mentorRequests.length} requests (${accepted} accepted, ${completed} completed)`);
  } else tick("mentorship: already present, skipped");

  // ---- messaging ----
  if (existing.conversations === 0) {
    let messages = 0;
    for (const d of mod.dms) {
      const [row] = await q<{ id: string }>(`${as(raw(d.a))} select public.start_direct_conversation(${literal(raw(d.b))}, ${literal(d.first)}) as id`);
      const cid = literal(row.id);
      await q(`update public.conversations set created_at = ${literal(d.at)} where id = ${cid};
        update public.messages set created_at = ${literal(d.at)} where conversation_id = ${cid};
        update public.conversation_participants set joined_at = ${literal(d.at)} where conversation_id = ${cid}`);
      if (d.outcome === "accepted" || d.outcome === "declined") {
        await q(`${as(raw(d.b))} select public.respond_to_message_request(${cid}, ${d.outcome === "accepted"})`);
      }
      if (d.replies.length) {
        await q(`insert into public.messages (conversation_id, sender_id, body, created_at) values ${d.replies.map((r) => `(${cid}, ${id(r.from)}, ${literal(r.body)}, ${literal(r.at)})`).join(",")};
          update public.conversations set last_message_at = (select max(created_at) from public.messages where conversation_id = ${cid}) where id = ${cid};
          update public.conversation_participants set last_read_at = (select max(created_at) from public.messages where conversation_id = ${cid}) where conversation_id = ${cid} and user_id = ${id(d.a)}`);
        messages += d.replies.length;
      }
      messages++;
    }
    for (const g of mod.groups) {
      const [row] = await q<{ id: string }>(`${as(raw(g.creator))} select public.create_group_conversation(${literal(g.title)}, array[${g.members.map((s) => literal(raw(s))).join(",")}]::uuid[]) as id`);
      const cid = literal(row.id);
      await q(`update public.conversations set created_at = ${literal(g.at)} where id = ${cid};
        update public.conversation_participants set joined_at = ${literal(g.at)} where conversation_id = ${cid};
        insert into public.messages (conversation_id, sender_id, body, created_at) values ${g.messages.map((m) => `(${cid}, ${id(m.from)}, ${literal(m.body)}, ${literal(m.at)})`).join(",")};
        update public.conversations set last_message_at = (select max(created_at) from public.messages where conversation_id = ${cid}) where id = ${cid}`);
      messages += g.messages.length;
    }
    tick(`messaging: ${mod.dms.length} direct conversations, ${mod.groups.length} groups, ${messages} messages`);
  } else tick("messaging: already present, skipped");

  // ---- network extras, privacy, saved items ----
  await q(`${mod.blocks.map((b) => `insert into public.member_blocks (blocker_id, blocked_id) values (${id(b.blocker)}, ${id(b.blocked)}) on conflict do nothing;`).join("\n")}
    ${mod.mutes.map((m) => `insert into public.member_mutes (muter_id, muted_id) values (${id(m.muter)}, ${id(m.muted)}) on conflict do nothing;`).join("\n")}
    update public.profiles set profile_visibility = 'connections' where id in (${mod.restricted.map(id).join(",")});
    update public.profiles set directory_listed = false where id in (${mod.unlisted.map(id).join(",")});
    insert into public.notification_preferences (user_id, notify_activity, inapp_connections, inapp_comments) values ${mod.prefsOff.map((s, i) => `(${id(s)}, ${i % 2 === 0}, ${i % 3 !== 0}, ${i % 4 !== 0})`).join(",")} on conflict do nothing;
    insert into public.consent_records (user_id, kind, version) select p.id, k, '2026-11-draft' from public.profiles p join auth.users u on u.id = p.id, unnest(array['terms','privacy','community_guidelines']) k where u.${seeded} and p.onboarding_completed on conflict do nothing;
    ${mod.dataRequests.map((d) => `insert into public.data_requests (user_id, kind, status) values (${id(d.user)}, ${literal(d.kind)}, 'requested') on conflict do nothing;`).join("\n")}`);
  for (const part of chunk(mod.saved, 80)) {
    await q(`insert into public.saved_items (user_id, item_type, item_id, created_at) values ${part.map((s) => `(${id(s.user)}, 'post', ${literal(s.post)}, now() - interval '${1 + (s.post.charCodeAt(1) % 60)} days')`).join(",")} on conflict do nothing`);
  }
  tick(`network extras: ${mod.blocks.length} blocks, ${mod.mutes.length} mutes, ${mod.saved.length} saved posts, ${mod.restricted.length} restricted profiles, ${mod.dataRequests.length} pending data requests`);

  // ---- moderation: reports by members, decisions by the administrator, through the real functions ----
  if (existing.reports === 0) {
    const targetId = async (r: ModulePlan["reports"][number]): Promise<string> => {
      if (r.kind === "post" || r.kind === "comment") return String(r.ref);
      if (r.kind === "profile") return raw(String(r.ref));
      if (r.kind === "community") return (await q<{ id: string }>(`select id from public.communities where slug = ${literal(String(r.ref))}`))[0].id;
      if (r.kind === "mentor") return raw(String(r.ref));
      if (r.kind === "question") return qIds.get(Number(r.ref)) ?? "";
      if (r.kind === "answer") return aIds.get(Number(r.ref)) ?? "";
      return replyIdOf(Number(r.ref));
    };
    const replyIdOf = (n: number) => replyCache.get(n) ?? "";
    const replyCache = new Map<number, string>();
    if (qIds.size === 0) {
      // Forums were skipped (already present): look the forum ids up by title/body instead.
      for (const fq of mod.forumQuestions) {
        const [row] = await q<{ id: string }>(`select id from public.forum_questions where title = ${literal(fq.title)} limit 1`);
        if (row) qIds.set(fq.id, row.id);
      }
      for (const fa of mod.forumAnswers) {
        const [row] = await q<{ id: string }>(`select id from public.forum_answers where body = ${literal(fa.body)} limit 1`);
        if (row) aIds.set(fa.id, row.id);
      }
    }
    for (const fr of mod.forumReplies) {
      const [row] = await q<{ id: string }>(`select id from public.forum_replies where body = ${literal(fr.body)} limit 1`);
      if (row) replyCache.set(fr.id, row.id);
    }
    let made = 0;
    for (const r of mod.reports) {
      const target = await targetId(r);
      if (!target) continue;
      const details = r.details;
      const [row] = await q<{ id: string }>(`${as(raw(r.reporter))} select public.submit_report(${literal(r.kind)}, ${literal(target)}, ${literal(r.reason)}, ${literal(details)}) as id`).catch(() => [] as { id: string }[]);
      if (!row) continue;
      made++;
      await q(`update public.reports set created_at = now() - interval '${3 + made * 2} days' where id = ${literal(row.id)}`);
      if (r.decision === "open") continue;
      if (r.decision === "claim") {
        await q(`${as(raw(mod.admin))} select public.claim_report(${literal(row.id)})`);
        continue;
      }
      await q(`${as(raw(mod.admin))} select public.claim_report(${literal(row.id)});
        select public.moderate_report(${literal(row.id)}, ${literal(r.decision)}, 'Reviewed (seed data).', ${literal(r.decision === "dismiss" ? null : WARN_MESSAGE)})`);
      if (r.decision === "suspend" && r.suspendSlug) {
        await q(`insert into public.appeals (notice_id, member_id, message, status) select id, ${id(r.suspendSlug)}, ${literal(APPEAL_MESSAGE)}, 'open' from public.member_notices where member_id = ${id(r.suspendSlug)} and kind = 'suspended' order by created_at desc limit 1`);
        await q(`${as(raw(mod.admin))} select public.decide_appeal((select id from public.appeals where member_id = ${id(r.suspendSlug)} order by created_at desc limit 1), 'overturned', 'Restored after review (seed data).')`);
      }
    }
    tick(`moderation: ${made} reports submitted, staff decisions through the real functions`);
  } else tick("moderation: already present, skipped");

  // ---- notification read states and dates (triggers stamped "now") ----
  await q(`update public.notifications n set created_at = now() - ((abs(hashtext(n.id::text)) % 60) + 1) * interval '1 day'
      where n.type in ('forum_answer','forum_reply','forum_answer_accepted','message_request','mentorship_event','community_join_request','community_request_approved','community_post_removed','verification_update')
        and n.recipient_id in (select id from auth.users where ${seeded});
    update public.notifications n set read_at = n.created_at + interval '3 hours'
      where n.read_at is null and n.created_at < now() - interval '10 days' and abs(hashtext(n.id::text)) % 5 <> 0
        and n.recipient_id in (select id from auth.users where ${seeded})`);
  const [counts] = await q<Record<string, number>>(`select
    (select count(*) from public.communities where slug like 'seed-%')::int communities,
    (select count(*) from public.forum_questions)::int forum_questions,
    (select count(*) from public.forum_answers)::int forum_answers,
    (select count(*) from public.forum_replies)::int forum_replies,
    (select count(*) from public.mentorships)::int mentorships,
    (select count(*) from public.messages)::int messages,
    (select count(*) from public.reports)::int reports`);
  return counts;
}

function by(plan: Plan, slug: string): SeedMember {
  return plan.members.find((m) => m.slug === slug)!;
}
function forumAnswerAt(mod: ModulePlan, answerId: number): string {
  return mod.forumAnswers[answerId].at;
}

export { createRng };
export type { Rng };
