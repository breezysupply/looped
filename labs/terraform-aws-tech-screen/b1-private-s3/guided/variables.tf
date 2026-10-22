variable "region" {
  type    = string
  default = "us-east-1"
}

variable "project" {
  type    = string
  default = "ridgeline"
}

# Bucket names are global across all AWS accounts: pick something only you
# would use, 3-63 lowercase letters, digits, dots or hyphens.
variable "bucket_name" {
  type = string
}

# TODO: variable "environment" (type string, default "dev")
