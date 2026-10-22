terraform {
  required_version = ">= 1.6.0, < 2.0.0"
  # TODO: required_providers with hashicorp/aws and a version constraint
}

# TODO: provider "aws" with region from a variable

locals {
  # TODO: tags map (project, environment, managed_by)
}

resource "aws_s3_bucket" "artifacts" {
  # TODO: bucket name from a variable; tags
}

resource "aws_s3_bucket_public_access_block" "artifacts" {
  # TODO: point at the bucket; set all four block/ignore/restrict flags
}

# TODO: versioning resource (status Enabled)

# TODO: server-side encryption configuration resource
