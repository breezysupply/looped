# Variant B only (dev root): bring the hand-made worker and its spool volume
# under Terraform. The volume imports cleanly (name + labels match); the
# container does not with this provider version (its import leaves env,
# ports, labels and mounts unset), so the first plan after import REPLACES
# it. That is acceptable for a stateless worker and is the reason the spool
# lives in a volume. Remove the import blocks after the apply.
import {
  to = docker_volume.spool
  id = "looped-l12-dev-spool"
}

resource "docker_volume" "spool" {
  name = "looped-l12-dev-spool"

  labels {
    label = "looped.lab/env"
    value = "dev"
  }
  labels {
    label = "looped.lab/id"
    value = "L12"
  }

  lifecycle {
    prevent_destroy = true
  }
}

resource "docker_container" "worker" {
  name        = "looped-l12-dev-worker"
  image       = module.beacon.image_id
  working_dir = "/src"
  command     = ["python3", "-m", "beacon", "worker", "--config", "/src/beacon.yaml"]
  env = [
    "BEACON_APP_ENVIRONMENT=dev",
    "BEACON_STORE_KIND=memory",
    "BEACON_QUEUE_KIND=dir",
    "BEACON_QUEUE_DIR=/spool",
    "BEACON_WORKER_EFFECTS_PATH=/spool/effects.jsonl",
    "PYTHONDONTWRITEBYTECODE=1",
  ]

  mounts {
    type      = "bind"
    source    = abspath("${path.root}/../../../../beacon")
    target    = "/src"
    read_only = true
  }

  volumes {
    volume_name    = docker_volume.spool.name
    container_path = "/spool"
  }

  networks_advanced {
    name = module.beacon.network_id
  }

  labels {
    label = "looped.lab/env"
    value = "dev"
  }
  labels {
    label = "looped.lab/id"
    value = "L12"
  }
}
