# Trust bootstrap for the Beacon release key (receiving site)

Replace each prompt with what is true for this site. The validator checks the fingerprint.

## Fingerprint

The SHA-256 fingerprint of the release public key in work/receiver/trusted-keys/ (as printed by
`python3 assets/bundle.py fingerprint <key>`), and the command you used to compute it.

## Second channel

How the fingerprint reached this site independently of the transfer media (who read it to whom,
over what channel, and how both sides recorded it). Why a key that arrives inside a bundle can
never be trusted on its own.

## Rotation and fallback

What happens when the release key must change or is lost or compromised: how a new key is
introduced, how the old one is removed, and what the site does if no verifiable bundle can be
obtained in time (and what it must not do).

## Residual risks

What this process still does not protect against (name at least three), and who owns each.
