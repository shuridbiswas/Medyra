import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Relationship } from "@/features/network/types";

const actions = vi.hoisted(() => ({
  sendConnectionRequest: vi.fn(),
  acceptRequest: vi.fn(),
  declineRequest: vi.fn(),
  withdrawRequest: vi.fn(),
  removeConnection: vi.fn(),
  setFollow: vi.fn(),
  setBlock: vi.fn(),
}));
vi.mock("@/features/network/actions", () => actions);
const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const { RelationshipActions } = await import("@/features/network/components/relationship-actions");
const { BlockButton } = await import("@/features/network/components/block-button");
const { MemberCard } = await import("@/features/network/components/member-card");
const { Pagination } = await import("@/components/layout/pagination");

const none: Relationship = { state: "none", connectionId: null, following: false };
const rel = (over: Partial<Relationship>): Relationship => ({ ...none, ...over });
const ok = (relationship: Relationship) => ({ ok: true, relationship });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("RelationshipActions", () => {
  it("connects, then offers to withdraw the request", async () => {
    const user = userEvent.setup();
    actions.sendConnectionRequest.mockResolvedValue(ok(rel({ state: "request_sent", connectionId: "c1" })));
    actions.withdrawRequest.mockResolvedValue(ok(none));
    render(<RelationshipActions memberId="m1" name="Sam" initial={none} />);

    await user.click(screen.getByRole("button", { name: "Connect with Sam" }));
    expect(actions.sendConnectionRequest).toHaveBeenCalledWith("m1");
    expect(await screen.findByText("Request sent")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /withdraw your request to sam/i }));
    expect(actions.withdrawRequest).toHaveBeenCalledWith("c1");
    expect(await screen.findByRole("button", { name: "Connect with Sam" })).toBeInTheDocument();
  });

  it("accepts or declines a received request using its connection id", async () => {
    const user = userEvent.setup();
    const received = rel({ state: "request_received", connectionId: "c2" });
    actions.acceptRequest.mockResolvedValue(ok(rel({ state: "connected", connectionId: "c2" })));
    render(<RelationshipActions memberId="m1" name="Sam" initial={received} />);
    await user.click(screen.getByRole("button", { name: /accept sam's request/i }));
    expect(actions.acceptRequest).toHaveBeenCalledWith("c2");
    expect(await screen.findByText("Connected")).toBeInTheDocument();
  });

  it("declines a received request", async () => {
    const user = userEvent.setup();
    actions.declineRequest.mockResolvedValue(ok(none));
    render(
      <RelationshipActions
        memberId="m1"
        name="Sam"
        initial={rel({ state: "request_received", connectionId: "c2" })}
      />,
    );
    await user.click(screen.getByRole("button", { name: /decline sam's request/i }));
    expect(actions.declineRequest).toHaveBeenCalledWith("c2");
    expect(await screen.findByRole("button", { name: "Connect with Sam" })).toBeInTheDocument();
  });

  it("asks before removing a connection, and Keep cancels", async () => {
    const user = userEvent.setup();
    actions.removeConnection.mockResolvedValue(ok(none));
    render(
      <RelationshipActions
        memberId="m1"
        name="Sam"
        initial={rel({ state: "connected", connectionId: "c3" })}
      />,
    );
    await user.click(screen.getByRole("button", { name: /remove sam from your connections/i }));
    expect(actions.removeConnection).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Keep" }));
    expect(screen.getByText("Connected")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /remove sam from your connections/i }));
    await user.click(screen.getByRole("button", { name: /yes, remove/i }));
    expect(actions.removeConnection).toHaveBeenCalledWith("c3");
    expect(await screen.findByRole("button", { name: "Connect with Sam" })).toBeInTheDocument();
  });

  it("follows and unfollows separately from connecting", async () => {
    const user = userEvent.setup();
    actions.setFollow.mockResolvedValue(ok(rel({ following: true })));
    render(<RelationshipActions memberId="m1" name="Sam" initial={none} />);
    const follow = screen.getByRole("button", { name: "Follow Sam" });
    expect(follow).toHaveAttribute("aria-pressed", "false");
    await user.click(follow);
    expect(actions.setFollow).toHaveBeenCalledWith("m1", true);
    expect(await screen.findByRole("button", { name: "Unfollow Sam" })).toHaveAttribute("aria-pressed", "true");
    // Following did not change the connection state.
    expect(screen.getByRole("button", { name: "Connect with Sam" })).toBeInTheDocument();
  });

  it("can hide the follow button", () => {
    render(<RelationshipActions memberId="m1" name="Sam" initial={none} showFollow={false} />);
    expect(screen.queryByRole("button", { name: /follow/i })).not.toBeInTheDocument();
  });

  it("shows the server's error and keeps the current state when an action fails", async () => {
    const user = userEvent.setup();
    actions.sendConnectionRequest.mockResolvedValue({ ok: false, error: "You can't do that with this member." });
    render(<RelationshipActions memberId="m1" name="Sam" initial={none} />);
    await user.click(screen.getByRole("button", { name: "Connect with Sam" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("You can't do that with this member.");
    expect(screen.getByRole("button", { name: "Connect with Sam" })).toBeInTheDocument();
  });
});

describe("BlockButton", () => {
  it("explains what blocking does and needs a confirmation", async () => {
    const user = userEvent.setup();
    actions.setBlock.mockResolvedValue({ ok: true });
    render(<BlockButton memberId="m1" name="Sam" />);
    await user.click(screen.getByRole("button", { name: "Block Sam" }));
    expect(screen.getByText(/no longer be connected or following each other/i)).toBeInTheDocument();
    expect(actions.setBlock).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /yes, block/i }));
    expect(actions.setBlock).toHaveBeenCalledWith("m1", true);
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("can be cancelled", async () => {
    const user = userEvent.setup();
    render(<BlockButton memberId="m1" name="Sam" />);
    await user.click(screen.getByRole("button", { name: "Block Sam" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(actions.setBlock).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Block Sam" })).toBeInTheDocument();
  });

  it("unblocks without a confirmation", async () => {
    const user = userEvent.setup();
    actions.setBlock.mockResolvedValue({ ok: true });
    render(<BlockButton memberId="m1" name="Sam" blocked />);
    await user.click(screen.getByRole("button", { name: "Unblock Sam" }));
    expect(actions.setBlock).toHaveBeenCalledWith("m1", false);
  });

  it("shows a failure", async () => {
    const user = userEvent.setup();
    actions.setBlock.mockResolvedValue({ ok: false, error: "Something went wrong. Please try again." });
    render(<BlockButton memberId="m1" name="Sam" blocked />);
    await user.click(screen.getByRole("button", { name: "Unblock Sam" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/went wrong/);
  });
});

describe("MemberCard", () => {
  const member = {
    id: "m1",
    username: "sam_k",
    first_name: "Sam",
    last_name: "Kowalski",
    headline: "Social work student",
    avatar_path: null,
    member_type: "graduate_student",
    institution: "McGill University",
    specialty: null,
    fields: ["social_work", "public_health", "nursing"],
    country: "CA",
    location_label: "Montreal",
    open_to_mentor: true,
    looking_for_mentorship: false,
  };

  it("shows who they are, links to their profile and says they are unverified", () => {
    render(<MemberCard member={member} />);
    expect(screen.getByRole("link", { name: "Sam Kowalski" })).toHaveAttribute("href", "/profile/sam_k");
    expect(screen.getByText("@sam_k")).toBeInTheDocument();
    expect(screen.getByText("Not Verified")).toBeInTheDocument();
    expect(screen.getByText("Social work student")).toBeInTheDocument();
    expect(screen.getByText("Graduate student · McGill University")).toBeInTheDocument();
    expect(screen.getByText("Montreal, Canada")).toBeInTheDocument();
    expect(screen.getByText("Open to mentoring")).toBeInTheDocument();
  });

  it("shows at most two fields and never an email address", () => {
    const { container } = render(<MemberCard member={member} />);
    expect(screen.getAllByRole("listitem").filter((li) => li.closest("[aria-label='Fields']"))).toHaveLength(2);
    expect(container.textContent).not.toMatch(/[a-z0-9._-]+@[a-z0-9-]+\.[a-z]{2,}/i);
  });

  it("only shows the connection buttons when a relationship is supplied", () => {
    const { rerender } = render(<MemberCard member={member} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    rerender(<MemberCard member={member} relationship={none} />);
    expect(screen.getByRole("button", { name: "Connect with Sam Kowalski" })).toBeInTheDocument();
    rerender(<MemberCard member={member} relationship={none} actions={false} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("Pagination", () => {
  const hrefFor = (p: number) => `/network?page=${p}`;

  it("links to the previous and next pages and says where you are", () => {
    render(<Pagination page={2} pageSize={12} total={30} hrefFor={hrefFor} />);
    expect(screen.getByText("Page 2 of 3")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /previous/i })).toHaveAttribute("href", "/network?page=1");
    expect(screen.getByRole("link", { name: /next/i })).toHaveAttribute("href", "/network?page=3");
  });

  it("disables the ends and hides itself when everything fits on one page", () => {
    const { rerender, container } = render(<Pagination page={1} pageSize={12} total={30} hrefFor={hrefFor} />);
    expect(screen.queryByRole("link", { name: /previous/i })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /next/i })).toBeInTheDocument();
    rerender(<Pagination page={3} pageSize={12} total={30} hrefFor={hrefFor} />);
    expect(screen.queryByRole("link", { name: /next/i })).not.toBeInTheDocument();
    rerender(<Pagination page={1} pageSize={12} total={12} hrefFor={hrefFor} />);
    expect(container).toBeEmptyDOMElement();
  });
});
