variable "region" {
  description = "AWS Region to build in."
  type        = string
  default     = "us-east-1"
}

variable "name" {
  description = "Prefix for Name tags."
  type        = string
  default     = "ar1-lab"
}

variable "vpc_cidr" {
  description = "VPC address range."
  type        = string
  default     = "10.20.0.0/16"

  validation {
    condition     = can(cidrhost(var.vpc_cidr, 0))
    error_message = "vpc_cidr must be an IPv4 CIDR block such as 10.20.0.0/16."
  }
}

variable "admin_cidr" {
  description = "The only range allowed to SSH in, for example your office /32."
  type        = string

  validation {
    condition     = can(cidrhost(var.admin_cidr, 0)) && var.admin_cidr != "0.0.0.0/0"
    error_message = "admin_cidr must be a CIDR block and must not be 0.0.0.0/0."
  }
}
