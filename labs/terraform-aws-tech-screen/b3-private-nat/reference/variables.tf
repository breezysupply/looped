variable "region" {
  type    = string
  default = "us-east-1"
}

variable "availability_zone" {
  type    = string
  default = null
}

variable "name" {
  type    = string
  default = "ridgeline-worker"
}

variable "vpc_cidr" {
  type    = string
  default = "10.50.0.0/16"
}

variable "public_subnet_cidr" {
  type    = string
  default = "10.50.0.0/24"
}

variable "private_subnet_cidr" {
  type    = string
  default = "10.50.10.0/24"
}

variable "instance_type" {
  type    = string
  default = "t3.micro"
}
