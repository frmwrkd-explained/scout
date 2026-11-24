# CI

No workflow in this repo runs by itself. `.github/workflows/ci.yml` has one trigger, `workflow_dispatch`:
start it by hand from the Actions tab when you want it.

**The gate is local.** Before pushing, run:

```bash
npm test
npm run demonstrate
npm run build
```

A red or missing check on GitHub does not mean the code is broken. Some dispatch and scheduler tests
(`tests/` around the local agent runner) expect an agent CLI on the machine and fail on a clean runner.

Do not add `push`, `pull_request`, `schedule` or `workflow_run` triggers.
