variable "region" {
  type    = string
  default = "us-east-1"
}

variable "name" {
  type    = string
  default = "ridgeline-web"
}

variable "vpc_cidr" {
  type    = string
  default = "10.30.0.0/16"
}

variable "instance_type" {
  type    = string
  default = "t3.micro"
}

variable "admin_cidr" {
  description = "The only range allowed to SSH in."
  type        = string

  validation {
    condition     = can(cidrhost(var.admin_cidr, 0)) && var.admin_cidr != "0.0.0.0/0"
    error_message = "admin_cidr must be a CIDR block and must not be 0.0.0.0/0."
  }
}
