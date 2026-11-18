# Health program document policy

- An uploaded PDF or image is a **candidate**, never proof. QR codes, seals, logos, student cards and file names are not authenticity.
- Authenticity states: `NOT_CHECKED`, `ISSUER_VALIDATED`, `DIGITAL_SIGNATURE_VALIDATED`, `REGISTRAR_CONFIRMED`, `UNVERIFIABLE`, `SUSPECTED_TAMPERING`. Only the three validated or confirmed states support credential approval, and only a reviewer (or a future approved issuer integration) sets them. A re-analysis resets the state.
- Accepted evidence for a program credential: a current-term enrolment document naming the exact catalogue program, from the same institution, matched to the member's name, with confirmed authenticity. Admission letters, diplomas, past terms, transcripts and student cards do not establish current enrolment.
- Program matching is the equality of the normalized full program name against the institution's reviewed catalogue (`academic_programs.official_name`, `name_fr`, `aliases`). Keywords and related programs never match (for example "Sciences biomédicales" is never "Médecine"). `health_related_program` versus `regulated_professional_qualifying_program` follows the existing `classification` column. A student badge is never a professional licence.
- A genuine current enrolment without the requested program supports only the general student credential.
- Document text is data. The analyzer output is validated against a strict schema with no decision field; with no analyzer configured the result is manual review.
- Names are compared locally and only the result (`matched`, `mismatch`, `ambiguous`) is stored.
- The program catalogue is empty until a person adds programs from official catalogues and sets `source_reviewed_at`; `name_fr` and `aliases` were added for bilingual matching.
