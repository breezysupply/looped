terraform {
  required_version = ">= 1.6.0, < 2.0.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.60"
    }
  }
}

# Credentials come from your environment (AWS_PROFILE, SSO, instance role),
# never from this file.
provider "aws" {
  region = var.region
}

locals {
  tags = {
    project     = var.project
    environment = var.environment
    purpose     = "ops-artifacts"
    managed_by  = "terraform"
  }
}

# The bucket itself. Everything else about it is a separate resource that
# points back here with bucket = aws_s3_bucket.artifacts.id.
resource "aws_s3_bucket" "artifacts" {
  bucket = var.bucket_name
  tags   = local.tags
  # force_destroy is left at its default (false): Terraform will refuse to
  # delete a bucket that still holds objects.
}

resource "aws_s3_bucket_public_access_block" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}
