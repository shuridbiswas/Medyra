import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ProfileHeader } from "@/features/profile/components/profile-header";
import { ProfileTabs } from "@/features/profile/components/profile-tabs";
import {
  AboutCard,
  CompletenessCard,
  InterestsCard,
  NetworkCard,
  TimelineCard,
} from "@/features/profile/components/sections";
import type { PublicProfile } from "@/features/profile/visibility";
import type { EducationRow, ExperienceRow, SkillRow } from "@/lib/supabase/database.types";

const profile: PublicProfile = {
  id: "u1",
  username: "amina_r",
  first_name: "Amina",
  last_name: "Rahman",
  headline: "Psychology student",
  bio: null,
  avatar_path: null,
  cover_path: null,
  location_label: "Montreal, QC",
  professional_journey: null,
  career_aspirations: null,
  looking_for_mentorship: false,
  open_to_mentor: false,
  member_type: "undergraduate_student",
  fields: ["psychology", "public_health"],
  institution: "University of Montreal",
  qualification: "BSc Psychology",
  specialty: null,
  career_stage: "student",
  country: "CA",
  profile_visibility: "members",
  created_at: "2026-01-01",
};

const skill = (name: string, kind: SkillRow["kind"]): SkillRow => ({
  id: `s-${name}`,
  profile_id: "u1",
  name,
  kind,
  created_at: "",
});

const education = (over: Partial<EducationRow> = {}): EducationRow => ({
  id: "e1",
  profile_id: "u1",
  institution: "University of Montreal",
  qualification: "BSc Psychology",
  field_of_study: null,
  start_year: 2024,
  end_year: null,
  currently_studying: true,
  description: null,
  created_at: "",
  updated_at: "",
  ...over,
});

const experience = (over: Partial<ExperienceRow> = {}): ExperienceRow => ({
  id: "x1",
  profile_id: "u1",
  title: "Volunteer",
  organization: "Community Health Centre",
  employment_type: "volunteer",
  start_date: "2023-09-01",
  end_date: "2024-06-01",
  is_current: false,
  description: null,
  created_at: "",
  updated_at: "",
  ...over,
});

describe("ProfileHeader", () => {
  it("shows the identity details and an Edit Profile link only to the owner", () => {
    const { rerender } = render(
      <ProfileHeader profile={profile} isOwner avatarSrc={null} coverSrc={null} />,
    );
    expect(screen.getByRole("heading", { level: 1, name: "Amina Rahman" })).toBeInTheDocument();
    expect(screen.getByText("@amina_r")).toBeInTheDocument();
    expect(screen.getByText("Montreal, QC, Canada")).toBeInTheDocument();
    expect(screen.getByText("Student")).toBeInTheDocument();
    expect(screen.getByText("BSc Psychology at University of Montreal")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /edit profile/i })).toHaveAttribute(
      "href",
      "/profile/edit",
    );

    rerender(
      <ProfileHeader
        profile={profile}
        isOwner={false}
        avatarSrc={null}
        coverSrc={null}
        actions={<button type="button">Connect</button>}
      />,
    );
    expect(screen.queryByRole("link", { name: /edit profile/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Connect" })).toBeInTheDocument();
  });

  it("shows Not Verified until a credential is approved", () => {
    render(<ProfileHeader profile={profile} isOwner={false} avatarSrc={null} coverSrc={null} />);
    expect(screen.getByText("Not Verified")).toBeInTheDocument();
  });

  it("copes with an incomplete profile (no headline, location or photo)", () => {
    const sparse = {
      ...profile,
      headline: null,
      location_label: null,
      country: null,
      fields: [],
      institution: null,
      qualification: null,
      career_stage: null,
    };
    render(<ProfileHeader profile={sparse} isOwner={false} avatarSrc={null} coverSrc={null} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Amina Rahman");
  });

  it("never renders an email address", () => {
    const { container } = render(
      <ProfileHeader profile={profile} isOwner avatarSrc={null} coverSrc={null} />,
    );
    expect(container.textContent).not.toMatch(/@[a-z0-9-]+\.[a-z]{2,}/i);
  });
});

describe("ProfileTabs (accessible tab navigation)", () => {
  const tabs = [
    { id: "a", label: "Posts", panel: <p>Panel A</p> },
    { id: "b", label: "Connections", count: 2, panel: <p>Panel B</p> },
    { id: "c", label: "Activity", panel: <p>Panel C</p> },
  ];

  it("exposes tablist, tab and tabpanel roles and shows one panel at a time", () => {
    render(<ProfileTabs tabs={tabs} />);
    expect(screen.getByRole("tablist", { name: "Profile sections" })).toBeInTheDocument();
    expect(screen.getAllByRole("tab")).toHaveLength(3);
    expect(screen.getByRole("tab", { name: /posts/i })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Panel A");
    expect(screen.getByText("Panel B")).not.toBeVisible();
  });

  it("switches with clicks and arrow, Home and End keys using roving focus", async () => {
    const user = userEvent.setup();
    render(<ProfileTabs tabs={tabs} />);

    await user.click(screen.getByRole("tab", { name: /connections/i }));
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Panel B");

    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: /activity/i })).toHaveFocus();
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Panel C");

    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: /posts/i })).toHaveFocus();

    await user.keyboard("{End}");
    expect(screen.getByRole("tab", { name: /activity/i })).toHaveFocus();
    await user.keyboard("{Home}");
    expect(screen.getByRole("tab", { name: /posts/i })).toHaveFocus();
    await user.keyboard("{ArrowLeft}");
    expect(screen.getByRole("tab", { name: /activity/i })).toHaveFocus();

    expect(screen.getByRole("tab", { name: /posts/i })).toHaveAttribute("tabindex", "-1");
  });
});

