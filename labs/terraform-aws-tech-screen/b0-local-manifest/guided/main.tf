# Build 0 (guided). Read each comment, then fill the two marked gaps.
terraform {
  # Any 1.x release from 1.6 on can run this lab.
  required_version = ">= 1.6.0, < 2.0.0"
}

locals {
  # A map: keys on the left, values on the right. Values can reference
  # variables declared in variables.tf.
  tags = {
    project     = var.project
    environment = var.environment
    # TODO: add a third tag, managed_by = "terraform"
  }
}

# resource "<TYPE>" "<LOCAL NAME>" — the type says what kind of object;
# the local name is how other blocks refer to it (terraform_data.manifest).
resource "terraform_data" "manifest" {
  input = {
    # String interpolation joins two variables with a hyphen.
    name = "${var.project}-${var.environment}"
    # TODO: store the tags map here as tags = local.tags
  }
}
