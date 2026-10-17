variable "region" {
  type    = string
  default = "us-east-1"
}

variable "admin_cidr" {
  type    = string
  default = "198.51.100.45/32"
}

variable "ami_id" {
  description = "An Amazon Linux 2023 AMI ID for the Region."
  type        = string
}
