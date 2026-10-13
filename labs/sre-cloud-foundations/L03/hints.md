# L03 hints

1. **Boundary.** `Result: exit-code` with `status=1` means the application ran and chose to
   exit. systemd did what it was told. So: what did it tell the application (user, directory,
   environment, command), and what did the application see?
2. **Evidence source.** `journalctl -u beacon -n 20 --no-pager` for the application's own
   words; `systemctl show beacon -p User -p WorkingDirectory -p ExecStart` for what systemd
   gave it; `namei -l /etc/beacon/beacon.yaml` for who may read the file.
3. **Discriminating command.** `sudo -u beacon python3 -c "open('/etc/beacon/beacon.yaml')"`
   (permission problem shows here, path problem does not) and
   `sudo -u beacon sh -c 'cd $(systemctl show beacon -p WorkingDirectory --value) && python3 -c "import beacon"'`
   (module-path problem shows here).
4. **Root cause and fix.** Variant with `No module named beacon` / no such file: the unit's
   `WorkingDirectory=` is `/opt`, not `/opt/beacon`, so `python3 -m beacon` cannot find the
   package; fix the directive, `daemon-reload`, `restart`. Variant with `permission denied`: the
   config is `root:root 600`; `chown root:beacon /etc/beacon/beacon.yaml && chmod 640`
   (group read for the service user only), then `restart`. Never `chmod 777`, never `User=root`.
