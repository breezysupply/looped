locals {
  out_dir = "${path.module}/out/${var.environment}"

  # Rendered once and used twice: the file itself and its checksum in the manifest.
  config = templatefile("${path.module}/templates/beacon.yaml.tftpl", {
    environment   = var.environment
    listen_port   = var.listen_port
    app_version   = var.app_version
    store_kind    = var.store_kind
    store_path    = var.store_path
    admin_enabled = var.admin_enabled
  })
}

# A stable identifier for this environment's deployment. `keepers` ties its
# lifetime to the environment: change the environment and Terraform must
# replace it (a new id), which is exactly what a plan should make you notice.
resource "random_id" "deploy" {
  byte_length = 4
  keepers = {
    environment = var.environment
  }
}

resource "local_file" "config" {
  filename        = "${local.out_dir}/beacon.yaml"
  content         = local.config
  file_permission = "0640"
}

# Depends on both resources above through references, so the graph has
# random_id.deploy -> local_file.manifest <- local_file.config.
resource "local_file" "manifest" {
  filename = "${local.out_dir}/manifest.json"
  content = jsonencode({
    service        = "beacon"
    environment    = var.environment
    deploy_id      = random_id.deploy.hex
    app_version    = var.app_version
    config_file    = basename(local_file.config.filename)
    config_sha256  = sha256(local_file.config.content)
    generated_with = "terraform (L11)"
  })
  file_permission = "0640"
}
