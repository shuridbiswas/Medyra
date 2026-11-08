import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
const actions = {
  askQuestion: vi.fn(),
  postAnswer: vi.fn(async () => ({ ok: true })),
  postReply: vi.fn(async () => ({ ok: true })),
  setHelpful: vi.fn(async (_id: string, on: boolean) => ({ ok: true, on })),
  acceptAnswer: vi.fn(async () => ({ ok: true })),
  deleteAnswer: vi.fn(async () => ({ ok: true })),
  deleteReply: vi.fn(async () => ({ ok: true })),
  deleteQuestion: vi.fn(async () => ({ ok: true })),
  setFollow: vi.fn(async (_id: string, on: boolean) => ({ ok: true, on })),
  setSavedForum: vi.fn(async (_t: string, _id: string, saved: boolean) => ({ ok: true, saved })),
};

vi.mock("@/features/forums/actions", () => actions);
vi.mock("@/features/safety/actions", () => ({ submitReport: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

const { AuthorLine } = await import("@/features/forums/components/author-line");
const { AskForm } = await import("@/features/forums/components/ask-form");
const { AnswerSection } = await import("@/features/forums/components/answers");
const { EducationalNotice, AnonymityExplainer } = await import("@/features/forums/components/forum-notices");
const { QuestionCard } = await import("@/features/forums/components/question-card");

const author = { id: "u1", username: "alice_a", first_name: "Alice", last_name: "Adams", headline: null, avatar_path: null, member_type: "educator" };
const topics = [{ slug: "other", name: "Something else", description: "x" }];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AuthorLine", () => {
  it("shows a public writer's name, self-reported role and the unverified chip", () => {
    render(<AuthorLine author={author} anonymous={false} createdAt="2026-11-03T10:00:00Z" />);
    expect(screen.getByRole("link", { name: "Alice Adams" })).toHaveAttribute("href", "/profile/alice_a");
    expect(screen.getByText("Not Verified")).toBeInTheDocument();
    expect(screen.getByText(/self-reported/i)).toBeInTheDocument();
  });

  it("shows nothing about an anonymous writer, even if an author object is passed", () => {
    const { container } = render(<AuthorLine author={author} anonymous createdAt="2026-11-03T10:00:00Z" />);
    expect(screen.getByText("Anonymous member")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/Alice|Adams|alice_a|educator|Verified/i);
    expect(screen.queryByRole("link")).toBeNull();
  });
});

describe("notices", () => {
  it("says the forums are educational and not a consultation, and warns about patient information", () => {
    render(<EducationalNotice />);
    const text = document.body.textContent ?? "";
    expect(text).toMatch(/not a clinical consultation, a diagnosis, or an authoritative patient-specific second opinion/i);
    expect(text).toMatch(/never post identifiable patient or client information/i);
    expect(text).toMatch(/not verified yet/i);
    expect(text).toMatch(/not a crisis service/i);
  });

  it("explains honestly what anonymous does and does not mean", () => {
    render(<AnonymityExplainer />);
    const text = document.body.textContent ?? "";
    expect(text).toMatch(/private record of who wrote it/i);
    expect(text).toMatch(/not from Medyra/i);
    expect(text).toMatch(/can still identify you/i);
  });
});

describe("AskForm", () => {
  it("makes the member confirm there is no identifiable information, and offers anonymity with its explanation", async () => {
    render(<AskForm topics={topics} />);
    expect(screen.getByRole("checkbox", { name: /contains no identifiable patient or client information/i })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: /post anonymously/i })).not.toBeChecked();
    expect(screen.getByText(/what anonymous means/i)).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /kind of question/i })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Non-identifiable scenario" })).toBeInTheDocument();
  });

  it("keeps what the member typed when posting fails", async () => {
    const user = userEvent.setup();
    actions.askQuestion.mockResolvedValue({ status: "error", message: "Please fix the highlighted fields.", fieldErrors: { confirmed: ["Please confirm."] } });
    render(<AskForm topics={topics} />);
    await user.type(screen.getByLabelText("Question"), "How do I read a forest plot?");
    await user.type(screen.getByLabelText("Details"), "I am new to meta-analysis.");
    await user.click(screen.getByRole("button", { name: /post question/i }));
    expect(await screen.findByText("Please confirm.")).toBeInTheDocument();
    expect(screen.getByLabelText("Question")).toHaveValue("How do I read a forest plot?");
    expect(screen.getByLabelText("Details")).toHaveValue("I am new to meta-analysis.");
  });
});

