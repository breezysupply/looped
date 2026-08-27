/* Track registry.

   A track is a domain of the job — Linux, containers, AWS, identity, and so on.
   Every content record carries `track`, and the app scopes chips, search, quiz
   pools and the review deck to the active one, so adding 500 AWS items does not
   flood the Linux deck.

   Each track owns its own category map. That is deliberate: `net` in Linux and
   `net` in AWS are different subjects, and a single flat CATS table would either
   collide or grow into a mess. Categories are addressed as `<track>:<cat>` in the
   registry and stored bare on the records themselves.

   This file must load before any content file and before app.js. */
window.LX = window.LX || { commands: [], scenarios: [], drills: [] };

LX.tracks = [
  {
    id: 'linux', name: 'Linux', short: 'Linux', ico: '❯_', 'default': true,
    blurb: 'The command line, the process model, and the incidents every ops interview reaches for.',
    /* Loaded eagerly because it is the default track; every other track's files
       are injected on first switch. tools/build.js reads this list. */
    files: [
      'assets/js/data/commands-core.js', 'assets/js/data/commands-system.js',
      'assets/js/data/commands-net.js', 'assets/js/data/commands-more.js',
      'assets/js/data/scenarios.js', 'assets/js/data/scenarios-more.js',
      'assets/js/data/playbooks.js', 'assets/js/data/playbooks-more.js',
      'assets/js/data/playbook-outputs.js',
      'assets/js/data/drills.js', 'assets/js/data/drills-more.js',
      'assets/js/data/quiz-extra.js',
      'assets/js/data/labs.js', 'assets/js/data/labs-more.js',
      'assets/js/data/missions.js'
    ],
    cats: {
      files: 'Files & Nav', text: 'Text', search: 'Search', perms: 'Permissions',
      procs: 'Processes', disk: 'Disk', users: 'Users', net: 'Networking',
      transfer: 'SSH & Transfer', pkg: 'Packages', sys: 'System & systemd',
      shell: 'Shell', cloud: 'Cloud / EC2', ops: 'On-call', behavioral: 'Behavioral'
    }
  },
  {
    id: 'containers', name: 'Containers & Networking', short: 'Containers', ico: '▣',
    blurb: 'Docker, Kubernetes, and the network path a packet actually takes.',
    /* shell-containers.js belongs to the track, not the engine: 25 KB of kubectl
       and docker that only this track needs. It guards on LXShell.register and
       sandbox.js reads LXShell.commands() at call time, so arriving late is fine. */
    files: [
      'assets/js/shell-containers.js',
      'assets/js/data/containers-docker.js', 'assets/js/data/containers-k8s.js',
      'assets/js/data/containers-net.js', 'assets/js/data/containers-playbooks.js',
      'assets/js/data/containers-outputs.js', 'assets/js/data/containers-drills.js',
      'assets/js/data/containers-labs.js', 'assets/js/data/containers-missions.js'
    ],
    cats: {
      images: 'Images & Builds', runtime: 'Runtime & Lifecycle', k8s: 'Kubernetes',
      netns: 'Namespaces & Bridges', svc: 'Services & Ingress', dns: 'Cluster DNS',
      vpc: 'VPC & Subnets', fw: 'Security Groups & NACLs', storage: 'Volumes & Storage',
      registry: 'Registries', ops: 'On-call'
    }
  },
  {
    id: 'aws', name: 'AWS', short: 'AWS', ico: '◇',
    blurb: 'EC2, VPC, IAM and the services an on-call engineer is actually paged about.',
    /* No shell extension: there is no simulated control plane, so this track
       teaches by sample output rather than by typing. */
    files: [
      'assets/js/data/aws-compute.js', 'assets/js/data/aws-network.js',
      'assets/js/data/aws-iam.js', 'assets/js/data/aws-data.js',
      'assets/js/data/aws-playbooks.js', 'assets/js/data/aws-outputs.js',
      'assets/js/data/aws-drills.js', 'assets/js/data/aws-labs.js'
    ],
    cats: {
      ec2: 'EC2 & Compute', img: 'AMIs & Launch Templates', scale: 'Auto Scaling & Load Balancing',
      vpc: 'VPC & Routing', sg: 'Security Groups & NACLs', iam: 'IAM & Policy',
      kms: 'KMS & Secrets', s3: 'S3', rds: 'RDS', obs: 'CloudTrail & Observability',
      org: 'Organizations & Control Tower', dr: 'Backup & DR', cost: 'Cost & Quotas'
    }
  }
];

