import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getHiddenAuthorIds } from "@/features/safety/queries";
import { getBadges } from "@/features/student-verification/queries";
import { FORUM_PAGE_SIZE } from "@/features/forums/options";
import type { ListParams } from "@/features/forums/schemas";
import {
  FORUM_AUTHOR_COLUMNS,
  type AnswerEntry,
  type ForumAuthor,
  type QuestionDetail,
  type QuestionSummary,
  type ReplyEntry,
  type Topic,
} from "@/features/forums/types";

/**
 * Forum reads run under the member's own session. Anonymous content has author_id = NULL in the
 * database, so the author embed below simply comes back empty: there is no code path here that
 * could name an anonymous writer. The only identity rows a member can read are their own, and
 * they are used for one purpose: to mark "this is mine" so edit and delete controls appear.
 */

const count = (rows: { count: number }[] | null | undefined) => rows?.[0]?.count ?? 0;

export async function listTopics(): Promise<Topic[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("forum_topics")
    .select("slug, name, description")
    .order("sort_order", { ascending: true })
    .overrideTypes<Topic[], { merge: false }>();
  return data ?? [];
}

export async function getTopic(slug: string): Promise<Topic | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("forum_topics")
    .select("slug, name, description")
    .eq("slug", slug)
    .maybeSingle()
    .overrideTypes<Topic, { merge: false }>();
  return data ?? null;
}

type SummaryRow = {
  id: string;
  title: string;
  body: string;
  topic_slug: string;
  kind: string;
  is_anonymous: boolean;
  accepted_answer_id: string | null;
  created_at: string;
  author: ForumAuthor | null;
  answers: { count: number }[];
};

const SUMMARY_COLUMNS = `id, title, body, topic_slug, kind, is_anonymous, accepted_answer_id, created_at, author:profiles!forum_questions_author_id_fkey(${FORUM_AUTHOR_COLUMNS}), answers:forum_answers!forum_answers_question_fkey(count)`;

/** Named authors only: an anonymous item has no author object, so nothing here can reveal one. */
async function attachBadges(authors: (ForumAuthor | null)[]) {
  const named = authors.filter((a): a is ForumAuthor => a !== null);
  const map = await getBadges(named.map((a) => a.id));
  for (const a of named) a.badge = map.get(a.id) ?? null;
}

const toSummary = (r: SummaryRow): QuestionSummary => ({
  id: r.id,
  title: r.title,
  body: r.body,
  topic_slug: r.topic_slug,
  kind: r.kind,
  is_anonymous: r.is_anonymous,
  accepted: r.accepted_answer_id !== null,
  created_at: r.created_at,
  author: r.is_anonymous ? null : r.author,
  answerCount: count(r.answers),
});

export async function listQuestions(
  viewerId: string,
  { q, topic, kind, filter, page }: ListParams,
): Promise<{ questions: QuestionSummary[]; total: number; failed?: boolean }> {
  const supabase = await createClient();

  // "Following" and "My questions" start from the viewer's own private lists.
  let onlyIds: string[] | undefined;
  if (filter === "following") {
    const { data, error } = await supabase
      .from("forum_follows")
      .select("question_id")
      .eq("user_id", viewerId)
      .limit(500)
      .overrideTypes<{ question_id: string }[], { merge: false }>();
    if (error) return { questions: [], total: 0, failed: true };
    onlyIds = (data ?? []).map((f) => f.question_id);
  } else if (filter === "mine") {
    const { data, error } = await supabase
      .from("forum_identity")
      .select("content_id")
      .eq("author_id", viewerId)
      .eq("content_type", "question")
      .limit(500)
      .overrideTypes<{ content_id: string }[], { merge: false }>();
    if (error) return { questions: [], total: 0, failed: true };
    onlyIds = (data ?? []).map((i) => i.content_id);
  }
  if (onlyIds && onlyIds.length === 0) return { questions: [], total: 0 };

  const hidden = await getHiddenAuthorIds(viewerId);

  let query = supabase.from("forum_questions").select(SUMMARY_COLUMNS, { count: "exact" });
  if (onlyIds) query = query.in("id", onlyIds);
  if (topic) query = query.eq("topic_slug", topic);
  if (kind) query = query.eq("kind", kind);
  if (filter === "open") query = query.is("accepted_answer_id", null);
  // Anonymous questions have no author, so they must be kept explicitly.
  if (hidden.length > 0 && filter !== "mine") {
    query = query.or(`author_id.is.null,author_id.not.in.(${hidden.join(",")})`);
  }
  if (q) query = query.textSearch("search", q, { type: "websearch", config: "simple" });

  const from = (page - 1) * FORUM_PAGE_SIZE;
  const { data, error, count: total } = await query
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(from, from + FORUM_PAGE_SIZE - 1)
    .overrideTypes<SummaryRow[], { merge: false }>();
  if (error || !data) return { questions: [], total: 0, failed: true };
  const questions = data.map(toSummary);
  await attachBadges(questions.map((q) => q.author));
  return { questions, total: total ?? data.length };
}

