# Flowable staging validation

- **Target:** `http://100.83.138.26:18081/flowable-rest/service` (exact host, port and path only).
- **Staging checks reported by the coordinating agent:** deploy/start/task/image/complete and PostgreSQL restart persistence passed; deployed patch SHA-256 matched.
- **Production:** not accessed. No production/admin credentials were used, and no production connector data was changed. The separate production FNS/NBHH connector-switch approval is still pending.
- **Transport policy:** HTTP is allowed only for `100.83.138.26:18080/flowable-rest/service` (existing rollback endpoint) and `100.83.138.26:18081/flowable-rest/service` (validated staging endpoint), optionally with a trailing slash. HTTPS remains available. Other hosts, ports and paths remain rejected; no CIDR-wide or general HTTP exception was added.
- **Release recommendation:** after the outstanding production approval and normal change window, deploy through the standard release process; preserve 18080 as a rollback option. Do not switch production connector data before approval.
