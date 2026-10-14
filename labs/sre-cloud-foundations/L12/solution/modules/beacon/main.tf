locals {
  prefix = "looped-l12-${var.env}"
  labels = {
    "looped.lab/id"  = "L12"
    "looped.lab/env" = var.env
  }
}

resource "docker_network" "beacon" {
  name = "${local.prefix}-net"

  dynamic "labels" {
    for_each = local.labels
    content {
      label = labels.key
      value = labels.value
    }
  }
}

# Beacon's records live here. Any plan that would destroy or replace this
# volume now fails instead of silently deleting data.
resource "docker_volume" "data" {
  name = "${local.prefix}-data"

  dynamic "labels" {
    for_each = merge(local.labels, var.extra_volume_labels)
    content {
      label = labels.key
      value = labels.value
    }
  }

  lifecycle {
    prevent_destroy = true
  }
}

resource "docker_image" "python" {
  name         = var.image
  keep_locally = true
}

resource "docker_container" "api" {
  name        = "${local.prefix}-api"
  image       = docker_image.python.image_id
  working_dir = "/src"
  command     = ["python3", "-m", "beacon", "api", "--config", "/src/beacon.yaml"]
  env = [
    "BEACON_APP_ENVIRONMENT=${var.env}",
    "BEACON_STORE_KIND=sqlite",
    "BEACON_STORE_PATH=/data/beacon.db",
    "BEACON_QUEUE_KIND=none",
    "PYTHONDONTWRITEBYTECODE=1",
  ]

  ports {
    internal = 8080
    external = var.api_port
    ip       = "127.0.0.1"
  }

  mounts {
    type      = "bind"
    source    = var.beacon_src
    target    = "/src"
    read_only = true
  }

  volumes {
    volume_name    = docker_volume.data.name
    container_path = "/data"
  }

  networks_advanced {
    name = docker_network.beacon.id
  }

  dynamic "labels" {
    for_each = local.labels
    content {
      label = labels.key
      value = labels.value
    }
  }
}
