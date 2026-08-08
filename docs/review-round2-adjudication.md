# Round 2 — External Review Adjudication

Seven independent AI reviews of `docs/review-brief-dashboard-public-path.md`,
adjudicated one subagent per review against the working tree, then consolidated.
Untracked, like the briefing. Round 1's settled findings were not re-litigated;
repeats were flagged instead.

---

## 0. The headline

**Every one of the seven reviewers asserted that the dashboard has no request
body size limit. All seven are wrong, and it is a repeat of a settled round-1
refutation.**

`src/web/module-routes.ts:80` — `const MAX_BODY_BYTES = 524288;`
`src/web/module-routes.ts:84-108` — the body is *streamed* (`for await (const
_chunk of req)`), the running total is checked per chunk, and `err(
'payload_too_large')` returns at `:98-100` before `JSON.parse` at `:104`.

Four reviewers built escalating scenarios on the false premise (10 MB, 50 MB,
100 MB payloads; "OOM the bot"; "stall the event loop for seconds"), three
promoted it to a new named fix (F21), and two put it in the launch-blocking set.
One additionally inverted its own mechanism: it claimed the body is read "before
any guard runs", when `readJsonBody` is called *after* `guardWrite` on all three
write paths (`:804→:830`, `:984→:997`, `:1256→:1335`) — an unauthenticated 100 MB
POST is refused by `requireSession` before a byte is read.

Seven-way convergence turned out to be seven reviewers not opening the file. This
is the strongest argument yet for the verify-everything protocol: on this round,
**agreement was anti-signal**.

Residual truths worth keeping from the wreckage:
- A `Content-Length` precheck would reject before the first chunk is read. Marginal.
- The gates PUT returns **400** on oversize (`:832-834`) where the config PUT
  returns **413** (`:1002-1003`). Same inconsistency class as D16.
- There is no **depth** bound, only a size bound. That half is real → **F23**.

---

## 1. Cross-reviewer matrix

### 1.1 Convergent — and confirmed

| Claim | Raised by | Verdict | Evidence |
|---|---|---|---|
| F13 belongs in the HANDLER funnel ahead of routing, so it covers static + 404 | 5 of 7 | **TRUE**, already the briefing's stated constraint | `src/web/server.ts:186-195` |
| F7 must ship after F13; trust the proxy header only once the JWT validates | R4, R5, R6 | **TRUE** — and stronger than they knew (see O1) | no proxy header is read today, `auth/routes.ts:254-256` |
| F9 should be launch-blocking | R5, R6, R7 | **TRUE** — promote it | `module-routes.ts:204` is an in-memory `guilds.cache.get`; zero REST, zero cost, closes 8 of 13 read routes |
| Drop F11; shorten `session_ttl_h` instead | 6 of 7 | **TRUE** — settled | default 12 h at `registry/nano-config.ts:31` |
| Wire `loop_p99_ms` + `rest_429s` into `fleet-alert.sh` | 7 of 7 | **TRUE but not novel** — the briefing says it twice (`:752-755`, `:1263-1265`) | `vitals.ts:37,42` |
| The config write path needs a core bound regardless of module schema | R1, R3, R5, R6 | **PARTLY** — size already bounded at 512 KiB; **depth** is the real gap, and non-web callers have no bound at all | `guild-store.ts:157-161` |

One reviewer called the heartbeat wiring "the most important thing you are not
doing." The briefing had already said it, twice. No reviewer noticed.

### 1.2 Contradictions between reviewers — the code decides

| Question | Split | Ruling |
|---|---|---|
| Does `/members/:uid` check bot presence? | R5 yes; R6/R7 imply no | **Yes.** `module-routes.ts:701-705`. R5 correct. |
| Does the descriptor URL regex admit `javascript:`? | R2 yes; R3 no | **No.** `nano-dashboard.ts:294` anchors `^https://`. R3 correct. R2 also invented an action `href`/badge surface that does not exist (`nano-dashboard.ts:204-220`). |
| Can `trust_proxy_header` go live concurrently with F13? | R2 yes; R4/R5/R6 no | **No — Hazard 3 stands.** A JWT is a bearer credential, not a channel binding: a host-local process can replay a captured assertion to loopback with any `CF-Connecting-IP`. Also undefined in R2's own plan is whether F7 runs before or after F13 inside the one funnel it prescribes. |
| Where does the single free rate-limit rule go? | R2 → Plan B; R3/R5/R7 → keep on `/auth/*` | **R2 has the better argument.** With Access fronting the whole hostname, anonymous traffic never reaches `/auth/login`; the rule guards an already-unreachable surface while Plan B has no edge control at all. Genuine plan correction. |
| Extraction trigger (Q8) | fixed date (R3) / first restart (R4, R7) / lag threshold (R1, R2, R5, R6) | **Lag threshold wins, on a mechanical ground none of them argued:** nothing in the system today can *attribute* a restart to the dashboard — audit fires on writes only (`audit.ts:17-22`), there is no request log and no per-route metric. "First dashboard-caused restart" is unmeasurable until request IDs land. |

