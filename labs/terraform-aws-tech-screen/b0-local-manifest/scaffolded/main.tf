terraform {
  required_version = ">= 1.6.0, < 2.0.0"
}

locals {
  # TODO: a map named tags with project, environment and managed_by keys
}

resource "terraform_data" "manifest" {
  # TODO: input = an object with name ("<project>-<environment>") and tags
}
