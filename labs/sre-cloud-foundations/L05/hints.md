# L05 hints (four rungs; rungs 3–4 end independent credit for this attempt)

1. **Boundary.** Split the request into resolve → route → connect → answer, and find the first
   step that fails *from the client namespace*. The exact curl error already tells you whether
   the name resolved.
2. **Evidence source.** Compare three views of the same name: the resolver's (`dig name`), the
   parent's (`dig @10.55.2.53 +norec name`) and the child's (`dig @10.55.2.54 +norec name`). Read
   status, the `aa` flag, the AUTHORITY section and the TTLs. If the name resolves, read the
   client's routing table instead.
3. **Discriminating command.** If the child has the record with `aa` but the parent answers
   NXDOMAIN with `aa`, the problem is in the parent. If both servers are right and only the
   resolver disagrees, run `cachectl dump` and watch the SOA TTL in the resolver's answer. If DNS
   agrees everywhere, `ip -n looped-l05-client route get 10.55.2.80`.
4. **Root cause and fix.** A: the parent zone lost `beacon NS ns1.beacon.corp.lab.` and its glue;
   add them, bump the serial, HUP the parent, flush the name. B: a negative answer cached for 3600 s
   before the record was published; `cachectl flush api.beacon.corp.lab`. C: a stale
   `10.55.2.64/27 via 10.55.1.254` route; delete it.
