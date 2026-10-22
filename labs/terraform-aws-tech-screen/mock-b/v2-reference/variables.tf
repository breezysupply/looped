variable "region" {
  type    = string
  default = "us-west-2"
}

variable "availability_zone" {
  type    = string
  default = null
}

variable "name" {
  type    = string
  default = "mock-b-ingest"
}

variable "vpc_cidr" {
  type    = string
  default = "192.168.0.0/16"
}

variable "public_subnet_cidr" {
  type    = string
  default = "192.168.0.0/24"
}

variable "private_subnet_cidr" {
  type    = string
  default = "192.168.32.0/24"
}

variable "instance_type" {
  type    = string
  default = "t3.micro"
}

variable "partner_api_cidr" {
  description = "The only destination the worker may call, on HTTPS."
  type        = string
  default     = "203.0.113.0/24"
}

variable "package_mirror_cidr" {
  description = "Package repository range the bootstrap needs, on HTTPS."
  type        = string
  default     = "0.0.0.0/0"
}
