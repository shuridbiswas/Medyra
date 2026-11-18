# Institution SSO approval matrix

Nothing below is approved. A CANARIE participant listing is **not** an approved Medyra connection: each institution must agree to register Medyra as a service provider and release the `student` affiliation to it. States: `researched`, `pending_approval`, `sandbox_approved`, `production_approved`, `disabled` (column `institution_sso_connections.approval_state`; the database refuses approval without issuer, client id and affiliation scope).

| Institution (slug) | CAF presence | Metadata confirmed | Protocol | Medyra SP registered | Attribute release agreed | Approved claims | Sandbox | Last checked | Contact | State |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Université de Montréal (udem) | not verified | no | unknown | no | no | none | no | never | none | researched |
| McGill (mcgill) | not verified | no | unknown | no | no | none | no | never | none | researched |
| UQAM (uqam) | not verified | no | unknown | no | no | none | no | never | none | researched |
| Concordia (concordia) | not verified | no | unknown | no | no | none | no | never | none | researched |
| Polytechnique Montréal (polymtl) | not verified | no | unknown | no | no | none | no | never | none | researched |
| ÉTS (ets) | not verified | no | unknown | no | no | none | no | never | none | researched |
| HEC Montréal (hec) | not verified | no | unknown | no | no | none | no | never | none | researched |
| INRS (inrs) | not verified | no | unknown | no | no | none | no | never | none | researched |

Sherbrooke's Longueuil campus is not included (it would be a separate Greater Montréal category). Fill a row only from a written answer; record date, person and source.

**Connectable today:** none. **Mock-only (development):** a test row can be set to `protocol = 'mock'` for the local simulator. **Next external approval to request:** CANARIE CAF service-provider application, then each university's written attribute-release agreement, starting with UdeM.