/* Registry helpers. Kept here rather than in app.js so content tooling and the
   node-side validators can use them without a DOM. */
LX.track = {
  byId: function (id) {
    for (var i = 0; i < LX.tracks.length; i++) if (LX.tracks[i].id === id) return LX.tracks[i];
    return null;
  },
  ids: function () {
    return LX.tracks.map(function (t) { return t.id; });
  },
  /* every category across every track, for the "All tracks" view */
  cats: function (trackId) {
    if (trackId && trackId !== 'all') {
      var t = LX.track.byId(trackId);
      return t ? t.cats : {};
    }
    var all = {};
    LX.tracks.forEach(function (x) {
      Object.keys(x.cats).forEach(function (c) { if (!all[c]) all[c] = x.cats[c]; });
    });
    return all;
  },
  /* label for a category code, searched across tracks so a record from another
     track still renders a name rather than its raw code */
  catName: function (c, trackId) {
    var t = trackId && trackId !== 'all' ? LX.track.byId(trackId) : null;
    if (t && t.cats[c]) return t.cats[c];
    for (var i = 0; i < LX.tracks.length; i++) if (LX.tracks[i].cats[c]) return LX.tracks[i].cats[c];
    return c;
  },
  /* ── Lazy loading ────────────────────────────────────────────────
     Only the default track ships as <script> tags in index.html. Everything
     else is injected on first switch, which keeps first paint at one track's
     worth of content however many tracks exist. sw.js still precaches every
     file, so a track opened for the first time works offline. */
  loaded: {},
  files: function (id) {
    if (id === 'all') {
      var all = [];
      LX.tracks.forEach(function (t) {
        (t.files || []).forEach(function (f) { if (all.indexOf(f) === -1) all.push(f); });
      });
      return all;
    }
    var t = LX.track.byId(id);
    return t ? (t.files || []).slice() : [];
  },
  isLoaded: function (id) {
    if (id === 'all') return LX.track.ids().every(function (x) { return LX.track.loaded[x]; });
    return !!LX.track.loaded[id];
  },
  /* Injects a track's files in order and calls back when the last one has run.
     Order matters — a mission file references helpers from objectives.js and a
     playbook's outputs are keyed to its ids — so these are strictly sequential
     rather than parallel. */
  load: function (id, cb) {
    cb = cb || function () {};
    var pending = (id === 'all' ? LX.track.ids() : [id]).filter(function (x) {
      return !LX.track.loaded[x];
    });
    if (!pending.length) return cb();
    var files = [];
    pending.forEach(function (t) {
      LX.track.files(t).forEach(function (f) { if (files.indexOf(f) === -1) files.push(f); });
    });
    /* mark first: a second switch while this one is in flight must not
       inject the same file twice */
    pending.forEach(function (t) { LX.track.loaded[t] = true; });

    if (typeof document === 'undefined') return cb();
    var i = 0;
    (function next() {
      if (i >= files.length) return cb();
      var src = files[i++];
      if (document.querySelector('script[src="' + src + '"]')) return next();
      var el = document.createElement('script');
      el.src = src;
      el.async = false;
      el.onload = next;
      el.onerror = function () {
        /* offline with a file the cache missed: carry on rather than hang the UI */
        if (window.console) console.error('looped: could not load ' + src);
        next();
      };
      document.head.appendChild(el);
    })();
  },

  /* content predates the track field in one place only: anything unlabelled is
     Linux, which is what the whole library was before this existed */
  of: function (x) { return (x && x.track) || 'linux'; },
  inTrack: function (x, trackId) {
    return !trackId || trackId === 'all' || LX.track.of(x) === trackId;
  }
};

/* How much each track holds, for the picker. A lazily loaded track has not run
   when the sheet is drawn, so this cannot be counted live — see tools/build.js. */
/* generated by tools/build.js — do not edit by hand */
LX.trackCounts = {
  linux: 239,
  containers: 79,
  aws: 83
};
/* /generated */
