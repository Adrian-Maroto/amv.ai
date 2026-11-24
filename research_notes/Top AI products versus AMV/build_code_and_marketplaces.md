# Build, code and marketplaces: top AI assistants and dedicated app builders (as of 24 Nov 2026)

Method and source quality (read first):
- 19 tool calls: WebSearch (standard and extended) plus two WebFetch attempts. Both fetches failed because the host is outside this session's allowed network: `www.llms.blog` and `docs.lovable.dev`. So almost every finding below comes from search-engine summaries of the linked pages, not from reading the pages in full. Treat exact wording and dates as "reported by" until someone reads the primary page.
- Primary/official sources reached (through summaries): OpenAI ChatGPT release notes, the learn.chatgpt.com changelog, OpenAI's Apps SDK announcement, Lovable docs/changelog/glossary/status page, Replit docs, Claude Code docs, Bolt support docs, the v0 changelog and Vercel community forum, Poe help center, claude.com Claude Marketplace page, Google's blog. Everything else is tech press or SEO blogs, and the notes flag that.
- Version numbers and dates for Grok, DeepSeek and Meta AI conflicted across sources and are not relied on here.

## 1. What each product offers for building (design canvas, app builder, live preview, deploy/share, GitHub)

### Takeaway
By Nov 2026 the general assistants have split. OpenAI (Codex + "Sites"), Google (AI Studio Build mode on the Antigravity agent, plus Gemini Canvas) and Anthropic (Artifacts + Claude Code) ship real app building with preview and share. Microsoft concentrates building in GitHub Copilot's coding agent. Perplexity, Mistral, Grok, DeepSeek and Meta AI show no comparable app builder in the sources found. The dedicated builders (Lovable, Replit, Bolt, v0) remain the reference for workspace UX.

### Cited Findings

