# Score Calibration

Use these bands consistently.

## Bands

- `50–60`
  Competent app, mostly standard CRUD or integration work.

- `60–70`
  Solid mid-level portfolio. Some real engineering depth, but limited systems signal.

- `70–80`
  Strong senior potential. Clear ownership and good engineering decisions.

- `80–87`
  Fast-track-worthy senior signal. Real system shape, real judgment, still capped by proof.

- `88–92`
  Exceptional. Rare for a portfolio project. Production-like discipline and clear differentiation.

- `93–95`
  Unusually strong. Could materially change hiring outcomes by itself.

- `96+`
  Genuinely rare. Deep technical originality plus strong proof and articulation.

## What Usually Caps Scores

### Strong but not yet exceptional

Common reasons a project stalls in the low/mid 80s:
- breadth is stronger than proof
- production shape without load / runtime evidence
- good AI integration without evals
- good architecture without a distinctive idea
- strong code without a public technical artifact that travels

### What 90+ Usually Requires

At least several of these should be true:
- one or two subsystems are clearly better than normal portfolio work
- real proof under pressure (load, runtime data, incident learning, or strong E2E flows)
- hard problems made boringly correct
- fewer obvious overclaims than strengths
- clear evidence of deciding what not to build

### What 95+ Usually Requires

This is not "more features." It usually requires:
- a distinctive technical contribution with a name
- proof that survives skeptical scrutiny
- a system that feels operationally credible, not just comprehensive
- strong public articulation or artifact quality
- very little obvious fluff, theater, or overclaiming

## Rating AI / Agent Work Correctly

Do not give extra credit for "AI" by default.

### Baseline

- single-shot prompt + output = normal integration
- structured output + validation + bounded execution = good production discipline
- eval harness + regressions + measurement = strong AI systems signal
- real multi-step tool loops with explicit verification = stronger "agentic" signal

### Overclaim Trap

Do not score a system as agentic if it only does:
- one prompt
- one tool block
- one validation pass
- one response

That is still good engineering. It is just not a real agent loop.

## Hiring Calibration

### `c) Fast-track`

Use when the project is strong enough that a serious technical loop is justified.

### `d) Side-door / bypass`

Reserve for cases where the repo alone is unusually strong and differentiated.
That is rare. Require clear evidence, not enthusiasm.
