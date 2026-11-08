import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { VerificationChip } from "@/components/verification-chip";

const credential = {
  claim_type: "CURRENT_PROGRAM_STUDENT",
  institution_name: "Université de Montréal",
  institution_name_en: "University of Montreal",
  institution_name_fr: "Université de Montréal",
  program_name: "Fictional nursing programme (test)",
  category: "nursing",
  category_label_en: "Nursing",
  category_label_fr: "Sciences infirmières",
  verification_method: "OFFICIAL_ATTESTATION_REVIEW",
  verified_at: "2026-11-01T10:00:00Z",
  expires_at: "2027-04-30T10:00:00Z",
};

describe("VerificationChip", () => {
  it("is a grey Not Verified pill without credentials, whatever else is passed", () => {
    for (const badge of [undefined, null, { credentials: [] }]) {
      const { container, unmount } = render(<VerificationChip badge={badge} />);
      expect(screen.getByText("Not Verified")).toBeInTheDocument();
      expect(container.querySelector("details")).toBeNull();
      unmount();
    }
  });

  it("is a blue Verified pill that explains exactly what was verified", () => {
    const { container } = render(<VerificationChip badge={{ credentials: [credential] }} />);
    expect(screen.getByText("Verified")).toBeInTheDocument();
    expect(container.querySelector("summary")?.className).toMatch(/blue/);
    const text = container.textContent ?? "";
    expect(text).toContain("Nursing Student");
    expect(text).toContain("University of Montreal");
    expect(text).toContain("Official enrolment evidence");
    expect(text).toContain("2026-11-01");
    expect(text).toContain("student status, not professional licensure");
    expect(text).not.toMatch(/licensed|registered nurse/i);
  });

  it("shows general student scope as just a student, never a program", () => {
    const { container } = render(
      <VerificationChip badge={{ credentials: [{ ...credential, claim_type: "CURRENT_STUDENT", program_name: null, category: null }] }} />,
    );
    expect(container.textContent).toContain("Student");
    expect(container.textContent).not.toContain("Nursing");
  });

  it("speaks French when asked", () => {
    render(<VerificationChip lang="fr" badge={{ credentials: [credential] }} />);
    expect(screen.getByText("Vérifié")).toBeInTheDocument();
  });
});
