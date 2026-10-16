variable "region" {
  type    = string
  default = "us-east-1"
}

variable "admin_cidr" {
  type = string

  validation {
    condition     = can(cidrhost(var.admin_cidr, 0)) && var.admin_cidr != "0.0.0.0/0"
    error_message = "admin_cidr must be a CIDR block and must not be 0.0.0.0/0."
  }
}
