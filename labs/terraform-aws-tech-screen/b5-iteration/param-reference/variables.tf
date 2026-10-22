variable "region" {
  type    = string
  default = "us-east-1"
}

variable "vpc_cidr" {
  description = "VPC range; must leave room for /24 subnets."
  type        = string
  default     = "10.60.0.0/16"

  validation {
    condition     = can(cidrhost(var.vpc_cidr, 0)) && tonumber(split("/", var.vpc_cidr)[1]) <= 22
    error_message = "vpc_cidr must be an IPv4 CIDR no smaller than /22."
  }
}

variable "instance_type" {
  description = "x86_64 types only, to match the AL2023 x86_64 AMI."
  type        = string
  default     = "t3.micro"

  validation {
    condition     = contains(["t3.micro", "t3.small", "t3.medium"], var.instance_type)
    error_message = "Choose t3.micro, t3.small or t3.medium."
  }
}
