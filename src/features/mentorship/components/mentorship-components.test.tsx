import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
const actions = {
  saveMentorProfile: vi.fn(),
  removeMentorProfile: vi.fn(async () => ({ ok: true })),
  addAvailability: vi.fn(),
  removeAvailability: vi.fn(async () => ({ ok: true })),
  sendMentorshipRequest: vi.fn(async () => ({ ok: true })),
  withdrawMentorshipRequest: vi.fn(async () => ({ ok: true })),
  decideMentorshipRequest: vi.fn(async () => ({ ok: true })),
  changeMentorshipStatus: vi.fn(async () => ({ ok: true })),
  submitMentorshipFeedback: vi.fn(async () => ({ ok: true })),
};

vi.mock("@/features/mentorship/actions", () => actions);
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const { MentorForm, AvailabilityEditor } = await import("@/features/mentorship/components/mentor-forms");
const { DecideRequestControls, MentorshipControls, RequestForm, FeedbackForm } = await import("@/features/mentorship/components/relationship-controls");
const { MentorCard, MentorshipLimits } = await import("@/features/mentorship/components/shared");

const member = {
  id: "m1", username: "mia_m", first_name: "Mia", last_name: "M", headline: null, avatar_path: null, member_type: "educator",
  institution: null, specialty: null, fields: ["nursing"], country: "CA", location_label: null, open_to_mentor: true, looking_for_mentorship: false,
};
const mentor = {
  user_id: "m1", bio: "I teach community nursing.", expertise: "Community nursing education", experience_years: 12, organization: "Mercy College",
  topics: ["placements"], languages: ["english"], capacity: 2, session_formats: ["video" as const, "chat" as const], accepting: true, member,
};

beforeEach(() => vi.clearAllMocks());

describe("mentor cards and framing", () => {
  it("labels expertise as self-declared and every mentor as unverified, with no accreditation claim", () => {
    render(<MentorCard mentor={mentor} />);
    expect(screen.getByRole("link", { name: "Mia M" })).toHaveAttribute("href", "/mentorship/m1");
    expect(screen.getByText("Not Verified")).toBeInTheDocument();
    expect(screen.getByText("(self-declared)")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/accredited mentor|verified mentor|certified|licensed supervisor/i);
    expect(screen.getByText(/up to 2 mentees/i)).toBeInTheDocument();
  });

  it("states what mentorship is not", () => {
    render(<MentorshipLimits />);
    const text = document.body.textContent ?? "";
    expect(text).toMatch(/doesn't verify it, and doesn't accredit mentors/i);
    expect(text).toMatch(/isn't automatically a qualified clinical supervisor/i);
    expect(text).toMatch(/no calendar is connected/i);
  });
});

describe("MentorForm", () => {
  it("asks for the self-declaration and keeps typed values when saving fails", async () => {
    const user = userEvent.setup();
    actions.saveMentorProfile.mockResolvedValue({ status: "error", message: "Please fix the highlighted fields.", fieldErrors: { acknowledged: ["Please confirm the statement above to list yourself."] } });
    render(<MentorForm />);
    expect(screen.getByRole("checkbox", { name: /self-declared and not verified by Medyra/i })).not.toBeChecked();
    await user.type(screen.getByLabelText(/area of expertise/i), "Community nursing");
    await user.click(screen.getByRole("button", { name: /list me as a mentor/i }));
    expect(await screen.findByText(/confirm the statement above/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/area of expertise/i)).toHaveValue("Community nursing");
  });
});

describe("AvailabilityEditor", () => {
  it("lists windows and removes one", async () => {
    const user = userEvent.setup();
    render(<AvailabilityEditor windows={[{ id: "w1", mentor_id: "m1", weekday: 2, start_minute: 540, end_minute: 600, timezone: "UTC" }]} />);
    expect(screen.getByText("Tuesday", { selector: "span" })).toBeInTheDocument();
    expect(screen.getByText(/09:00–10:00/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /remove tuesday 09:00/i }));
    expect(actions.removeAvailability).toHaveBeenCalledWith("w1");
  });
});

describe("requests and relationships", () => {
  it("needs real goals before a request can be sent, then sends it", async () => {
    const user = userEvent.setup();
    render(<RequestForm mentorId="m1" mentorName="Mia" formats={["video", "chat"]} />);
    expect(screen.getByRole("button", { name: /send request/i })).toBeDisabled();
    await user.type(screen.getByLabelText(/what would you like help with from mia/i), "I want to prepare for my first community placement.");
    await user.selectOptions(screen.getByLabelText(/preferred format/i), "video");
    await user.click(screen.getByRole("button", { name: /send request/i }));
    expect(actions.sendMentorshipRequest).toHaveBeenCalledWith("m1", "I want to prepare for my first community placement.", "video");
    expect(refresh).toHaveBeenCalled();
  });

  it("lets a mentor accept, or decline with a note", async () => {
    const user = userEvent.setup();
    render(<DecideRequestControls requestId="r1" name="Bob" />);
    await user.click(screen.getByRole("button", { name: "Accept Bob" }));
    expect(actions.decideMentorshipRequest).toHaveBeenCalledWith("r1", true);
    await user.click(screen.getByRole("button", { name: "Decline Bob" }));
    await user.type(screen.getByLabelText(/short, kind note/i), "My schedule is full.");
    await user.click(screen.getByRole("button", { name: /decline request/i }));
    expect(actions.decideMentorshipRequest).toHaveBeenLastCalledWith("r1", false, "My schedule is full.");
  });

  it("shows a capacity refusal from the server", async () => {
    const user = userEvent.setup();
    actions.decideMentorshipRequest.mockResolvedValueOnce({ ok: false, error: "You are at your mentoring capacity." } as never);
    render(<DecideRequestControls requestId="r1" name="Bob" />);
    await user.click(screen.getByRole("button", { name: "Accept Bob" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/mentoring capacity/i);
  });

  it("offers pause only to the mentor, completion to both, and nothing once finished", async () => {
    const user = userEvent.setup();
    const { rerender, container } = render(<MentorshipControls mentorshipId="s1" status="active" role="mentee" />);
    expect(screen.queryByRole("button", { name: /^pause$/i })).toBeNull();
    rerender(<MentorshipControls mentorshipId="s1" status="active" role="mentor" />);
    await user.click(screen.getByRole("button", { name: /^pause$/i }));
    expect(actions.changeMentorshipStatus).toHaveBeenCalledWith("s1", "paused");
    await user.click(screen.getByRole("button", { name: /mark as completed/i }));
    await user.click(screen.getByRole("button", { name: "Yes" }));
    expect(actions.changeMentorshipStatus).toHaveBeenLastCalledWith("s1", "completed");
    rerender(<MentorshipControls mentorshipId="s1" status="completed" role="mentor" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("sends private feedback with a rating", async () => {
    const user = userEvent.setup();
    render(<FeedbackForm mentorshipId="s1" />);
    expect(screen.getByRole("button", { name: /send feedback/i })).toBeDisabled();
    await user.selectOptions(screen.getByLabelText(/how helpful/i), "4");
    await user.type(screen.getByLabelText(/comments/i), "Clear and kind");
    expect(screen.getByText(/only you and the other person can read this/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /send feedback/i }));
    expect(actions.submitMentorshipFeedback).toHaveBeenCalledWith("s1", 4, "Clear and kind");
  });
});
