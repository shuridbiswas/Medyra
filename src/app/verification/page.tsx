import { redirect } from "next/navigation";

// Quebec students are the only supported group for now.
export default function VerificationIndex() {
  redirect("/verification/student");
}
