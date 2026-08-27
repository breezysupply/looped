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
    id: 'linux', name: 'Linux', short: 'Linux', ico: '❯_',
    blurb: 'The command line, the process model, and the incidents every ops interview reaches for.',
    cats: {
      files: 'Files & Nav', text: 'Text', search: 'Search', perms: 'Permissions',
      procs: 'Processes', disk: 'Disk', users: 'Users', net: 'Networking',
      transfer: 'SSH & Transfer', pkg: 'Packages', sys: 'System & systemd',
      shell: 'Shell', cloud: 'Cloud / EC2', ops: 'On-call', behavioral: 'Behavioral'
    }
  },
  {
    id: 'containers', name: 'Containers & Networking', short: 'Containers', ico: '▣',
    blurb: 'Docker, Kubernetes and the network path a packet actually takes. Empty until Phase 1.',
    cats: {
      images: 'Images & Builds', runtime: 'Runtime & Lifecycle', k8s: 'Kubernetes',
      netns: 'Namespaces & Bridges', svc: 'Services & Ingress', dns: 'Cluster DNS',
      vpc: 'VPC & Subnets', fw: 'Security Groups & NACLs', storage: 'Volumes & Storage',
      registry: 'Registries', ops: 'On-call'
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
  /* content predates the track field in one place only: anything unlabelled is
     Linux, which is what the whole library was before this existed */
  of: function (x) { return (x && x.track) || 'linux'; },
  inTrack: function (x, trackId) {
    return !trackId || trackId === 'all' || LX.track.of(x) === trackId;
  }
};