### 1.3 Repeats of round-1 settled findings

| Settled item | Repeated by | Note |
|---|---|---|
| #2 no body size limit | **all 7** | see §0 |
| #1 a sync throw escapes the request wrapper | R4 | used as the stated rationale for its F22; `server.ts:186-195` is `async`, a sync throw rejects into `.catch` at `:188` |
| #3 session-cycling games the limiter | R1, R3 | R1 layered a false premise on top (nothing is session-keyed); R5 went further and *proposed* a per-session bucket, which would **create** the weakness item #3 records as absent |
| #4 batch member fetch (opcode-8) | **R6 only** | "the server should batch the response" — round 1 had 3 of 4. Writing the law into the briefing cut it to 1 of 7. |
| #6 `frame-src 'none'` | **nobody** | R1 explicitly warned against it |

Writing a law into the briefing works: the opcode-8 trap fell from 3-of-4 to
1-of-7, and `frame-src 'none'` to zero. The body-cap trap was not neutralised
**because the briefing never states the cap** — that omission alone produced the
round's 7-of-7 false convergence. **Fix the briefing.**

---

## 2. Novel and true (survived verification)

| # | Finding | Evidence | Raised by |
|---|---|---|---|
| N1 | `Sec-Fetch-Site` **fails open when the header is absent** — documented as one of three CSRF layers, but only two apply to non-browser clients | `auth/routes.ts:162-171` | R4 (with an exact, real citation), R2 partial |
| N2 | Action param **values** are never type-checked; only keys are filtered. A declared `number` can receive a 400 KB nested object, bounded only by `MAX_BODY_BYTES` | `module-routes.ts:1345-1355`; law at `rule-web.org:102-103` | R3, R5 |
| N3 | **`/stats` is a harder REST amplifier than D11's member route.** `guilds.fetch(id)` is cache-first, but `channels.fetch()` and `roles.fetch()` are id-less and **always** hit REST — 2 guaranteed calls per request, no bot-presence check, no cooldown, and the client calls it on every guild overview | `module-routes.ts:455-467` → `api/channel.ts:164`, `api/role.ts:89` | found independently by three adjudicators |
| N4 | `/instance` stays over-wide **after F9** — every legitimate guild admin still sees `web.port`, `web.bind`, `intents`, `database_driver`, module inventory. The host-tier mechanism already exists | `module-routes.ts:599-610`; gate at `:1096-1117` | R3, R5 |
| N5 | **No security-event telemetry on any denial** — zero log calls in the 401 no-session, 403 CSRF, 403 guardRead, 403 live-check, 403 host-tier, or 429 branches | `auth/routes.ts:141-183`, `module-routes.ts:157,190,1111` | R7 (its one real finding) |
| N6 | Session cookie carries **no `__Host-` prefix**; `Secure` is config-dependent rather than structurally enforced | `auth/cookies.ts:46`; `auth/routes.ts:90-92` | R5 |
| N7 | The audit record carries **no principal and no client IP** — both become available once F13 lands | `web/audit.ts:8-15` | R5 |
| N8 | **The request funnel leaks the socket once headers are sent** — the catch logs and returns without `res.end()`. Reachable today: `sendJson` does `writeHead` then `JSON.stringify`, so a module returning a circular or BigInt-bearing object throws after headers | `server.ts:191-193`; `auth/routes.ts:99-100`; `module-routes.ts:270-281` | R4 |
| N9 | The hot-config re-read runs **twice per write** — once in `guardRead`, again in `guardWrite`. F8's memo must live inside `resolveWebConfig`, not at the call sites | `module-routes.ts:146` + `:181` | R4 |
| N10 | `rest_429s` counts discord.js **pre-emptive bucket waits**, not only real 429s. "Alert on any non-zero" would be noisy | `vitals.ts:90-92` | R4 |
| N11 | **Create the Access application before the tunnel route** — a fourth ordering hazard; a route created first is publicly unauthenticated until the app is clicked through | briefing `:1202-1214` lists only three | R4 |
| N12 | The briefing's own order sequences **F13 after F6** — F6 adds a network-reachable `/health` before the origin is a boundary | briefing `:1184` | R5 |
| N13 | **D7 is labelled "highest severity, lowest cost" yet its fix is bundled into F5, which is not launch-blocking** | briefing `:999` vs `:1193`; target is one line, `module-routes.ts:684` | R5 |
| N14 | F17's execution timeout **cannot preempt synchronous module code**. R1 claimed an `AbortController` could hard-abort it; it cannot — only process extraction buys that | `module-routes.ts:1360-1362` | R3, R4, R5 |
| N15 | **No throttle of any kind on `PUT /config` or `PUT …/commands/gates`.** Cooldowns exist only for descriptor-declared actions and data views. Behind Access, the bucket that a hostile admin cannot shed is identity- or guild-keyed — **not** session-keyed (5 sessions/user, free re-login), and the house bucket is per-guild | `module-routes.ts:980-1159`, `:800-951`; cooldowns at `:1194-1217`, `:1297-1318`; law `rule-web.org:38-39` | R6 |
| N16 | **`event_loop_lag_max_ms` is free and absent.** `vitals.ts:79,110-112` already holds the `IntervalHistogram`; only `.percentile(99)` is read. `.max` is the number that distinguishes a slow request from a gateway-losing stall | `vitals.ts:79,110-112` | R6 |
| N17 | **F13 implementation note.** One-shot `crypto.verify(alg, data, key, sig)` **without a callback runs synchronously on the main thread**; the libuv threadpool applies only to the callback form and to `crypto.subtle.verify`. jose v5's Node path is main-thread, v6's WebCrypto path is threadpool. On 1 vCPU the offload saves nothing either way — but F13 must be written knowing the verify is main-thread work. Cost is small regardless: RSA-2048 verify ≈ 25-60 µs, measured elsewhere at 0.019 ms | `package.json` (no `jose` today); briefing `:1130` | R6 (correcting its own claim) |

