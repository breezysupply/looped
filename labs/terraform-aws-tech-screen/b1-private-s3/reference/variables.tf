variable "region" {
  description = "AWS Region for the bucket."
  type        = string
  default     = "us-east-1"
}

variable "project" {
  type    = string
  default = "ridgeline"
}

variable "environment" {
  type    = string
  default = "dev"
}

variable "bucket_name" {
  description = "Globally unique S3 bucket name you choose, e.g. ridgeline-ops-artifacts-<your initials>-<random digits>."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$", var.bucket_name))
    error_message = "Use 3-63 lowercase letters, digits, dots or hyphens, starting and ending with a letter or digit."
  }
}
