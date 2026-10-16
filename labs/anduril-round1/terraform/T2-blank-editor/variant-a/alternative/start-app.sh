#!/bin/bash
dnf install -y python3
cd /tmp && nohup python3 -m http.server 8080 >/var/log/app.log 2>&1 &
