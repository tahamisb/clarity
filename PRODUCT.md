# Product

## Register

product

## Users

Mixed internal teams at Rafeeq, a Qatar-based food-delivery company. One shared
tool spanning three audiences with different tempos:

- **CX / support leadership** — monitor sentiment, call/message volumes, and
  emerging issues; decide what to act on.
- **Frontline agents** — review individual calls and messages during or right
  after handling them.
- **Ops / product / exec stakeholders** — read overall customer health and
  cancellation risk at a glance.

Context is operational and recurring: people open this during the workday, often
alongside other tools, to answer "what's happening with our customers right now
and what needs attention." The data is grounded in real Qatar operations —
order IDs, restaurant names, delivery areas, QAR amounts, Arabic-language
transcripts.

## Product Purpose

Rafeeq Analytics turns raw customer interactions (calls, support messages) into
decisions. It analyzes transcripts for sentiment, intent, and entities; surfaces
trends and negative-signal triggers across channels and geography; and predicts
cancellation risk. Success is when a leader spots a rising issue before it
escalates, an agent understands a customer faster, and an exec trusts the
customer-health read without exporting to a spreadsheet.

## Brand Personality

**Bold, modern, premium.** The interface is a precision instrument that happens
to look striking — it leans fully into the Rafeeq purple liquid-glass identity
rather than apologizing for being an internal tool. Confident, data-forward, and
high-end, but never decorative at the expense of legibility. Voice is direct and
expert: it states what the data says, it doesn't hedge.

## Anti-references

- **Generic SaaS template.** No Stripe/Linear-clone card grids, no hero-metric
  template (big number + small label + gradient accent), nothing that could be
  swapped into any other dashboard without noticing.
- **Flat & colorless.** No lifeless gray admin panel. The brand identity must be
  present and the hierarchy must be visible.
- **Toy / consumer-cute.** No over-rounded, gamified, or playful styling. This is
  an operational tool for professionals; warmth comes from polish, not whimsy.

## Design Principles

- **The signal is the interface.** Every screen leads with what needs attention
  (negative trends, risk, anomalies), not with a uniform wall of equal-weight
  metrics. Hierarchy reflects urgency.
- **Premium serves legibility.** The liquid-glass / purple identity is a feature,
  not a coat of paint — but contrast, density, and readability always win when
  they conflict with decoration.
- **Grounded in real operations.** Show real entities (orders, restaurants,
  areas, QAR, Arabic content) faithfully; the design must hold up to live,
  bilingual, messy data, not just clean demo data.
- **Confident, not busy.** Data-dense without being cluttered legacy BI. Earn
  density through rhythm and grouping, not by filling every pixel with controls.
- **Consistent across channels.** Calls, messages, cancellations, and CX views
  share one visual language so users move between them without relearning.

## Accessibility & Inclusion

- Target **WCAG 2.1 AA**: ≥4.5:1 body contrast, ≥3:1 large text, visible keyboard
  focus, sensible tab order.
- **Colorblind-safe sentiment**: never rely on red/green sentiment color alone —
  always pair with an icon, label, or shape.
- **Arabic / RTL support**: this serves Qatar. Layouts must accommodate
  right-to-left flow and Arabic typography in transcripts and content; mirror
  directional UI and choose type that renders Arabic cleanly.
- **Reduced motion**: every animation needs a `prefers-reduced-motion`
  alternative (crossfade or instant), given the liquid-glass motion vocabulary.
