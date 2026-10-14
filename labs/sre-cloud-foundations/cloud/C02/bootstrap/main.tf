# C02 bootstrap — the state bucket (local state for this stack only).
terraform {
  required_version = ">= 1.10.0"
  required_providers {
    aws    = { source = "hashicorp/aws", version = "6.60.0" }
    random = { source = "hashicorp/random", version = "3.7.2" }
  }
}
variable "region" { type = string }
provider "aws" {
  region = var.region
  default_tags { tags = { "looped:lab" = "c02" } }
}
resource "random_id" "suffix" { byte_length = 4 }
resource "aws_s3_bucket" "state" { bucket = "looped-c02-state-${random_id.suffix.hex}" }
resource "aws_s3_bucket_versioning" "state" {
  bucket = aws_s3_bucket.state.id
  versioning_configuration { status = "Enabled" }
}
resource "aws_s3_bucket_server_side_encryption_configuration" "state" {
  bucket = aws_s3_bucket.state.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}
resource "aws_s3_bucket_public_access_block" "state" {
  bucket                  = aws_s3_bucket.state.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
output "bucket" { value = aws_s3_bucket.state.bucket }
