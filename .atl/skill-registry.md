# Skill Registry

Generated for `vocero-crm` during SDD initialization on 2026-09-23.

This file is an index only. Each `SKILL.md` path is the source of truth and must
be read before invoking that skill. Project-level skills take precedence over
user-level duplicates. SDD phase skills, `_shared`, and `skill-registry` are
omitted because they are orchestration/infrastructure skills rather than
delegation targets.

## Project skills

| Skill | Trigger / description | Scope | Path |
|---|---|---|---|
| loop-sdd | Execute an objective end-to-end through Discover → Plan → Execute → Verify → Iterate; use for goal-oriented implementation or `/loop-sdd`. | project | `C:\Users\Edwin\Desktop\Trabajos\vocero-crm\.claude\skills\loop-sdd\SKILL.md` |
| speckit-agent-context-update | Refresh the managed Spec Kit section in the coding agent context file. | project | `C:\Users\Edwin\Desktop\Trabajos\vocero-crm\.claude\skills\speckit-agent-context-update\SKILL.md` |
| speckit-analyze | Perform non-destructive cross-artifact consistency and quality analysis across spec.md, plan.md, and tasks.md. | project | `C:\Users\Edwin\Desktop\Trabajos\vocero-crm\.claude\skills\speckit-analyze\SKILL.md` |
| speckit-checklist | Generate a custom checklist for the current feature based on user requirements. | project | `C:\Users\Edwin\Desktop\Trabajos\vocero-crm\.claude\skills\speckit-checklist\SKILL.md` |
| speckit-clarify | Identify underspecified areas in the current feature spec and encode answers back into the spec. | project | `C:\Users\Edwin\Desktop\Trabajos\vocero-crm\.claude\skills\speckit-clarify\SKILL.md` |
| speckit-constitution | Create or update the project constitution and keep dependent templates in sync. | project | `C:\Users\Edwin\Desktop\Trabajos\vocero-crm\.claude\skills\speckit-constitution\SKILL.md` |
| speckit-git-commit | Auto-commit changes after a Spec Kit command completes. | project | `C:\Users\Edwin\Desktop\Trabajos\vocero-crm\.claude\skills\speckit-git-commit\SKILL.md` |
| speckit-git-feature | Create a feature branch with sequential or timestamp numbering. | project | `C:\Users\Edwin\Desktop\Trabajos\vocero-crm\.claude\skills\speckit-git-feature\SKILL.md` |
| speckit-git-initialize | Initialize a Git repository with an initial commit. | project | `C:\Users\Edwin\Desktop\Trabajos\vocero-crm\.claude\skills\speckit-git-initialize\SKILL.md` |
| speckit-git-remote | Detect the Git remote URL for GitHub integration. | project | `C:\Users\Edwin\Desktop\Trabajos\vocero-crm\.claude\skills\speckit-git-remote\SKILL.md` |
| speckit-git-validate | Validate that the current branch follows feature branch naming conventions. | project | `C:\Users\Edwin\Desktop\Trabajos\vocero-crm\.claude\skills\speckit-git-validate\SKILL.md` |
| speckit-implement | Execute the implementation plan by processing tasks defined in tasks.md. | project | `C:\Users\Edwin\Desktop\Trabajos\vocero-crm\.claude\skills\speckit-implement\SKILL.md` |
| speckit-plan | Execute the implementation planning workflow using the plan template. | project | `C:\Users\Edwin\Desktop\Trabajos\vocero-crm\.claude\skills\speckit-plan\SKILL.md` |
| speckit-specify | Create or update a feature specification from a natural-language feature description. | project | `C:\Users\Edwin\Desktop\Trabajos\vocero-crm\.claude\skills\speckit-specify\SKILL.md` |
| speckit-tasks | Generate actionable, dependency-ordered tasks from the available design artifacts. | project | `C:\Users\Edwin\Desktop\Trabajos\vocero-crm\.claude\skills\speckit-tasks\SKILL.md` |
| speckit-taskstoissues | Convert existing tasks into actionable, dependency-ordered GitHub issues. | project | `C:\Users\Edwin\Desktop\Trabajos\vocero-crm\.claude\skills\speckit-taskstoissues\SKILL.md` |
| whatsapp-meta-app-review | Prepare, debug, and resubmit Meta App Review for a WhatsApp SaaS. | project | `C:\Users\Edwin\Desktop\Trabajos\vocero-crm\.claude\skills\whatsapp-meta-app-review\SKILL.md` |
| whatsapp-saas-meta-infra | Implement and troubleshoot WhatsApp SaaS infrastructure on Meta Graph API and WhatsApp Cloud API. | project | `C:\Users\Edwin\Desktop\Trabajos\vocero-crm\.claude\skills\whatsapp-saas-meta-infra\SKILL.md` |

