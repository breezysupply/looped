/* Onsite track — mock interview presets.

   Each preset draws a fixed number of prompts from its pools, one at a time.
   Nothing here is an actual interview format: the agenda is unknown, so these
   are practice shapes. There is no AI grading — you answer out loud (or in the
   box), then compare against the rubric and rate yourself. The app records
   which prompts you have seen so a repeat session prefers fresh ones. */
window.LX = window.LX || {};
LX.onsiteMock = [
  { id: 'mock-15', title: 'Fundamentals', mins: 15,
    blurb: 'Five short prompts on how Kubernetes works. Aim for about two to three minutes each, spoken.',
    slots: [
      { kind: 'question', pool: ['ons-q-arch-01', 'ons-q-arch-02', 'ons-q-arch-03', 'ons-q-arch-09'] },
      { kind: 'question', pool: ['ons-q-arch-04', 'ons-q-arch-05', 'ons-q-arch-08'] },
      { kind: 'question', pool: ['ons-q-net-01', 'ons-q-net-02', 'ons-q-net-03'] },
      { kind: 'question', pool: ['ons-q-trouble-02', 'ons-q-trouble-03', 'ons-q-trouble-01'] },
      { kind: 'question', pool: ['ons-q-config-02', 'ons-q-config-03', 'ons-q-config-05', 'ons-q-arch-10'] }
    ] },
  { id: 'mock-30', title: 'Troubleshooting', mins: 30,
    blurb: 'One incident lab in independent mode, then troubleshooting questions with follow-ups. Talk through your reasoning as you go.',
    slots: [
      { kind: 'lab', pool: ['ons-lab-02', 'ons-lab-03', 'ons-lab-04', 'ons-lab-06', 'ons-lab-07', 'ons-lab-05'] },
      { kind: 'question', pool: ['ons-q-trouble-04', 'ons-q-trouble-06', 'ons-q-trouble-07', 'ons-q-trouble-08'] },
      { kind: 'question', pool: ['ons-q-net-04', 'ons-q-net-10', 'ons-q-trouble-01'] },
      { kind: 'question', pool: ['ons-q-trouble-09', 'ons-q-trouble-05', 'ons-q-trouble-10'] }
    ] },
  { id: 'mock-45', title: 'Mixed technical', mins: 45,
    blurb: 'Fundamentals, troubleshooting, identity, delivery and one lab — the broadest single session.',
    slots: [
      { kind: 'question', pool: ['ons-q-arch-01', 'ons-q-arch-03', 'ons-q-arch-05', 'ons-q-arch-06'] },
      { kind: 'question', pool: ['ons-q-net-04', 'ons-q-net-06', 'ons-q-net-09', 'ons-q-net-05'] },
      { kind: 'question', pool: ['ons-q-trouble-04', 'ons-q-trouble-07', 'ons-q-trouble-03'] },
      { kind: 'lab', pool: ['ons-lab-08', 'ons-lab-09', 'ons-lab-10', 'ons-lab-01'] },
      { kind: 'question', pool: ['ons-q-config-02', 'ons-q-config-04', 'ons-q-config-01', 'ons-q-config-08'] },
      { kind: 'question', pool: ['ons-q-delivery-01', 'ons-q-delivery-02', 'ons-q-delivery-05', 'ons-q-delivery-06'] },
      { kind: 'question', pool: ['ons-q-behavior-05', 'ons-q-behavior-02'] }
    ] },
  { id: 'mock-trouble-60', title: 'Infrastructure troubleshooting (full hour)', mins: 60,
    blurb: 'Shaped like the troubleshooting loop on your agenda: two interviewer-led cases (you ask for the evidence), one simulated incident in independent mode, and a verbal question. Practise narrating as if one interviewer were on video.',
    slots: [
      { kind: 'case', pool: ['ons-case-09', 'ons-case-11', 'ons-case-01', 'ons-case-03', 'ons-case-02', 'ons-case-06'] },
      { kind: 'lab', pool: ['ons-lab-02', 'ons-lab-03', 'ons-lab-07', 'ons-lab-04', 'ons-lab-06'] },
      { kind: 'case', pool: ['ons-case-10', 'ons-case-08', 'ons-case-05', 'ons-case-04', 'ons-case-07'] },
      { kind: 'question', pool: ['ons-q-trouble-09', 'ons-q-net-10', 'ons-q-trouble-10'] }
    ] },
  { id: 'mock-design-60', title: 'Architecture & system design (full hour)', mins: 60,
    blurb: 'Shaped like the architecture loop on your agenda: walk through a system you worked on, then one design problem led by the interviewer, paced for an hour.',
    slots: [
      { kind: 'walk', pool: ['ons-walk-bringup', 'ons-walk-transfer'] },
      { kind: 'design', pool: ['ons-design-webapp', 'ons-design-artifacts', 'ons-design-multicluster', 'ons-design-remediation', 'ons-design-stateful'] }
    ] },
  { id: 'mock-60', title: 'Design and operational judgment', mins: 60,
    blurb: 'A full design conversation led by the interviewer, then judgment and experience questions.',
    slots: [
      { kind: 'design', pool: ['ons-design-artifacts', 'ons-design-multicluster', 'ons-design-stateful', 'ons-design-remediation'] },
      { kind: 'question', pool: ['ons-q-design-01', 'ons-q-design-05', 'ons-q-design-07'] },
      { kind: 'question', pool: ['ons-q-delivery-07', 'ons-q-design-02', 'ons-q-design-08'] },
      { kind: 'question', pool: ['ons-q-behavior-01', 'ons-q-behavior-03', 'ons-q-behavior-06'] },
      { kind: 'question', pool: ['ons-q-behavior-04', 'ons-q-behavior-05'] }
    ] }
];

/* The self-assessment vocabulary used everywhere a prompt is rated. The first
   five mark a weakness to revisit; the last two are strengths. */
LX.onsiteFeedback = [
  { id: 'terminology', label: 'Terminology error', weak: true, tip: 'A term used for the wrong object or mechanism (e.g. "the Service restarts the pod").' },
  { id: 'mechanism', label: 'Incorrect mechanism', weak: true, tip: 'The explanation of how it works was wrong or missing a step.' },
  { id: 'evidence', label: 'Missing evidence', weak: true, tip: 'A conclusion without the command, event or log line that shows it.' },
  { id: 'unsafe', label: 'Unsafe remediation', weak: true, tip: 'A fix with a bigger blast radius than needed, or one that destroys evidence.' },
  { id: 'verification', label: 'Incomplete verification', weak: true, tip: 'No check that the fix worked, or a check that could pass while broken.' },
  { id: 'sound', label: 'Clear, technically sound', weak: false, tip: 'Accurate, structured, and backed by evidence.' },
  { id: 'alternative', label: 'Valid alternative approach', weak: false, tip: 'Different from the model answer but technically sound — counts as a strength.' }
];