describe("QuestionCard", () => {
  const base = {
    id: "q1",
    title: "How should I appraise a small trial?",
    body: "Body text",
    topic_slug: "other",
    kind: "evidence",
    is_anonymous: false,
    accepted: false,
    created_at: "2026-11-03T10:00:00Z",
    author,
    answerCount: 2,
  };

  it("shows the answers tile, topic and writer", () => {
    render(<QuestionCard question={base} topics={new Map(topics.map((t) => [t.slug, t]))} />);
    expect(screen.getByRole("link", { name: base.title })).toHaveAttribute("href", "/forums/q1");
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Something else" })).toHaveAttribute("href", "/forums/topics/other");
    expect(screen.getByText("Alice Adams")).toBeInTheDocument();
  });

  it("shows an anonymous question without a writer and marks an accepted answer", () => {
    render(<QuestionCard question={{ ...base, is_anonymous: true, author: null, accepted: true }} topics={new Map()} />);
    expect(screen.getByText("Anonymous member")).toBeInTheDocument();
    expect(screen.getByText("Accepted answer")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Alice/);
  });
});

describe("AnswerSection", () => {
  const answer = (over: Record<string, unknown> = {}) => ({
    id: "a1",
    body: "Look at allocation concealment.",
    created_at: "2026-11-03T11:00:00Z",
    edited_at: null,
    is_anonymous: false,
    author,
    isMine: false,
    accepted: false,
    helpfulCount: 3,
    votedByMe: false,
    savedByMe: false,
    replies: [],
    ...over,
  });

  it("marks an answer helpful and refreshes", async () => {
    const user = userEvent.setup();
    render(<AnswerSection questionId="q1" answers={[answer()]} canAccept={false} />);
    await user.click(screen.getByRole("button", { name: /mark helpful/i }));
    expect(actions.setHelpful).toHaveBeenCalledWith("a1", true);
    expect(refresh).toHaveBeenCalled();
  });

  it("does not let a writer mark their own answer helpful, and shows delete instead of report", () => {
    render(<AnswerSection questionId="q1" answers={[answer({ isMine: true, is_anonymous: true, author: null })]} canAccept={false} />);
    expect(screen.getByRole("button", { name: /mark helpful/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /delete your answer/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /report/i })).toBeNull();
    expect(screen.getByText("Anonymous member")).toBeInTheDocument();
  });

  it("offers acceptance only to the asker, and shows the accepted answer", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<AnswerSection questionId="q1" answers={[answer()]} canAccept={false} />);
    expect(screen.queryByRole("button", { name: /accept answer/i })).toBeNull();
    rerender(<AnswerSection questionId="q1" answers={[answer()]} canAccept />);
    await user.click(screen.getByRole("button", { name: /accept answer/i }));
    expect(actions.acceptAnswer).toHaveBeenCalledWith("q1", "a1");
    rerender(<AnswerSection questionId="q1" answers={[answer({ accepted: true })]} canAccept />);
    expect(screen.getByText(/accepted by the person who asked/i)).toBeInTheDocument();
  });

  it("posts an anonymous answer and explains what anonymous means next to the box", async () => {
    const user = userEvent.setup();
    render(<AnswerSection questionId="q1" answers={[]} canAccept={false} />);
    expect(screen.getByText(/no answers yet/i)).toBeInTheDocument();
    expect(screen.getByText(/what anonymous means/i)).toBeInTheDocument();
    await user.type(screen.getByLabelText(/share what you know/i), "  An anonymous answer.  ");
    await user.click(screen.getByRole("checkbox", { name: /post anonymously/i }));
    await user.click(screen.getByRole("button", { name: /post answer/i }));
    expect(actions.postAnswer).toHaveBeenCalledWith("q1", "  An anonymous answer.  ", true);
  });

  it("lists replies, and lets the writer delete only their own", async () => {
    const user = userEvent.setup();
    render(
      <AnswerSection
        questionId="q1"
        canAccept={false}
        answers={[
          answer({
            replies: [
              { id: "r1", body: "A mine reply", created_at: "2026-11-03T12:00:00Z", is_anonymous: true, author: null, isMine: true },
              { id: "r2", body: "Someone else's", created_at: "2026-11-03T12:30:00Z", is_anonymous: false, author, isMine: false },
            ],
          }),
        ]}
      />,
    );
    const replies = within(screen.getByRole("list", { name: "Replies" }));
    expect(replies.getAllByRole("listitem")).toHaveLength(2);
    expect(replies.getAllByRole("button", { name: /delete/i })).toHaveLength(1);
    await user.click(replies.getByRole("button", { name: /delete/i }));
    await user.click(replies.getByRole("button", { name: /yes, delete/i }));
    expect(actions.deleteReply).toHaveBeenCalledWith("r1");
  });
});
