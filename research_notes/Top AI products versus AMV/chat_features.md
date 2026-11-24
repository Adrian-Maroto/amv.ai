# Chat experience of the top consumer AI assistants (as of 24 November 2026)

Scope: composer/attach, deep research, voice, model picker, memory, personalization, notifications, empty-chat home - for ChatGPT, Gemini, Claude, Copilot, Perplexity, Meta AI, Grok, DeepSeek, Mistral (Le Chat, now "Mistral Vibe"), Character.ai, plus Manus.

Method and reliability warning (read first):
- Every WebFetch to a primary source failed in this environment (`help.openai.com` and `gemini.google` both returned DNS ENOTFOUND, i.e. not on the session's allowed network list). Everything below comes from WebSearch result summaries. Where a summary quoted an official page (help.openai.com release notes, support.claude.com, support.microsoft.com, perplexity.ai/changelog, api-docs.deepseek.com, x.ai), it is marked **[official]**; everything else is **[secondary]** (press, blogs, aggregators such as Releasebot) and should be re-checked against the official page before it is quoted to users or used to back a list in `docs/RESEARCH.md`.
- The search summaries flagged their own date metadata as inconsistent in several places (e.g. a "Nov 4" ChatGPT entry carrying a 128-day age). Dates below are the dates the sources print.
- Anything dated before mid-2026 is flagged **(pre-mid-2026: possibly outdated)**.
- Several model names in these sources (e.g. "GPT-6.2", "Opus 5.5", "GPT-5.6", "Gemini 3.1 Pro") are reported as found; I could not verify them on a primary page.

## Q1. Per product and per feature: does it exist, how does it work, what are its limits, when was it launched or last changed?

### Takeaway
Every major assistant now has an attach menu, a research mode, some voice, saved memory with a review/edit screen, and a model or effort picker; the differences are in limits and polish. The biggest moves of the last six months are: ChatGPT replaced its voice modes with a single full-duplex "Live" voice (GPT-Live, July 2026; old modes retire 11 Dec 2026) and folded Pulse into Scheduled tasks with push/email notifications (June 2026); Gemini added a reviewable Memory Summary (Nov 2026) and research-by-voice in Gemini Live (Aug 2026); Claude moved memory to categorized, editable topic entries (July 2026); Microsoft retired Deep Research from consumer Copilot (18 Aug 2026); Grok retired its avatar Companions (Jul-Sep 2026); Le Chat was rebranded Mistral Vibe (May 2026).

### Cited Findings

#### ChatGPT (OpenAI)
Composer / attach
- Per-message file limit raised from 10 to 20 files on 13 Feb 2026 (attributed to the ChatGPT release notes); rolling cap of 80 files per 3 hours; Free users 3 uploads/day; caps may be lowered at peak (pre-mid-2026: possibly outdated) — [Fastero, "512 MB a file, 20 per message"](https://fastero.com/blog/chatgpt-file-upload-limits) [secondary]; [ai-toolbox.co upload limits 2026](https://www.ai-toolbox.co/chatgpt-management-and-productivity/chatgpt-file-upload-limits-2026) [secondary]
- Per-file limits: 512 MB per file, 20 MB per image, 2M tokens per text document, 50 MB for spreadsheets; no separate per-message image count published in the uploads FAQ — [Fastero](https://fastero.com/blog/chatgpt-file-upload-limits) [secondary]; [tinypngnow image limits ChatGPT/Claude/Gemini 2026](https://www.tinypngnow.com/blog/chatgpt-claude-gemini-image-upload-limits/) [secondary]
- Projects: 5 files/project on Free, 25 on Go and Plus, 40 on Pro and Business; custom GPTs 10 files lifetime — [Fastero](https://fastero.com/blog/chatgpt-file-upload-limits) [secondary]
- Custom GPTs themselves reportedly retire on 11 Dec 2026 (one source only) — [Android Authority, Nov 2026](https://www.androidauthority.com/openai-retiring-chatgpt-advanced-standard-voice-3733978/) [secondary]; [DEV Community](https://dev.to/crypteasensei/chatgpt-standard-and-advanced-voice-retire-on-december-11-2026-what-switches-to-live-what-still-3f14) [secondary]
- Redesigned mobile app with pinned favorites, 19 Nov 2026 — [Releasebot ChatGPT, Nov 2026](https://releasebot.io/updates/openai/chatgpt) [secondary]

Deep research
- Legacy deep research mode removed 26 Mar 2026, current experience unchanged; 10 Feb 2026 update added more user control and aimed at more accurate, credible reports (pre-mid-2026: possibly outdated) — [ChatGPT release notes](https://help.openai.com/en/articles/6825453-chatgpt-release-notes) [official, via search summary]
- Deep research made available in "ChatGPT Work" and Codex, 9 Sep 2026 — [reconn-ai LLM changelog](https://reconn-ai.com/llm-changelog.php) [secondary]
- GPT-6.2 rolling out in the chat tab for Plus, Pro, Business, Enterprise on 23 Nov 2026 "with better image understanding and web research" — [ChatGPT release notes](https://help.openai.com/en/articles/6825453-chatgpt-release-notes) [official, via search summary]

Voice
- Live Dictation rolling out to all plans on iOS, Android, web and desktop, 18 Nov 2026 — [ChatGPT release notes](https://help.openai.com/en/articles/6825453-chatgpt-release-notes) [official, via search summary]
- Voice rebuilt on 8 Jul 2026 around GPT-Live (a full-duplex model) that can search the web and use memory mid-conversation; a lighter "mini" variant reported for free users — [reconn-ai changelog](https://reconn-ai.com/llm-changelog.php) [secondary]; [Android Authority](https://www.androidauthority.com/openai-retiring-chatgpt-advanced-standard-voice-3733978/) [secondary]
- Announced 10 Nov 2026: Advanced Voice and Standard Voice retire on 11 Dec 2026; users are moved automatically to "Live voice" (GPT-Live); voice-chat history is kept and can be continued by text or voice; OpenAI says voice usage "nearly doubled" since GPT-Live and virtually all voice users are already on it — [ChatGPT release notes](https://help.openai.com/en/articles/6825453-chatgpt-release-notes) [official, via search summary]; [Interesting Engineering](https://interestingengineering.com/ai-robotics/chatgpt-drops-two-voice-modes-december-2026) [secondary]; [Windows Report](https://windowsreport.com/openai-will-retire-chatgpt-advanced-and-standard-voice-in-december-2026/) [secondary]
- Exception: live video (camera) and screen sharing stay on Advanced Voice after 11 Dec because GPT-Live does not support them yet; no date given — [Android Authority](https://www.androidauthority.com/openai-retiring-chatgpt-advanced-standard-voice-3733978/) [secondary]; [DEV Community](https://dev.to/crypteasensei/chatgpt-standard-and-advanced-voice-retire-on-december-11-2026-what-switches-to-live-what-still-3f14) [secondary]

Model picker
- GPT-6.2 in the chat tab for paid plans (23 Nov 2026); "GPT-6.2 Astra and Sol" for Enterprise/Edu (17 Nov 2026) — [ChatGPT release notes](https://help.openai.com/en/articles/6825453-chatgpt-release-notes) [official, via search summary]; [Enterprise and Edu release notes](https://help.openai.com/en/articles/10128477-chatgpt-enterprise-and-edu-release-notes) [official, via search summary]
- I found no source in this pass describing the current picker layout (Auto / Instant / Thinking options) - see Gaps.

Memory
- Memory sources (what ChatGPT used) added for Plus and Pro, 5 May 2026; on 4 Jun 2026 memory was upgraded to keep context current and cut stale or contradictory saved memories, with a reviewable memory summary and sources — [ChatGPT release notes](https://help.openai.com/en/articles/6825453-chatgpt-release-notes) [official, via search summary]

Personalization
- "Base style and tone" dropdown (introduced with GPT-5.1, Nov 2025) with presets reported as Default, Professional, Friendly, Candid, Quirky, Efficient, Cynical, and per one source Nerdy (count disputed: 7 vs 8) (pre-mid-2026: possibly outdated) — [Lilach Bullock, ChatGPT characteristics](https://www.lilachbullock.com/chatgpt-characteristics/) [secondary]; [TechRadar](https://www.techradar.com/ai-platforms-assistants/chatgpt/chatgpts-new-personality-settings-let-you-pick-the-vibe-and-it-ranges-from-corporate-calm-to-chaotic-bestie) [secondary]
- Four "characteristics" sliders below the preset - Warmth, Enthusiasm, Headers and lists, Emoji - each More / Less / Default; launched Dec 2025; they change style, not capability (pre-mid-2026: possibly outdated) — [TechCrunch, 20 Dec 2025](https://techcrunch.com/2025/12/20/openai-allows-users-to-directly-adjust-chatgpts-warmth-and-enthusiasm) [secondary]; [Engadget](https://www.engadget.com/ai/you-can-now-tweak-how-warm-and-enthusiastic-chatgpts-responses-are-204003009.html) [secondary]
- Path: profile icon -> Personalization -> Base style and tone — [withclair.io](https://withclair.io/blog/chatgpt-personality-settings) [secondary]

Notifications / scheduled results
- Pulse sunset announced 17 Jun 2026, proactive updates moved into Scheduled tasks (Pro kept Pulse 14 more days); Scheduled tasks rolling out to Go, Plus, Pro, Business, Enterprise on web and mobile; Free gets a limited number of active tasks; a "Scheduled" page in the sidebar manages them; notification delivery set in Settings (push, email, or both per blogs) — [Digit](https://www.digit.in/news/general/openai-is-retiring-chatgpt-pulse-and-replacing-it-with-scheduled-tasks-here-is-why.html) [secondary]; [ITBrief](https://itbrief.co.nz/story/openai-expands-chatgpt-scheduled-tasks-with-new-hub) [secondary]; [AI Insiders](https://aiinsiders.net/article/openai-retires-chatgpt-pulse-unifies-tasks-into-one-hub) [secondary]
- Some sources say tasks can monitor web pages for changes; no official page found — [sqmagazine](https://sqmagazine.co.uk/chatgpt-automate-tasks-send-smart-alerts/) [secondary]

Other Nov 2026 context: Wallet for US Pro with biometric purchase approval (13 Nov); "Space" collaborative pages/presentations global for Plus 18+ (20 Nov) — [Releasebot](https://releasebot.io/updates/openai/chatgpt) [secondary]

#### Google Gemini
Composer / attach
- Gemini app: 10 files per prompt ("subject to availability"); files inside an uploaded folder or ZIP each count toward the 10; 100 MB per non-video file, 2 GB per video; the count cap is the same across plans, context size differs (free ~48 pages vs AI Pro ~1,500 pages, per one source) — [whizi.io](https://whizi.io/resources/gemini-file-upload-limit/) [secondary]; [fast.io attachment limit](https://fast.io/resources/gemini-attachment-limit/) [secondary]; [mentalclone](https://www.mentalclone.com/blog/gemini-file-upload-limit) [secondary]

Deep research
- Deep Research can draw on Gmail, Drive and Chat for reports — [Gemini Drops](https://gemini.google/gemini-drops/) [official, via search summary]
- Deep Research agent versions (Apr 2026) with collaborative planning, visualization, MCP servers and File Search (API side) (pre-mid-2026: possibly outdated) — [Gemini API changelog](https://ai.google.dev/gemini-api/docs/changelog) [official, via search summary]
- Aug 2026: Gemini Live can start a Deep Research report by voice and then discuss the result; Notebooks came to AI Mode — [9to5Google, 19 Aug 2026](https://9to5google.com/2026/08/19/gemini-app-ai-mode-study-tools/) [secondary]

Voice
- Gemini Live updated (Jun 2026) to use memories of past chats and info from some Connected Apps — [Android Authority](https://www.androidauthority.com/gemini-live-memory-personal-intelligence-3679235/) [secondary]
- Gemini on Apple CarPlay; CarPlay conversations sync to the iPhone Gemini app (Nov 2026) — [The Mobile Indian](https://themobileindian.com/news/google-releases-november-2026-pixel-drop-with-new-features-also-announces-gemini-on-apple-carplay) [secondary]
- Pixel-only (Nov 2026 Pixel Drop, from 10 Nov): Gemini places calls from your own number in the US (public beta, user can take over); Gemini Call Screen on Pixel 11; task automation in approved apps (groceries, rides, delivery, reservations) expanded to India, Japan, UK — [9to5Google, 10 Nov 2026](https://9to5google.com/2026/11/10/november-2026-pixel-feature-drop/) [secondary]; [Android Authority](https://www.androidauthority.com/google-pixel-drop-november-2026-all-new-features-3733178/) [secondary]

Model picker
- Model-specific data found only for the API/Vertex (Gemini 3.1 Pro, 3,000 files per prompt on Vertex - not the consumer app) — [Vertex AI Gemini 3.1 Pro docs](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/3-1-pro) [official]. Consumer picker layout: see Gaps.

Memory
- "Personal Intelligence" (personal context for tailored answers) launched 20 Jan 2026; "past chats" renamed "memories" in Mar 2026; Nov 2026 added "Memory Summary" to review and edit what Gemini remembers across web and mobile; import of personal context, preferences and full chat history from other AI apps (pre-mid-2026 items flagged) — [Gemini release notes](https://gemini.google/release-notes/) [official, via search summary]; [Releasebot Gemini, Nov 2026](https://releasebot.io/updates/google/gemini) [secondary]

Personalization / notifications / home screen: no 2026 source found in this pass - see Gaps.

#### Claude (Anthropic)
Composer / attach
- No source found stating a per-message file count for the consumer app; sources list PDFs, text/code and images, and up to a 1M-token context depending on model — [buildfastwithai Claude Research review](https://www.buildfastwithai.com/ai-tools/claude-research) [secondary]; [ai-toolbox.co Claude Research 2026](https://www.ai-toolbox.co/claude-management-and-productivity/how-to-use-claude-research-2026) [secondary]

Research
- Research searches the web plus connected tools; available on paid plans (Pro, Max, Team, Enterprise; one guide also lists "Ultra"), not Free; uses usage limits faster than a normal chat; one guide says it runs on the top model regardless of the picker (unverified) — [ai-toolbox.co](https://www.ai-toolbox.co/claude-management-and-productivity/how-to-use-claude-research-2026) [secondary]

Voice
- Consumer voice mode exists; Anthropic's support article says to start a chat in voice mode with memory off, turn memory off first then tap the voice button; an unofficial site says voice is not offered in incognito chats (dated to an Oct 2026 change) — [support.claude.com, chat search and memory](https://support.claude.com/en/articles/11817273-use-claude-s-chat-search-and-memory-to-build-on-previous-context) [official]; [weloveclaude.com incognito](https://www.weloveclaude.com/features/incognito-mode) [secondary]
- Other voice claims (continuous conversation, preset voices) are from low-quality blogs and unverified — [workingnotworking](https://workingnotworking.com/claude-voice-mode-2026-ai-voice-conversations/) [secondary, low confidence]

Model picker / thinking
- Sources conflict: one says "adaptive reasoning" with the 4.6 generation (Feb 2026) replaced the extended-thinking toggle; another describes a newer release replacing the binary on/off toggle; neither verified against Anthropic docs — [aiforanything](https://aiforanything.io/blog/claude-extended-thinking-guide-2026) [secondary]; [beginnersinai](https://beginnersinai.org/claude-extended-thinking-guide/) [secondary]

Memory
- Rollout: Team 11 Sep 2025, Max 23 Oct 2025 (Pro over the next two weeks), every plan including Free 2 Mar 2026 (pre-mid-2026: possibly outdated) — [Syracuse ITS, "Claude has a memory"](https://its.syr.edu/claude-has-a-memory-heres-how-to-use-it/) [secondary]; [justinmckelvey.com](https://justinmckelvey.com/blog/claude-memory) [secondary]
- 10 Jul 2026: memory changed from a daily summary to "a set of individual, categorized entries" that Claude reads and updates; users can view, edit, delete, pause and reset memory topics; Aug 2026: Claude chat and Cowork share one memory — [lumichats](https://lumichats.com/blog/claude-memory-2026-complete-guide-how-to-use) [secondary]; [unabyss](https://unabyss.com/blog/claude-memory-feature) [secondary]
- Memory import (including from ChatGPT) and export since Mar 2026, labelled experimental — [five.reviews](https://www.five.reviews/ai-tools/claude-memory/) [secondary]
- Chat search vs memory: incognito chats are never pulled into past-chat search; chats with memory off still stay in history and are searchable; incognito chats are included in organizational data exports — [support.claude.com](https://support.claude.com/en/articles/11817273-use-claude-s-chat-search-and-memory-to-build-on-previous-context) [official]
- Incognito chats reportedly kept 30 days, not used for training — [secria.me](https://secria.me/blog/is-claude-private/) [secondary]; [ai-toolbox.co incognito](https://www.ai-toolbox.co/claude-management-and-productivity/claude-incognito-chats-2026) [secondary]

Personalization / notifications / home: no 2026 source found - see Gaps.

#### Microsoft Copilot (consumer)
- Deep Research retired from the consumer Copilot app starting 18 Aug 2026; consumers are pointed to "Researcher", limited to Microsoft 365 Premium; saved research stays available — [Microsoft Support, Deep Research in Microsoft Copilot](https://support.microsoft.com/en-us/topic/deep-research-in-microsoft-copilot-d958a5d3-4758-493e-a381-63f0815a97bd) [official]
- Model picker (Microsoft 365 Copilot Chat, i.e. work): Quick Response / Think Deeper selector; GPT-5.2 added 27 Jan 2026, later "GPT 5.5 Thinking"; one blog says the picker briefly showed generic options (Auto, Quick response, Think deeper, plus a third-party model) and model names returned 8 Jul 2026; Researcher (Aug 2026) lets users choose model and mode per task — [Microsoft 365 Copilot release notes](https://learn.microsoft.com/en-us/microsoft-365/copilot/release-notes) [official]; [Chris Menard](https://chrismenardtraining.com/post/microsoft-365-copilot-model-picker-changed-where-did-gpt-5-5-and-the-other-models-go/) [secondary]; [Crayon "What's new" Aug 2026 PDF](https://apac.crayonchannel.com/app/uploads/2026/09/Whats-New-in-Copilot-August-11.pdf) [secondary]
- Voice + vision: show Copilot your screen or phone camera and ask about it by voice — [Crayon Aug 2026 PDF](https://apac.crayonchannel.com/app/uploads/2026/09/Whats-New-in-Copilot-August-11.pdf) [secondary]
- Memory, Groups (up to 32 people, US first), Mico avatar, Learn Live, connectors to OneDrive/Gmail/Google Drive/Calendar: these are from the Oct 2025 Fall Release; memory editable/deletable by the user; no 2026 consumer update found (pre-mid-2026: possibly outdated) — [Search Engine Journal](https://www.searchenginejournal.com/microsoft-updates-copilot-with-memory-search-connectors-more/559129/) [secondary]; [WindowsForum](https://windowsforum.com/threads/microsoft-copilot-fall-release-mico-avatar-groups-and-memory.386126/) [secondary]

#### Perplexity
- Deep Research moved onto Opus 4.6 (13 Feb 2026; some secondaries say 4.5); memory works inside Model Council, pulling personalized context for each model (pre-mid-2026: possibly outdated) — [Perplexity changelog, 13 Feb 2026](https://www.perplexity.ai/changelog/what-we-shipped---february-13-2026) [official]
- Comet voice mode moved to a realtime speech model, "over 25% more reliable interactions", for everyone on Comet desktop and Android; Perplexity Computer launched; Perplexity on Galaxy S26 (27 Feb 2026); voice can open pages and take actions in Comet (pre-mid-2026) — [Perplexity changelog, 27 Feb 2026](https://www.perplexity.ai/changelog/what-we-shipped---february-27-2026) [official]; [Comet release 2.25.26](https://www.perplexity.ai/comet/whats-new/releases-2.25.26) [official]
- Computer to all Pro (13 Mar 2026); deeper Deep Research inside Computer with command panel and enterprise controls (18/19 Jun 2026, date disputed); "Brain" self-improving memory building a private context graph across sessions, connectors, files and past decisions (13 Jul 2026); Computer remembers past work, switches models mid-task, publishes websites (27 Jul 2026) — [releases.sh Perplexity](https://releases.sh/perplexity) [secondary]; [beginnersinai](https://beginnersinai.org/whats-new-perplexity-2026/) [secondary]

#### Meta AI (and Meta's "Muse" app)
- 5 Nov 2026: voice conversations and expressive avatars rolling out in the Muse app in the US on mobile, web and Mac; glasses and the "Muse Charm" device "coming soon" — [Android Headlines, Nov 2026](https://www.androidheadlines.com/2026/11/meta-real-time-voice-mode-muse-ai.html) [secondary]
- 6 Nov 2026: model versions with "Active Memory" (remembers useful information from previous conversations) and "Active Focus" (gives up less on tasks) — [NewsBytes](https://www.newsbytesapp.com/news/science/meta-ai-muse-get-memory-and-focus-upgrade/story) [secondary]; [The Swipe Up](https://www.theswipeup.com/2026/11/with-latest-update-meta-ai-will-forget.html) [secondary]
- Real-time voice with memory reportedly moved to a paid "Meta One Plus" tier ($14.99/mo), free keeps basic voice input without memory (low confidence) — [freeainews](https://freeainews.com/news/meta-ai-subscription-meta-one-plus-2026/) [secondary]

#### Grok (xAI)
- Grok release notes: edit saved memories from a summary in Settings; two new voices (Aurora, Liora); voice mode screen sharing on iOS and Android (exact dates not captured) — [grok.com release notes](https://grok.com/release-notes) [official, via search summary]
- Persistent cross-session memory launched 2026 — [allthings-elon](https://www.allthings-elon.com/articles/grok-persistent-memory-personalized-ai-sessions-2026) [secondary]
- 24 Jul 2026: xAI said the 3D avatar Companions (Ani, Mika, Valentine, Rudi) would be retired; tab removed early Sep 2026 (1 vs 7 Sep disputed); chats and saved memories kept, avatar and companion real-time voice removed — [roborhythms](https://www.roborhythms.com/grok-companions-discontinued/) [secondary]; [sloane.world](https://www.sloane.world/guides/grok-companions-shutting-down-2026) [secondary]
- Grok Build (coding CLI, not the consumer app): memory GA 19 Sep 2026; memory is an on/off switch (12 Oct 2026) — [x.ai Grok Build changelog](https://x.ai/build/changelog) [official]

#### DeepSeek
- Consumer app features: web search, DeepThink mode, file upload and text extraction (Jan 2025 launch; pre-mid-2026: possibly outdated) — [DeepSeek, Introducing DeepSeek App](https://api-docs.deepseek.com/news/news250115/) [official]
- 13 Nov 2026: the app's capabilities opened to developers via API - search (with citations, web or image results), file input (PDF, Office, images parsed into context), URL reading, safety checks, voice; "deep thinking search" searches and reads pages throughout multi-step reasoning; separate Search, Fetch, OCR, ASR, TTS APIs — [DeepSeek, "The full DeepSeek App experience, now via API"](https://api-docs.deepseek.com/news/news261113/) [official]
- Model naming conflict: API release names V4.1 Flash; a 2026 guide says DeepThink runs on V4-Pro — [chatbot.gallery](https://chatbot.gallery/guide/deepseek) [secondary]

#### Mistral (Le Chat -> Mistral Vibe)
- May 2026: Le Chat rebranded "Mistral Vibe", a unified agent for productivity and coding — [Wikipedia, Mistral Vibe](https://en.wikipedia.org/wiki/Mistral_Vibe) [secondary]; [MRKT3.0 tested](https://mrkt30.com/what-happened-to-le-chat-mistrals-vibe-rebrand-tested-2026/) [secondary]
- Deep Research is now a Skill in Work; Agents, Deep Research, Memories still available in "Vibe Chat (legacy)"; memories moved into an "Agentic Knowledge Base" (public preview), on by default, saved on request ("Remember that...") or automatically; one source says a 500-memory cap — [aiagentslist Vibe review](https://www.aiagentslist.io/agents/mistral-vibe) [secondary]; [kevinwelter.com](https://kevinwelter.com/en/blog/mistral-le-chat) [secondary]
- Voice input on Voxtral; one review says input only, no real-time conversational voice (conflicts with 2025 launch coverage of voice mode) — [theairankings](https://theairankings.com/mistral/le-chat/) [secondary]; contradicted by [scienceai.news (2025)](https://scienceai.news/article/mistral-ais-le-chat-gets-major-upgrade-with-deep-research-voice-mode-and-project-organization/) [secondary]

#### Character.ai
- May 2026 Memory screen: Story Memory, pinned Facts (carry across chats; reportedly c.ai+), usage meter - curated, not automatic; Apr 2026 PipSqueak 2 default model and Lorebook; Mar 2026 Imagine Gallery (pre-mid-2026) — [affiny.blog memory](https://affiny.blog/features/character-ai-memory/) [secondary]; [aicompanionpick](https://www.aicompanionpick.com/character-ai-launches-new-features-in-2026-full-breakdown) [secondary]
- Character Calls: two-way real-time voice; free vs c.ai+ disputed — [affiny.blog voice](https://affiny.blog/features/character-ai-voice/) [secondary]
- Under-18 restrictions referenced in 2026 reviews — [MyPresio review](https://mypresio.com/blog/character-ai-review-2026) [secondary]

#### Manus (more relevant than Character.ai as a productivity peer)
- Manus 2.0 reportedly launched 28 Sep 2026: new agent harness, event-triggered automations, Cloud Computers, video editor; 1.6 added Chat Mode and Wide Research; web app builder, slides/PPTX, Plan Mode, Slack/WhatsApp/Telegram — [nxcode Manus review, Nov 2026](https://www.nxcode.io/resources/news/manus-ai-review-2026) [secondary]; [kanerika](https://kanerika.com/blogs/manus-ai/) [secondary]

### Inferences
- The industry default composer limit is now in the 10-20 range: ChatGPT 20 files/message, Gemini 10 files/prompt. AMV's 20-photo refusal (task #103) matches the ChatGPT ceiling, which is the highest documented consumer cap found.
- Voice is converging on one full-duplex mode that can search and use memory mid-conversation (ChatGPT GPT-Live, Gemini Live with memory and Deep Research). Even OpenAI has not yet carried camera and screen share into its new voice model, so camera/screen share is a separate, harder capability; Gemini Live, Grok and Copilot advertise it.
- Memory has converged on three controls: an editable summary/list (ChatGPT memory summary Jun 2026, Gemini Memory Summary Nov 2026, Claude categorized topics Jul 2026, Grok memory summary in Settings), a "which memories were used" source view (ChatGPT, May 2026), and a temporary/incognito chat excluded from history search (Claude, documented). Import from rivals is now standard (Gemini, Claude).
- Notifications for finished work are being merged into scheduled tasks rather than a separate feed: ChatGPT killed Pulse in favour of Scheduled tasks with push/email. A bell/inbox for finished tasks plus push is therefore the expected baseline, not a differentiator.
- Deep research is being split by tier: Microsoft pulled it from consumer Copilot entirely, Claude gates it to paid plans, Mistral turned it into a skill. A free research mode is becoming rarer.

### Gaps
- Official pages could not be fetched (help.openai.com, gemini.google DNS-blocked). The session's network settings would have to allow those hosts to verify dates and wording.
- Current ChatGPT model picker layout (Auto/Instant/Thinking, effort levels, which models Free sees) - not found in 2026 sources.
- Gemini consumer model picker (Fast / Thinking / Pro naming) and current Deep Research quotas - not found.
- Claude: per-message file and image count, current model list and thinking control, personalization ("what should Claude call you", occupation, styles) and notifications - not found in 2026 sources.
- Empty-chat home screens (greeting text, suggestion chips, disclaimer wording) for every product - no 2026 source found. From pre-cutoff recollection only (unsourced, do not cite): ChatGPT shows a centred prompt like "What's on your mind today?" / "Ready when you are." with a one-line "ChatGPT can make mistakes. Check important info." disclaimer; Gemini greets "Hello, <name>" with suggestion chips and "Gemini can make mistakes, so double-check it"; Claude shows a time-of-day greeting with the person's name. These need screenshots or a 2026 source.
- Personalization fields ("what should we call you", occupation, "more about you") - only ChatGPT's tone presets/sliders were sourced; the other products' fields were not found.
- In-app notification inboxes/bells: no source for Gemini, Claude, Perplexity, Copilot, Grok in 2026.
- Copilot consumer memory, voice and model picker in 2026: only the Oct 2025 Fall Release and Microsoft 365 (work) notes were found.
- DeepSeek memory/voice/personalization in the consumer app: no source found; probably absent but unconfirmed.
- Meta AI: Muse vs Meta AI app naming and what is in the free tier are unclear in the sources.
- Several reported model names (GPT-6.2, GPT-5.6, Opus 5.5, Gemini 3.1 Pro) and Perplexity "Brain" figures could not be verified on primary pages.

## Q2. Which product is best-in-class for each feature, and what specifically makes it so?

### Takeaway
On the evidence found: ChatGPT leads composer limits, voice and personalization; Gemini leads research integration with personal data and research-by-voice; Claude leads memory transparency and privacy controls (documented incognito exclusion, editable categorized topics); Perplexity leads research with model choice and cross-session "Brain" memory; ChatGPT leads notifications via Scheduled tasks. These are judgements on incomplete, mostly secondary evidence.

### Cited Findings
- Composer: ChatGPT - 20 files per message (double Gemini's 10), 512 MB per file, 80 files per 3 hours — [Fastero](https://fastero.com/blog/chatgpt-file-upload-limits); Gemini 10 per prompt with folder/ZIP files each counted — [whizi.io](https://whizi.io/resources/gemini-file-upload-limit/)
- Deep research: Gemini - reports grounded in Gmail/Drive/Chat — [Gemini Drops](https://gemini.google/gemini-drops/); started and discussed by voice in Gemini Live (Aug 2026) — [9to5Google](https://9to5google.com/2026/08/19/gemini-app-ai-mode-study-tools/). Perplexity - Deep Research on a top third-party model and inside Computer with a command panel — [Perplexity changelog](https://www.perplexity.ai/changelog/what-we-shipped---february-13-2026); [releases.sh](https://releases.sh/perplexity). Copilot is the negative example: removed for consumers 18 Aug 2026 — [Microsoft Support](https://support.microsoft.com/en-us/topic/deep-research-in-microsoft-copilot-d958a5d3-4758-493e-a381-63f0815a97bd)
- Voice: ChatGPT - full-duplex GPT-Live with web search and memory mid-conversation, usage nearly doubled, plus Live Dictation on every plan and platform (18 Nov 2026) — [Android Authority](https://www.androidauthority.com/openai-retiring-chatgpt-advanced-standard-voice-3733978/); [ChatGPT release notes](https://help.openai.com/en/articles/6825453-chatgpt-release-notes). For camera/screen share specifically, ChatGPT's new voice lacks it — same source; Grok has voice screen sharing on iOS/Android — [grok.com release notes](https://grok.com/release-notes); Copilot has screen/camera with voice — [Crayon PDF](https://apac.crayonchannel.com/app/uploads/2026/09/Whats-New-in-Copilot-August-11.pdf)
- Model picker: Perplexity and Microsoft Researcher are the multi-vendor pickers (Perplexity Model Council; Researcher chooses model and mode per task) — [Perplexity changelog](https://www.perplexity.ai/changelog/what-we-shipped---february-13-2026); [Microsoft 365 Copilot release notes](https://learn.microsoft.com/en-us/microsoft-365/copilot/release-notes)
- Memory: Claude - categorized topic entries the user can view/edit/delete/pause/reset — [lumichats](https://lumichats.com/blog/claude-memory-2026-complete-guide-how-to-use); documented incognito exclusion from past-chat search — [support.claude.com](https://support.claude.com/en/articles/11817273-use-claude-s-chat-search-and-memory-to-build-on-previous-context). ChatGPT - memory sources show what was used, and staleness cleanup — [ChatGPT release notes](https://help.openai.com/en/articles/6825453-chatgpt-release-notes)
- Personalization: ChatGPT - preset personality plus four independent sliders (warmth, enthusiasm, headers/lists, emoji) — [TechCrunch](https://techcrunch.com/2025/12/20/openai-allows-users-to-directly-adjust-chatgpts-warmth-and-enthusiasm)
- Notifications: ChatGPT - one Scheduled page, push and/or email when a scheduled result is ready, on Go and above — [ITBrief](https://itbrief.co.nz/story/openai-expands-chatgpt-scheduled-tasks-with-new-hub); [Digit](https://www.digit.in/news/general/openai-is-retiring-chatgpt-pulse-and-replacing-it-with-scheduled-tasks-here-is-why.html)

### Inferences
- For AMV, the bars to clear are: 20 attachments/message with thumbnails (met per task #103); a reviewable, editable memory list with a "what was used for this answer" view and a temporary chat excluded from memory and search (ChatGPT + Claude combined); tone presets plus independent sliders (ChatGPT); a Scheduled page whose results arrive by bell plus push/email (ChatGPT).
- Being honest about absent capabilities is itself competitive: ChatGPT states plainly that video/screen share stays on the old voice model, and Microsoft publishes a retirement date for Deep Research. AMV's "degrade honestly" directive matches what the leaders do.
- No product in these sources was best-in-class for the empty-chat home screen on evidence; that judgement needs screenshots.

### Gaps
- No head-to-head benchmark or dated reviewer comparison of research-report quality, voice latency, or memory accuracy across products was found in this pass.
- Best-in-class for the empty home screen and for in-app notification inboxes cannot be judged without screenshots or 2026 sources.
- Character.ai and Meta AI memory/voice claims rest on low-confidence blogs; they were not considered for best-in-class.