describe("profile cards", () => {
  it("invite the owner to add content with working edit links", () => {
    render(
      <>
        <AboutCard profile={profile} isOwner />
        <InterestsCard profile={{ ...profile, fields: [] }} skills={[]} isOwner />
        <TimelineCard education={[]} experience={[]} isOwner firstName="Amina" />
      </>,
    );
    const hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual([
      "/profile/edit#about",
      "/profile/edit#skills",
      "/profile/edit#education",
      "/profile/edit#education",
      "/profile/edit#experience",
    ]);
  });

  it("speak to visitors without edit links", () => {
    render(
      <>
        <AboutCard profile={profile} isOwner={false} />
        <TimelineCard education={[]} experience={[]} isOwner={false} firstName="Amina" />
      </>,
    );
    expect(screen.getByText(/Amina hasn't added an About section yet/)).toBeInTheDocument();
    expect(screen.getByText(/Amina hasn't added education or experience yet/)).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("shows mentorship as self-reported, not verified", () => {
    render(
      <AboutCard
        profile={{ ...profile, looking_for_mentorship: true, open_to_mentor: true }}
        isOwner={false}
      />,
    );
    const list = screen.getByRole("list", { name: "Mentorship" });
    expect(within(list).getByText("Open to mentorship")).toBeInTheDocument();
    expect(within(list).getByText("Looking for mentorship")).toBeInTheDocument();
    expect(screen.getByText(/self-reported/i)).toBeInTheDocument();
    expect(screen.getByText(/not verified professional credentials/i)).toBeInTheDocument();
  });

  it("groups fields, interests, skills and mentorship areas as self-reported", () => {
    render(
      <InterestsCard
        profile={profile}
        skills={[
          skill("Mental health", "interest"),
          skill("Triage", "skill"),
          skill("Clinical placements", "mentorship_area"),
        ]}
        isOwner={false}
      />,
    );
    expect(within(screen.getByRole("list", { name: "Fields" })).getByText("Psychology")).toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "Interests" })).getByText("Mental health")).toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "Skills" })).getByText("Triage")).toBeInTheDocument();
    expect(
      within(screen.getByRole("list", { name: "Mentorship areas" })).getByText("Clinical placements"),
    ).toBeInTheDocument();
    expect(screen.getByText(/self-reported and have not been verified/i)).toBeInTheDocument();
  });

  it("merges education and experience into one timeline, current items first", () => {
    render(
      <TimelineCard
        education={[education()]}
        experience={[experience()]}
        isOwner={false}
        firstName="Amina"
      />,
    );
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("BSc Psychology");
    expect(items[0]).toHaveTextContent("2024 to Present");
    expect(items[1]).toHaveTextContent("Volunteer");
    expect(items[1]).toHaveTextContent("Sep 2023 to Jun 2024");
  });

  it("says when a long timeline is cut short", () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      experience({ id: `x${i}`, title: `Role ${i}`, start_date: `20${10 + i}-01-01` }),
    );
    render(<TimelineCard education={[]} experience={many} isOwner={false} firstName="Amina" />);
    expect(screen.getAllByRole("listitem")).toHaveLength(8);
    expect(screen.getByText("Showing 8 of 10.")).toBeInTheDocument();
  });

  it("shows accurate counts and links to the owner's full list only for the owner", () => {
    const member = {
      id: "m1",
      username: "sam_k",
      first_name: "Sam",
      last_name: "Kowalski",
      avatar_path: null,
    } as never;
    const { rerender } = render(
      <NetworkCard
        counts={{ connections: 1, followers: 12, following: 3 }}
        connections={[member]}
        isOwner
      />,
    );
    expect(screen.getByText("connection")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("following")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sam Kowalski" })).toHaveAttribute("href", "/profile/sam_k");
    expect(screen.getByRole("link", { name: /view all/i })).toHaveAttribute("href", "/network/connections");

    rerender(
      <NetworkCard
        counts={{ connections: 2, followers: 1, following: 0 }}
        connections={[]}
        isOwner={false}
      />,
    );
    expect(screen.getByText("connections")).toBeInTheDocument();
    expect(screen.getByText("follower")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /view all/i })).not.toBeInTheDocument();
  });

  it("does not invent verification badges", () => {
    const { container } = render(
      <>
        <AboutCard profile={{ ...profile, open_to_mentor: true }} isOwner={false} />
        <InterestsCard profile={profile} skills={[skill("Triage", "skill")]} isOwner={false} />
      </>,
    );
    expect(container.textContent?.toLowerCase()).not.toMatch(
      /(?<!not )verified (professional|badge|member)|licensed|certified by/,
    );
  });

  it("lists completeness steps for the owner and hides once complete", () => {
    const { rerender, container } = render(
      <CompletenessCard profile={profile} education={[]} experience={[]} skills={[]} />,
    );
    expect(screen.getByText(/0 of 6 done/)).toBeInTheDocument();

    const full = { ...profile, avatar_path: "a", cover_path: "c", bio: "b" };
    rerender(
      <CompletenessCard
        profile={full}
        education={[{ id: "e" } as never]}
        experience={[{ id: "x" } as never]}
        skills={[skill("Triage", "skill")]}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