type AnswerRow = {
  id: string;
  question_id: string;
  body: string;
  created_at: string;
  edited_at: string | null;
  is_anonymous: boolean;
  author: ForumAuthor | null;
  votes: { count: number }[];
};

type ReplyRow = {
  id: string;
  answer_id: string;
  body: string;
  created_at: string;
  is_anonymous: boolean;
  author: ForumAuthor | null;
};

export async function getQuestion(viewerId: string, id: string): Promise<QuestionDetail | null> {
  const supabase = await createClient();
  const { data: question } = await supabase
    .from("forum_questions")
    .select(`${SUMMARY_COLUMNS}, edited_at`)
    .eq("id", id)
    .maybeSingle()
    .overrideTypes<SummaryRow & { edited_at: string | null }, { merge: false }>();
  if (!question) return null;

  const [answersRes, hidden] = await Promise.all([
    supabase
      .from("forum_answers")
      .select(
        `id, question_id, body, created_at, edited_at, is_anonymous, author:profiles!forum_answers_author_id_fkey(${FORUM_AUTHOR_COLUMNS}), votes:forum_votes(count)`,
      )
      .eq("question_id", id)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(200)
      .overrideTypes<AnswerRow[], { merge: false }>(),
    getHiddenAuthorIds(viewerId),
  ]);
  const hiddenSet = new Set(hidden);
  // Members the viewer muted stay out of view; anonymous answers have no author to compare.
  const answers = (answersRes.data ?? []).filter((a) => a.is_anonymous || !a.author || !hiddenSet.has(a.author.id));
  const answerIds = answers.map((a) => a.id);

  const repliesRes = answerIds.length
    ? await supabase
        .from("forum_replies")
        .select(`id, answer_id, body, created_at, is_anonymous, author:profiles!forum_replies_author_id_fkey(${FORUM_AUTHOR_COLUMNS})`)
        .in("answer_id", answerIds)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .limit(500)
        .overrideTypes<ReplyRow[], { merge: false }>()
    : { data: [] as ReplyRow[] };
  const replies = (repliesRes.data ?? []).filter((r) => r.is_anonymous || !r.author || !hiddenSet.has(r.author.id));

  const replyIds = replies.map((r) => r.id);
  const [identity, votes, saves, follow] = await Promise.all([
    supabase
      .from("forum_identity")
      .select("content_type, content_id")
      .eq("author_id", viewerId)
      .in("content_id", [id, ...answerIds, ...replyIds])
      .overrideTypes<{ content_type: string; content_id: string }[], { merge: false }>(),
    answerIds.length
      ? supabase
          .from("forum_votes")
          .select("answer_id")
          .eq("user_id", viewerId)
          .in("answer_id", answerIds)
          .overrideTypes<{ answer_id: string }[], { merge: false }>()
      : Promise.resolve({ data: [] as { answer_id: string }[] }),
    supabase
      .from("saved_items")
      .select("item_type, item_id")
      .eq("user_id", viewerId)
      .in("item_type", ["forum_question", "forum_answer"])
      .in("item_id", [id, ...answerIds])
      .overrideTypes<{ item_type: string; item_id: string }[], { merge: false }>(),
    supabase
      .from("forum_follows")
      .select("question_id")
      .eq("user_id", viewerId)
      .eq("question_id", id)
      .maybeSingle()
      .overrideTypes<{ question_id: string }, { merge: false }>(),
  ]);

  const mine = new Set((identity.data ?? []).map((i) => `${i.content_type}:${i.content_id}`));
  const voted = new Set((votes.data ?? []).map((v) => v.answer_id));
  const saved = new Set((saves.data ?? []).map((s) => `${s.item_type}:${s.item_id}`));

  const repliesByAnswer = new Map<string, ReplyEntry[]>();
  for (const r of replies) {
    const entry: ReplyEntry = {
      id: r.id,
      body: r.body,
      created_at: r.created_at,
      is_anonymous: r.is_anonymous,
      author: r.is_anonymous ? null : r.author,
      isMine: mine.has(`reply:${r.id}`),
    };
    repliesByAnswer.set(r.answer_id, [...(repliesByAnswer.get(r.answer_id) ?? []), entry]);
  }

  const entries: AnswerEntry[] = answers.map((a) => ({
    id: a.id,
    body: a.body,
    created_at: a.created_at,
    edited_at: a.edited_at,
    is_anonymous: a.is_anonymous,
    author: a.is_anonymous ? null : a.author,
    isMine: mine.has(`answer:${a.id}`),
    accepted: question.accepted_answer_id === a.id,
    helpfulCount: count(a.votes),
    votedByMe: voted.has(a.id),
    savedByMe: saved.has(`forum_answer:${a.id}`),
    replies: repliesByAnswer.get(a.id) ?? [],
  }));
  // The accepted answer first, then the most helpful, then the earliest.
  entries.sort(
    (x, y) =>
      Number(y.accepted) - Number(x.accepted) ||
      y.helpfulCount - x.helpfulCount ||
      x.created_at.localeCompare(y.created_at),
  );

  const summary = toSummary(question);
  await attachBadges([summary.author, ...entries.map((e) => e.author), ...entries.flatMap((e) => e.replies.map((r) => r.author))]);
  return {
    ...summary,
    edited_at: question.edited_at,
    isMine: mine.has(`question:${id}`),
    followedByMe: Boolean(follow.data),
    savedByMe: saved.has(`forum_question:${id}`),
    answers: entries,
  };
}

