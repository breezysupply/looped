/* Onsite track — the conversations around the technical loops.

   Prep for the co-founder conversation, lunch, and the hiring-manager
   conversation on the confirmed agenda, plus arrival and the close. Roles
   only: no interviewer names belong in this repository.

   Built from facts you gave about your background and from the role themes;
   nothing here claims to know the company's internal stack or plans. Where
   an answer needs something only you know — your motivations, your role,
   outcomes — there is a blank. Blanks and your chosen questions are stored
   only in this browser.

   "What they may be listening for" is a reasonable guess from the role and
   the format, not inside knowledge. */
window.LX = window.LX || {};
LX.onsiteTalk = [
  {
    id: 'talk-arrival', track: 'onsite', slot: '10:45–11:00 EDT', title: 'Arrival and office tour (Director, Engineering)',
    listen: ['First impressions are formed here, even though it is not an interview slot.', 'Curiosity about the team and the space.'],
    prepare: [
      { q: 'Small talk that is actually useful',
        structure: ['A question about the team or the office that shows interest (how the space is used, who sits where, what the team is working on this month).', 'One short line about why you are glad to be there — save the full story for later.'],
        fields: ['One question you will ask on the tour'] }
    ],
    ask: [],
    notes: ['Confirm the time zone beforehand: the invitation lists EDT; an Austin office runs on Central time.', 'Arrive a little early; have the agenda on your phone so you know who is next.']
  },
  {
    id: 'talk-cofounder', track: 'onsite', slot: '11:00–11:30 EDT', title: 'Co-founder conversation (CTO, virtual)',
    listen: [
      'Why you, why this role, why now — in your own words, briefly.',
      'How you think about hard infrastructure problems: trade-offs, judgment, ownership.',
      'Honesty about where you are strong and where you are still growing.',
      'Whether you are curious about the problems the company works on.'
    ],
    prepare: [
      { q: '"Tell me about yourself" — about 90 seconds',
        structure: [
          'Start: about ten years as an Army signals intelligence analyst, then government contracting.',
          'Then: about four years at AWS operating a managed search service in air-gapped regions.',
          'What that work was: bringing a service online in new, isolated regions — identity, authorization, DNS, certificates, artifact distribution, feature enablement, validation and readiness — plus incident response, controlled deployments, monitoring, runbooks and automation.',
          'The bridge: why that experience points at this role (disconnected environments, trusted delivery, reliability).',
          'Close with what you want next — one sentence.'
        ],
        fields: ['Your one-sentence bridge from that work to this role', 'What you want next, in one sentence'] },
      { q: '"Why this role, and why now?"',
        structure: [
          'The problems in the role — disconnected and edge deployments, trusted artifact distribution, reliability across commercial and government environments — are the ones you have worked on.',
          'What you want to grow into: deeper Kubernetes and platform ownership.',
          'Why now: [your reason].'
        ],
        fields: ['What specifically draws you to this role', 'Why now (your real reason)'] },
      { q: '"Your background is mostly AWS-managed services. How should we think about the Kubernetes gap?"',
        structure: [
          'State it plainly: your production depth is in AWS services and operations, not Kubernetes.',
          'What transfers directly: incident response, controlled rollouts, identity and certificates, DNS, artifact verification, runbooks.',
          'What you have done since the recruiter feedback: [the labs and hands-on practice you actually completed — check Prep › Progress].',
          'Be clear that practice labs are not production experience, and say how you would ramp in the first months.'
        ],
        question: 'ons-q-behavior-05',
        fields: ['What you have actually done since the feedback (be specific and honest)'] },
      { q: '"Tell me about a hard problem you solved"',
        structure: ['Use a story where the obvious answer was wrong — the DNS delegation story fits.', 'Situation, the evidence that changed your mind, what you did, how you verified, what you would do now.'],
        story: 'ons-story-dns', question: 'ons-q-behavior-02',
        fields: ['The one sentence that makes the story interesting'] }
    ],
    ask: [
      'What are the hardest infrastructure problems the company needs solved in the next year?',
      'How do customer environments — commercial, government, disconnected — shape technical decisions today?',
      'How do you decide what to build versus adopt, especially for delivery and security tooling?',
      'What distinguishes the infrastructure engineers who do best here?',
      'What would you want someone in this role to have changed a year from now?'
    ],
    notes: ['It is on video: test camera and audio, have water and your notes, and look at the camera when you answer.', 'Thirty minutes goes fast — keep answers to about two minutes and leave five minutes for your questions.']
  },
  {
    id: 'talk-lunch', track: 'onsite', slot: '12:30–1:30 EDT', title: 'Lunch (with your architecture interviewer)',
    listen: ['What you are like to work with day to day.', 'Genuine curiosity about how the team works.'],
    prepare: [
      { q: 'If the design interview comes up',
        structure: ['Do not relitigate it. One genuine follow-up thought is fine — "I kept thinking about how I would handle X" — and can be a good sign.', 'Then move the conversation to them.'],
        fields: ['One thing from the design interview you would genuinely like to hear their view on'] },
      { q: 'A short, human version of how you share knowledge',
        structure: ['The runbook story, told casually: incomplete instructions consolidated into a reusable runbook with prerequisites and validation.'],
        story: 'ons-story-runbook', question: 'ons-q-behavior-04',
        fields: [] }
    ],
    ask: [
      'What does a typical week look like for you?',
      'How does on-call work, and what does a bad week look like?',
      'How are incidents run and followed up?',
      'How do you test infrastructure changes before they reach customers?',
      'What do you wish you had known when you joined?'
    ],
    notes: ['Lunch is part of the day. Be relaxed, not careless.', 'Ask about them; listen more than you talk.']
  },
  {
    id: 'talk-hm', track: 'onsite', slot: '2:30–3:00 EDT', title: 'Hiring-manager conversation (Director, Engineering)',
    listen: [
      'Ownership: what you did yourself, and how you follow through.',
      'Judgment under ambiguity, and when you escalate.',
      'Collaboration and written communication.',
      'How you would ramp up, and what support you need.'
    ],
    prepare: [
      { q: '"Tell me about a time a change went wider than intended"',
        structure: ['The scope story: empty scoping criteria treated as unrestricted, a missing identity prerequisite, the response.', 'Your part, the evidence, what changed afterwards — only what you know.'],
        story: 'ons-story-scope', question: 'ons-q-behavior-01', fields: [] },
      { q: '"Tell me about escalating to another team"',
        structure: ['The capacity story: repeated remediation from a few clusters consuming shared capacity; ruling out other bottlenecks; an evidence-backed escalation.'],
        story: 'ons-story-capacity', question: 'ons-q-behavior-03', fields: [] },
      { q: '"What would your first 90 days look like?"',
        structure: [
          'First month: learn the systems, the delivery path and on-call; shadow, read incidents and runbooks, ask a lot.',
          'Second month: take on a scoped piece of work end to end and ship it safely.',
          'Third month: own an area, improve something you noticed (a runbook, a check, an alert), and be on the on-call rotation.',
          'Name where you will need support: Kubernetes depth in their environment.'
        ],
        fields: ['One thing you would expect to improve early, stated as a question to them'] },
      { q: '"How do you handle disagreement?"',
        structure: ['Disagree with evidence, in writing where it matters, commit once decided, and revisit with data.', 'A real example: [yours].'],
        fields: ['Your example (one sentence)'] }
    ],
    ask: [
      'What does success look like for this role at six months and at a year?',
      'What is the team\'s biggest challenge right now?',
      'How is ownership split across the team, and how does on-call work?',
      'How do people grow here — technically and in scope?',
      'Is there anything in my background you would want me to address before we finish?',
      'What are the next steps and the timeline?'
    ],
    notes: ['Last conversation of the day: keep energy up, and make your close count.']
  },
  {
    id: 'talk-close', track: 'onsite', slot: 'End of day', title: 'Closing the day',
    listen: ['Clear interest, and a clear picture of what you would bring.'],
    prepare: [
      { q: 'Your 30-second close with the hiring manager',
        structure: [
          'Thank them for the day.',
          'One sentence on why you are excited about the role, tied to something you heard today.',
          'One sentence on what you would bring — the transferable experience — and how you are closing the Kubernetes gap.',
          'Ask about next steps.'
        ],
        fields: ['Your close, in your own words'] },
      { q: 'After the day',
        structure: ['A short thank-you note to the recruiter the same day, mentioning one specific thing from a conversation.', 'Write down the questions you were asked while they are fresh — they are useful whatever happens.'],
        fields: [] }
    ],
    ask: [],
    notes: []
  }
];
