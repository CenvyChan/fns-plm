# Form designer backend verification

- Implemented only under `server/`; client source was not changed.
- `cd server && npm test`: **116 passed, 0 failed** (including DSL sections, activation pointer, scoped form bindings and role denials).
- API server fixture: `server/scripts/start-form-designer-fixture.sh`, bind `0.0.0.0:4179` by default; override `PORT` and `DATABASE_FILE` as needed. First-time setup can use the existing `/api/auth/mobile/setup` flow; service uses isolated `server/data/form-designer-fixture.sqlite`.
- No Flowable engine deployment or task adapter is claimed. Bindings are PLM configuration records only; actual remote deployment remains blocked until authorized and integrated.
