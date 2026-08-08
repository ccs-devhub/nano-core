# Taking a Discord bot's admin dashboard public
## A self-contained briefing for independent security and performance review

---

## How to use this document

You have **no access to the code**, so this document carries it. Every structural
claim comes with a directory tree, a verbatim source excerpt, a real configuration
file, or a live measurement. Nothing requires you to take our word for it.

Read **Part 1 in full**, even if you are tempted to skip to the defects. It explains
how the machine actually works. Most weak feedback we have received came from
reasonable assumptions about web applications that happen to be false here — no
middleware layer, no framework, a shared event loop with a real-time protocol, and a
plugin system with no sandbox.

**A disclosure about our own rigor.** An earlier version of this briefing told
reviewers the bot serves "one Discord guild." It serves **seventeen**. That error was
ours, it went to four reviewers, and it silently miscalibrated everything they said
about scale. Treat our framing as fallible and check the numbers we give you.

---

## What we are asking you for

Two audits and a set of decisions.

### 1. A security audit

Not "is this secure" in the abstract. Specifically:

- **Attack the threat model in Part 3.** Four adversaries with four different reaches:
  an anonymous internet attacker, an authenticated-but-hostile guild administrator, a
  malicious module author, and a process already running on the host. What can each do
  that we have not anticipated?
- **Which of our twenty planned fixes are wrong, insufficient, or mis-ordered?**
- **What are we protecting that we have not noticed is valuable?**

### 2. A performance audit

The bot and the dashboard share one process, one event loop, and one vCPU. Performance
is therefore a **safety property**, not a nicety — a slow request path is an outage
risk for a real-time protocol.

- **What falls over first, and at what load?** Live baseline numbers are in Part 2.
- **Where is the blocking work?** We know about some of it. Find the rest.
- **What do our fixes cost?** Several add work to the request path.
- **What should we measure?** We have instrumentation we barely use.

### 3. Direct answers to the questions in Part 8

Please answer them individually rather than in prose.

### What a useful answer looks like

We are running several independent reviewers on this same document **and comparing
their responses**, so it is worth knowing how we read them.

- **We verify every claim against source before acting on it.** Last round, six
  confident claims were refuted by the code, and one widely-recommended fix violated an
  architectural rule documented in the repository. Confident-and-wrong costs us a
  verification cycle; it is worse than uncertain-and-honest.
- **Specific beats comprehensive.** "Add rate limiting" is not useful; we know. "Your
  bucket design puts image traffic in the API bucket because assets live under `/api/`"
  is useful, and was one of the best things we received.
- **Tell us what to do, in what order, and what it costs** — including what *not* to do.
- **If the whole approach is wrong, say so plainly**, and say what you would do under
  the constraints in Part 3. Two of those constraints are softer than they look and we
  flag which.
- **Say "I don't know" where you don't.** We will not hold it against you. We will hold
  a fabricated file path against you.

---

# Part 1 — How the machine actually works

## 1.1 What a Discord bot process is

A Discord bot is a long-lived process holding a **persistent WebSocket** to Discord's
gateway. Discord pushes events down it — messages, member joins, role changes, slash
command interactions — and the bot must answer heartbeats on a schedule. Stall long
enough and Discord tears the connection down; the bot goes silent until it reconnects.

Separately the bot makes **REST calls** for actions and lookups. Discord rate-limits
these globally per bot token (order of 50 requests/second) plus per-route buckets. The
library queues internally when limits are hit, so a burst does not error — **it delays
everything behind it**, including unrelated production work.

Two consequences drive this entire document:

1. **Blocking the event loop is an availability bug**, not a latency bug. Synchronous
   file reads, large `JSON.parse`, and heavy schema validation all stall the gateway.
2. **Discord REST quota is a shared, exhaustible resource.** Anything that can trigger
   many REST calls can starve the bot's real work.

Stack: **discord.js 14.25.1**, **Node ≥20**, TypeScript strict, **better-sqlite3 +
drizzle** (WAL), **pino** logging, **zod** validation, **Vue 3 + Vite** for the client.
Eleven runtime dependencies total — the project is deliberately small.

## 1.2 Repository layout

```
nano-core/
├── src/
│   ├── cli/                  # nano-cli: doctor, module management, scaffolding
│   ├── core/
│   │   ├── commands/         # built-in slash commands
│   │   ├── events/           # gateway event handlers
│   │   └── kernel/           # the always-on core module (/module, dispatcher)
│   ├── lib/
│   │   ├── api/              # plain-JSON wrappers over discord.js (NanoResult)
│   │   ├── registry/         # nano-config.ts, module-registry.ts
│   │   ├── services/         # database, guild-store, scheduler, cache, cooldown,
│   │   │                     #   lifecycle, logger, vitals, doctor, errors
│   │   ├── store/            # module store client + installer
│   │   └── types/            # NanoResult, nano-dashboard.ts (descriptor schema)
│   ├── tui/                  # Ink/React terminal UI
│   └── web/                  # ← THE SUBJECT OF THIS DOCUMENT
├── modules/                  # embed-styler, synapse, mcp, roles
├── tests/                    # 278 core tests
├── docs/rules/               # written architectural law (rule-web.org, etc.)
├── Dockerfile
└── nano.config.json
```

## 1.3 The dashboard's own tree

Server side — 10 TypeScript files, no framework:

```
src/web/
├── server.ts          # http server, lifecycle, THE REQUEST FUNNEL
├── router.ts          # exact-segment matcher; NO MIDDLEWARE (see 1.6)
├── module-routes.ts   # all 13 guild-scoped routes + the two guards
├── manifests.ts       # descriptor discovery and loading
├── hot-config.ts      # per-request config read
├── static-files.ts    # SPA shell + assets, traversal-safe
├── status.ts          # health state read by the Discord surface
├── audit.ts           # structured audit lines
├── index.ts           # startWebIfEnabled
└── auth/
    ├── routes.ts      # OAuth, sessions, CSRF, rate limiting, /api/me
    ├── sessions.ts    # SessionStore, NonceStore, RateLimiter
    ├── permissions.ts # snapshot admin + THE LIVE CHECK
    ├── oauth.ts       # Discord token exchange / revoke
    └── cookies.ts     # cookie serialization and flags
```

Client side — Vue 3 SPA built by Vite into `dist/web/app`:

```
src/web/client/src/
├── dashboard-app.vue
├── router.ts
├── views/
│   ├── guild-picker.vue     # pick a guild; three-state classification
│   ├── guild-shell.vue      # module list for a guild
│   ├── guild-overview.vue
│   └── module-window.vue    # one module's config/data/actions window
├── components/              # widget-host (recursive), ui-table, media-carousel,
│                            #   command-cards, module-about, …
├── lib/
│   ├── api.ts               # fetch wrapper, CSRF header, 401 handling
│   ├── api-cache.ts         # shared request cache; dedupes GETs
│   ├── member-names.ts      # resolves member ids to names (see D11)
│   ├── warm.ts              # hover prefetch
│   └── i18n.ts              # en/es host chrome dictionaries
└── stores/session.ts
```

## 1.4 Why the dashboard lives inside the bot

The dashboard reads **live discord.js caches** — guild lists, roles, channels, member
records — and a **per-process guild-configuration cache** that invalidates itself on
write. Neither is shareable across processes as things stand.

So "just host it elsewhere" is a re-architecture requiring an IPC seam, not a
deployment choice. What follows from in-process:

- Dashboard work and gateway work share **one event loop**.
- They share the process memory limit and the Discord REST quota.
- **A dashboard crash is a bot crash.** Any unhandled exception hits a global guard:

