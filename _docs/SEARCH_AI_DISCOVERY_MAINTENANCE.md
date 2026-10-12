# Search and AI discovery maintenance

## Source and generated files

- Edit the four existing marketing components in `_site-source/index.html`, `Solo.dc.html`, `Team.dc.html`, `Coach.dc.html`.
- Run `npm run build:marketing` to update the committed root HTML snapshots. Do not edit only generated HTML: a rebuild will overwrite it.
- Edit the new editorial content and entity definitions in `scripts/build-discovery.py`; run `npm run build:discovery` to regenerate the 21 static pages, sitemap, llms.txt and manifest.
- `assets/prerender-bridge.js` keeps static content visible until the original component has rendered an H1. It does not change the diagnostic, payment, account or AI runtime.
- Templates are inert HTML, visible snapshots contain the actual page content, and there is no user-agent-specific serving. If JavaScript is blocked or fails to load, the static page remains readable and its links remain usable. Interactive language switches and walkthrough controls still require JavaScript.
- `_worker.js` implements public aliases and private indexing headers. Existing `/quiz` proxy logic is retained. `/api/*` still depends on the separately configured production Worker route.
- Keep `404.html` at the deployment root to disable Cloudflare Pages' default SPA fallback. The local server approximates asset routing; only a real Pages preview can verify the platform's exact behavior.
- `_site-source`, scripts, internal docs, database and worker source are denied by the Pages Worker. As defense in depth, exclude these directories from deployment artifacts when configuring the production build. Do not publish the repository through a host that ignores `_worker.js`.

## Local verification

Prerequisites: Node.js, Python 3, Chrome or Playwright Chromium.

```sh
npm ci
npx playwright install chromium
npm run build:discovery
npm run build:marketing
npm run test:static
npm run serve:test
# In another terminal:
npm run test:browser
```

On macOS the scripts use installed Google Chrome. Set `CHROME_PATH` to select another executable. `NODE_PATH` can point to an existing managed Playwright installation. Set `TEST_BASE` for a preview origin and `ARTIFACT_DIR` for screenshots. The browser tests deliberately block non-test-origin requests; they do not buy products or submit real customer data.

`python3 scripts/live-audit.py` makes read-only requests to public production URLs and records HTTP status and discovery contents. It does not verify bot source IPs or authenticated flows. Audit outputs are under `_site-source` and are not public assets.

## Release checks

1. Reconcile the deployed source/build with `master`. The audited production HTML, sitemap and llms.txt already differ from the cloned repository. The live sitemap also references `/practitioner/apply/`, which is not implemented in this checkout. Do not replace production blindly.
2. Build a Cloudflare Pages preview with the same Worker, assets and API routing as production. Verify `/solo`, `/teams`, `/coaches`, legacy aliases, unknown URL 404, `/quiz?lang=en`, robots, sitemap, llms, internal source denial and private noindex headers.
3. Check existing checkout return URLs, purchase links, coach application route, login, language persistence, assessment access, consent, report retrieval and tracking in the approved test environment. Local script preservation is not an end-to-end payment/authentication test.
4. Review the new English editorial pages and proposed AI-specific offer scope. Update legal notices with qualified review if the current notice does not cover these services.
5. Only after the source discrepancy is resolved: merge/deploy through the established process, purge appropriate caches and repeat external HTTP checks.

## Content policy

Do not call NBIF validated without published evidence. No automatic AI readiness score can be derived from a workstyle type. Keep the enterprise status table factual. Do not introduce local office addresses, reviews, awards, certifications or founder credentials without a source.

Search and user-directed discovery are allowed; GPTBot and ClaudeBot are separately disallowed for training. Change training policy independently of discovery groups. robots.txt is not authentication and blocked URLs may still appear as URL-only search results. Authentication, token authorization and database row-level controls must remain enforced by the application.

No hreflang is emitted for UI language toggles because the current marketing URLs do not serve independently addressable English static editions. The new English knowledge pages are not alternate translations of the German marketing pages.