/** Saved questions and answers for the Saved page, newest save first. */
export async function getSavedForum(
  viewerId: string,
  page: number,
  pageSize: number,
): Promise<{ questions: QuestionSummary[]; answers: { id: string; body: string; question: QuestionSummary }[]; total: number; failed?: boolean }> {
  const supabase = await createClient();
  const from = (page - 1) * pageSize;
  const { data, error, count: total } = await supabase
    .from("saved_items")
    .select("item_type, item_id", { count: "exact" })
    .eq("user_id", viewerId)
    .in("item_type", ["forum_question", "forum_answer"])
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(from, from + pageSize - 1)
    .overrideTypes<{ item_type: string; item_id: string }[], { merge: false }>();
  if (error || !data) return { questions: [], answers: [], total: 0, failed: true };

  const questionIds = data.filter((i) => i.item_type === "forum_question").map((i) => i.item_id);
  const answerIds = data.filter((i) => i.item_type === "forum_answer").map((i) => i.item_id);

  const [qs, ans] = await Promise.all([
    questionIds.length
      ? supabase.from("forum_questions").select(SUMMARY_COLUMNS).in("id", questionIds).overrideTypes<SummaryRow[], { merge: false }>()
      : Promise.resolve({ data: [] as SummaryRow[] }),
    answerIds.length
      ? supabase
          .from("forum_answers")
          .select(`id, body, question:forum_questions!forum_answers_question_fkey(${SUMMARY_COLUMNS})`)
          .in("id", answerIds)
          .overrideTypes<{ id: string; body: string; question: SummaryRow | null }[], { merge: false }>()
      : Promise.resolve({ data: [] as { id: string; body: string; question: SummaryRow | null }[] }),
  ]);

  return {
    questions: (qs.data ?? []).map(toSummary),
    answers: (ans.data ?? []).flatMap((a) => (a.question ? [{ id: a.id, body: a.body, question: toSummary(a.question) }] : [])),
    total: total ?? data.length,
  };
}
