# Build 0: a deployment manifest that lives only in Terraform state.
# terraform_data is built into Terraform (1.4+): no provider download,
# no cloud account, no credentials.
terraform {
  required_version = ">= 1.6.0, < 2.0.0"
}

locals {
  # One place to define the tags every resource in a project would carry.
  tags = {
    project     = var.project
    environment = var.environment
    managed_by  = "terraform"
  }
}

resource "terraform_data" "manifest" {
  input = {
    name = "${var.project}-${var.environment}"
    tags = local.tags
  }
}