```ts
// src/lib/services/errors.ts:42-48  (wired at src/index.ts:225-229)
process.on('uncaughtException', (error: Error): void => {
  getLogger().fatal(...);
  void LIFECYCLE.shutdown().finally((): void => {
    process.exit(2);          // ← the whole bot dies
  });
});
```

- The security model is **same-origin by construction**. Standing rule: *no CORS
  headers, ever*. An external site calling this API cross-origin is forbidden by
  design.

## 1.5 The request path, end to end

This is what we propose to build. The hop-by-hop detail matters because several
plausible attacks and fixes depend on which hop does what.

```
Browser
  │  GET https://bot.kyonax.tech/api/guilds/123/modules/roles/config
  ▼
┌─────────────────────────────────────────────────────────────┐
│ CLOUDFLARE EDGE                                             │
│  · TLS termination (Full Strict to origin)                  │
│  · CDN caching by file extension  ← relevant to defect D7   │
│  · WAF managed ruleset + 1 free rate-limiting rule          │
│  · CLOUDFLARE ACCESS: identity challenge                    │
│      on success → mints a signed RS256 JWT and forwards it  │
│      as the  Cf-Access-Jwt-Assertion  header                │
└─────────────────────────────────────────────────────────────┘
  │  (outbound-only tunnel; NO inbound port is opened on the VPS)
  ▼
cloudflared  ── systemd service on the VPS host, unprivileged user
  │             dials out to Cloudflare; proxies to a local address
  ▼
127.0.0.1:4777  on the HOST
  │   published by Docker from the bot container, loopback-only
  │   ⚠ ANY host process / host-network container / ssh user can
  │     reach this directly, skipping everything above  → D15
  ▼
┌─────────────────────────────────────────────────────────────┐
│ THE BOT PROCESS  (also running the Discord gateway)         │
│                                                             │
│  node:http server                                           │
│    └─ HANDLER closure        server.ts:186-195              │
│         ↑ the ONLY place that sees every request,           │
│           including static files and 404s                   │
│       └─ handleRequest       server.ts:76-104   (async)     │
│            ├─ router.match                                  │
│            ├─ handler(context)                              │
│            │    ├─ guardRead   (session + snapshot admin)   │
│            │    ├─ guardWrite  (+ CSRF + LIVE Discord check)│
│            │    └─ module `provides` dispatch               │
│            ├─ serveStatic  (GET/HEAD fallback)              │
│            └─ 404 JSON                                      │
└─────────────────────────────────────────────────────────────┘
```

**The funnel, verbatim.** Note it is `async` — which is why a synchronous throw from
any handler becomes a rejection and is caught, rather than reaching the process guard:

```ts
// src/web/server.ts:76-104
async function handleRequest(
  router: WebRouter, static_roots: string[],
  req: IncomingMessage, res: ServerResponse
): Promise<void> {
  const URL_PARSED = new URL(req.url ?? '/', 'http://web.invalid');
  const METHOD = req.method ?? 'GET';
  const MATCH = router.match(METHOD, URL_PARSED.pathname);

  if (MATCH) {
    const CONTEXT: WebContext = { req, res, url: URL_PARSED, params: MATCH.params };
    await MATCH.handler(CONTEXT);
    return;
  }
  if (METHOD === 'GET' || METHOD === 'HEAD') {
    if (serveStatic(res, URL_PARSED.pathname, { roots: static_roots })) return;
  }
  jsonError(res, HTTP_NOT_FOUND, 'Not found.');
}

// src/web/server.ts:186-195 — the one funnel
const HANDLER = (req: IncomingMessage, res: ServerResponse): void => {
  handleRequest(ROUTER, STATIC_ROOTS, req, res)
    .catch((error: unknown): void => {
      LOGGER.error(`Web request failed: ${String(error)}`);
      if (!res.headersSent) jsonError(res, HTTP_SERVER_ERROR, 'Internal error.');
    });
};
```

**Two things reviewers get wrong about this diagram:**

- **The loopback bind is not a security boundary.** `127.0.0.1:4777` means *not
  internet-routable*. It does **not** mean "only cloudflared can reach it."
