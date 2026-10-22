# Build 1 (guided): a private bucket for operations artifacts.
# Work top to bottom. The first three resources are written for you with
# notes; you write the encryption resource, the tags and the outputs.
terraform {
  required_version = ">= 1.6.0, < 2.0.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws" # which provider plugin to download
      version = "~> 6.60"       # any 6.x from 6.60 on, never 7.0
    }
  }
}

provider "aws" {
  region = var.region # credentials are NOT set here; see the lesson
}

locals {
  tags = {
    project = var.project
    # TODO: add environment = var.environment once you declare that variable
  }
}

# resource TYPE "aws_s3_bucket", LOCAL NAME "artifacts".
# The REMOTE name in AWS is var.bucket_name — a third, different thing.
resource "aws_s3_bucket" "artifacts" {
  bucket = var.bucket_name
  tags   = local.tags
}

# Each of these manages one aspect of the same bucket. The reference
# aws_s3_bucket.artifacts.id is what ties them to it (and orders creation).
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

# TODO: aws_s3_bucket_server_side_encryption_configuration for the same bucket:
#   rule { apply_server_side_encryption_by_default { sse_algorithm = "AES256" } }
