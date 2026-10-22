variable "region" {
  type    = string
  default = "us-east-2"
}

variable "availability_zone" {
  type    = string
  default = null
}

variable "name" {
  description = "Prefix for Name tags."
  type        = string
  default     = "harbor-jobs"
}

variable "vpc_cidr" {
  type    = string
  default = "10.80.0.0/16"
}

variable "public_subnet_cidr" {
  type    = string
  default = "10.80.0.0/24"
}

variable "private_subnet_cidr" {
  type    = string
  default = "10.80.20.0/24"
}

variable "instance_type" {
  type    = string
  default = "t3.micro"
}

variable "extra_tags" {
  description = "Tags added to every resource."
  type        = map(string)
  default     = {}
}