**OpenAI (ChatGPT Canvas, Codex, Sites)**
- Codex "Sites" has been in preview since 2 June 2026: users ask Codex to "create, iterate on, and deploy lightweight full-stack JavaScript/TypeScript web apps". It is off by default for Enterprise/Edu workspaces. — [ChatGPT Enterprise and Edu release notes](https://help.openai.com/en/articles/10128477-chatgpt-enterprise-and-edu-release-notes); [ChatGPT & Codex changelog](https://learn.chatgpt.com/docs/changelog)
- OpenAI announced on 2 June 2026 that it was putting Codex inside the ChatGPT app everywhere, alongside 6 new business plugins. — [9to5Mac, 2 Jun 2026](https://9to5mac.com/2026/06/02/openai-putting-codex-inside-chatgpt-app-everywhere-releasing-6-business-plugins/)
- The Codex app merged into the ChatGPT desktop app on 9 July 2026. — [learn.chatgpt.com What's new](https://learn.chatgpt.com/docs/whats-new) (via search summary)
- Codex is in preview inside the ChatGPT mobile app: "Start new work, review outputs, steer execution, and approve next steps ... Codex will keep running on your laptop, Mac mini, or devbox." — [OpenAI on X](https://x.com/OpenAI/status/2055016850849993072)
- Codex in the ChatGPT desktop app for Linux is in preview. — [OpenAI Developer Community](https://community.openai.com/t/codex-in-chatgpt-desktop-app-for-linux-is-now-in-preview/1390027)
- November 2026 Codex app releases: 26.1117 added in-viewer ZIP browsing with file previews; 26.1120 added CSV table previews and remembered Markdown view mode. — [ChatGPT & Codex changelog](https://learn.chatgpt.com/docs/changelog); [Releasebot, Nov 2026](https://releasebot.io/updates/openai)
- ChatGPT Canvas: the release notes list a shortcut that opens pasted content in canvas, and sharing from the Canvas toolbar. Those entries were undated in the results, so they cannot be placed in Oct-Nov 2026. — [ChatGPT release notes](https://help.openai.com/en/articles/6825453-chatgpt-release-notes)

**Google (Gemini Canvas, AI Studio Build mode)**
- Google introduced "vibe coding in Google AI Studio" (Build mode) with "Annotation Mode", described as a way to "highlight a part of your app and tell Gemini what to modify". The post's date did not show in results; see Gaps. — [Google blog](https://blog.google/technology/developers/introducing-vibe-coding-in-google-ai-studio/)
- March 2026 overhaul of Build mode: rebuilt full-stack experience powered by the Antigravity coding agent, with built-in Firebase (auth, database), Next.js, npm packages and secrets management. Sources disagree on the day (18 or 23 March). — [Buttondown "Verified"](https://buttondown.com/verified/archive/google-ai-studio-build-the-full-stack-vibe-coding/); [DevOps Digest](https://www.devopsdigest.com/google-ai-studio-adds-new-vibe-coding-experience); [MagicShot news](https://magicshot.ai/news/google-ai-studio-major-vibe-coding-update)
- Reported later additions: multiplayer state management and native Android apps (Kotlin, Jetpack Compose). Annotation edits update the code panel, so code stays in sync with preview. — [Digitnaut, Nov 2026](https://www.digitnaut.com/2026/11/google-ai-studio-vibe-coding.html); [zoer.ai guide](https://zoer.ai/posts/zoer/vibe-coding-google-ai-studio-guide) (secondary)
- Gemini Canvas is on the free plan when signed in. Sharing: Share & export, then Share, creates a link. Recipients can "Copy Canvas" to get their own version. Warning: anyone with the link can edit the app's data. — [Fastero, 2026](https://fastero.com/blog/gemini-canvas) (secondary)
- Canvas gained a "Create" menu on 20 May 2026 that turns text into web pages, infographics, quizzes and Audio Overviews. — [FelloAI Gemini Canvas](https://felloai.com/gemini-canvas/); [Yahoo Tech](https://tech.yahoo.com/articles/gemini-app-extends-useful-key-181922922.html) (secondary)

**Anthropic (Artifacts, Claude Code)**
- Artifacts made on or after 16 Sep 2026 use a Share control ("Anyone with the link") instead of Publish. Earlier "legacy artifacts" keep Publish, and unpublishing is permanent and deletes stored data. Viewers generally need a Claude account. — [Hostsmith, 2026](https://hostsmith.net/blog/publish-claude-artifact/); [Anchorify 2026 update](https://anchorify.io/blog/are-claude-artifacts-public); [FreakyJolly guide](https://freakyjolly.com/claude-artifacts-guide/) (secondary; they conflict on Free-plan sharing)
- There is no public directory: artifacts appear only once shared or published. Team/Enterprise keep artifacts inside the org by default, and an owner can allow external sharing. Persistent storage and connectors start at Pro. One source gives a 20MB per-artifact limit (checked Oct 2026). — [Static.app guide](https://static.app/guides/what-are-claude-artifacts); [Instapods 2026 guide](https://instapods.com/blog/what-are-claude-artifacts/) (secondary)
- Claude Code can publish pages to a private claude.ai URL, managed with `/artifacts`. — [ShareDuo guide](https://www.shareduo.com/blog/claude-artifacts) (secondary)

**Microsoft (Copilot Pages, GitHub Copilot)**
- GitHub moved Copilot to usage-based billing on 1 June 2026: "GitHub AI Credits" at $0.01 each, consumed at token rates. Agent mode and the coding agent are the main cost drivers. — [VaaSBlock, Jun 2026](https://www.vaasblock.com/news/github-copilot-usage-based-billing-agentic-cost-microsoft-2026/); [SolidAITech, Jun 2026](https://www.solidaitech.com/2026/06/github-copilot-complete-guide.html)
- Reported tiers: Free, $10 Pro, $39 Pro+, $100 Max, $19 Business, $39 Enterprise. Completions stay unlimited on paid plans, while chat, agents and CLI use consume credits. Reported GitHub research (May 2026): agentic tasks can use about 1,000x more tokens than single-turn queries. — [Adalytica](https://adalytica.com/news/microsoft-github-copilot-tiers-usage-fees-07d765ae); [TechTimes, 29 Jun 2026](https://www.techtimes.com/articles/319340/20260629/github-copilot-billing-shock-confirmed-agentic-users-face-10x-cost-surge.htm) (secondary)
- Claimed: the coding agent opened over 2.1M PRs in public repos since May 2025, and 72% were merged. Low-quality stats site. — [Second Talent](https://www.secondtalent.com/resources/github-copilot-statistics/)
- Copilot CLI has a documented "cancel and roll back" capability. — [GitHub Docs](https://docs.github.com/en/enterprise-cloud@latest/copilot/concepts/agents/copilot-cli/cancel-and-roll-back)

**Perplexity, Mistral, Grok, DeepSeek, Meta AI**
- Perplexity Labs is described as an opt-in Pro creation engine that builds reports and dashboards from research sessions. — [DataCamp alternatives 2026](https://www.datacamp.com/blog/10-chatgpt-alternatives); [The AI Rankings](https://theairankings.com/best-ai-apps/) (secondary)
- Mistral reportedly renamed Le Chat to "Vibe" in 2026 ("one agent and one licence across work and code"). Its free tier reportedly includes canvas, agents and a code interpreter. — [Jobbit, 2026](https://jobbit.uk/en/blog/best-chatgpt-alternatives-2026); [Hackceleration](https://hackceleration.com/labs/to-watch/new-ai-chatbots) (secondary, unconfirmed by Mistral)
- Meta AI runs on Muse Spark (Meta Superintelligence Labs, replacing Llama as the consumer engine in April 2026). Meta's separate "Muse" agent books travel, fills forms and completes checkouts. No source showed Meta AI building apps. — [usecarly](https://www.usecarly.com/blog/meta-ai-alternatives/); [Jobbit](https://jobbit.uk/en/blog/best-chatgpt-alternatives-2026) (secondary)
- Grok (4.6 vs 4.7) and DeepSeek (V4-Pro GA Aug 2026 vs V4.1-Flash Sep 2026) version claims conflict, and no app-builder features were found. — [aicomparison.ai](https://aicomparison.ai/grok-alternatives/); [DarwinApps, Sep 2026](https://www.darwinapps.com/blog/15-most-used-generative-ai-chatbots/)

**Dedicated builders**
- Replit Agent 4 launched in March 2026 (one review says 11 Mar) with parallel agents (sub-agents for auth, DB and frontend that merge, with automatic conflict resolution), an "infinite design canvas" (generate UI variants, compare them, apply one to the live app) and team collaboration. Parallel execution is gated to Pro/Enterprise, with only limited temporary access for Core at launch. Every agent turn bills "effort". — [HeadsUpAI](https://headsupai.io/updates/replit-launches-agent-4-with-parallel-agents-infinite-design-canvas); [Developers Digest](https://www.developersdigest.tech/blog/replit-agent-4-design-to-app); [ChatForest](https://chatforest.com/builders-log/replit-agent-4-creativity-parallel-agents-effort-pricing/); [Javi's Review](https://javisreview.com/review/replit-review-2026/)
- Replit's valuation reportedly tripled to $9B around the Agent 4 launch. — [aiforautomation.io, 21 Mar 2026](https://aiforautomation.io/news/2026-03-21-replit-agent-4-9-billion-valuation-400m-parallel-ai-agents)
- v0's changelog lists design mode fixes: a disabled toggle while the preview loads, an overlapping toolbar and panel, lost instruction drafts, and edits queued or applied twice. It also notes "delete selected element" and element-screenshot attachment. Elsewhere: GitHub sync fixes for commits that fail to push, "Import from GitHub", and a fix for empty assistant messages when the agent is stopped. — [v0 changelog](https://v0.app/changelog)
- v0 forum reports: design mode was disabled for chats created from a GitHub repo; v0 cannot connect to externally created repos/branches (work must start from a v0-created branch); branch-sync and PR-before-deploy friction. — [Vercel Community: design mode](https://community.vercel.com/t/design-mode-not-enabled-on-chat-created-from-github-repository/33571); [sync error](https://community.vercel.com/t/v0-github-integration-sync-error-preventing-production-deployment-when-branches-are-identical/32478); [branch](https://community.vercel.com/t/will-not-sync-with-github-cannot-change-branch/23468)
- Comparisons in 2026 reviews: Lovable "wins for shipping real apps", Bolt is fastest, v0 is best for UI/components but weak on backend, and Replit's output is inconsistent. One benchmark found Bolt and Replit failed to integrate an AI API even with 3 debugging prompts. Reported pricing: v0 Plus $30, Lovable $20, Bolt Pro $25, Replit Core $20 per month. — [altar.io](https://altar.io/lovable-vs-bolt-vs-v0-vs-replit-vs-base44/); [clord.dev](https://clord.dev/blog/bolt-vs-v0-vs-lovable-vs-replit-agent-which-ai-app-builder-actually-ships-2026/); [ai-agents-benchmark.com](https://ai-agents-benchmark.com/); [toolspotter](https://toolspotter.co/blog/ai-nocode-app-builders-compared-2026) (secondary)
- Replit GitHub: connect a repo for backup and collaboration, or "Import from GitHub" to turn any repo into a Replit App. — [Replit docs: version control](https://docs.replit.com/core-concepts/workspace/version-control)

### Inferences
- The "design canvas" pattern has converged on: generate several variants, compare them side by side, apply one to the live app (Replit Agent 4), plus point-and-edit on the running preview (Google Annotation Mode, v0 design mode with select/delete element and element screenshots).
- Among the general assistants, only OpenAI (Codex Sites) and Google (AI Studio) clearly deploy full-stack apps in Nov 2026. Claude's offering is share-a-link artifacts plus Claude Code for real repositories.
- Gemini Canvas share links let anyone edit the app's data. That is a known weak spot to avoid: a shared app should not hand write access to its data.

### Gaps
- Microsoft Copilot Pages: nothing 2026-specific found. Its status and features as of Nov 2026 are unverified.
- Exact launch date of AI Studio's Annotation Mode, and whether AI Studio offers one-click deploy/GitHub export in Nov 2026 (not confirmed from a primary page).
- Lovable's publish, custom-domain and GitHub-sync details: docs.lovable.dev was unreachable (blocked host), and searches returned only Replit.
- Bolt.new 2026 feature changes (deploy targets, GitHub) were not found beyond the troubleshooting docs.
- Workspace layout (chat left / preview-code right) is not explicitly described in any source found for any product. Background knowledge says the dedicated builders all use it, but this session did not verify it.

## 2. Best-in-class agent workspace patterns in 2026: queueing, interrupting, adding instructions, errors, suggestions, versioning

### Takeaway
The leaders have moved from a strict FIFO message queue to steering a running agent: a message sent mid-run joins the current turn at its next stopping point. Each turn gets a checkpoint, with rewind of code and/or conversation. Error surfacing is the weakest area everywhere. Bolt openly says it cannot see the preview and asks users to paste console errors. v0 relies on a "Fix with v0" button.

### Cited Findings

**Queueing and steering**
- Lovable "follow-ups" replace its message queue. You can send a follow-up, correction or new idea while Lovable is working, in Build or Plan mode, and it is picked up "at its next natural stopping point". — [Lovable changelog](https://docs.lovable.dev/changelog) (via search summary)
- Lovable's glossary lists the message queue as deprecated: disabled by default, kept for accounts that used it, and toggled under Account settings → Preferences → Message queue. In the legacy queue, messages wait in a visible list above the chat input and run in order, and each has a "Send now" button that pushes it into the running task as a follow-up. — [Lovable glossary](https://docs.lovable.dev/glossary)
- The original Lovable prompt queue (Feb 2026, third-party changelog) let users stack prompts, reorder or remove them mid-queue, and repeat a prompt up to 50 times. — [Yet Another Changelog](https://www.yet-another-changelog.ai/changelog/lovable-prompt-queue-repeatable-prompts)
- Failure mode: an April 2026 incident had the queue process the first follow-up and leave the second stuck indefinitely. The workaround was to pause the queue and send directly. — [Lovable status incident](https://statuspage.incident.io/lovable/incidents/01KNA4H46ZTT17ER0H72SKJRGH)
- Claude Code: a message queued while Claude works joins the running turn if it reaches Claude there, rather than starting a new turn. Queued messages that start a new turn get their own checkpoint. — [Claude Code interactive mode docs](https://code.claude.com/docs/en/interactive-mode)
- Claude Code: Esc interrupts mid-turn and keeps the work done so far. — [Claude Code keyboard shortcuts](https://code.claude.com/docs/en/interactive-mode). User reports conflict: Enter only queues and Ctrl+C is needed to stop ([claudeissues #36326](https://claudeissues.com/issue/36326-bug-docs-say-enter-interrupts-mid-task-but-it-only-queues-the-message)), and a queued message cannot be removed without Esc interrupting the task ([GitHub issue](https://github.com/anthropics/claude-code/issues/55737)).
- Codex in the ChatGPT mobile app lets you "steer execution, and approve next steps" while the run continues on your own machine. — [OpenAI on X](https://x.com/OpenAI/status/2055016850849993072)
- v0 fixed design-mode edits that "could be queued or applied twice", and empty assistant messages when the agent was stopped. Forum users report the agent stopping with a generic "Something went wrong". — [v0 changelog](https://v0.app/changelog); [Vercel Community](https://community.vercel.com/t/v0-platform-issues-with-github-prs-team-permissions-and-preview-authentication/32987)

**Versioning / undo**
- Claude Code: `/rewind`, or Esc twice on an empty prompt, opens a menu that restores code, conversation or both. Snapshots are kept for the 100 most recent checkpoints per session, and symlinked/hard-linked files are not rewound. — [Claude Code checkpointing docs](https://code.claude.com/docs/en/checkpointing)
- Replit: checkpoints snapshot the whole app state (files, AI conversation context, connected databases) and are made automatically at milestones. "Rollback to here" sits in the Agent tab, and checkpoints appear as Git commits in the Git pane. — [Replit docs: checkpoints and rollbacks](https://docs.replit.com/core-concepts/agent/checkpoints-and-rollbacks)
- A 2026 Replit review headline cites "the database it deleted", a reminder of why database-inclusive rollback matters. — [Javi's Review](https://javisreview.com/review/replit-review-2026/)

**Error surfacing in the running preview**
- Bolt's support docs tell users to open the browser console, reproduce the blank screen and paste the errors into chat. A white screen can be a runtime error Bolt cannot detect automatically. Bolt checks for errors after editing code but "cannot run the app or view the preview", so it can mark a fix done while the page looks unchanged. Suggested prompt: "The preview is not showing, fix this." — [Bolt: Preview issues](https://support.bolt.new/troubleshooting/preview-issues); [Bolt issues](https://support.bolt.new/troubleshooting/issues)
- Each automatic fix attempt in Bolt costs tokens. — [AppStuck, 2026](https://www.appstuck.com/blog/bolt-new-not-working-fix-the-10-most-common-errors-2026) (secondary)
- v0: the common remedy is the "Fix with v0" button, or asking the agent to review console errors. One user says it did not help a deploy failure. — [Vercel Community threads](https://community.vercel.com/t/v0-github-integration-sync-error-preventing-production-deployment-when-branches-are-identical/32478)
- Open-source DeepSite (Hugging Face) added automatic error detection and fixing for previews, with a typed preview-error model. — [DeepSite preview-error.ts](https://huggingface.co/spaces/enzostvs/deepsite/blob/refs%2Fpr%2F290/types/preview-error.ts)

**Parallelism**
- Replit Agent 4 runs several sub-agents in parallel and merges them, and teammates can submit tasks in any order. More parallel agents means faster credit burn. — [ChatForest](https://chatforest.com/builders-log/replit-agent-4-creativity-parallel-agents-effort-pricing/); [bycrawl](https://www.bycrawl.com/blog/replit-agent-4-launch)

### Inferences
- Best-in-class pattern (synthesized from the above):
  1. A message sent mid-run steers the current turn at its next safe stopping point, rather than waiting in a FIFO queue. Lovable deprecated its queue for exactly this.
  2. A visible "queued" state with "Send now" and remove/reorder for anything not yet absorbed.
  3. A Stop that keeps the work done so far.
  4. Automatic checkpoints per turn with rewind of code, conversation or both. Replit extends this to the database.
  5. Errors read from the running preview by the agent itself, not pasted by the user.
- Bolt's own docs and v0's forum show that "agent says fixed but the page is still broken" is the common failure. A builder whose agent reads back the running preview's errors before claiming done would beat both.
- Two failure modes to design against: queue items getting stuck (Lovable incident) and a duplicate send/apply (v0 fix).

### Gaps
- Lovable's "Try to fix" button and any automatic error-fixing loop, and Replit's 2025-era self-testing in a browser: not verified this session (docs.lovable.dev blocked; no Replit result on it).
- Suggested next steps after a build: no source found describing post-build suggestion chips for any product. Background knowledge says Lovable, v0 and Bolt show them, but this is unverified here.
- Gemini AI Studio's error surfacing (console/"fix" button): not found.
- No dated source on the chat-left / preview-right layout or tabbed code/preview/console panels.

## 3. Marketplaces and stores for agents, GPTs and apps: publishing, monetization, discovery, and whether creators get paid

### Takeaway
Poe is the only consumer marketplace found with a working, documented creator payout: a per-message price set by the creator, paid in USD. OpenAI's GPT Store revenue program reportedly never went beyond an invite-only pilot. Custom GPTs are reportedly being retired from 11 Dec 2026. ChatGPT apps cannot sell digital goods in-chat, and external checkout is the route. Google is retiring Gems in favour of shareable Skills with no payouts found. Anthropic's Claude Marketplace is a B2B procurement channel, not a creator payout store.

### Cited Findings

**OpenAI: GPT Store, ChatGPT app directory**
- OpenAI introduced apps in ChatGPT and the Apps SDK. — [OpenAI](https://openai.com/index/introducing-apps-in-chatgpt/)
- The ChatGPT App Directory launched in December 2025 and took third-party submissions. Apps are at chatgpt.com/apps and listed if they meet the developer guidelines. — [VentureBeat](https://venturebeat.com/technology/openai-now-accepting-chatgpt-app-submissions-from-third-party-devs-launches); [DataStudios](https://www.datastudios.org/post/chatgpt-app-directory-and-gpt-store-marketplace-launch-sdk-features-and-platform-evolution); [Moburst](https://www.moburst.com/blog/chatgpt-app-directory-explained-what-brands-need-to-know/)
- Monetization rules: a January 2026 developer-forum thread quotes the docs barring apps that monetize digital products/services in-chat. OpenAI says it is "exploring additional monetization options". External redirects (checkout on your own site) are the main path. Physical goods are a separate case. — [OpenAI Developer Community, Jan 2026](https://community.openai.com/t/chatgpt-app-monetization-apps-sdk/1372343/4)
- A September 2026 third-party guide says OpenAI's monetization docs list external checkout as the generally available route ("Yes, but with limits"). Not verified against OpenAI's docs. — [dforce, 2026](https://dforce.com.ua/en/blog/how-to-build-a-chatgpt-app/); [Snaplama 2026 guide](https://www.snaplama.com/blog/how-to-create-chatgpt-apps-and-monetize-them-complete-2026-guide)
- GPT Store builder revenue: WIRED reportedly found revenue sharing shrank to an invite-only pilot covering a tiny number of developers. One creator with more than 250 published GPTs who was featured at launch was never included. — [llms.blog, "Nobody got paid", ~23 Nov 2026](https://www.llms.blog/posts/nobody-got-paid-what-the-gpt-store-chatgpt-apps-and-claude-marketplace-actually-built) (via search summary only; fetch was blocked)
- The same article says OpenAI's FAQ sets 11 Dec 2026 as the date custom GPTs and their store pages become inaccessible, deferrable only to 28 Feb 2027, and that the migration target is "plugins", which has no payout program. Not verified on OpenAI's own pages; verify before relying on it. — [llms.blog](https://www.llms.blog/posts/nobody-got-paid-what-the-gpt-store-chatgpt-apps-and-claude-marketplace-actually-built)
- Figures such as $0.03 per conversation with a $100/month cap, or a $1,000 monthly minimum, appear only in third-party blogs and were never confirmed. — [Geeky Gadgets](https://www.geeky-gadgets.com/custom-gpt-revenue-program/); [The GPT Shop](https://www.thegptshop.online/blog/openai-gpt-store-revenue-sharing) (low reliability)
- OpenAI's June 2026 move put Codex in ChatGPT with "6 new business plugins", consistent with the plugins direction. — [9to5Mac, 2 Jun 2026](https://9to5mac.com/2026/06/02/openai-putting-codex-inside-chatgpt-app-everywhere-releasing-6-business-plugins/)

**Google: Gems, now Skills**
- Personal Gems became read-only on 17 Nov 2026 and disappear on 17 Dec 2026 (personal accounts 18+). Workspace business/enterprise/nonprofit accounts follow in March 2027 and education in June 2027. — [Mixed News, Oct 2026](https://mixed-news.com/en/gemini-gems-removed-november-skills-canvas-deep-research/); [FelloAI](https://felloai.com/gemini-gems/); [Online Tech Tips](https://www.online-tech-tips.com/google-gemini-gems-to-skills-attachments-sharing/)
- Skills replace Gems and add file integrations and sharing. Recipients install a shared skill and use it in chat, and sharing is managed only on web. As of 1 Oct 2026, skills did not work with Canvas or Deep Research (per Google support, as reported). No monetization was found. — [Mixed News](https://mixed-news.com/en/gemini-gems-removed-november-skills-canvas-deep-research/)

**Anthropic: Claude Marketplace**
- 6 Mar 2026: limited preview with GitLab, Harvey, Lovable, Replit, Rogo and Snowflake. Enterprises apply part of their existing Anthropic spend commitment to partner tools, and Anthropic handles invoicing. One report says Anthropic forgoes the usual marketplace revenue cut at launch. — [SiliconANGLE, 6 Mar 2026](https://siliconangle.com/2026/03/06/anthropic-launches-claude-marketplace/); [VentureBeat](https://venturebeat.com/technology/anthropic-launches-claude-marketplace-giving-enterprises-access-to-claude); [Digital Commerce 360, 16 Mar 2026](https://www.digitalcommerce360.com/2026/03/16/anthropic-launches-claude-b2b-marketplace-enterprise-ai-applications/?noamp=mobile)
- Late Sep 2026: reported as live with more than 2,000 connectors and plugins in three sections (connectors and plugins; agents and products; service partners). Named partners include CrowdStrike, Cursor, Harvey, Legora, Lovable and Snowflake, plus Accenture, BCG and Deloitte. — [gHacks, 27 Sep 2026](https://www.ghacks.net/2026/09/27/anthropic-launches-claude-marketplace-with-more-than-2000-connectors-and-plugins/); [BleepingComputer](https://bleepingcomputer.com/news/artificial-intelligence/anthropic-turns-claude-into-an-ai-marketplace-with-2-000-plus-plugins-and-connectors); [Claude Marketplace](https://claude.com/platform/claude-marketplace)
- 4 Nov 2026: expanded with partner agents and products (more than 25), adding CrowdStrike, Cursor, Factory, Gamma and Vercel. — [Unite.AI](https://unite.ai/anthropic-expands-claude-marketplace-with-partner-agents-and-products); [CryptoBriefing](https://cryptobriefing.com/anthropic-claude-marketplace-crowdstrike-cursor-vercel/)
- Analyst view: the partners already have their own enterprise distribution, so the marketplace must add value beyond a billing route. — [Futurum](https://futurumgroup.com/insights/claude-marketplace-tests-whether-anthropic-can-win-the-procurement-heart/)
- Sources disagree on whether September was a new launch or a broadening of the March preview. — compare [SiliconANGLE](https://siliconangle.com/2026/03/06/anthropic-launches-claude-marketplace/) and [gHacks](https://www.ghacks.net/2026/09/27/anthropic-launches-claude-marketplace-with-more-than-2000-connectors-and-plugins/)

**Poe (Quora): pays creators**
- Creators set a price per message, up to $10,000 per 1,000 messages (meant for expensive API bots). They can change it at will, with up to 24h to take effect. Prices and earnings are in USD. Users see the price in points, charged on top of the base model's cost. — [Poe Creator Monetization FAQs](https://help.poe.com/hc/en-us/articles/21921312368020-Poe-Creator-Monetization-FAQs); [TechCrunch, 9 Apr 2024 (older than mid-2026)](https://techcrunch.com/2024/04/09/poe-introduces-a-price-per-message-revenue-model-for-ai-bot-creators)
- Reported extras: up to $20 per new subscriber a bot drives, and a "tens of millions of dollars" annual payout run rate. A conflicting third-party figure says "over $100,000 paid by mid-2026". Payouts are reportedly monthly, 30-45 days after period close. — [aiwiki Poe](https://aiwiki.ai/wiki/poe_ai_platform); [Perplexity AI Magazine review 2026](https://perplexityaimagazine.com/ai-tools/poe-ai-review-2026/); [usagepricing](https://www.usagepricing.com/blueprint/poe) (secondary, conflicting)
- Poe Premium is listed at $19.99 for 660,000 points/month. Free allowance figures conflict (about 300/day vs about 3,000). — [Essevin 2026](https://essevin.com/blog/poe-pricing-2026-explained-en); [Whizi](https://whizi.io/resources/is-poe-ai-worth-it/)

**Microsoft: Copilot agents store**
- No 2026 source found on a Copilot Agent Store or its monetization. — (search returned only GitHub billing items)

### Inferences
- The consumer "GPT store" model failed to pay creators at scale: an invite-only pilot, then retirement. The industry is moving to installable apps, plugins and skills that monetize through the creator's own checkout (OpenAI) or through enterprise procurement (Anthropic). Poe's per-message pricing is the proven direct-payout design.
- Platform-run payouts tied to usage (Poe) or to a spend commitment (Claude Marketplace) both put the platform in the billing path. OpenAI's external-checkout rule keeps it out. A marketplace that does pay creators must own refunds, fraud and payout compliance. Poe works because the user pays in pre-bought points.
- Retiring Gems (17 Dec 2026) and custom GPTs (reportedly 11 Dec 2026) in the same month means a wave of displaced creators exactly now.

### Gaps
- OpenAI's own page confirming the 11 Dec 2026 custom-GPT retirement and the "plugins" replacement. The llms.blog page was unreachable (host blocked), so this rests on a search summary of one secondary article citing WIRED.
- The WIRED article itself (URL not surfaced).
- Revenue share percentages for any marketplace: none found for the Claude Marketplace, ChatGPT apps or Google Skills. Poe's split is per-message pricing, not a percentage.
- Microsoft Copilot agent store (Microsoft 365 Agent Store) status, publishing flow and monetization: not found.
- Discovery mechanics (ranking, featured lists, search) for each store were not found in dated 2026 sources.
- Mistral, Grok, DeepSeek, Meta AI and Perplexity agent marketplaces: none found.
