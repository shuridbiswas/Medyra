# Institution partnerships and permissions

Medyra has **no partnerships, agreements or API access** with any institution. Everything is a manual, reviewer-assisted workflow built on public procedures the institutions publish. Nothing below is claimed to exist.

| Item | Institution | What would be needed | Status |
| --- | --- | --- | --- |
| Automated receipt of MesCertif shares | Université de Montréal | Written permission and a designated Medyra receiving account or API terms from the Registrariat | Not requested. Public API access is not assumed. |
| MyCreds share receipt | McGill University | MyCreds recipient arrangement; McGill documents an optional paid sharing process | Not requested |
| Third-party verification service | UQAM | Use of UQAM's official verification service with the member's signed authorization (fees may apply) | Manual only; Medyra does not hold a date of birth |
| Validation service | Université Laval | Reviewer use of monportail.ulaval.ca/validation by hand | Manual only. Do **not** automate the web form without Laval's authorization |
| Confirmed school email domains | All | Domains taken from an official source, recorded with `email_domains_status = 'confirmed'` | None confirmed |
| Federated login (CANARIE CAF) | Participating institutions | Service-provider registration, per-institution agreements, attribute release and validation | Future only; refused by the request function |
| Program catalogues | All | A person checks each program against the official catalogue and sets `source_reviewed_at` | None seeded |

Before contacting an institution, record the date, the person, the answer and the source URL in `academic_institutions.source_checked_at` and the method's `note`. Do not change `integration_status` to `tested` unless a real, authorized exchange has succeeded end to end.
