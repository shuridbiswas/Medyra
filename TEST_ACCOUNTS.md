# Test accounts (fictional, development database only)

Everyone below is a **fictional** persona created by the seed tool (`npm run seed:dev`). No password is written in this file, ever. Passwords are random and live only in the git-ignored `scripts/.seed-output/accounts.json`.

## How to log in without handling a password

1. Start the app (`npm run dev`) and open `/login`.
2. Copy the persona's password to your clipboard without printing it:

   ```bash
   npm run seed:login -- camille_lavoie
   ```

   It prints the email (`seed+<username>@example.com`) and puts the password on the clipboard.
3. Type the email, paste the password, sign in. Copy something else afterwards to clear the clipboard.

If `accounts.json` is gone (for example after `seed:clean`), run `npm run seed:dev` again; it recreates the accounts with new random passwords.

## Personas

| Persona | Username | Language, city | Good for testing |
| --- | --- | --- | --- |
| Prolific poster (nursing master's student who also works as a nurse) | `camille_lavoie` | FR, Montréal | 46 posts and pagination at 15 per page; heavy Activity tab; the most interactions |
| Nursing student | `anais_lapointe` | FR, Laval | Undergraduate profile, CEGEP then bachelor timeline, student view of the feed |
| Nursing student, quiet | `ethan_goldberg` | EN, Montréal | No posts, empty bio, no headline-rich profile; empty Activity tab |
| Psychology student | `amira_benali` | FR, Montréal | Looking for a mentor; psychology search and field filters |
| Registered nurse | `fatima_zahra_idrissi` | FR, Montréal | Working professional, open to mentoring, hospital experience |
| Registered nurse | `emily_thompson` | EN, Vaudreuil-Dorion | English-language professional profile |
| Professor / clinical educator | `andre_tremblay` | FR, Montréal | Educator, open to mentoring, long career timeline |
| Educator with a very long name and a 1000-character bio | `maria_guadalupe_h` | FR, Montréal | Layout stress test: long name, maximum-length bio |
| Researcher | `sarah_mitchell` | EN, Montréal | Researcher profile, open to mentoring; used by `seed:verify` as the "other member" |
| Independent / private-practice professional | `yasmine_haddad` | EN, Montréal | Self-employed experience entry |
| Rarely active members | `aisha_diallo`, `wei_zhang`, `yannick_ouellet` | FR/EN | Profiles with little or no activity |
| New member who has not finished onboarding | `chloe_dubois` | FR | Sign in and you land on `/onboarding`; other members must not see this profile (also `pascal_bergeron`, `alexis_martel`, `melodie_paquette`) |

All 50 accounts follow the same pattern: `seed+<username>@example.com`. The full list (name, language, city, role) is printed by `npm run seed:dev -- --dry-run`.

## More personas (100 members now)

| Persona | Username | Good for testing |
| --- | --- | --- |
| **Administrator** (also a nursing professor) | `andre_tremblay` | Granted through a row in `staff_roles`, inserted with SQL by the project owner (the only sanctioned path; it is not a profile flag). Admin pages need a confirmed two-step sign-in, so set `MFA_ENFORCEMENT=off` in `.env.local` for local development only; never weaken production. Holds the claimed and decided reports |
| Suspended then restored member | `kimberly_ross` | Suspension, member notices, an appeal that was overturned |
| Community owners and moderators | see `communities` in the app | Public and private communities, join requests, a ban, announcements |
| Mentors (never students) | `rachid_mansouri`, `ghislaine_noel`, `hannah_goldstein`, `imane_cherkaoui`, `francoise_lemieux` | Mentor profiles, availability, pending, accepted, declined and completed mentorships, private feedback |
| Mentees | members flagged looking-for-mentorship (for example `camille_lavoie`) | Open `/mentorship/requests` and `/mentorship/my-mentorships` to see requests in each state; accepted ones opened a conversation |
| Anonymous forum writers | any member; roughly 15% of forum items | Anonymous questions, answers and replies (author shown as Anonymous) |
| Student verification scenarios | the first ten completed seed accounts alphabetically | Ten fixtures labelled `[DEV TEST DATA]`: valid, email only, expired, rejected variants, revoked |
| Restricted-profile members | six accounts, `profile_visibility = connections` | Details hidden from non-connections |

Seven accounts never finished onboarding (`chloe_dubois`, `pascal_bergeron`, `alexis_martel`, `melodie_paquette`, `bao_tran`, `fabien_morissette`, `maxime_cloutier`).

## Not available

There is no professional (licence or employer) verification and no verification badge other than the student credential feature, so no such persona exists. The administrator is created only through `staff_roles`.