---

## 3. Corrections to our own briefing

| # | Correction |
|---|---|
| C1 | **D19 overstates the leak.** No `Referrer-Policy` header and no `<meta name="referrer">` exists, so browsers apply the default `strict-origin-when-cross-origin`: a cross-origin badge image sends `Referer: https://bot.kyonax.tech/` — origin only, **no path, no guild id**. The IP/user-agent beacon is real; the guild-id claim is not. Note also that the carousel iframes **already** set `referrerpolicy` explicitly (`media-carousel.vue:207,268`); only the badge `<img>` (`module-about.vue:73-86`) and the image slides do not. |
| C2 | **D18's stated cap is self-inconsistent** — "1 MB, consistent with the asset route's 8 MB cap" (`module-routes.ts:81` = 8388608). Pick one and justify it. |
| C3 | **D1's mechanism is wrong for production** — see O1 below. |
| C4 | **F16's "per-request cap" is a category error.** `/members/:uid` performs exactly one lookup per request (`module-routes.ts:691-735`). The cap must be per-session / per-guild / per-window. |
| C5 | **D13 understates session weight.** A session pins the full OAuth guild list (`sessions.ts:21`, `oauth.ts:24-30`) — tens of KB each, not ~1 KB. A global cap of 1000 is too high for a 259 MB heap limit; 100–200 is better founded. |
| C6 | **The briefing never states the 512 KiB body cap.** That omission produced a 7-of-7 false convergence. Add it to the "what is genuinely good" section. |

---

## 4. Our own independent pass

