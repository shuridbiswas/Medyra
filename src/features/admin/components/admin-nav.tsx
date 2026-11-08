import Link from "next/link";
import { cn } from "@/lib/utils";

const TABS = [
  { key: "overview", label: "Overview", href: "/admin" },
  { key: "reports", label: "Reports", href: "/admin/reports" },
  { key: "users", label: "Members", href: "/admin/users" },
  { key: "verification", label: "Student verification", href: "/admin/student-verifications" },
] as const;

export type AdminTab = (typeof TABS)[number]["key"];

export function AdminNav({ current }: { current: AdminTab }) {
  return (
    <nav aria-label="Admin" className="border-b border-border">
      <ul className="flex gap-1">
        {TABS.map((t) => (
          <li key={t.key}>
            <Link
              href={t.href}
              aria-current={t.key === current ? "page" : undefined}
              className={cn(
                "-mb-px block border-b-2 px-4 py-3 text-sm font-medium transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                t.key === current ? "border-maroon-600 text-maroon-700" : "border-transparent text-muted-foreground hover:text-maroon-900",
              )}
            >
              {t.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function AdminNotice() {
  return (
    <p className="rounded-xl border border-border bg-surface p-3 text-xs leading-relaxed text-muted-foreground">
      Everything here is done by people. Medyra has <strong>no automated or AI moderation</strong>: nothing is
      screened before or after it appears, and a report does not remove anything until a person decides. Every action
      on this page is recorded in the audit log.
    </p>
  );
}
