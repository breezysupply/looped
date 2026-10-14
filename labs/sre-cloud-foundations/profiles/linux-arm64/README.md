# Profile: linux-arm64 — the disposable Linux VM

Used by L01–L06 (and the host parts of L28/L32). macOS is not a Linux host: no systemd, no
Linux filesystems, no network namespaces. The host labs therefore run **inside** an ARM64
Ubuntu VM on your Apple Silicon Mac, created with [Lima](https://lima-vm.io/). It is
disposable: `vm-reset.sh` brings it back to the baseline in a couple of minutes, and
`vm-delete.sh` removes it.

| Pinned | Value |
|---|---|
| Lima | 1.0.x (`brew install lima`; `limactl --version`) |
| Guest | Ubuntu 24.04 LTS (noble), `arm64` cloud image, pinned by Lima's digest-checked image list in `looped-foundations.yaml` |
| Resources | 2 CPUs, 4 GiB, 20 GiB disk (change in the YAML before first create) |
| Python | 3.12 from the Ubuntu archive (stdlib only is used) |
| Tools in the guest | systemd, journald, iproute2, bind9-dnsutils, nginx, openssl, curl, jq, python3 |

**AMD64 note:** on an Intel Mac or a Linux PC the same YAML works with `arch: x86_64`; the
course was written for Apple Silicon and lists arm64 first.

## Create

```sh
brew install lima                                   # once
labs/sre-cloud-foundations/profiles/linux-arm64/vm-create.sh
```

`vm-create.sh` runs `limactl create --name looped-foundations looped-foundations.yaml`, starts
it, then runs `bootstrap.sh` inside: installs the guest packages, creates the `beacon` system
user and `/opt/beacon`, copies the Beacon starter from the repository, and writes
`/etc/looped-vm` (the marker every lab script checks before it touches anything).

The repository is mounted read/write at the same path as on your Mac, so evidence written by a
validator inside the VM lands in your Git workspace.

## Use

```sh
limactl shell looped-foundations                    # a shell in the VM, same working directory
limactl shell looped-foundations -- sudo bash labs/sre-cloud-foundations/L03/setup.sh
alias lv='limactl shell looped-foundations --'      # optional
```

Every host lab's commands are written to be run from the repository root **inside** the VM.

## Reset and delete

```sh
labs/sre-cloud-foundations/profiles/linux-arm64/vm-reset.sh   # stop, re-run bootstrap baseline (keeps the VM)
labs/sre-cloud-foundations/profiles/linux-arm64/vm-delete.sh  # limactl delete looped-foundations (asks first)
```

Reset re-runs the baseline and removes `/opt/beacon`, `/etc/beacon`, `/var/lib/beacon` and the
lab systemd units. It never touches your Mac.

## What this VM does not prove

- It is one VM on one laptop; nothing about multi-host, multi-zone or production load.
- Lima's networking is user-mode by default: the VM reaches the internet through the host; the
  network labs (L05) use **network namespaces inside the VM**, which is why they do not need
  a second machine.
- Resource faults (L04) are bounded inside the VM: a capped loop device for the "full
  filesystem", `stress`-style CPU load pinned to the VM's cores, and a memory hog with a limit.
  They cannot exhaust your Mac's disk or memory.

## Troubleshooting

See `docs/sre-cloud-foundations/troubleshooting.md` (Lima networking, slow first boot,
Rosetta not required, "/etc/looped-vm missing").
