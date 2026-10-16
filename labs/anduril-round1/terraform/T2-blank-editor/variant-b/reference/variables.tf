variable "region" {
  type    = string
  default = "us-east-1"
}

variable "name" {
  type    = string
  default = "partner-api"
}

variable "vpc_cidr" {
  type    = string
  default = "172.20.0.0/16"
}

variable "partner_cidr" {
  description = "The partner's published egress range."
  type        = string
  default     = "198.51.100.0/24"
}