- **The bind law has two halves.** Inside the container the server binds `0.0.0.0`
  (Docker cannot forward into a container's loopback); Docker publishes to the *host's*
  loopback only (`127.0.0.1:4777:4777`). Only together do they mean "through the tunnel
  and nothing else."

## 1.6 The router, and why there is no middleware

```
// src/web/router.ts:3-7 (header comment, verbatim)
   No wildcards, no middleware — auth and CSRF guards wrap handlers
   explicitly.
```

Matching is exact segments plus `:param`. There is no `use()`, no filter chain, no
before-hook. Guards are ordinary function calls inside each handler, so an unguarded
route is *visibly* unguarded — a deliberate design choice for auditability.

**The consequence for every cross-cutting fix in this document:** rate limiting,
security headers, and Access JWT validation cannot be expressed as routes. They must
live in the `HANDLER` closure shown above, because that is the only point that sees
static files and 404s as well as matched routes.

## 1.7 The complete route table

Seventeen routes. `guardRead` = session + snapshot admin. `guardWrite` = that, plus
CSRF, plus a live Discord permission re-check.

| Method | Path | Guard | Notes |
|---|---|---|---|
| GET | `/auth/login` | **none** | Rate-limited. Mints state nonce, redirects to Discord. |
| GET | `/auth/callback` | **none** | Rate-limited. Token exchange. |
| POST | `/auth/logout` | session + CSRF | Revokes the Discord token upstream. |
| GET | `/api/me` | session | Returns identity, CSRF token, host-owner flag. |
| GET | `/api/guilds` | session | **The only route that refreshes the guild snapshot.** |
| GET | `/api/guilds/:gid/reference` | guardRead | ✔ checks bot presence |
| GET | `/api/guilds/:gid/members/:uid` | guardRead | ✔ checks bot presence · **one live Discord lookup per request** (D11) |
| GET | `/api/guilds/:gid/stats` | guardRead | ✘ no bot check → triggers a live fetch for arbitrary guild ids |
| GET | `/api/guilds/:gid/instance` | guardRead | ✘ no bot check → leaks host-global data |
| GET | `/api/guilds/:gid/modules` | guardRead | ✘ no bot check · re-parses every descriptor |
| GET | `/api/guilds/:gid/modules/:mid/descriptor` | guardRead | ✘ no bot check · 404 body leaks an absolute path |
| GET | `/api/guilds/:gid/modules/:mid/assets/:file` | guardRead | ✘ no bot check · **`Cache-Control: public`** (D7) |
| GET | `/api/guilds/:gid/modules/:mid/commands` | guardRead | ✘ no bot check |
| GET | `/api/guilds/:gid/modules/:mid/config` | guardRead | ✘ no bot check |
| GET | `/api/guilds/:gid/modules/:mid/data/:view` | guardRead | ✘ no bot check · **dispatches into module code** with the caller's guild id |
| PUT | `/api/guilds/:gid/modules/:mid/config` | guardWrite | ✔ safe (live check) · diff-then-patch · audited |
| PUT | `/api/guilds/:gid/modules/:mid/commands/gates` | guardWrite | ✔ safe · audited |
| POST | `/api/guilds/:gid/modules/:mid/actions/:action` | guardWrite | ✔ safe · audited · **but see D16** |
| GET/HEAD | `/`, `/app/*`, `/assets/*` | **none** | SPA shell and built assets. Traversal-safe. |

Everything else returns `404 {"ok":false,"error":"Not found."}`.

## 1.8 Authentication, step by step

Discord OAuth2, scopes `identify guilds`.

1. **`GET /auth/login`** — rate-limited, then: mint a 256-bit single-use state nonce,
   store it **server-side** in a bounded LRU (max 5000, 10-minute TTL), set it in a
   short-lived `nano_oauth` cookie, redirect to Discord. The post-login destination is
   stored **in the server-side nonce record**, never in a URL parameter — this is what
   closes open-redirect.
2. **`GET /auth/callback?code=…&state=…`** — the state must be known, unused, and
   **match the cookie** via `timingSafeEqual` (double submit).
3. Exchange the code using the **client secret** (environment only). Fetch identity and
   guild list. **The refresh token is deliberately discarded** — sessions expire and the
   user re-authenticates; there is no silent refresh.
4. Create a session and set the cookie.

**The session object, verbatim:**

```ts
// src/web/auth/sessions.ts:16-27
export interface WebSession {
  id: string;                     // 32 random bytes, base64url — IS the capability
  csrf: string;                   // 32 random bytes
  user: WebUser;
  access_token: string;           // Discord token — SERVER-SIDE ONLY, never sent out
  guilds: OauthGuild[];           // the OAuth guild snapshot
  fetched_at: number;             // when the snapshot was taken
  next_guild_refresh_at: number;  // 429 backoff stamp
  created_at: number;
  expires_at: number;
}

const SESSION_ID_BYTES = 32;
const CSRF_BYTES = 32;
const DEFAULT_MAX_SESSIONS_PER_USER = 5;   // no GLOBAL cap — defect D13
const DEFAULT_SWEEP_INTERVAL_MS = 60000;
const DEFAULT_NONCE_TTL_MS = 600000;
const DEFAULT_NONCE_MAX = 5000;
```

Sessions live in an in-memory `Map` and are **dropped on restart** (documented and
accepted). The id is unsigned — there is no JWT and no signing secret; possession is
authority.

**Cookie flags:** `HttpOnly` always. `SameSite=Lax` always — not `Strict`, because the
OAuth callback is a cross-site top-level navigation that `Strict` would break. `Secure`
is **conditional**, emitted only when `web.public_url` starts with `https://`. That one
config value therefore controls both the OAuth redirect URI *and* the `Secure` flag.

**No PKCE.** Acceptable for a confidential client holding a secret; recorded as known
posture, not oversight.

**`GET /api/me` response** — this is how the SPA gets its CSRF token:

```jsonc
{ "ok": true,
  "data": {
    "user": { "id": "…", "username": "…", "avatar": "…" },
    "csrf": "<32 random bytes, base64url>",
    "host_owner": false          // drives host-tier rendering; server enforces anyway
  } }
```

## 1.9 Authorization: two bars and a tier

**The read bar, verbatim** — note what it does *not* do:

```ts
// src/web/module-routes.ts:135-164
function guardRead(deps: AuthDeps, context: WebContext): GuardedRead | null {
  const SESSION = requireSession(deps, context);
  if (!SESSION) return null;

  const GUILD_ID = context.params.gid;
  const WEB = resolveWebConfig(deps.root, deps.frozen);   // ← full config re-read (D3)
  const SNAPSHOT = SESSION.guilds.find(g => g.id === GUILD_ID);

  if (!SNAPSHOT || !isSnapshotAdmin(SNAPSHOT, adminBitsFor(WEB.admin_permissions))) {
    sendJson(context.res, HTTP_FORBIDDEN,
             { ok: false, error: 'Not an admin of this guild.' });
    return null;
  }
  return { session: SESSION, guild_id: GUILD_ID };
  // ⚠ never touches deps.bot.guilds — see D6
}
```

**The check it is missing** already exists in the same file and costs nothing — a pure
in-memory cache lookup, zero REST:

```ts
// src/web/module-routes.ts:199-214
function botGuild(deps, context, guild_id): Guild | null {
  const GUILD = deps.bot.guilds.cache.get(guild_id);
  if (!GUILD) {
    sendJson(context.res, HTTP_NOT_FOUND,
             { ok: false, error: 'The bot is not in this guild.' });
    return null;
  }
  return GUILD;
}
```

**The write bar** adds CSRF and a **live** permission check against the bot's own view:

```ts
// src/web/auth/permissions.ts:146-184 (abridged)
export async function requireLiveGuildAdmin(bot, guild_id, user_id, names) {
  const GUILD = bot.guilds.cache.get(guild_id);
  if (!GUILD) return err(`Bot is not in guild '${guild_id}'.`);   // fails CLOSED
  if (GUILD.ownerId === user_id) return ok({ via: 'owner' });

  let member;
  try { member = await GUILD.members.fetch(user_id); }            // one REST call
  catch { return err(`User '${user_id}' is not a member…`); }

  for (const _name of names) {
    const BIT = (PermissionFlagsBits as Record<string, bigint>)[_name];
    if (BIT !== undefined && member.permissions.has(BIT)) return ok({ via: 'permissions' });
  }
  return err(`User '${user_id}' lacks the admin permissions…`);
}
```

This closes the demoted/kicked/banned window on **writes**. Reads ride the snapshot —
intentional, but see D9 for how stale that actually gets.

**Host tier** — certain config keys and actions are reserved to `BOT_OWNER_ID` from the
environment, enforced server-side, not merely hidden in the UI. Unset means nobody
holds it.

**CSRF, verbatim** — three layers on every non-GET:

```ts
// src/web/auth/routes.ts:158-183
export function requireCsrf(context: WebContext, session: WebSession): boolean {
  const SITE = context.req.headers['sec-fetch-site'];
  if (typeof SITE === 'string' && SITE !== 'same-origin' && SITE !== 'none') {
    sendJson(context.res, HTTP_FORBIDDEN,
             { ok: false, error: 'Cross-site request refused.' });
    return false;
  }
  const HEADER = context.req.headers['x-nano-csrf'];
  if (typeof HEADER !== 'string' || !safeEqual(HEADER, session.csrf)) {
    sendJson(context.res, HTTP_FORBIDDEN,
             { ok: false, error: 'Missing or invalid CSRF token.' });
    return false;
  }
  return true;
}
```

Note the `Sec-Fetch-Site` layer is skipped when the header is absent entirely (non-browser
clients), but layer three still holds.

## 1.10 The rate limiter, verbatim

This is the whole thing:

```ts
// src/web/auth/sessions.ts:187-212
/** Fixed-window counter keyed by caller (B1 pre-auth memory DoS). */
export class RateLimiter {
  private cache: LRUCache<string, { count: number }>;
  private max_per_window: number;

  constructor(options: RateLimiterOptions) {
    this.max_per_window = options.max_per_window;
    this.cache = new LRUCache({
      max: options.max_keys ?? DEFAULT_NONCE_MAX,   // 5000
      ttl: options.window_ms,
    });
  }
  allow(key: string): boolean {
    const ENTRY = this.cache.get(key);
    if (!ENTRY) { this.cache.set(key, { count: 1 }); return this.max_per_window >= 1; }
    ENTRY.count += 1;
    return ENTRY.count <= this.max_per_window;
  }
}

// src/web/auth/routes.ts:254-256 — THE KEY FUNCTION
function clientKey(context: WebContext): string {
  return context.req.socket.remoteAddress ?? 'unknown';
}
```

Defaults are **10 requests per 60 seconds**, applied to exactly two routes:
`/auth/login` and `/auth/callback`. Nothing else is limited.

**Behind cloudflared, `remoteAddress` is always `127.0.0.1`.** The entire internet
collapses into one bucket. That is defect D1, and it is why the tunnel does not merely
fail to help — it actively disarms the only limiter that exists.

## 1.11 Modules, descriptors, and the provides seam

A module registers commands, events, jobs, and optionally a dashboard window. Modules
may be first-party or installed from a **store**.

**Store trust model, stated verbatim in the code** (`src/lib/store/store-client.ts:9-14`):
*"Only modules the store maintainer merged appear here — that is the whole trust
model."* Curation, not cryptography. **No signing, no checksums**; the commit pin is
optional. Installation is:

```
npm install <package>@<version> --ignore-scripts
   or
git clone --depth 1 --branch v<version> https://github.com/<repo>.git
```

**Installation is CLI/TUI only.** No Discord command, no dashboard route, no remote API
can install a module. This is the single most important mitigating fact about the whole
module system.

**Once loaded, a module has full process privilege and no sandbox.** It receives the raw
discord.js `Client`, which carries the module registry (so it can disable other modules)
and every service including the database. Being in-process it also has `process.env` —
the bot token and the OAuth client secret — plus filesystem and network. The installer's
own risk warning says exactly this. **The module boundary is a modularity boundary, not
a security boundary.**

**The descriptor.** Each module ships `nano-dashboard.json`, validated by a zod schema.
It is *declarative*: the only code references are **function names**, resolved lazily at
dispatch with the guild id injected by the host. Real excerpts from our `roles` module —
this file is **43 KB**, which matters for D18:

```jsonc
// top-level keys
["title", "languages", "about", "api_version", "config_version",
 "config", "data", "actions", "action_groups"]

// a config field
{ "key": "enabled",
  "label": { "en": "Module enabled", "es": "Módulo activado" },
  "type": "boolean",
  "tier": "discord",                    // discord | ops | host  ← authority tier
  "help":        { "en": "Turns this module on or off for this server. …" },
  "propagation": { "en": "After turning this back on, run Re-arm pending restores." } }

// a data view  → GET /api/guilds/:gid/modules/roles/data/stats
{ "id": "stats",
  "title":    { "en": "Roles at a glance" },
  "provides": "rolesStats" }            // ← a FUNCTION NAME, resolved at dispatch

// an action   → POST /api/guilds/:gid/modules/roles/actions/publish-panel
{ "id": "publish-panel",
  "label":    { "en": "Publish panel" },
  "provides": "publishPanelAction",
  "params": [ { "key": "panel_id", "type": "text",
                "label": { "en": "Panel id" } } ],
  "group": "panel" }

// a badge — note the URL is only checked to start with https://   ← D19
{ "image": "https://img.shields.io/badge/repo-nano--module--roles-ededed?style=flat-square",
  "href":  "https://github.com/ccs-devhub/nano-module-roles",
  "alt":   { "en": "The module repository" } }
```

**Dispatch flow for an action:**

```
POST /api/guilds/123/modules/roles/actions/publish-panel
  → guardWrite  (session + CSRF + live Discord admin check)
  → descriptor lookup: is "publish-panel" declared?      no → 404
  → actor_gate check: 'host' actions require BOT_OWNER_ID
  → cooldown check (only if the descriptor declared cooldown_s — OPT-IN)
  → param filter: only keys the descriptor declares cross the seam
  → getModuleApi('roles').publishPanelAction(guild_id, PARAMS, { actor_id })
  → audit line { user_id, guild_id, module_id, action id }
```

The host enforces reachability, tier, params, and cooldown. **It enforces nothing about
what the function does.**

**What the public path genuinely changes about modules:**

1. A module's descriptor now decides which of its functions are **internet-reachable**.
   Adding a line to a JSON file becomes a remotely-reachable-surface change with no core
   review.
2. `cooldown_s` is **opt-in**. A module that omits it gets an unthrottled amplification
   primitive on a now-public route.

**The correct framing for descriptor hardening:** anyone who can write your descriptor
already runs your module code with your token. So the descriptor is a *post-compromise*
surface — harden its parser for **event-loop safety and robustness**, not as a security
boundary.

**Client rendering, verified clean:** zero `v-html`, zero `innerHTML`, zero `eval`, no
`<component :is>`. Widget rendering uses static `v-if` branches on field type.
Descriptor strings are mustache-interpolated and therefore escaped. Embed URLs are
**rebuilt from regex-validated ids** rather than accepted as URLs. The asset filename
pattern deliberately excludes SVG.

## 1.12 Configuration: two layers

**Host configuration** — `nano.config.json`. Our actual development file:

```jsonc
{
  "bot": { "name": "kyonax-ptb", "dev_guild_id": "763464848457072701" },
  "intents": ["Guilds", "GuildMembers"],
  "modules": ["./modules/embed-styler", "./modules/synapse",
              "./modules/mcp", "./modules/roles"],
  "disabled": [],
  "database": { "driver": "sqlite" },
  "logging": { "level": "info", "pretty": true },
  "store": { "registry_url": "…/registry.json", "cache_ttl_hours": 24 },
  "module_config": { "mcp": { "allow_write": true } },
  "web": { "enabled": true }        // ← everything else is a schema default
}
```

The `web` block and its defaults — **note the complete absence of validation**: no
`.min()`, no `.int()`, no `.url()`. `port` accepts negatives and floats; `public_url` is
never checked to be a URL.

| Key | Default | Notes |
|---|---|---|
| `enabled` | `false` | Off everywhere until deliberately enabled |
| `port` | `4777` | The MCP bridge owns 3777 |
| `bind` | `127.0.0.1` | Containers set `0.0.0.0`; see the bind law |
| `public_url` | `""` | **Load-bearing twice**: OAuth redirect URI *and* the `Secure` cookie flag |
| `session_ttl_h` | `12` | |
| `guild_refresh_s` | `300` | In practice, only the guild *picker's* refresh |
| `admin_permissions` | `["Administrator","ManageGuild"]` | The read/write bar |
| `invite_permissions` | `"268528704"` | The functional set; never Administrator |

`loadConfig` **throws** on an existing-but-invalid file (deliberately — a silent default
would drop every module and re-register commands globally). `saveConfig` is an atomic
temp-file-plus-rename. **There is no file locking**, so concurrent writers can lose
updates, and the atomic rename requires a *directory* mount rather than a single-file
bind mount.

**How the web layer reads it — the performance problem:**

```ts
// src/web/hot-config.ts — the entire file
export function resolveWebConfig(root: string, frozen: NanoConfig): WebConfig {
  try { return loadConfig(root).web; }   // existsSync + readFileSync + FULL zod parse
  catch { return frozen.web; }           // boot snapshot fallback for mid-edit files
}
```

Called from `guardRead`, again from `guardWrite`, and from four auth sites. A separate
helper re-reads and re-parses the same file per module route. All synchronous, all on the
gateway's event loop. The hot-read behavior is deliberate; paying full price per request
is not.

**Guild configuration** — per-guild, per-module settings in SQLite, written through a
store that self-invalidates its cache. Writes are diff-then-patch: only changed keys
persist, which preserves sparse rows and produces the audit log's changed-keys list.

Validation on that path is **delegated to modules and fails open when absent**:

```ts
// src/lib/services/guild-store.ts:151-165 (abridged)
checkGuildModuleConfig(module_id, value) {
  const SPEC = this.schemas.get(module_id);
  if (!SPEC) return ok(stripVersionKey(value));   // ← NO SCHEMA ⇒ RAW BODY PERSISTED
  const PARSED = SPEC.schema.safeParse(stripVersionKey(value));   // module-supplied
  …
}
```

## 1.13 Static serving

```ts
// src/web/static-files.ts:95-132 (abridged)
export function serveStatic(res, pathname, options): boolean {
  // '/' and '/app' → index.html ; '/app/*' → SPA history fallback ; '/assets/*' → files
  // anything else → return false (falls through to the JSON 404)
  let file = resolveStaticFile(lookup, ROOTS);          // decode → NUL guard →
                                                        // normalize → must stay in root
  if (!file && spa_fallback && !lookup.includes('.')) {
    file = resolveStaticFile('/index.html', ROOTS);
  }
  if (!file) { res.writeHead(404, {'Content-Type':'text/plain'}); res.end('Not found'); return true; }

  res.writeHead(200, { 'Content-Type': contentTypeFor(file) });   // ← ONLY header
  res.end(readFileSync(file));                                    // ← sync, every request
  return true;
}
```

Traversal defense is sound and tested. But: **the only header is `Content-Type`** — no
CSP, no `X-Frame-Options`, no `nosniff`, no `Cache-Control`, no `ETag`, no 304 path. And
the whole bundle is re-read synchronously on every request.

## 1.14 Observability, as it exists

**`.nano/heartbeat.json`** — the canonical liveness signal, written atomically every 300
seconds. The container `HEALTHCHECK` reads its **mtime**; it is not an HTTP probe. This
is the real file from production, right now:

```json
{ "ts": 1786083519497, "bot": "the_creator", "version": "0.4.0",
  "uptime_s": 112502, "rss_mb": 116.5, "heap_used_mb": 29, "heap_limit_mb": 259,
  "loop_p99_ms": 20.2,
  "gateway": { "ready": true, "ws_ping_ms": 26, "invalidated_count": 0 },
  "shard": null, "guild_count": 17, "rest_429s": 0,
  "db": { "sqlite_mb": 0.3, "wal_mb": 1.5 },
  "scheduler": { "jobs": 0, "overruns": 0 },
  "modules": { "healthy": 5, "degraded": 0, "down": 0,
    "metrics": { "roles": { "queue_keys": 0, "suppression_entries": 0,
                            "broken_panels": 0, "level_blind_rules": 0,
                            "pending_restores": 2 } } } }
```

**`webHealth()`** — the web server's state (enabled / listening / detail), surfaced
through Discord commands and a doctor CLI. **There is no HTTP health endpoint anywhere
in the codebase.**

**`fleet-alert.sh`** — host-side bash on a 5-minute timer, per-condition marker files
with a 6-hour debounce, posting to a Discord webhook. Deliberately runs on the host and
never inside the bots. It currently checks container state, restart loops, backup age,
guild count (by grepping container logs), disk, and memory.

**For the performance audit:** the heartbeat already emits `loop_p99_ms` and
`rest_429s` — the two precise detectors for the failure modes we most fear — and
`fleet-alert.sh` reads **neither**.

---

# Part 2 — Infrastructure, exactly as it is now

## 2.1 The VPS

| Property | Value |
|---|---|
| Host | Hostinger VPS, Debian 13 (trixie), kernel 6.12.95 |
| Resources | **1 vCPU**, 3.8 GiB RAM (3.2 GiB available), 50 GB disk at ~10% |
| Swap | 2 GiB, `vm.swappiness=10`, persisted |
| Docker | 29.6.2 + Compose v5.3.1, cgroup2, `live-restore: true` |
| Firewall | `ufw` deny-inbound except tcp/22, allow-outbound |
| Timers | backup (daily), fleet-alert (5 min), docker-prune (weekly) |

Egress to Cloudflare is proven: tcp/7844 to the Argo endpoints connects in **7 ms**.

## 2.2 The production bot container

The **actual** compose file — note there is **no `ports:` key at all**, so 4777 is
unreachable from the host even if the server were enabled:

```yaml
services:
  bot:
    image: nano-core:0.4.0-r1
    container_name: the-creator
    restart: unless-stopped
    env_file: .env
    working_dir: /state
    user: "10001"
    volumes: [./state:/state]
    mem_limit: 512m
    stop_grace_period: 20s
    read_only: true
    tmpfs: [/tmp]
    cap_drop: [ALL]
    security_opt: [no-new-privileges:true]
    logging: { driver: json-file, options: { max-size: 10m, max-file: "5" } }
```

The environment file holds exactly three keys:

```
DISCORD_TOKEN=…
CLIENT_ID=…
NANO_MCP_TOKEN=…
```

**`DISCORD_CLIENT_SECRET` and `BOT_OWNER_ID` are both absent.** Without the first the
dashboard refuses to listen at all; without the second nobody holds host tier.

**Live baseline** — please reason with these rather than assumed numbers:

| Signal | Value |
|---|---|
| `guild_count` | **17** |
| `loop_p99_ms` (event-loop lag) | **20.2 ms** |
| `rest_429s` (Discord rate-limit hits) | **0** |
| `rss_mb` / `heap_limit_mb` | 116.5 / 259 |
| `gateway.ws_ping_ms` | 26 |
| Container memory | 65 MiB of 512 MiB |
| CPU | 0.18% |
| Uptime | 30 h, healthy |

## 2.3 Cloudflare and DNS

| Item | State |
|---|---|
| Domain | `kyonax.tech`, paid through **2027-08-05** |
| Zone | Active on Cloudflare **Free**, and **completely empty** — zero DNS records |
| TLS | Full (Strict), Always Use HTTPS, minimum TLS 1.2 |
| Bot Fight Mode | **OFF** (standing rule) |
| Tunnel | Created, status Inactive, **zero routes** |
| Tunnel token | Parked in the operator's GPG password store |
| Zero Trust | Free tier, 50 users, team exists, **no applications configured** |

**Free-tier quotas that constrain the design:** exactly **1** rate-limiting rule, **5**
custom WAF rules, the free managed ruleset, Access for 50 users.

## 2.4 What is already staged

`cloudflared` **2026.7.3** installed from Cloudflare's official repository, plus a
hardened systemd unit — dedicated unprivileged user, `MemoryMax=128M`,
`NoNewPrivileges`, `ProtectSystem=strict` — **disabled and stopped**, reading a token
from a 0600 file that currently holds a placeholder.

**Nothing is wired.** No DNS record, no tunnel route, no Access application, no token.
And the dashboard's 60 files are **uncommitted** — it is not in the running image.

---

# Part 3 — What we are trying to achieve

## The goal

Give the bot's operator a **web dashboard reachable from the internet** at
`bot.kyonax.tech`, without opening a port, without paying anything, and — most
importantly — **without making the production bot's availability depend on internet
traffic**.

## The threat model

| # | Adversary | Reach | Goal |
|---|---|---|---|
| 1 | Anonymous internet attacker | Whatever is publicly exposed | Denial of service against the bot; information disclosure |
| 2 | Hostile guild administrator | Passes read/write bars for guilds they administer — **including throwaway guilds they create for free** | Reach data or actions outside their guild; exhaust shared resources |
| 3 | Malicious module author | Their code already runs with full privilege | What does *publishing* the dashboard let them reach that they could not before? |
| 4 | Process already on the host | `127.0.0.1:4777` directly, bypassing every edge control | Anything; this is the adversary the loopback bind does *not* stop |

**The property we most want:** a request from any of the four must not become a bot
outage. Confidentiality and integrity matter, but the bot going down is the failure that
actually hurts.

## Non-goals

- This is **not a public product**. It is an administrative console for a small number
  of operators.
- We are **not** making the dashboard multi-tenant-safe for arbitrary Discord users now.
- We are not scaling to hundreds of concurrent operators.

## Hard constraints

A proposal violating one of these is not actionable. Two are softer than they look and
we flag which.

1. **The dashboard is in-process with the bot.** Same origin, no CORS ever.
   *(Soft long-term — see Q3. Hard for this deployment.)*
2. **The bot must not go down.** It manages live roles across 17 guilds.
3. **Zero cost.** Cloudflare Free tier and its quotas.
4. **One vCPU, 3.8 GiB RAM**, shared with a planned backend stack later.
5. **No inbound ports.** `ufw` stays deny-inbound except ssh.
6. **The AI performs no git operations.** Code is prepared; the operator commits.
7. **Secrets move only by the operator's own keystroke.**
8. **`web.enabled` flips on production only at a deliberate gate**, after a dev-bot
   end-to-end test. *(Soft: the gate is ours to schedule.)*

## Our chosen approach, and why

**Publish at `bot.kyonax.tech` through the existing Cloudflare Tunnel, with Cloudflare
Access in front, and validate Access's JWT at the origin.**

The tunnel gives outbound-only connectivity: no inbound ports, TLS and CDN at the edge,
zero cost. Access adds an identity challenge **at the edge**, so anonymous traffic never
reaches the bot process. Origin-side JWT validation makes that a real boundary rather
than a perimeter shape — because it is the only thing that covers adversary #4.

**Alternatives considered and rejected:**

| Option | Why rejected |
|---|---|
| Public hostname, no Access | The tunnel *disarms* the rate limiter (§1.10). The whole internet would share one bucket. |
| Subdomain of another owned domain | Cloudflare Free has no subdomain-only zones — needs a full nameserver migration of an unrelated zone, for zero gain. |
| Host the dashboard externally | Impossible without re-architecture (§1.4). An external site could only be a landing page pointing here. |
| Stay loopback-only behind ssh | Perfectly secure, zero accessibility. Our fallback if you convince us to wait. |

**Measured latency**, for anyone proposing a different topology: VPS → Cloudflare edge
**7 ms**; operator → edge 58–73 ms; operator → VPS directly 79 ms; operator → our shared
hosting (a candidate landing origin) 96 ms.

---

# Part 4 — Our own assessment

Stated plainly, so you know what you are pushing against.

**What we think is genuinely good.** The authentication and authorization *logic* is
better than most admin panels we have seen: single-use server-side state nonces with
cookie double-submit, a post-login destination that never touches a URL parameter,
three-layer CSRF on every write, writes re-verified against live Discord state, host tier
enforced server-side rather than hidden in the UI, secrets that never enter a response or
a log line, traversal-safe static serving with tests, and a client with no `v-html` and no
dynamic component resolution. We do not think the locks are the problem.

**What we think is genuinely risky.** Everything around those locks. No timeouts, no
connection cap, no `clientError` handler. Synchronous disk reads and full schema
validation on the gateway's event loop, per request. A read bar that never checks the bot
is in the guild. Cloudflare caching an authenticated per-guild response because it carries
`Cache-Control: public` and ends in `.png`. A member-lookup route that on a cold cache
turns one page view into hundreds of Discord REST calls.

**The tension we have not resolved.** Every one of those is fixable. The architecture is
not: while the dashboard shares a process with the gateway, *any* dashboard bug remains a
candidate bot outage. We propose to ship anyway, behind edge identity, because the
operator population is one person and the alternative is no dashboard. We think that is
defensible. We would like to be told if it is not.

**What we would do if it were only our call.** Land the launch-blocking fixes, validate
the JWT at the origin, ship behind Access, wire the two monitoring signals we already
emit and ignore, and treat the worker-process extraction as scheduled work with a named
trigger rather than a someday-maybe. The thing we are least sure about is that trigger —
see Q8.

---

# Part 5 — Known defects

All verified against source. Grouped by what they threaten.

## 5.1 Threats to the bot process

**D1 — The rate limiter goes inert behind a proxy.** §1.10. One bucket for the whole
internet; one request every six seconds locks the operator out of login. No proxy header
is read anywhere. Limiting exists on two routes only.

**D2 — No server limits, no error handling.** `headersTimeout`, `requestTimeout`,
`keepAliveTimeout`, `maxConnections` are set nowhere. No `clientError` handler, no
socket error listeners. Slowloris and file-descriptor exhaustion are unbounded.

**D3 — Synchronous I/O and validation on the gateway's event loop, per request.** §1.12.
Config re-read and fully re-validated per guard call (twice per write). Descriptors
re-read and re-validated on every `/modules` and `/instance` request — **43 KB for the
roles descriptor alone**. Static files `readFileSync` per request with no `ETag`, no 304.

**D4 — No error listener after startup.** The server's `'error'` handler is registered
with `once` and consumed by the listen phase. Any later server error is an unhandled
`'error'` event, which reaches the global guard and exits the process.
*(A synchronous throw from a route handler is **not** a risk — the funnel is `async`, so
sync throws become rejections and are caught. See §1.5.)*

**D5 — Shutdown can hang forever.** `server.close()` awaited with no
`closeIdleConnections()`/`closeAllConnections()` and no timeout; the lifecycle manager
gives tasks no timeout either. One keep-alive socket — exactly what a tunnel holds open —
stalls shutdown indefinitely.

**D14 — No cap on concurrent in-flight requests.** No semaphore, no queue.

## 5.2 Threats to data and authority

**D6 — The read bar never checks the bot is in the guild.** §1.9. Eight of thirteen
guild-scoped routes affected (see the table in §1.7). Writes are already safe. The widest
dispatches into module code with an attacker-chosen guild id; another triggers a live
Discord fetch per request for arbitrary ids. Others leak host-global data — this is the
literal `/instance` response body:

```ts
{ bot_name, bot_username, version, database_driver, intents,
  web: { port, bind },                    // ← listen bind and port
  modules: listDashboardModules(...) }    // ← full module inventory
```

**D7 — Cloudflare will cache authenticated per-guild responses and may serve them to
other identities.** The module-asset route sets `Cache-Control: public, max-age=3600` on
a route behind the read bar, with a path ending `.png`/`.jpg`/`.webp` — which Cloudflare
caches by extension by default. **Highest severity, lowest cost to fix.**

**D8 — Absolute filesystem paths and raw upstream bodies reach clients.** A descriptor
404 returns the loader error verbatim, containing an absolute path. The OAuth callback
reflects Discord's raw response body to an anonymous caller.

**D9 — Read authorization is stale for up to 12 hours.** The guild snapshot is refreshed
by exactly one route — the guild picker. Guild-scoped reads never refresh it. So
`guild_refresh_s` (300 s) governs the *picker*; the true bound on read authorization is
`session_ttl_h`, **12 hours**. Contradicts our own written rule.

**D10 — Reads are never audited.** Only the two writes and the action route emit audit
lines. The widest read leak leaves no record of who read what.

**D15 — Loopback is not an Access boundary.** Adversary #4 reaches the origin directly,
bypassing Access, and could forge the client-IP header once we start trusting it.

**D16 — The action route executes even when the request body was rejected**, verbatim:

```ts
// src/web/module-routes.ts:1335-1362
const BODY = await readJsonBody(context.req);
const RAW_PARAMS = BODY.ok && BODY.data !== null && typeof BODY.data === 'object'
  ? (BODY.data as { params?: Record<string, unknown> }).params
  : undefined;                                    // ← oversize/malformed ⇒ undefined

const PARAMS: Record<string, unknown> = {};
if (RAW_PARAMS !== null && typeof RAW_PARAMS === 'object') { /* filter */ }

const RESULT = ACTION.params && ACTION.params.length > 0
  ? await FN(WRITE.guild_id, PARAMS, CONTEXT)     // ← RUNS ANYWAY, with {}
  : await FN(WRITE.guild_id, undefined, CONTEXT);
```

Returns 200 with an audit line claiming success. Both sibling write routes handle this
correctly — the config PUT returns 413/400, the gates PUT returns 400 — so this is an
inconsistency, not a design.

**D17 — The core cannot guarantee validation on the config write path, and the no-schema
case fails open.** §1.12. When a module registers no schema, the raw body is persisted.
When one is registered it is **module-supplied**, so a permissive module schema makes the
config PUT an arbitrary-JSON write. As modules multiply, the weakest module defines the
write surface.

## 5.3 Missing hardening

**D11 — The member-lookup route is a Discord REST amplifier.** One live lookup per
request, no cooldown, no cap, driven by the client at one request per distinct member
rendered. *(Nuance: the underlying library call is **cache-first**, so this costs REST
only on a cold cache. There is no **negative** cache, so repeated misses re-hit REST
every time. Note also that the obvious batch API is a **gateway opcode-8** operation
which this codebase deliberately avoids by documented rule — batching is not the fix.)*

**D12 — No security headers anywhere** except one `nosniff` on module assets. §1.13. No
CSP, no frame protections, no HSTS. The dashboard is framable.

**D13 — The session store has no global bound.** Per-user cap of 5 exists; the map itself
is unbounded.

**D18 — Descriptor loading is uncached and unbounded.** No file-size cap (inconsistent
with the asset route, which caps at 8 MiB), no `.max()` on text fields, no depth cap on
the recursive field schema.

**D19 — Descriptors can point the operator's browser at arbitrary external hosts.** Badge
and media URLs are validated only as `/^https:\/\/[^\s]+$/`. A badge image is therefore
an arbitrary-host beacon firing on every admin page view, leaking IP, user agent, and a
`Referer` containing the guild id — and it carries no `referrerpolicy`.

**D20 — `--ignore-scripts` on module install is one-shot, not durable.** npm-sourced
store modules land in the root manifest, and the Dockerfile's bare `npm ci` executes
their `postinstall` on the next image build. The Dockerfile cannot simply add the flag
because `better-sqlite3` needs its native build. Latent today; no store modules installed.

## 5.4 Configuration prerequisites, not defects

- **`public_url` is empty**, so the OAuth redirect URI points at loopback (the tunnel
  deployment is functionally broken until it is set) and `Secure` is suppressed.
- **No HTTP health endpoint exists.**

---

# Part 6 — The plan

Twenty fixes, grouped by theme for comprehension.

**Keeping the bot alive:** server timeouts, connection cap, `clientError` and socket
error handlers, a persistent post-startup error listener *(F3)*; shutdown connection
teardown with a bounded timeout *(F4)*; an mtime-keyed cache for config reads *(F8)*;
the same for descriptor loading plus size and depth bounds *(F15)*; a concurrency cap
returning 503 *(F18)*; a core-imposed throttle floor and an execution timeout on module
dispatch *(F17)*.

**Making the edge boundary real:** origin-side Access JWT validation *(F13 — mandatory)*;
real rate limiting keyed on the true client IP with separate buckets for auth, API,
static, and health *(F7)*.

**Closing authorization gaps:** a bot-presence check inside the read bar *(F9)*; auditing
reads *(part of F9)*; rejecting actions whose body failed to parse *(F14)*; refreshing the
guild snapshot *(F11 — optional, see below)*.

**Reducing exposure:** scrubbing paths and upstream bodies *(F1)*; security headers and a
CSP *(F5)*; a `private` cache directive on the authenticated asset route *(part of F5)*;
constraining descriptor-supplied external URLs *(F19)*.

**Bounding resources:** a global session cap *(F2)*; negative caching, a cooldown, and a
per-request cap on member lookups *(F16)*.

**Everything else:** a real `/health` route *(F6)*; config schema validation *(F10)*;
client recovery when the Access session expires *(F12)*; closing the npm lifecycle-script
hole *(F20)*.

## The details that are easy to get wrong

**F13 — origin JWT validation.** Validate the `Cf-Access-Jwt-Assertion` **header**, not
the `CF_Authorization` cookie (browser-only; Cloudflare recommends against relying on it).

```
keys:           createRemoteJWKSet("https://<team>.cloudflareaccess.com/cdn-cgi/access/certs")
issuer:         "https://<team>.cloudflareaccess.com"     ← no trailing slash
audience:       <64-char lowercase hex AUD tag>           ← ARRAY; per-application
algorithms:     ["RS256"]                                 ← pin it
clockTolerance: "30s"                                     ← nbf === iat; a fast clock rejects
→ principal = payload.common_name
    ? { kind: "service", id: payload.common_name }        ← service token
    : { kind: "user", sub: payload.sub, email: payload.email }
```

Service-token requests carry a **full JWT too**, so one verification path covers humans
and machines — distinguish them by the presence of `common_name`, **not** by the `type`
claim, which is `"app"` for both. Library: `jose` (zero dependencies, Web Crypto, what
Cloudflare's own Node examples use) — this would be the project's first new runtime
dependency in a deliberately small set of eleven. Separately, cloudflared can validate
the JWT itself via its origin-request parameters: worth enabling as a second layer, but
it does **not** replace F13, because a host-local attacker never traverses cloudflared.

**F6 — `/health`.** Use an Access **Service Auth** policy with a service token, **not** a
Bypass policy: Cloudflare's documentation states Bypass *"does not enforce any Access
security controls and requests are not logged."* Give the route its own rate-limit
bucket; do not exempt it. Keep the body minimal — no version, no module list, no bind or
port. Honest limit: when the web server is disabled nothing listens, so a failed probe
cannot distinguish "web off" from "bot dead." The heartbeat file remains authoritative.

**F5 — CSP.** A strict policy is viable: the built HTML has no inline script or style, the
bundle has no `eval`, the client has no `v-html`. But it must permit what the client
actually loads — a blanket `frame-src 'none'` would break the click-to-load video embeds:

```
default-src 'self';
script-src  'self';
style-src   'self';
connect-src 'self';
img-src     'self' https://cdn.discordapp.com https://i.ytimg.com <badge-hosts>;
frame-src   https://www.youtube-nocookie.com https://platform.twitter.com;
font-src    'self';
object-src  'none';
frame-ancestors 'none'; base-uri 'none'; form-action 'self';
```

`<badge-hosts>` is the open question: descriptor badges accept any https host today
(D19). Either constrain the schema to an allowlist (F19, preferred — it makes this
directive tight) or fall back to `https:` and accept the beacon. HSTS must be gated on
the same `public_url`-is-https predicate that controls the `Secure` cookie, or it poisons
local development. One blocker: an inline `<style>` block in the development fallback
page needs externalizing.

**F8 — the config memo.** Key on the root path **and** on high-resolution mtime plus
inode and size, not millisecond mtime: the config is written by a read-modify-write plus
rename that can land two writes inside one millisecond. Treat a missing file as a
cacheable state or an existing test breaks. Cache only successful parses and retain the
last good value, preserving the documented behavior that a mid-edit config never turns
requests into 500s.

**F11 — read staleness, and why it is optional.** The obvious fix (refresh inside the read
bar) is wrong twice over: the refresh helper does not stamp a backoff on generic failures,
and the client's module loader is a *sequential* loop, so during a Discord outage one page
load becomes dozens of Discord calls; and it makes a synchronous guard async, cascading to
every route. The alternative — refreshing in the 60-second session sweep — is better but
not free: the refresh timestamp is re-stamped on success, so sessions **phase-lock** into
the same tick forever, and because sessions die on restart, every operator re-logs within
one minute after a deploy and lands in the same bucket permanently. Doing it properly
needs jitter, a bounded concurrency pool, a re-entrancy guard, and explicit error
handling. Shortening the session TTL is a legitimate cheaper mitigation.

## Implementation order

Risk-ascending: F1 → F3 → F4 → F2 → F5 → F6 → F13 → F10 → F14 → F18 → F8 → F15 → F19 →
F20 → F7 → F16 → F17 → F9 → F12 → F11.

**On order generally:** the deploy gate is a single `web.enabled` flip, so nothing ships
publicly until everything has landed. Intra-order is therefore about safe integration, not
exposure priority. F1 is first because it is trivial and clears the deck; the server
lifecycle work is early because it needs the most iteration; the two changes that alter
authorization semantics (F9, F11) are last and get their own commits and revert paths.

**The launch-blocking subset**, if scope must shrink: **F3, F4, F13, F14, F16, F18.**

---

# Part 7 — Deployment sequence

The dashboard is **uncommitted**, so the ship path runs through the operator's git gates,
then an image build, then a dev-bot end-to-end test, then the production flip.

**Three ordering hazards already found:**

1. **Register the Discord redirect URI first**, before anything ships. It is sent at both
   the authorize step and the code exchange, and Discord rejects unregistered ones — so
   setting `public_url` before registering leaves login completely dead. The portal entry
   is additive and costs nothing to do first.
2. **Prove login before setting `public_url` to https.** The moment it is https, the
   `Secure` flag makes plain-HTTP login impossible — including any loopback smoke test.
   Either prove it on the dev bot, or temporarily register a loopback redirect URI and
   scrub it afterward.
3. **Enable proxy-header trust only after Access is live.** Left off during tunnel
   bring-up, every request buckets under `127.0.0.1` — the operator-lockout condition the
   fix exists to remove.

**Configuration changes at the gate:**

```yaml
# compose.yml gains:
    ports:
      - "127.0.0.1:4777:4777"      # loopback-only; ufw sees no new open port
```

```jsonc
// state/nano.config.json web block:
"web": { "enabled": true,
         "bind": "0.0.0.0",                       // in-container half of the bind law
         "port": 4777,
         "public_url": "https://bot.kyonax.tech",
         "trust_proxy_header": true }             // new in F7; prod only
```

```
# .env gains:
DISCORD_CLIENT_SECRET=…      ← operator keystroke; server refuses to listen without it
BOT_OWNER_ID=…               ← not secret, but nobody holds host tier without it
```

**Cloudflare objects to create:** the tunnel route; a main Access application with an
email policy and **Managed OAuth enabled** (so Access returns 401 instead of a 302 to
non-browser clients — the official fix for the dead-dashboard-on-expiry failure); a
**separate path-scoped application** for `/health` with a Service Auth policy; and the
single free rate-limiting rule spent on the auth routes.

**End-to-end verification**, stopping at the first failure:

1. TLS valid; HTTP redirects to HTTPS.
2. An unauthenticated request is stopped **at the edge** and never reaches the app.
3. **From an ssh session on the VPS, `curl http://127.0.0.1:4777/api/me` is rejected by
   the JWT check** — repeated with a forged `CF-Connecting-IP`. This is the test that
   proves Access is a boundary rather than a shape.
4. Access login → shell loads.
5. Discord OAuth completes on the public origin; the session cookie carries `Secure`.
6. Functional pass: classify → config edit → data view → action.
7. Negatives: a guild you do not administer → 403; **a guild you administer that the bot
   is not in → 404** (F9); host-tier key refused for a non-host actor; CSRF omitted →
   rejected.
8. The bot stayed healthy and logged in throughout.

**Monitoring:** add tunnel-liveness and public-path checks to `fleet-alert.sh`, and —
cheaply, before the flip — start reading `loop_p99_ms` and `rest_429s` from the heartbeat.

**Rollback**, either alone sufficient and both minutes: flip `web.enabled` off and
restart, or delete the tunnel route.

---

# Part 8 — Questions we want answered

Please answer individually.

**Q1 — Is edge identity the right primary control for an admin console, or a crutch that
will never be removed?** We plan to keep Access on permanently. Right call, or does it
breed complacency about the code?

**Q2 — What does another pass find?** Three verification rounds each found defects the
previous missed, including the highest-severity one. We are specifically unsure about the
module dispatch path, the descriptor loader as a robustness surface, and whether our
proposed rate-limit bucketing can be gamed.

**Q3 — Should the dashboard leave the bot process, and what would that cost?** Every prior
reviewer said yes, medium-term, via a worker process over a Unix socket. We have not
committed. Given §1.4 — live discord.js caches plus a per-process config cache — what
would the IPC contract need to expose, and what breaks?

**Q4 — Does our fix list bound the blast radius of adversary #2?** They pass the write bar
legitimately. Reads are audited only after F9; module actions run arbitrary module code;
the config write path can fail open (D17).

**Q5 — What breaks first, and at what number?** 17 guilds, 1 operator, 20.2 ms
event-loop lag, zero Discord 429s today. Give us the number at which each becomes a
problem.

**Q6 — Is our monitoring sufficient to detect the failures you are worried about?** If
not, what should we emit that we do not?

**Q7 — Which of the twenty fixes would you drop, and which would you add?** We would
rather ship twelve correct fixes than twenty half-considered ones.

**Q8 — What is the trigger for extracting the dashboard into its own process?** We would
rather commit now than relitigate architecture during an incident. Candidates: the first
dashboard-caused restart; the second operator; a sustained event-loop-lag threshold; a
fixed date. Which, and why?

**Q9 — A planned second system shares this infrastructure.** A separate API for identity
and entitlements will later run on the same VPS behind the same tunnel, serving browser
JavaScript from static sites — which means **Access cannot front it**, it needs its own
in-code protections from day one, and it competes for the single free rate-limiting rule.
What else about that coexistence should we decide now rather than later?

---

# Appendix — Verification, testing, and dependencies

**Runtime dependencies**, the complete list:

```
@clack/prompts  better-sqlite3  croner  discord.js  dotenv
drizzle-orm     jiti            lru-cache  pino     smol-toml  zod
```

The Vue client, Vite, vitest, and ESLint are all devDependencies — the runtime gains
nothing from them.

**Gates**, all run manually — there is **no CI**, only a pre-commit hook: lint at zero
problems; a strict TypeScript build (which also type-checks the Vue client); the test
suite; a doctor command; a tokenless smoke boot; and a degraded smoke proving that
enabling the web server without its secret boots degraded and never listens.

**Baseline: 312 tests** (278 core + 34 web-client). One gap worth flagging: 14 test files
belonging to a module sit outside the runner's include globs and execute in **neither**
project today.

**Test harnesses that exist** (so you can judge how expensive new tests are): temp-root
fixtures that write a real `nano.config.json` — required, because config reads are hot; a
stubbed Discord `fetch` covering token exchange, revoke, identity, and guild list; fake
bots of varying fidelity; and a reusable `loginFlow()` helper that performs the full OAuth
round trip and returns a cookie plus CSRF token.

**Tests we know we need:**

- A guild the session administers **but the bot is absent from** returns 404, across all
  eight affected routes. Currently untested; the single most important new assertion.
- Proxy-header trust honored only when configured; `X-Forwarded-For` ignored always.
- Distinct rate-limit buckets with `Retry-After`; `/assets/` routed to the static bucket.
- Config and descriptors read once per mtime rather than per request — including the
  empty-root and same-millisecond-write cases.
- Security headers present; HSTS absent when not https; asset `Cache-Control` is `private`.
- `/health` leaking nothing, asserted as exact key-set equality rather than a list of
  absences.
- Raw-socket tests for timeouts, malformed requests, and `maxConnections` — these need
  the timeout values made injectable through the existing options seam, because the
  current harness goes through `fetch`, which cannot express a half-sent request.
