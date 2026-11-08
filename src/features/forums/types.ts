import type { MemberBadge } from "@/features/student-verification/types";

/** Public author fields. Null for an anonymous question, answer or reply: there is nothing to show. */
export type ForumAuthor = {
  id: string;
  username: string | null;
  first_name: string;
  last_name: string;
  headline: string | null;
  avatar_path: string | null;
  member_type: string | null;
  /** Current valid student credentials; never set for anonymous content (there is no author object). */
  badge?: MemberBadge | null;
};

export const FORUM_AUTHOR_COLUMNS = "id, username, first_name, last_name, headline, avatar_path, member_type";

export type QuestionSummary = {
  id: string;
  title: string;
  body: string;
  topic_slug: string;
  kind: string;
  is_anonymous: boolean;
  accepted: boolean;
  created_at: string;
  author: ForumAuthor | null;
  answerCount: number;
};

export type ReplyEntry = {
  id: string;
  body: string;
  created_at: string;
  is_anonymous: boolean;
  author: ForumAuthor | null;
  /** True when the signed-in viewer wrote it (public or anonymous). Only the viewer's own records say so. */
  isMine: boolean;
};

export type AnswerEntry = {
  id: string;
  body: string;
  created_at: string;
  edited_at: string | null;
  is_anonymous: boolean;
  author: ForumAuthor | null;
  isMine: boolean;
  accepted: boolean;
  helpfulCount: number;
  votedByMe: boolean;
  savedByMe: boolean;
  replies: ReplyEntry[];
};

export type QuestionDetail = QuestionSummary & {
  edited_at: string | null;
  isMine: boolean;
  followedByMe: boolean;
  savedByMe: boolean;
  answers: AnswerEntry[];
};

export type Topic = { slug: string; name: string; description: string };