## User skills

| Skill | Trigger / description | Scope | Path |
|---|---|---|---|
| branch-pr | Create Gentle AI pull requests with issue-first checks. | user | `C:\Users\Edwin\.agents\skills\branch-pr\SKILL.md` |
| chained-pr | Split oversized changes into chained PRs that protect review focus. | user | `C:\Users\Edwin\.agents\skills\chained-pr\SKILL.md` |
| cognitive-doc-design | Design docs that reduce cognitive load for guides, READMEs, RFCs, onboarding, architecture, or review-facing docs. | user | `C:\Users\Edwin\.agents\skills\cognitive-doc-design\SKILL.md` |
| comment-writer | Write warm, direct collaboration comments for PRs, issues, reviews, Slack, or GitHub. | user | `C:\Users\Edwin\.agents\skills\comment-writer\SKILL.md` |
| connect-recommend | Recommend Stripe Connect patterns for marketplaces, payouts, onboarding, KYC, split payments, or connected accounts. | user | `C:\Users\Edwin\.agents\skills\connect-recommend\SKILL.md` |
| connect-required-verification-information | Determine required Stripe Connect verification information, documents, and business details. | user | `C:\Users\Edwin\.agents\skills\connect-required-verification-information\SKILL.md` |
| context7-mcp | Retrieve current documentation and examples for libraries, frameworks, APIs, and SDKs. | user | `C:\Users\Edwin\.agents\skills\context7-mcp\SKILL.md` |
| docs | Create or edit living shared documents when the user explicitly asks for a document, page, memo, spec, PRD, runbook, or write-up. | user | `C:\Users\Edwin\.claude\skills\synced\f3decb59-35e6-407c-9bca-2a19d40ab133_2ab99a90-3c81-49cf-a00f-863ce7625a73\docs\SKILL.md` |
| docx | Create, read, edit, or manipulate Word documents and templates. | user | `C:\Users\Edwin\.claude\skills\synced\f3decb59-35e6-407c-9bca-2a19d40ab133_2ab99a90-3c81-49cf-a00f-863ce7625a73\docx\SKILL.md` |
| find-docs | Retrieve current documentation, API references, and examples for developer technologies. | user | `C:\Users\Edwin\.agents\skills\find-docs\SKILL.md` |
| find-skills | Discover and install agent skills when the user asks how to do something that may have an installable skill. | user | `C:\Users\Edwin\.agents\skills\find-skills\SKILL.md` |
| gentle-ai-bench | Author and verify Gentle AI bench journeys and driven execution. | user | `C:\Users\Edwin\.agents\skills\gentle-ai-bench\SKILL.md` |
| go-testing | Apply focused Go testing patterns, including coverage and Bubbletea teatest/golden files. | user | `C:\Users\Edwin\.agents\skills\go-testing\SKILL.md` |
| import-memory | Import a memory export from another AI assistant conversationally and additively. | user | `C:\Users\Edwin\.claude\skills\synced\f3decb59-35e6-407c-9bca-2a19d40ab133_2ab99a90-3c81-49cf-a00f-863ce7625a73\import-memory\SKILL.md` |
| insforge | Use InsForge or @insforge/sdk for application backend features and integrations. | user | `C:\Users\Edwin\.agents\skills\insforge\SKILL.md` |
| insforge-cli | Use InsForge CLI for backend, infrastructure, SQL, migrations, RLS, functions, storage, deployments, secrets, and diagnostics. | user | `C:\Users\Edwin\.agents\skills\insforge-cli\SKILL.md` |
| insforge-debug | Diagnose InsForge failures, auth issues, RLS, realtime, performance, and readiness problems. | user | `C:\Users\Edwin\.agents\skills\insforge-debug\SKILL.md` |
| insforge-integrations | Wire external auth providers or the OKX x402 payment facilitator into InsForge. | user | `C:\Users\Edwin\.agents\skills\insforge-integrations\SKILL.md` |
| issue-creation | Create and triage GitHub issues from repository evidence. | user | `C:\Users\Edwin\.agents\skills\issue-creation\SKILL.md` |
| judgment-day | Run an explicit blind dual review with bounded fix and re-judgment rounds. | user | `C:\Users\Edwin\.agents\skills\judgment-day\SKILL.md` |
| morning | Render or schedule the user's morning brief when explicitly requested. | user | `C:\Users\Edwin\.claude\skills\synced\f3decb59-35e6-407c-9bca-2a19d40ab133_2ab99a90-3c81-49cf-a00f-863ce7625a73\morning\SKILL.md` |
| pdf | Read, create, edit, combine, split, or otherwise manipulate PDF files. | user | `C:\Users\Edwin\.claude\skills\synced\f3decb59-35e6-407c-9bca-2a19d40ab133_2ab99a90-3c81-49cf-a00f-863ce7625a73\pdf\SKILL.md` |
| pptx | Read, create, edit, or manipulate PowerPoint presentations. | user | `C:\Users\Edwin\.claude\skills\synced\f3decb59-35e6-407c-9bca-2a19d40ab133_2ab99a90-3c81-49cf-a00f-863ce7625a73\pptx\SKILL.md` |
| rdd-defect-workflow | Guide receipt-driven development, review authority, correction/recovery, delivery gates, and bounded review defects. | user | `C:\Users\Edwin\.agents\skills\rdd-defect-workflow\SKILL.md` |
| skill-creator | Create, modify, improve, and evaluate agent skills. | user | `C:\Users\Edwin\.agents\skills\skill-creator\SKILL.md` |
| skill-improver | Audit and upgrade existing LLM-first skills. | user | `C:\Users\Edwin\.agents\skills\skill-improver\SKILL.md` |
| stripe-apps | Build, modify, or review Stripe Apps and Dashboard extensions. | user | `C:\Users\Edwin\.agents\skills\stripe-apps\SKILL.md` |
| stripe-best-practices | Guide Stripe integration decisions for payments, Connect, billing, tax, Treasury, webhooks, and security. | user | `C:\Users\Edwin\.agents\skills\stripe-best-practices\SKILL.md` |
| stripe-directory | Resolve documented engagement paths for external providers, merchants, platforms, APIs, and services. | user | `C:\Users\Edwin\.agents\skills\stripe-directory\SKILL.md` |
| stripe-docs | Search and read Stripe documentation and API reference. | user | `C:\Users\Edwin\.agents\skills\stripe-docs\SKILL.md` |
| stripe-projects | Provision infrastructure and third-party services through Stripe Projects. | user | `C:\Users\Edwin\.agents\skills\stripe-projects\SKILL.md` |
| supabase | Use for any Supabase database, auth, storage, realtime, functions, vectors, or CLI task. | user | `C:\Users\Edwin\.agents\skills\supabase\SKILL.md` |
| supabase-postgres-best-practices | Optimize and review Postgres queries, schema designs, and database configurations. | user | `C:\Users\Edwin\.agents\skills\supabase-postgres-best-practices\SKILL.md` |
| systemic-issue-triage | Triage issue floods by root class and shrink the system instead of fixing symptoms one by one. | user | `C:\Users\Edwin\.agents\skills\systemic-issue-triage\SKILL.md` |
| upgrade-stripe | Guide Stripe API and SDK upgrades. | user | `C:\Users\Edwin\.agents\skills\upgrade-stripe\SKILL.md` |
| work-unit-commits | Plan reviewable work-unit commits and keep tests and docs with code. | user | `C:\Users\Edwin\.agents\skills\work-unit-commits\SKILL.md` |
| xlsx | Read, create, edit, clean, or transform spreadsheet files. | user | `C:\Users\Edwin\.claude\skills\synced\f3decb59-35e6-407c-9bca-2a19d40ab133_2ab99a90-3c81-49cf-a00f-863ce7625a73\xlsx\SKILL.md` |

## Scan notes

- Indexed: 55 deduplicated skills (18 project-level, 37 user-level).
- Skipped by rule: all `sdd-*` skills, `_shared`, and `skill-registry`.
- Existing project conventions included: `CLAUDE.md`, `.specify/memory/constitution.md`, and `.specify/workflows/`.
- No matching registry observation was found. A tracked registry file was discovered during git inspection and fully refreshed with the installed scan rules.