| # | Finding |
|---|---|
| **O1** | **The production origin will never see `127.0.0.1`.** The prod compose uses default bridge networking (no `network_mode: host`). Once the deploy gate adds `ports: ["127.0.0.1:4777:4777"]`, requests arrive through docker-proxy (or DNAT+MASQUERADE) and `req.socket.remoteAddress` is the **Docker bridge gateway**. D1's conclusion survives — one constant key, one shared bucket — but the "trust the proxy header only when the peer is loopback" gate that **four reviewers proposed cannot be built here**. The peer address is not a usable trust signal. F13 is therefore not merely the defence against adversary 4; it is the **only available trust anchor for `trust_proxy_header`, full stop.** |
| **O2** | **Brand fonts are declared but never shipped.** The built CSS has **0** `@font-face` rules and the bundle contains no font files, yet it declares `font-family:Poppins,Inter,sans-serif` and `font-family:Space Mono,Cascadia Mono,monospace`. The Kyonax Book typography renders only where those fonts happen to be installed locally. The obvious "fix" — a Google Fonts link — would break the CSP draft (`font-src 'self'`, `style-src 'self'`) *and* reintroduce exactly the third-party beacon D19/F19 exist to remove. Correct fix: self-hosted woff2. Decide before the flip. |
| **O3** | **Verified strength — no host-header trust in OAuth origin derivation.** `baseUrl()` = `web.public_url` else `localBase()` (`auth/routes.ts:86-88`), used identically at authorize (`:281`) and exchange (`:343`). Zero hits for `req.headers.host` / `x-forwarded-host` in `src/web/**`. Host-header redirect injection is closed by construction; no reviewer tested this class. |
| **O4** | **Verified strength — the gates PUT is the reference pattern D16 wants.** It checks `if (!BODY.ok) return 400`, enforces `UNGATEABLE_COMMANDS = ['module']` so the recovery path can never be gated shut (`command-gates.ts:21`), scopes writes to the module's own command roots, and preserves other modules' gates on merge. D16 is a lone outlier, not a systemic gap. |
| **O5** | **Only one descriptor exists in tree** — `modules/roles/nano-dashboard.json`, 43,130 bytes. `embed-styler`, `mcp`, `synapse` ship none. Refutes "43 KB × 4 modules ≈ 172 KB per request". |
| **O6** | **The deploy-gate prerequisite list omits `web.bind: 0.0.0.0`.** The briefing carries it (`:654`, `:1227`) and THE BIND LAW documents it, but the plan node's STATE list names only compose `ports:`, `DISCORD_CLIENT_SECRET`, `BOT_OWNER_ID` and `public_url`. Without the bind flip the container listens on its own loopback, the published port reaches nothing, and the failure presents as a Cloudflare/Access problem. |
| **O7** | **More unread heartbeat signal than the plan records.** Alongside `loop_p99_ms` and `rest_429s`, the heartbeat already emits `db.sqlite_mb` and `db.wal_mb` (`vitals.ts:43,144`), `heap_used_mb` / `heap_limit_mb`, and `gateway.invalidated_count`. All unread by the alerter. (This also refutes R6's "the WAL can grow indefinitely and fill the 50 GB disk": `database.ts:101` sets `journal_mode = WAL`, `:339` runs an explicit `wal_checkpoint(TRUNCATE)`, and the size is already instrumented.) |

---

## 5. Reviewer scorecard

Ranked by novel-true findings that survived verification, with confident-but-false
as the counterweight.

| # | Novel-true | Confident-false | Settled repeats | Citation hygiene | Character |
|---|---|---|---|---|---|
| **R4** | **7** | 17 | #1 | 1 citation, exact | The most thorough and the highest-yield. Found the `Sec-Fetch-Site` fail-open with a precise citation, the double config re-read, the socket leak on `headersSent`, and the Access-before-route hazard. Ruined by numbers: nearly every figure is invented (500 ms → disconnect, "2-3 concurrent requests of headroom", 50 MB of guild cache, ~1 KB sessions, Node 19+/21+). Its "adversary #5, the operator's browser" is rhetorically strong and analytically empty — it proposes no control specific to it, and the one defence it claims already covers it (the live write-check) does not. |
| **R5** | **6** | 11 | #2, and *proposes* #3 | 2 of 4 land on the right symbol | The most specific and the only one that cited file:line throughout — which cuts both ways: `module-routes.ts:1335` is a real line that does not contain `readJsonBody`, and the claim attached to it is refuted by line 80 of the same file. Best law compliance of the set (respected opcode-8, no-CORS, click-to-load). Produced the single most valuable item of the round: the **D19 correction to our own briefing**. Also asserted a Node API that does not exist (`stat.mtimeNs`). |
| **R3** | 2 | 9 | #2, #3 | 1 citation, exact | Procedurally careful, ~60% accurate, reasons well about the *plan* and repeatedly asserts things about the *code* without opening it. Both novel items are real (`/instance` host-tier scoping, action param values). Its "most impactful performance change" ranks a 182 KB static problem above the 43 KB-per-request descriptor re-parse the briefing already flagged. Q8 answer (fixed date) is the outlier and the weakest. |
| **R2** | 2 | 9 | #2 | 1 citation, exact | Two of three headline "you missed" findings flatly refuted, one of which invented a surface. Every performance number inflated 3×–250× against measurements taken from this repo. But it produced the round's best *strategic* correction (reallocate the free rate-limit rule to Plan B) and the dashboard-attributed REST metric gap. Its Hazard-3 "correction" is wrong and would have opened a rollout window. |
| **R1** | 1 | 8 | #3 | cited nothing | Structurally the strongest on authorization and threat modelling; avoided every round-1 trap including opcode-8 and `frame-src 'none'`. Manufactured four confident numbers that exist nowhere ("36 requests", "~30 fan-out", "~700 MB API stack", "50-80 ms → heartbeat miss"). Its worst claim is self-contradictory: an `AbortController` cannot hard-abort in-process module code — a control that requires the very extraction it recommends two sections later. |
| **R7** | 1 | 8 | #2 | cited nothing | Lowest. Its Q2 list — the fresh pass it was asked for — scores 1 novel-true, 1 already-D2, 1 half-right, 5 wrong. Its self-nominated "most critical" finding is a settled repeat *and* inverts its own mechanism. Two infrastructure claims are wrong on platform reality (Access "cannot" serve browser JS — inverted; subdomains need a paid DNS migration — the zone is already Active and empty on Free) and two contradict THE BIND LAW. A stock OWASP checklist mapped onto the codebase by assumption. Its one hit (N5, security-event logging) is genuinely good. |
| **R6** | 3 | 8 | #2 **and #4** | cited nothing | Fluent, confidently framed, numerically unreliable. **Every** load-bearing figure in its performance section is contradicted: the bundle is 158,865 B not 2 MB, it reads in 0.0298 ms not 3 ms, so its headline "3,000 req/s ⇒ the loop blocks 9 seconds per second ⇒ the bot goes offline" is off by ~100× and is self-refuting besides (a loop with 1 s of budget per second cannot ingest 3,000 req/s). Its "stalls >10 s drop the connection" threshold does not exist — zombie detection is one full ~41 s interval, and recovery is **Resume**, not outage. The only reviewer in round 2 to repeat the opcode-8 trap. Genuinely useful on the qualitative side: dispatch-param value validation, the unthrottled config/gates writes, the free `.max` histogram read, and the correct observation that per-session buckets are the wrong shape here. |

**Aggregate:** 7 reviewers, ~500 checkable claims, **17 novel-and-true**, ~70
confident-but-false, one 7-of-7 false convergence on the round's most-repeated
"finding", and one settled-law repeat (opcode-8) down from 3-of-4 to 1-of-7. Our
own pass added 7 more, including the one that changes an implementation decision
(O1).

**Pattern worth keeping:** the reviewers were reliable on *structure* and
unreliable on *quantity*. Not one performance number offered by any of the seven
survived measurement against this repo; the four that were checkable were
inflated 3× to 250×. Every genuinely new finding came from reading a file, and
every bad one came from assuming its contents. Round 3 should ask for claims with
file:line or not at all, and should state measured baselines in the briefing so
reviewers cannot invent them.

---

## 6. Plan changes

### 6.1 Append-only new fixes

- **F21 — Security-event logging.** Emit a structured line on every denial: 401
  no-session, 403 CSRF, 403 guardRead, 403 live-check, 403 host-tier, 429
  login/cooldown. `auditWeb` exists and pino already redacts cookies/tokens, so
  this is near-free. *(N5)*
- **F22 — Request IDs.** A per-request id on every audit line and error. Also the
  **prerequisite for the Q8 extraction trigger** — without it a
  dashboard-caused restart cannot be attributed. *(N8's companion; R4)*
- **F23 — Core depth/shape ceiling on written config.** Max depth, max keys, max
  string length, enforced in the guild-store write path regardless of module
  schema, and refuse config writes from schema-less modules. Size is already
  capped at the web layer; depth is not, and non-web callers have no bound.
- **F24 — Type-check action param values, not just keys.** *(N2)*
- **F25 — Host-tier scoping on `/instance`.** Hide `web.port`, `web.bind`,
  `intents`, `database_driver` from non-host callers. *(N4)*
- **F26 — Bound `/stats`.** Bot-presence check (arrives with F9), a short-TTL
  cache on the id-less role/channel fetches, and a cooldown. *(N3)*
- **F27 — Close the funnel socket leak.** In the `headersSent` branch, destroy or
  end the response instead of returning. *(N8)*
- **F28 — Audit lines carry principal + client IP.** *(N7)*
- **F29 — `__Host-` session cookie prefix**, with `Secure` structurally required
  rather than config-dependent. *(N6)*
- **F30 — Self-host the two brand fonts as woff2.** Keeps `font-src 'self'`
  true and adds no external host. *(O2)*
- **F31 — Throttle the two unthrottled write routes.** `PUT /config` and
  `PUT …/commands/gates` have no cooldown at all. Use the house bucket
  (per-guild, through the existing `CooldownManager`), **not** a session-keyed
  one — 5 sessions per user and free re-login make session keys sheddable. *(N15)*
- **F32 — Emit `event_loop_lag_max_ms`.** The histogram is already held; only
  `.percentile(99)` is read. One line, and it is the number that separates a slow
  request from a gateway-losing stall. *(N16)*

### 6.2 Revised launch-blocking subset

Was: **F3, F4, F13, F14, F16, F18** (6).
Now: **F1, F3, F4, F5a, F7, F9, F13, F14, F16, F18, F27** (11).

- **F5a** — the `private` cache directive split out of F5, because D7 is labelled
  highest-severity/lowest-cost and F5 is not launch-blocking. One line. *(N13)*
- **F9** — promoted. Zero-cost in-memory check closing 8 of 13 read routes.
- **F7** — promoted, because the limiter is inert behind the tunnel and that is
  the operator-lockout path.
- **F27** — promoted; a socket leak reachable from module output is an
  availability defect on the property we most care about.
- **F1** — promoted; trivial and it is an active information leak.

### 6.3 Ordering corrections

- **F13 before F6.** F6 introduces a network-reachable `/health` on an origin
  that is not yet a boundary. *(N12)*
- **F13 before F7**, unchanged in the briefing's order but now load-bearing for a
  new reason: the peer address is not a usable trust signal in the container
  topology, so the JWT is the only anchor. *(O1)*

### 6.4 Fourth deployment hazard

**Create the Access application before the tunnel route.** A route created first
is publicly reachable and unauthenticated until the app is configured. *(N11)*

### 6.5 Deploy-gate prerequisites — add

- `web.bind: 0.0.0.0` in the prod `nano.config.json`. *(O6)*
- Note in the runbook that the origin will see the **Docker bridge gateway**, not
  `127.0.0.1`, so the loopback smoke test must not assert on the peer address.

### 6.6 Monitoring

Wire `loop_p99_ms` and `rest_429s` into `fleet-alert.sh` **before the flip** — but
alert on `rest_429s` as a *trend*, not on any non-zero value, because the counter
includes discord.js pre-emptive bucket waits. *(N10)* Also available and unread:
`db.wal_mb`, `db.sqlite_mb`, `heap_used_mb`/`heap_limit_mb`,
`gateway.invalidated_count`. *(O7)*

### 6.7 Open forks — now closed

- **Q3/Q8 (extraction trigger):** sustained `loop_p99_ms > 100 ms` for 5 minutes
  **or** a dashboard-attributed `rest_429s` trend, whichever fires first; if
  either fires twice in 30 days, start the extraction sprint. Explicitly **not**
  "the first dashboard-caused restart" — that is unmeasurable until F22 ships.
  Not a fixed date.
- **Q7 (what to drop):** drop **F11** (six of seven agree; shorten
  `session_ttl_h` 12 → 2 instead). Defer **F12**. Everything else stands.
- **Q9 (the free rate-limit rule):** reallocate to Plan B, which has no edge
  control at all. The dashboard keeps Access + the in-process F7 limiter, and
  Access already stops anonymous traffic before `/auth/*` is reachable.
